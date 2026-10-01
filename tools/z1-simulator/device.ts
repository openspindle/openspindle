import { SETTER_RADIUS } from "../../src/domain/fixtures/makera-z1/tool-setter.ts"
import { readSimulatedBedLine } from "../../src/machine/contract/simulator.ts"
import type { SimulatedBed } from "../../src/machine/contract/simulator.ts"
import { FRAME_TYPES } from "../../src/machine/firmware/makera/codec.ts"
import type { Frame } from "../../src/machine/firmware/makera/codec.ts"
import {
  CLEARANCE_Z,
  DEFAULT_SURFACE_Z,
  changeTool,
  heightTable,
  levelGrid,
  machineOf,
  originRoutine,
  probeZ,
  sensorZ,
  setReference,
} from "./automation.ts"
import type { Grid, Step, ToolLengths } from "./automation.ts"
import {
  CONFIGURATION_PATH,
  initialConfiguration,
  savedSetting,
  withSavedSetting,
} from "./configuration.ts"
import { TransferEndpoint } from "./transfer.ts"
import type { TransferOptions } from "./transfer.ts"

export type SimulatorOptions = {
  readonly model: 3 | 4
  readonly atc: boolean
  readonly bedClean: boolean
  readonly homed: boolean
  /** The active tool at start; the firmware keeps it in EEPROM across restarts. */
  readonly tool: number
  /** Anchor 1's machine X and Y, then anchor 2's offset from it (`coordinate.*`). */
  readonly anchors: readonly [number, number, number, number]
  /** Milliseconds per played program line, moves taking their own time on top. */
  readonly lineMs: number
  /** How many times faster than the machine it moves. */
  readonly speed: number
  /** Skip the one-second done snapshot: P vanishes without a completion report. */
  readonly noDoneSnapshot: boolean
  /** Halt with a probe failure when this 1-based line plays. */
  readonly failAtLine: number | null
  /** Commands (regular expression) whose acknowledgement is never sent. */
  readonly dropAcks: RegExp | null
  /**
   * Every play is given another file, one line longer, as when the ESP32 finds another file by
   * the CRC-16 of the name `play` asks for: `File size` reports that file's size.
   */
  readonly otherFile: boolean
  readonly transfer: TransferOptions
}

type Send = (type: number, payload?: Uint8Array | string) => void
type Xyz = [number, number, number]
type Progress = { line: number; percent: number; elapsed: number }
/** A G2 or G3 arc in X and Y: the centre it turns about and the angle it sweeps. */
type Arc = { readonly centre: [number, number]; readonly sweep: number }
/** A move under way from `from` to `to`, starting when the one before it ends. */
type Motion = {
  readonly from: Xyz
  readonly to: Xyz
  readonly startedAt: number
  readonly ms: number
  /** mm/min, as the status reports it. */
  readonly rate: number
  readonly arc: Arc | null
}

type Player = {
  readonly path: string
  readonly lines: string[]
  readonly bytes: number
  /** Played with -v: each played line's reply goes to the host. */
  readonly verbose: boolean
  index: number
  played: number
  startedAt: number
  pausedAt: number | null
  pausedMs: number
  suspended: boolean
  /** The line reported while an M600 holds the player: the one before it. */
  suspendLine: number | null
  toolWait: boolean
  dwellUntil: number
  doneAt: number | null
}

const ANCHOR_KEYS = [
  "coordinate.anchor1_x",
  "coordinate.anchor1_y",
  "coordinate.anchor2_offset_x",
  "coordinate.anchor2_offset_y",
] as const
const MAX_TEXT_FRAME = 512
/** configZ1.default: G0's rate, G1's without an F, and the most each axis goes (mm/min). */
const SEEK_RATE = 2000
const FEED_RATE = 1000
const AXIS_RATES: Xyz = [1200, 1200, 600]
/** `coordinate.clearance_x` and `_y`: where G28 parks. */
const PARK: [number, number] = [-11.6, -14.6]
const f4 = (value: number) => value.toFixed(4)
const f3 = (value: number) => value.toFixed(3)
const f1 = (value: number) => value.toFixed(1)
const flag = (value: boolean) => (value ? 1 : 0)
const word = (line: string, letter: string) => {
  const match = new RegExp(`${letter}([+-]?(?:\\d+\\.?\\d*|\\.\\d+))`).exec(
    line
  )
  return match ? Number(match[1]) : null
}

/**
 * How long a move of `length` mm takes at `rate` mm/min, no axis going faster than its own rate
 * (Robot::append_milestone), without acceleration.
 */
function moveMs(delta: Xyz, length: number, rate: number) {
  if (length <= 0) return 0
  let limited = Math.max(rate, 1)
  delta.forEach((distance, axis) => {
    if (distance)
      limited = Math.min(
        limited,
        (AXIS_RATES[axis] * length) / Math.abs(distance)
      )
  })
  return (length / limited) * 60_000
}

/** The angle a G2 (clockwise) or G3 arc sweeps about `centre`: a whole turn back to its start. */
function sweepOf(
  from: Xyz,
  to: Xyz,
  centre: [number, number],
  clockwise: boolean
) {
  const start = Math.atan2(from[1] - centre[1], from[0] - centre[0])
  let sweep = Math.atan2(to[1] - centre[1], to[0] - centre[0]) - start
  if (clockwise && sweep >= -1e-9) sweep -= 2 * Math.PI
  if (!clockwise && sweep <= 1e-9) sweep += 2 * Math.PI
  return sweep
}

/** Where a move is `fraction` of the way along it. */
function along({ from, to, arc }: Motion, fraction: number): Xyz {
  const z = from[2] + (to[2] - from[2]) * fraction
  if (!arc)
    return [
      from[0] + (to[0] - from[0]) * fraction,
      from[1] + (to[1] - from[1]) * fraction,
      z,
    ]
  const [cx, cy] = arc.centre
  const start = Math.hypot(from[0] - cx, from[1] - cy)
  const radius = start + (Math.hypot(to[0] - cx, to[1] - cy) - start) * fraction
  const angle = Math.atan2(from[1] - cy, from[0] - cx) + arc.sweep * fraction
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), z]
}

/** The rate a script line moves at: its F, else G0's. */
function scriptRate(echo: string | null) {
  const feed = echo === null ? null : word(echo, "F")
  return feed !== null && feed > 0 ? feed : SEEK_RATE
}

/**
 * A fake Makera Z1 for development. It reproduces the firmware behaviour the app
 * depends on (Kernel status fields, Player lifecycle, SimpleShell replies, ATC waits,
 * the ESP32 file transfer); it is a development tool, not a test oracle.
 */
export class SimulatedZ1 {
  homed: boolean
  halted = false
  haltReason = 0
  answeringStatus = true
  /** Called when a reset reboots the controller; the connection drops with it. */
  onReboot: () => void = () => {}
  private readonly options: SimulatorOptions
  private readonly send: Send
  private readonly log: (message: string) => void
  private readonly transfer: TransferEndpoint
  /** Anchor 1 as the firmware loaded it when it started; `config-set` takes effect at a reboot. */
  private anchor1: [number, number]
  /** Where the machine is once the moves under way end; `position` is where it is now. */
  private readonly mpos: Xyz = [-200, -150, -5]
  private offset: Xyz = [-100, -100, -20]
  /** The moves under way and queued, which the player and scripts wait for. */
  private motions: Motion[] = []
  /** G90 or G91 (Robot.cpp's absolute_mode), which G0 to G3 follow and C reports. */
  private absolute = true
  /** The modal motion (G0 to G3) that axis words alone move in; null before any. */
  private motionMode: number | null = null
  /** The last F, in mm/min. */
  private feed: number | null = null
  /** What the app says its plate positions on the bed; null until it says. */
  private bed: SimulatedBed | null = null
  /** The tool lengths the firmware keeps in EEPROM; T reports the offset. */
  private readonly lengths: ToolLengths = {
    measured: null,
    reference: null,
    offset: 0,
  }
  private spindleOn = false
  private targetRpm = 0
  private feedOverride = 100
  private spindleOverride = 100
  private light = false
  private beep = false
  private vacuum = false
  private vacuumPower = 0
  private vacuumDefaultPower = 80
  private vacuumAuto = false
  private blowing = false
  private bedClean: boolean
  private antiStatic = false
  private tool: number
  private requestedTool = 0
  private motionUntil = 0
  private motionState: "Home" | "Run" = "Run"
  private cleaningUntil = 0
  private player: Player | null = null
  /** The firmware's script queue (a tool change, M495), which holds the player while it runs. */
  private automation: {
    steps: Step[]
    index: number
    nextAt: number
    waiting: boolean
  } | null = null
  private abortSnapshot: Progress | null = null
  private abortPolls = 0
  /** What motion and bed cleaning finish later; a halt or a reboot ends them first. */
  private readonly pending = new Set<ReturnType<typeof setTimeout>>()
  private readonly timer: ReturnType<typeof setInterval>

  constructor(
    options: SimulatorOptions,
    send: Send,
    log: (message: string) => void
  ) {
    this.options = options
    this.send = send
    this.log = log
    this.homed = options.homed
    this.tool = options.tool
    this.bedClean = options.bedClean
    this.anchor1 = [options.anchors[0], options.anchors[1]]
    this.transfer = new TransferEndpoint(send, options.transfer, log)
    this.transfer.files.set(
      CONFIGURATION_PATH,
      initialConfiguration({
        anchors: options.anchors,
        feedRate: FEED_RATE,
        seekRate: SEEK_RATE,
        axisRates: AXIS_RATES,
        park: PARK,
        clearanceZ: CLEARANCE_Z,
      })
    )
    this.loadVacuumDefaultPower()
    this.timer = setInterval(() => this.tick(), options.lineMs)
  }

  private get configuration() {
    return this.transfer.files.get(CONFIGURATION_PATH) ?? new Uint8Array(0)
  }

  private loadVacuumDefaultPower() {
    const saved = savedSetting(
      this.configuration,
      "switch.vacuum.default_on_value"
    )
    const value = saved === undefined ? NaN : Number(saved)
    this.vacuumDefaultPower = Number.isFinite(value)
      ? Math.max(0, Math.min(100, value))
      : 80
  }

  dispose() {
    clearInterval(this.timer)
    this.cancelPending()
  }

  /** Runs `done` later, unless a halt or a reboot comes first. */
  private later(milliseconds: number, done: () => void) {
    const timer = setTimeout(() => {
      this.pending.delete(timer)
      done()
    }, milliseconds)
    this.pending.add(timer)
  }

  private cancelPending() {
    for (const timer of this.pending) clearTimeout(timer)
    this.pending.clear()
  }

  // ── Frames ─────────────────────────────────────────────────────────────

  receive(frame: Frame) {
    const text = new TextDecoder().decode(frame.payload)
    if (frame.type === FRAME_TYPES.control) {
      if (text === "?") this.reportStatus()
      else if (text === "\x18")
        this.halt(1, "ALARM: Halted - reset or $X to clear")
      return
    }
    if (frame.type === FRAME_TYPES.command) {
      this.command(text.trim())
      return
    }
    if (
      frame.type >= FRAME_TYPES.fileStart &&
      frame.type <= FRAME_TYPES.fileRetry
    )
      this.transfer.receive(frame)
  }

  /** Normal-information text, split into frames the codec accepts. */
  private lines(...lines: string[]) {
    const bytes = new TextEncoder().encode(
      lines.map((line) => `${line}\n`).join("")
    )
    for (let offset = 0; offset < bytes.length; offset += MAX_TEXT_FRAME)
      this.send(
        FRAME_TYPES.normalInfo,
        bytes.subarray(offset, offset + MAX_TEXT_FRAME)
      )
  }

  private ok(command: string) {
    if (this.options.dropAcks?.test(command)) {
      this.log(`dropped the acknowledgement of "${command}"`)
      return
    }
    this.lines("ok")
  }

  // ── Status ─────────────────────────────────────────────────────────────

  private state(now = Date.now()): string {
    if (this.halted) return "Alarm"
    const player = this.player
    if (player?.suspended) return "Pause"
    if (player?.toolWait) return "Tool"
    if (now < this.motionUntil) return this.motionState
    if (now < this.cleaningUntil) return "Run"
    if (this.spindleOn) return "Run"
    if (player && player.doneAt === null && now >= player.dwellUntil)
      return "Run"
    return "Idle"
  }

  private progress(now = Date.now()): Progress | null {
    if (this.abortPolls > 0 && this.abortSnapshot) {
      this.abortPolls--
      return this.abortSnapshot
    }
    const player = this.player
    if (!player) return null
    const elapsed = Math.floor(
      (now - player.startedAt - player.pausedMs) / 1000
    )
    if (player.doneAt !== null)
      return { line: player.lines.length, percent: 100, elapsed }
    return {
      line: player.suspendLine ?? player.index,
      percent: Math.round((player.played * 100) / Math.max(player.bytes, 1)),
      elapsed,
    }
  }

  statusText(now = Date.now()): string {
    const mpos = this.position(now)
    // mcs2wcs: less the work offset, and in Z the tool offset.
    const wpos = mpos.map(
      (value, index) =>
        value - this.offset[index] - (index === 2 ? this.lengths.offset : 0)
    )
    const rate = this.motions.find(
      (motion) => now >= motion.startedAt && now < motion.startedAt + motion.ms
    )?.rate
    const rpm = this.spindleOn ? this.targetRpm : 0
    const toolField = this.options.atc
      ? `|T:${this.tool},${f3(this.lengths.offset)}`
      : `|T:${this.tool},${f3(this.lengths.offset)},${this.requestedTool}`
    const progress = this.progress(now)
    return [
      `<${this.state(now)}`,
      `|MPos:${mpos.map(f4).join(",")},0.0000,0.0000`,
      `|WPos:${wpos.map(f4).join(",")},0.0000,0.0000`,
      `|F:${f1(rate ?? 0)},${f1(this.feed ?? FEED_RATE)},${f1(this.feedOverride)}`,
      `|S:${f1(rpm)},${f1(this.targetRpm)},${f1(this.spindleOverride)},${flag(this.vacuumAuto)},32.5,38.1,${flag(this.blowing)},${flag(this.bedClean)},0,${flag(this.antiStatic)}`,
      toolField,
      // Kernel.cpp prints the laser module as "|L:%d, %d, %d, %1.1f,%1.1f" (milling mode here).
      "|L:0, 0, 0, 0.0,100.0",
      progress
        ? `|P:${progress.line},${progress.percent},${progress.elapsed}`
        : "",
      this.halted ? `|H:${this.haltReason}` : "",
      `|C:${this.options.model},${this.options.atc ? 4 : 0},0,${flag(this.absolute)}>`,
    ].join("")
  }

  private reportStatus() {
    if (!this.answeringStatus) return
    this.send(FRAME_TYPES.status, this.statusText())
  }

  private diagnose() {
    this.send(
      FRAME_TYPES.diagnostics,
      `{S:${flag(this.spindleOn)},${this.targetRpm}|G:${flag(this.light)},${flag(this.beep)},0,${flag(this.vacuum)},${this.vacuumPower}|I:0}`
    )
  }

  // ── Commands ───────────────────────────────────────────────────────────

  private command(text: string) {
    if (text === "model") {
      this.lines(
        `model = Z1, ${this.options.model}, ${this.options.atc ? 4 : 0}, 0, ${this.state()}`
      )
      return
    }
    if (text === "diagnose") {
      this.diagnose()
      return
    }
    const [head = "", ...rest] = text.split(/\s+/)
    if (/^[a-z]/.test(head)) {
      this.shell(head, rest.join(" "))
      return
    }
    this.gcode(text)
  }

  private shell(command: string, argument: string) {
    const player = this.player
    switch (command) {
      case "config-get": {
        const [source, key = ""] = argument.split(/\s+/)
        if (source !== "sd")
          return this.lines(`${source} source does not exist`)
        const value = savedSetting(this.configuration, key)
        this.lines(
          value === undefined
            ? `${source}: ${key} is not in config`
            : `${source}: ${key} is set to ${value}`
        )
        return
      }
      case "sim-bed": {
        // Not the firmware's: the app tells the simulator what its plate positions on the bed.
        const bed = readSimulatedBedLine(`sim-bed ${argument}`)
        if (!bed) return this.lines("sim-bed: malformed bed")
        this.bed = bed
        this.log(
          bed.stock
            ? `bed: stock top at machine Z ${f3(bed.stock.top)}, support at ${f3(bed.support)}`
            : `bed: no stock, support at machine Z ${f3(bed.support)}`
        )
        this.lines("ok")
        return
      }
      case "config-set": {
        // Configurator::config_set_command: the value is stored as it was sent.
        const [source = "", key = "", value = ""] = argument.split(/\s+/)
        if (!source || !key || !value)
          return this.lines(
            "Usage: config-set source setting value # where source is sd, setting is the key and value is the new value"
          )
        if (source !== "sd")
          return this.lines(`${source} source does not exist`)
        this.transfer.files.set(
          CONFIGURATION_PATH,
          withSavedSetting(this.configuration, key, value)
        )
        this.log(`config-set ${key} ${value} (loaded at the next reboot)`)
        this.lines(`${source}: ${key} has been set to ${value}`)
        return
      }
      case "play": {
        // Player::extract_options: options start at the first " -"; the path is the first word.
        const optionsAt = argument.indexOf(" -")
        const options = optionsAt < 0 ? "" : argument.slice(optionsAt)
        const [path = ""] = argument
          .slice(0, optionsAt < 0 ? undefined : optionsAt)
          .split(/\s+/)
        // Player::play_command asks Robot::is_homed_all_axes, which reports and halts (NON_HOME).
        if (!this.homed) {
          this.log("play refused: not homed")
          return this.halt(
            15,
            "ERROR:Machine has not been homed,Please home first!",
            "Use M888 To disable homed check temporarily"
          )
        }
        if (player) return this.lines("Currently printing, abort print first")
        const stored = this.transfer.files.get(path)
        // The player asks the ESP32 for the file; one it does not serve is never reported.
        if (!stored)
          return this.log(`play ${path}: no such file, nothing reported`)
        const data = this.options.otherFile
          ? new TextEncoder().encode(
              `${new TextDecoder().decode(stored)}G4 P0\n`
            )
          : stored
        if (data !== stored)
          this.log(`play ${path}: serving another file (${data.length} bytes)`)
        const lines = new TextDecoder().decode(data).split("\n")
        if (lines.at(-1) === "") lines.pop()
        this.player = {
          path,
          lines,
          bytes: data.length,
          verbose: /[Vv]/.test(options),
          index: 0,
          played: 0,
          startedAt: Date.now(),
          pausedAt: null,
          pausedMs: 0,
          suspended: false,
          suspendLine: null,
          toolWait: false,
          dwellUntil: 0,
          doneAt: null,
        }
        this.lines(`  File size ${data.length}`)
        this.log(`playing ${path} (${lines.length} lines)`)
        return
      }
      case "suspend":
        if (!player || player.doneAt !== null)
          return this.lines("Can not suspend when not playing file!")
        if (player.suspended) return this.lines("Already suspended!")
        this.suspend("Suspending , waiting for queue to empty...")
        return
      case "resume":
        if (!player?.suspended) return this.lines("Not suspended")
        this.lines(
          "Resuming playing...",
          "Restoring saved XYZ positions and state..."
        )
        player.suspended = false
        player.suspendLine = null
        if (player.pausedAt !== null)
          player.pausedMs += Date.now() - player.pausedAt
        player.pausedAt = null
        this.lines("Playing file resumed")
        return
      case "abort":
        if (!player) return this.lines("Not currently playing")
        this.abort("Aborted playing or paused file. ")
        return
      case "reset":
        // SimpleShell::reset_command, then system_reset three seconds later.
        this.lines("Rebooting machine in 3 seconds...")
        setTimeout(() => this.reboot(), 3000)
        return
      default:
        this.lines(`${command}: command not found`)
    }
  }

  private gcode(text: string) {
    const code = text.toUpperCase()
    if (this.halted && !/^\$H\b|^\$X\b/.test(code)) {
      this.lines("error:Alarm lock")
      return
    }
    if (code === "$H") {
      this.halted = false
      const from = this.position()
      this.mpos.fill(0)
      this.motions = [
        {
          from,
          to: [0, 0, 0],
          startedAt: Date.now(),
          ms: 1500,
          rate: SEEK_RATE,
          arc: null,
        },
      ]
      this.move(1500, "Home", () => {
        this.homed = true
        this.ok(text)
      })
      return
    }
    if (code === "$X") {
      // A controller that is not halted says nothing.
      if (!this.halted) return
      this.halted = false
      this.lines("[Caution: Unlocked]")
      this.ok(text)
      return
    }
    if (code.startsWith("$J")) {
      const axis = /([XYZ])([+-]?[\d.]+)/.exec(code)
      if (axis) {
        const index = "XYZ".indexOf(axis[1])
        const from: Xyz = [...this.mpos]
        this.mpos[index] = Number(
          (this.mpos[index] + Number(axis[2])).toFixed(4)
        )
        this.travel(from, word(code, "F") ?? SEEK_RATE)
      }
      this.ok(text)
      return
    }
    if (code === "G28.6") {
      this.lines(
        `X:${flag(this.homed)} Y:${flag(this.homed)} Z:${flag(this.homed)} `
      )
      this.ok(text)
      return
    }
    if (code.startsWith("G10 L20 P0")) {
      for (const [index, axis] of ["X", "Y", "Z"].entries())
        if (word(code, axis) !== null) {
          if (axis === "Z") setReference(this.lengths)
          this.offset[index] = this.mpos[index]!
        }
      this.ok(text)
      return
    }
    if (code === "M375.1") {
      this.heightMap()
      return
    }
    if (code === "M490.2") {
      if (this.options.atc)
        this.log("M490.2 on an ATC machine: THE TOOL WAS LOOSENED")
      else if (this.automation?.waiting && this.player) {
        // The scripts go on: no tool, then the new one measured at the tool sensor.
        this.automation.waiting = false
        this.player.toolWait = false
        this.log(`measuring T${this.requestedTool} at the tool sensor`)
      }
      this.ok(text)
      return
    }
    if (this.machineCode(code)) this.ok(text)
    else this.lines("error:Unsupported command")
  }

  /** Spindle, switches and overrides shared by console commands and played lines. */
  private machineCode(code: string): boolean {
    const m = /^M(\d+(?:\.\d+)?)/.exec(code)?.[1]
    if (m === undefined) return /^[GXYZFTS]/.test(code)
    switch (m) {
      case "3":
        // SpindleControl: without a cutting tool (T-1, or the probe T0) M3 halts instead.
        if (this.tool < 1 || this.tool >= 1000) {
          this.halt(1, "ERROR: No tool or probe tool!")
          return true
        }
        this.spindleOn = true
        this.targetRpm = word(code, "S") ?? this.targetRpm
        if (this.vacuumAuto) {
          this.vacuumPower = this.vacuumDefaultPower
          this.vacuum = this.vacuumPower > 0
        }
        return true
      case "5":
        this.spindleOn = false
        if (this.vacuumAuto) {
          this.vacuum = false
          this.vacuumPower = 0
        }
        return true
      case "821":
      case "822":
        this.light = m === "821"
        return true
      case "861":
      case "862":
        this.beep = m === "861"
        return true
      case "851": {
        this.vacuumPower = Math.max(0, Math.min(100, word(code, "S") ?? 98))
        this.vacuum = this.vacuumPower > 0
        return true
      }
      case "852":
        this.vacuum = false
        this.vacuumPower = 0
        return true
      case "220":
        this.feedOverride = word(code, "S") ?? this.feedOverride
        return true
      case "223":
        this.spindleOverride = word(code, "S") ?? this.spindleOverride
        return true
      case "331":
      case "332":
        this.vacuumAuto = m === "331"
        return true
      case "331.1":
      case "332.1":
        this.blowing = m === "331.1"
        return true
      case "331.2":
      case "332.2":
        this.bedClean = m === "331.2"
        return true
      case "493.2": {
        // Sets the active tool; T-1 means none, so the next M6 always changes.
        const tool = word(code, "T")
        if (tool !== null) this.tool = tool
        return true
      }
      case "331.4":
      case "332.4":
        this.antiStatic = m === "331.4"
        return true
      case "2":
      case "30":
      case "6":
      case "600":
        return true
      default:
        return m.length > 0
    }
  }

  private move(milliseconds: number, state: "Home" | "Run", done: () => void) {
    this.motionState = state
    this.motionUntil = Date.now() + milliseconds
    this.later(milliseconds, done)
  }

  /** Where the machine is now: along the move under way, else where the last one ended. */
  private position(now = Date.now()): Xyz {
    for (const motion of this.motions) {
      if (now >= motion.startedAt + motion.ms) continue
      if (now < motion.startedAt) return [...motion.from]
      return along(motion, (now - motion.startedAt) / motion.ms)
    }
    return [...this.mpos]
  }

  /**
   * The machine goes from `from` to where `mpos` now is, at `rate` mm/min (about an arc's
   * centre), once the moves before it end. The player and scripts wait for it; returns how long
   * that is.
   */
  private travel(from: Xyz, rate: number, arc: Arc | null = null): number {
    const to: Xyz = [...this.mpos]
    const dz = to[2] - from[2]
    const xy = arc
      ? Math.abs(arc.sweep) *
        Math.hypot(from[0] - arc.centre[0], from[1] - arc.centre[1])
      : Math.hypot(to[0] - from[0], to[1] - from[1])
    const delta: Xyz = arc
      ? [xy, 0, dz]
      : [to[0] - from[0], to[1] - from[1], dz]
    const ms = moveMs(delta, Math.hypot(xy, dz), rate) / this.options.speed
    const now = Date.now()
    if (ms <= 0) return Math.max(0, this.motionUntil - now)
    const startedAt = Math.max(now, this.motionUntil)
    this.motions = [
      ...this.motions.filter((motion) => motion.startedAt + motion.ms > now),
      { from, to, startedAt, ms, rate, arc },
    ]
    this.motionState = "Run"
    this.motionUntil = startedAt + ms
    return this.motionUntil - now
  }

  /** The machine stops where it is: the moves under way and queued are dropped. */
  private stopMotion() {
    const [x, y, z] = this.position()
    this.mpos[0] = x
    this.mpos[1] = y
    this.mpos[2] = z
    this.motions = []
    this.motionUntil = 0
  }

  /** G0's rate, else the feed with its override. */
  private get rate() {
    if (this.motionMode === 0) return SEEK_RATE
    return ((this.feed ?? FEED_RATE) * this.feedOverride) / 100
  }

  /** G28 on the Z1 parks: up to the clearance, then over to its X and Y (ATCHandler). */
  private park() {
    const from: Xyz = [...this.mpos]
    this.mpos[2] = CLEARANCE_Z
    this.travel(from, SEEK_RATE)
    const up: Xyz = [...this.mpos]
    this.mpos[0] = PARK[0]
    this.mpos[1] = PARK[1]
    this.travel(up, SEEK_RATE)
  }

  /** The grid the last G32 probed (A/B size, I/J points); a fixed 5 × 4 grid before any. */
  private probedGrid: Omit<Grid, "height"> = {
    width: 40,
    depth: 30,
    columns: 5,
    rows: 4,
  }

  private recordProbe(code: string) {
    const count = (letter: string, fallback: number) =>
      Math.max(2, Math.round(word(code, letter) ?? fallback))
    this.probedGrid = {
      width: word(code, "A") ?? this.probedGrid.width,
      depth: word(code, "B") ?? this.probedGrid.depth,
      columns: count("I", this.probedGrid.columns),
      rows: count("J", this.probedGrid.rows),
    }
  }

  private heightMap() {
    this.lines(...heightTable({ ...this.probedGrid, height: 2 }), "ok")
  }

  // ── Player ─────────────────────────────────────────────────────────────

  private suspend(message: string) {
    const player = this.player
    if (!player) return
    this.lines(message)
    player.suspended = true
    player.pausedAt = Date.now()
    this.lines("Suspended, resume to continue playing")
  }

  private tick() {
    const player = this.player
    const now = Date.now()
    if (!player || this.halted) return
    if (this.automation) {
      this.automate(now)
      return
    }
    if (player.doneAt !== null) {
      if (now - player.doneAt >= 1000) this.finish()
      return
    }
    if (
      player.suspended ||
      player.toolWait ||
      now < player.dwellUntil ||
      now < this.motionUntil
    )
      return
    if (player.index >= player.lines.length) {
      this.done()
      return
    }
    const line = player.lines[player.index]
    player.index++
    player.played += line.length + 1
    if (this.options.failAtLine === player.index) {
      this.halt(2, "ALARM: Probe failed to complete")
      return
    }
    this.play(line)
  }

  /** A played line's reply: to the host with -v, otherwise to the firmware's null stream. */
  private reply(text: string) {
    if (this.player?.verbose) this.lines(text)
  }

  private play(line: string) {
    const player = this.player!
    const code = line
      .replace(/\([^)]*\)/g, "")
      .replace(/;.*$/, "")
      .trim()
    if (!code) return
    if (/^M0*600\b/.test(code)) {
      this.suspend("Suspending , waiting for queue to empty...")
      // suspend_command saves the lines played before this one.
      player.suspendLine = player.index - 1
      this.reply("ok")
      return
    }
    // ATCHandler acts only on an M6 with its T word; a bare M6 (or T) does nothing. CAM writes
    // it spaced or not ("T2 M6", "T2M6"), as the dispatcher splits a line.
    const toolChange = /M0*6(?![\d.])/.test(code) ? word(code, "T") : null
    if (toolChange !== null) {
      this.spindleOn = false
      // ATCHandler: M6 for the active tool's number does nothing, not even the measurement.
      if (toolChange === this.tool) {
        this.log(`M6 T${toolChange} skipped: T${toolChange} is the active tool`)
      } else if (this.options.atc) {
        this.requestedTool = toolChange
        this.move(2000, "Run", () => {
          this.tool = toolChange
          this.lines("Done ATC")
        })
      } else {
        this.requestedTool = toolChange
        this.automate(
          Date.now(),
          changeTool(
            toolChange,
            this.changePosition,
            this.sensor,
            this.stepMs,
            [this.mpos[0], this.mpos[1]]
          )
        )
      }
      this.reply("ok")
      return
    }
    if (/^M0*495\b/.test(code)) {
      this.firmwareProbing(code)
      this.reply("ok")
      return
    }
    // M480.n: the 3D probe's corner and centre routines, from where the probe is.
    if (/^M0*480\.\d+/.test(code)) {
      this.automate(
        Date.now(),
        originRoutine(code, [...this.mpos], this.stepMs)
      )
      this.reply("ok")
      return
    }
    const mode = /\bG0*9([01])(?![\d.])/.exec(code)?.[1]
    if (mode !== undefined) this.absolute = mode === "0"
    const feed = word(code, "F")
    if (feed !== null && feed > 0) this.feed = feed
    const motion = /\bG0*([0-3])(?![\d.])/.exec(code)?.[1]
    if (motion !== undefined) this.motionMode = Number(motion)
    const probe = /^G0*38\.([2-5])(?!\d)/.exec(code)?.[1]
    if (probe !== undefined) {
      if (this.probe(code, Number(probe))) this.reply("ok")
      return
    }
    const from: Xyz = [...this.mpos]
    const machineMove = /^G0*53\b/.test(code)
    if (machineMove) {
      for (const [index, axis] of ["X", "Y", "Z"].entries()) {
        const value = word(code, axis)
        if (value !== null) this.mpos[index] = value
      }
      this.travel(from, this.rate)
    }
    if (/^G0*28(?![\d.])/.test(code)) this.park()
    // G10 L2 sets the work origin; L20 names the current position.
    if (/^G0*10\b/.test(code) && word(code, "P") === 0)
      for (const [index, axis] of ["X", "Y", "Z"].entries()) {
        const value = word(code, axis)
        if (value === null) continue
        if (axis === "Z") setReference(this.lengths)
        if (word(code, "L") === 2) this.offset[index] = value
        if (word(code, "L") === 20)
          this.offset[index] = this.mpos[index] - value
      }
    if (/^M0*5\b/.test(code)) player.dwellUntil = Date.now() + 1500
    if (/^G0*4\b/.test(code))
      player.dwellUntil = Date.now() + (word(code, "P") ?? 0) * 1000
    if (/^G0*32\b/.test(code)) this.recordProbe(code)
    // Axis words move in the modal motion, but not a code's own (G4, G10, G28, G32, G92).
    const moves =
      !machineMove &&
      this.motionMode !== null &&
      /[XYZ][+-]?[\d.]/.test(code) &&
      !/\bG0*(?:4|10|28|32|92)(?!\d)/.test(code)
    if (moves) {
      for (const [index, axis] of ["X", "Y", "Z"].entries()) {
        const value = word(code, axis)
        if (value === null) continue
        if (this.absolute)
          this.mpos[index] = machineOf(
            { offset: this.offset, lengths: this.lengths },
            index,
            value
          )
        else this.mpos[index] += value
      }
      this.travel(from, this.rate, this.arc(code, from))
    }
    this.reply(this.machineCode(code) ? "ok" : "error:Unsupported command")
  }

  /** A G2 or G3 move's arc from `from` to `mpos`, about I and J from its start (G17); else null. */
  private arc(code: string, from: Xyz): Arc | null {
    const [i, j] = [word(code, "I"), word(code, "J")]
    if ((this.motionMode !== 2 && this.motionMode !== 3) || (i ?? j) === null)
      return null
    const centre: [number, number] = [from[0] + (i ?? 0), from[1] + (j ?? 0)]
    const clockwise = this.motionMode === 2
    return { centre, sweep: sweepOf(from, this.mpos, centre, clockwise) }
  }

  /**
   * G38.2 to G38.5 in a played line (ZProbe probe_XYZ): X Y Z are distances in either distance
   * mode. Going down, the probe meets the tool sensor under it, else the stock top; G38.2 and
   * G38.4 halt with a probe failure when it meets nothing. The contact goes to the line's
   * stream. Whether the line goes on to its acknowledgement.
   */
  private probe(code: string, subcode: number): boolean {
    const target = this.mpos.map(
      (value, index) => value + (word(code, "XYZ"[index]) ?? 0)
    ) as Xyz
    const surface = this.surfaceAt(target[0], target[1])
    const toward = subcode === 2 || subcode === 3
    if (toward && this.mpos[2] <= surface) {
      this.halt(3, "Error:ZProbe triggered before move, aborting command.")
      return false
    }
    const met = toward && target[2] <= surface
    if (met) target[2] = surface
    const from: Xyz = [...this.mpos]
    for (const index of [0, 1, 2]) this.mpos[index] = target[index]
    const ms = this.travel(from, this.feed ?? FEED_RATE)
    this.reply(
      `[PRB:${f3(target[0])},${f3(target[1])},${f3(target[2])}:${flag(met)}]`
    )
    if (met) {
      this.log(`probe contact at machine Z ${f3(surface)}`)
      return true
    }
    // Meeting nothing, it searches its whole distance, then alarms.
    if (subcode === 2 || subcode === 4) {
      this.later(ms, () => this.halt(3, "ALARM: Probe fail"))
      return false
    }
    return true
  }

  /**
   * What the probe meets going down at machine X Y: the tool sensor, the plate's stock, else
   * what carries it; before the app sends a bed, a default stock everywhere.
   */
  private surfaceAt(x: number, y: number): number {
    const [sx, sy] = this.sensor
    if (Math.hypot(x - sx, y - sy) <= SETTER_RADIUS) return sensorZ(this.tool)
    const { bed } = this
    if (!bed) return DEFAULT_SURFACE_Z
    const { stock } = bed
    const onStock =
      !!stock &&
      x >= stock.min[0] &&
      x <= stock.max[0] &&
      y >= stock.min[1] &&
      y <= stock.max[1]
    return onStock ? stock.top : bed.support
  }

  /** Where the tool sensor is: 181 mm from anchor 1 in X and Y, as on a Z1. */
  private get sensor(): [number, number] {
    return [this.anchor1[0] + 181, this.anchor1[1] + 181]
  }

  /**
   * Where a tool change by hand waits, from anchor 1: `toolrack_offset_x` + 132 and
   * `toolrack_offset_y` (48.78 and 179.74 in configZ1.default).
   */
  private get changePosition(): [number, number] {
    return [this.anchor1[0] + 48.78 + 132, this.anchor1[1] + 179.74]
  }

  private get stepMs() {
    return Math.max(this.options.lineMs * 2, 30)
  }

  /**
   * M495 (ATCHandler): the probe first when another tool is in, then the Z probe at X+O Y+F
   * with O and F, the rectangular grid from X Y with A B I J H.
   */
  private firmwareProbing(code: string) {
    const [x, y] = [word(code, "X"), word(code, "Y")]
    if (x === null || y === null) {
      this.lines("ALARM: Miss Automation Parameter: X/Y")
      return
    }
    const steps: Step[] = []
    if (this.tool !== 0) {
      this.requestedTool = 0
      steps.push(
        ...changeTool(0, this.changePosition, this.sensor, this.stepMs).slice(
          0,
          -1
        )
      )
    }
    const o = word(code, "O")
    if (o !== null)
      steps.push(...probeZ(x + o, y + (word(code, "F") ?? 0), this.stepMs))
    const [a, b, i, j, h] = ["A", "B", "I", "J", "H"].map((letter) =>
      word(code, letter)
    )
    if (a !== null && b !== null && i !== null && j !== null && h !== null) {
      const grid: Grid = { width: a, depth: b, columns: i, rows: j, height: h }
      this.probedGrid = grid
      steps.push(...levelGrid(x, y, grid, this.stepMs))
    }
    this.automate(Date.now(), steps)
  }

  /**
   * ATCHandler::on_main_loop: one script line per turn, echoed with what it prints; a wait for
   * the tool change holds it; "Done ATC" when the queue is empty. Starts a queue when given one.
   */
  private automate(now: number, steps?: Step[]) {
    if (steps) {
      this.automation = { steps, index: 0, nextAt: now, waiting: false }
      return
    }
    const automation = this.automation
    const player = this.player
    if (!automation || !player || automation.waiting || now < automation.nextAt)
      return
    if (automation.index >= automation.steps.length) {
      this.automation = null
      this.lines("Done ATC")
      return
    }
    const step = automation.steps[automation.index]
    automation.index++
    const from: Xyz = [...this.mpos]
    const machine = {
      mpos: this.mpos,
      offset: this.offset,
      tool: this.tool,
      lengths: this.lengths,
      surfaceAt: (x: number, y: number) => this.surfaceAt(x, y),
    }
    const output = step.output(machine)
    this.tool = machine.tool
    // A script line that moves takes its time, at its F or G0's rate.
    const moved = this.mpos.some((value, index) => value !== from[index])
    const ms = moved ? this.travel(from, scriptRate(step.echo)) : 0
    automation.nextAt = now + Math.max(step.ms, ms)
    this.lines(...(step.echo === null ? [] : [step.echo]), ...output)
    if (step.waitsForTool !== undefined) {
      automation.waiting = true
      player.toolWait = true
      this.log(
        `tool change: waiting for T${step.waitsForTool} (confirm with M490.2)`
      )
    }
  }

  /** Player::on_main_loop end of file: queue idle, done snapshot burst, job complete. */
  private done() {
    const player = this.player
    if (!player) return
    if (this.options.noDoneSnapshot) {
      this.log("done snapshot suppressed")
      this.finish()
      return
    }
    player.doneAt = Date.now()
    for (let index = 0; index < 3; index++) this.reportStatus()
    this.beep = false
    if (this.bedClean) {
      this.cleaningUntil = Date.now() + 3000
      this.log("bed cleaning (M486.1)")
      this.later(3000, () => this.lines("Done ATC"))
    }
  }

  private finish() {
    this.log(`finished ${this.player?.path ?? ""}`)
    this.player = null
  }

  private abort(message: string) {
    // ATCHandler drops its script queue when the player stops, and the moves stop.
    this.automation = null
    this.stopMotion()
    const snapshot = this.progress()
    this.abortSnapshot = snapshot
    this.abortPolls = snapshot ? 3 : 0
    this.player = null
    this.spindleOn = false
    this.lines(message)
  }

  /** A reboot: whatever ran stops, the halt clears and the connection drops. */
  private reboot() {
    this.cancelPending()
    this.automation = null
    this.halted = false
    this.haltReason = 0
    this.stopMotion()
    this.cleaningUntil = 0
    this.player = null
    this.abortSnapshot = null
    this.spindleOn = false
    this.targetRpm = 0
    // The firmware loads its saved configuration as it starts.
    const anchor = (index: 0 | 1) => {
      const saved = savedSetting(this.configuration, ANCHOR_KEYS[index])
      const value = saved === undefined ? NaN : Number(saved)
      return Number.isFinite(value) ? value : this.options.anchors[index]
    }
    this.anchor1 = [anchor(0), anchor(1)]
    this.loadVacuumDefaultPower()
    this.log("rebooted")
    this.onReboot()
  }

  /**
   * Kernel halt: motion in progress never finishes, the player aborts (its snapshot lingers for
   * three polls), then Alarm with the halt's report.
   */
  halt(reason: number, ...report: string[]) {
    this.cancelPending()
    this.halted = true
    this.haltReason = reason
    this.stopMotion()
    this.cleaningUntil = 0
    if (this.player) this.abort("Aborted by halt")
    else this.spindleOn = false
    this.lines(...report)
    this.log(`halted (reason ${reason})`)
  }
}
