import {
  Z1_DEFAULT_LIMITS,
  readZ1MotionLimits,
} from "../../src/domain/fixtures/makera-z1/motion.ts"
import { SETTER_RADIUS } from "../../src/domain/fixtures/makera-z1/tool-setter.ts"
import type { MachineLimits } from "../../src/domain/motion/limits.ts"
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
import { MotionQueue, sweepOf } from "./motion-queue.ts"
import type { Arc, QueuedMove, Xyz } from "./motion-queue.ts"
import { TransferEndpoint } from "./transfer.ts"
import type { TransferOptions } from "./transfer.ts"

/** What the machine truly does at a status query, to check what the app makes of the status by. */
export type TruthRecord = {
  readonly at: number
  readonly state: string
  /** The program line of the block under way; null when none runs. */
  readonly line: number | null
  /** Whether that block is a G1, G2 or G3's. */
  readonly g123: boolean
  /** Where the machine is, moving or not. */
  readonly mpos: Xyz
  /** The line the status reports (P:); null without a program. */
  readonly reported: number | null
  /** The block's number among those queued since the program started; null when none runs. */
  readonly blockIndex: number | null
}

export type SimulatorOptions = {
  readonly model: 3 | 4
  readonly atc: boolean
  readonly bedClean: boolean
  readonly homed: boolean
  /** The active tool at start; the firmware keeps it in EEPROM across restarts. */
  readonly tool: number
  /** Anchor 1's machine X and Y, then anchor 2's offset from it (`coordinate.*`). */
  readonly anchors: readonly [number, number, number, number]
  /** Milliseconds the player takes to read a program line. */
  readonly lineMs: number
  /** How many times faster than the machine it moves at start. */
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
  /**
   * The E-stop is pressed at power-on: the motors stay off, so the homing the firmware runs as it
   * starts fails, and it halts with homing failed (2), not E-stop (13).
   */
  readonly estop: boolean
  readonly transfer: TransferOptions
  /** Given what the machine truly does at each status query (`--truth`); null for none. */
  readonly truth: ((record: TruthRecord) => void) | null
}

type Send = (type: number, payload?: Uint8Array | string) => void
type Progress = { line: number; percent: number; elapsed: number }

type Player = {
  readonly path: string
  readonly lines: string[]
  readonly bytes: number
  /** Played with -v: each played line's reply goes to the host. */
  readonly verbose: boolean
  /** How many moves the queue had taken before this program's first. */
  readonly firstBlock: number
  index: number
  played: number
  startedAt: number
  pausedAt: number | null
  pausedMs: number
  /** Asked to suspend: the moves queued end first (the firmware's Wait). */
  suspending: boolean
  suspended: boolean
  /**
   * The line the status reports (Player::on_get_public_data): the line of the feed block (G1,
   * G2, G3) a status query last found under way, never a rapid's, a probe's or a routine's; once
   * the player suspends, the lines played so far, which an M600 is not among yet. It stays after
   * a resume.
   */
  reported: number
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
/** How often the player and the scripts run, in milliseconds. */
const TICK_MS = 5
/** The most lines the player reads at one turn, however long the turn took. */
const MAX_LINES = 500
/** `zprobe.slow_feedrate` (1.5 mm/s), which a G38 without an F searches at, in mm/min. */
const PROBE_RATE = 90
/** The spindle fan's power while blowing gives the spindle air, as `PlaySpindleFanValue`. */
const SPINDLE_AIR_POWER = 80
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
/** M220's override, which the firmware keeps from 10 to 1000 %. */
const overrideOf = (percent: number) => Math.min(1000, Math.max(10, percent))

/**
 * A fake Makera Z1 for development. It reproduces the firmware behaviour the app
 * depends on (Kernel status fields, Player lifecycle, SimpleShell replies, ATC waits,
 * the ESP32 file transfer, the planner's motion); it is a development tool, not a test oracle.
 */
export class SimulatedZ1 {
  homed: boolean
  halted = false
  haltReason = 0
  /** Whether the E-stop is pressed (`pressEstop`). */
  estop = false
  answeringStatus = true
  /** How many times faster than the machine it moves; a change applies from the next block. */
  speed: number
  /** Called when a reset reboots the controller; the connection drops with it. */
  onReboot: () => void = () => {}
  private readonly options: SimulatorOptions
  private readonly send: Send
  private readonly log: (message: string) => void
  private readonly transfer: TransferEndpoint
  /** Anchor 1 as the firmware loaded it when it started; `config-set` takes effect at a reboot. */
  private anchor1: [number, number]
  /** Where the machine is once the moves queued end (Robot's machine_position); `position` is where it is now. */
  private readonly mpos: Xyz = [-200, -150, -5]
  private offset: Xyz = [-100, -100, -20]
  /** The limits the firmware loaded from its configuration when it started. */
  private limits: MachineLimits = Z1_DEFAULT_LIMITS
  /** The moves under way and queued, which the player and scripts wait for. */
  private queue = new MotionQueue(Z1_DEFAULT_LIMITS, () => this.speed)
  /** What waits for the moves queued to end (Conveyor::wait_for_idle), in order. */
  private readonly drains: {
    readonly since: number
    readonly then: (at: number) => void
  }[] = []
  /** G90 or G91 (Robot.cpp's absolute_mode), which G0 to G3 follow and C reports. */
  private absolute = true
  /** The modal motion (G0 to G3) that axis words alone move in; null before any. */
  private motionMode: number | null = null
  /** G0's rate and G1 to G3's, in mm/min; an F sets the one of the modal motion. */
  private seekRate = Z1_DEFAULT_LIMITS.seek
  private feedRate = Z1_DEFAULT_LIMITS.feed
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
  /** Homing, and an ATC machine's tool change, which take a set time rather than the queue's. */
  private motionUntil = 0
  private motionState: "Home" | "Run" = "Run"
  private homing: { from: Xyz; startedAt: number; ms: number } | null = null
  private cleaningUntil = 0
  private player: Player | null = null
  /** Lines the player may read before its next turn, a fraction of one included. */
  private reading = 0
  private lastTick = Date.now()
  /**
   * When what the player or a routine does at this turn happens: as the dwell or the moves it
   * waited for ended, which may be before the turn; null outside a turn (`time`).
   */
  private readAt: number | null = null
  /** When the moves ended that something last waited for. */
  private drainedAt = 0
  /** The firmware's script queue (a tool change, M495), which holds the player while it runs. */
  private automation: {
    steps: Step[]
    index: number
    nextAt: number
    waiting: boolean
  } | null = null
  private abortSnapshot: Progress | null = null
  private abortPolls = 0
  /** What homing, a tool change and bed cleaning finish later; a halt or a reboot ends them first. */
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
    this.speed = options.speed
    this.tool = options.tool
    this.bedClean = options.bedClean
    this.anchor1 = [options.anchors[0], options.anchors[1]]
    this.transfer = new TransferEndpoint(send, options.transfer, log)
    this.transfer.files.set(
      CONFIGURATION_PATH,
      initialConfiguration({
        anchors: options.anchors,
        limits: Z1_DEFAULT_LIMITS,
        park: PARK,
        clearanceZ: CLEARANCE_Z,
      })
    )
    this.loadVacuumDefaultPower()
    this.loadMotion()
    if (options.estop) {
      this.estop = true
      this.bootHoming()
    }
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  /**
   * The homing the firmware runs as it starts (`home_on_boot`): with the E-stop pressed the
   * motors stay off, no home switch closes, and it halts with homing failed.
   */
  private bootHoming() {
    if (!this.estop) return
    this.homed = false
    this.halted = true
    this.haltReason = 2
  }

  /**
   * Presses or releases the E-stop. MainButton halts with E-stop (13) only when the machine is
   * not in an alarm already, which keeps the reason it has.
   */
  pressEstop(pressed: boolean) {
    this.estop = pressed
    this.log(pressed ? "E-stop pressed" : "E-stop released")
    if (pressed && !this.halted) this.halt(13, "ALARM: E-stop pressed")
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

  /** The motion settings the firmware loads from its configuration as it starts, and an empty queue. */
  private loadMotion() {
    this.limits = readZ1MotionLimits(
      new TextDecoder().decode(this.configuration),
      "simulator"
    )
    this.queue = new MotionQueue(this.limits, () => this.speed)
    this.seekRate = this.limits.seek
    this.feedRate = this.limits.feed
    this.log(
      `motion: seek ${this.limits.seek}, feed ${this.limits.feed}, axes ${this.limits.axisRate.join("/")} mm/min, ${this.limits.acceleration} mm/s²`
    )
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
    if (player?.suspending) return "Wait"
    if (player?.toolWait) return "Tool"
    if (now < this.motionUntil) return this.motionState
    if (!this.queue.idle(now)) return "Run"
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
      line: player.reported,
      percent: Math.round((player.played * 100) / Math.max(player.bytes, 1)),
      elapsed,
    }
  }

  statusText(now = Date.now()): string {
    const state = this.state(now)
    // Kernel: the position under way and the feed only while it runs or homes; otherwise where
    // the moves queued end.
    const live = state === "Run" || state === "Home"
    const mpos = live ? this.position(now) : [...this.mpos]
    // mcs2wcs: less the work offset, and in Z the tool offset.
    const wpos = mpos.map(
      (value, index) =>
        value - this.offset[index] - (index === 2 ? this.lengths.offset : 0)
    )
    const running = this.queue.current(now)
    const move = running?.block.payload.move
    const player = this.player
    // Player::on_get_public_data: the query finds a G1, G2 or G3 block under way and reports
    // its line; not while a routine plays.
    if (player && player.doneAt === null && !this.automation && move?.g123)
      player.reported = move.line
    const rpm = this.spindleOn ? this.targetRpm : 0
    const toolField = this.options.atc
      ? `|T:${this.tool},${f3(this.lengths.offset)}`
      : `|T:${this.tool},${f3(this.lengths.offset)},${this.requestedTool}`
    const progress = this.progress(now)
    // Conveyor's feed under way is its block's planned speed; then the modal rate and the override.
    const feed = live && running ? running.block.nominal * 60 : 0
    const modal = this.motionMode === 0 ? this.seekRate : this.feedRate
    return [
      `<${state}`,
      `|MPos:${mpos.map(f4).join(",")},0.0000,0.0000`,
      `|WPos:${wpos.map(f4).join(",")},0.0000,0.0000`,
      `|F:${f1(feed)},${f1(modal)},${f1(this.feedOverride)}`,
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
    const now = Date.now()
    this.send(FRAME_TYPES.status, this.statusText(now))
    if (this.options.truth) this.options.truth(this.truth(now))
  }

  /** What the machine truly does at `now`, the status just reported. */
  private truth(now: number): TruthRecord {
    const running = this.queue.current(now)
    const move = running?.block.payload.move
    const player = this.player
    return {
      at: now,
      state: this.state(now),
      line: move ? move.line : null,
      g123: move?.g123 ?? false,
      mpos: this.position(now),
      reported: player
        ? player.doneAt === null
          ? player.reported
          : player.lines.length
        : null,
      blockIndex: running
        ? running.block.payload.index - (player?.firstBlock ?? 0)
        : null,
    }
  }

  private diagnose() {
    // Blowing turns the spindle fan, its air, on with the spindle (SpindleControl M3).
    const air = this.spindleOn && this.blowing
    this.send(
      FRAME_TYPES.diagnostics,
      `{S:${flag(this.spindleOn)},${this.targetRpm}|F:${flag(air)},${air ? SPINDLE_AIR_POWER : 0}|G:${flag(this.light)},${flag(this.beep)},0,${flag(this.vacuum)},${this.vacuumPower}|I:${flag(this.estop)}}`
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
        // Configurator::config_set_command: the value is stored as it was sent, where its line
        // has room for it (`withSavedSetting`).
        const [source = "", key = "", value = ""] = argument.split(/\s+/)
        if (!source || !key || !value)
          return this.lines(
            "Usage: config-set source setting value # where source is sd, setting is the key and value is the new value"
          )
        if (source !== "sd")
          return this.lines(`${source} source does not exist`)
        const saved = withSavedSetting(this.configuration, key, value)
        if (!saved)
          return this.lines(
            `${source}: ${key} not enough space to overwrite existing key/value`
          )
        this.transfer.files.set(CONFIGURATION_PATH, saved)
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
          firstBlock: this.queue.count,
          index: 0,
          played: 0,
          startedAt: Date.now(),
          pausedAt: null,
          pausedMs: 0,
          suspending: false,
          suspended: false,
          reported: 0,
          toolWait: false,
          dwellUntil: 0,
          doneAt: null,
        }
        this.reading = 0
        this.lines(`  File size ${data.length}`)
        this.log(`playing ${path} (${lines.length} lines)`)
        return
      }
      case "suspend":
        if (!player || player.doneAt !== null)
          return this.lines("Can not suspend when not playing file!")
        if (player.suspended || player.suspending)
          return this.lines("Already suspended!")
        this.suspend(null)
        return
      case "resume":
        if (!player?.suspended) return this.lines("Not suspended")
        this.lines(
          "Resuming playing...",
          "Restoring saved XYZ positions and state..."
        )
        player.suspended = false
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
    // Endstops answers M119 in any state, an alarm too. Away from home every switch is open;
    // A's reads closed without a rotary module.
    if (/^M0*119\b/.test(code)) {
      const home = this.homed && this.mpos.every((value) => value === 0)
      this.lines(
        `X_max:${flag(home)} Y_max:${flag(home)} Z_max:${flag(home)} A_min:1 pins- (XL)P0.24:${flag(home)} (YL)P0.25:${flag(home)} (ZL)P1.1:${flag(home)} (AL)P1.4:1  Probe: 0`
      )
      this.ok(text)
      return
    }
    if (this.halted && !/^\$H\b|^\$X\b/.test(code)) {
      this.lines("error:Alarm lock")
      return
    }
    if (code === "$H" && this.estop) {
      this.halt(2)
      return
    }
    if (code === "$H") {
      this.halted = false
      const from = this.position()
      this.stopMotion()
      this.mpos.fill(0)
      this.homing = { from, startedAt: Date.now(), ms: 1500 }
      this.move(1500, "Home", () => {
        this.homing = null
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
        this.queueMove(from, word(code, "F") ?? this.seekRate, 0, false)
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
    const probe = /^G0*38\.([2-5])(?!\d)/.exec(code)?.[1]
    if (probe !== undefined) {
      this.probe(
        code,
        Number(probe),
        (line) => this.lines(line),
        () => this.ok(text)
      )
      return
    }
    this.motion(code, 0)
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
      case "220": {
        const percent = word(code, "S")
        if (percent !== null) this.feedOverride = overrideOf(percent)
        return true
      }
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

  /** Where the machine is now: homing, along the block under way, else where the moves queued end. */
  private position(now = Date.now()): Xyz {
    const homing = this.homing
    if (homing && now < homing.startedAt + homing.ms) {
      const fraction = Math.max(0, (now - homing.startedAt) / homing.ms)
      return [0, 1, 2].map(
        (axis) =>
          homing.from[axis] + (this.mpos[axis] - homing.from[axis]) * fraction
      ) as Xyz
    }
    return this.queue.position(now) ?? [...this.mpos]
  }

  /**
   * The machine goes from `from` to where `mpos` now is, at `rate` mm/min (about an arc's
   * centre), once the moves before it end; `line` is the program line it was read from.
   */
  private queueMove(
    from: Xyz,
    rate: number,
    line: number,
    g123: boolean,
    arc: Arc | null = null
  ) {
    const move: QueuedMove = {
      from,
      to: [...this.mpos],
      arc,
      rate,
      line,
      g123,
      touches: false,
    }
    this.queue.push(move, this.time())
  }

  /** When what the player, a routine or a command does now happens (`readAt`). */
  private time() {
    return this.readAt ?? Date.now()
  }

  /** G0 to G3's rate, with the override (Robot: M220 scales them all). */
  private get modalRate() {
    const rate = this.motionMode === 0 ? this.seekRate : this.feedRate
    return (rate * this.feedOverride) / 100
  }

  /** The machine stops where it is: the moves under way and queued are dropped, and nothing waits for them. */
  private stopMotion() {
    const now = Date.now()
    const [x, y, z] = this.position(now)
    this.queue.stop(now)
    this.mpos[0] = x
    this.mpos[1] = y
    this.mpos[2] = z
    this.homing = null
    this.motionUntil = 0
    this.drains.length = 0
  }

  /**
   * Runs `then` once the moves queued have all ended, as the firmware waits for idle, given when
   * they did; at once when they have. Meanwhile the machine starts what is queued.
   */
  private afterDrain(then: (at: number) => void) {
    const at = this.time()
    const now = Date.now()
    this.queue.flush(now)
    if (this.drains.length || !this.queue.idle(now))
      this.drains.push({ since: at, then })
    else then(at)
  }

  /** Runs what waits for the moves to end, once they have, as of when they did. */
  private drained(now: number) {
    while (this.drains.length) {
      if (!this.queue.idle(now)) {
        this.queue.flush(now)
        return
      }
      const { since, then } = this.drains.shift()!
      const at = Math.min(now, this.queue.settled(since))
      this.drainedAt = at
      this.readAt = at
      then(at)
      this.readAt = null
    }
  }

  /** G28 on the Z1 parks: up to the clearance, then over to its X and Y (ATCHandler). */
  private park() {
    const rate = (this.seekRate * this.feedOverride) / 100
    const from: Xyz = [...this.mpos]
    this.mpos[2] = CLEARANCE_Z
    this.queueMove(from, rate, 0, false)
    const up: Xyz = [...this.mpos]
    this.mpos[0] = PARK[0]
    this.mpos[1] = PARK[1]
    this.queueMove(up, rate, 0, false)
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

  /**
   * Player::suspend_command: the moves queued end (Wait), then the player suspends with the
   * lines it has played, or `played`.
   */
  private suspend(played: number | null) {
    const player = this.player
    if (!player) return
    this.lines("Suspending , waiting for queue to empty...")
    player.suspending = true
    this.afterDrain(() => {
      if (this.player !== player) return
      player.suspending = false
      player.suspended = true
      player.reported = played ?? player.index
      player.pausedAt = Date.now()
      this.lines(
        "now save current pos...",
        "Suspended, resume to continue playing"
      )
    })
  }

  /** Whether the player waits: for a pause, a tool, a dwell, the moves, room in the queue or a routine. */
  private holdsPlayer(now: number) {
    const player = this.player
    return (
      !player ||
      this.halted ||
      player.suspending ||
      player.suspended ||
      player.toolWait ||
      player.doneAt !== null ||
      now < player.dwellUntil ||
      now < this.motionUntil ||
      this.drains.length > 0 ||
      this.automation !== null ||
      this.queue.full
    )
  }

  private tick() {
    const now = Date.now()
    const since = this.lastTick
    this.lastTick = now
    if (this.halted) return
    this.queue.advance(now)
    this.drained(now)
    const player = this.player
    if (!player || this.drains.length) return
    if (this.automation) {
      this.automate(now, since)
      return
    }
    if (player.doneAt !== null) {
      if (now - player.doneAt >= 1000) this.finish()
      return
    }
    if (this.holdsPlayer(now)) {
      this.reading = 0
      return
    }
    // Player::on_main_loop: a line each `lineMs`, while the queue has room for its moves; read
    // from when the program started, a dwell or a wait for the moves ended since the turn before.
    this.reading = Math.min(
      MAX_LINES,
      this.reading + ((now - since) * this.speed) / this.options.lineMs
    )
    const resumed = Math.max(
      player.startedAt,
      player.dwellUntil,
      this.drainedAt
    )
    this.readAt = resumed > since && resumed <= now ? resumed : now
    while (this.reading >= 1 && !this.holdsPlayer(now)) {
      this.reading--
      if (player.index >= player.lines.length) {
        this.afterDrain(() => this.done())
        break
      }
      const line = player.lines[player.index]
      player.index++
      player.played += line.length + 1
      if (this.options.failAtLine === player.index) {
        this.readAt = null
        this.halt(2, "ALARM: Probe failed to complete")
        return
      }
      this.play(line)
    }
    this.readAt = null
  }

  /** A played line's reply: to the host with -v, otherwise to the firmware's null stream. */
  private reply(text: string) {
    if (this.player?.verbose) this.lines(text)
  }

  /** The player stands still for `seconds` from `at` (G4, the spindle's delays). */
  private dwell(at: number, seconds: number) {
    if (this.player) this.player.dwellUntil = at + (seconds * 1000) / this.speed
  }

  private play(line: string) {
    const player = this.player!
    const code = line
      .replace(/\([^)]*\)/g, "")
      .replace(/;.*$/, "")
      .trim()
    if (!code) return
    if (/^M0*600\b/.test(code)) {
      // suspend_command saves the lines played before this one.
      this.suspend(player.index - 1)
      this.reply("ok")
      return
    }
    // ATCHandler acts only on an M6 with its T word; a bare M6 (or T) does nothing. CAM writes
    // it spaced or not ("T2 M6", "T2M6"), as the dispatcher splits a line. It waits for the
    // moves before it to end, as the other routines do.
    const toolChange = /M0*6(?![\d.])/.test(code) ? word(code, "T") : null
    if (toolChange !== null) {
      this.afterDrain(() => {
        this.changeToolTo(toolChange)
        this.reply("ok")
      })
      return
    }
    if (/^M0*495\b/.test(code)) {
      this.afterDrain(() => {
        this.firmwareProbing(code)
        this.reply("ok")
      })
      return
    }
    // M480.n: the 3D probe's corner and centre routines, from where the probe is.
    if (/^M0*480\.\d+/.test(code)) {
      this.afterDrain((at) => {
        this.runRoutine(originRoutine(code, [...this.mpos], this.stepMs), at)
        this.reply("ok")
      })
      return
    }
    const probe = /^G0*38\.([2-5])(?!\d)/.exec(code)?.[1]
    if (probe !== undefined) {
      this.probe(
        code,
        Number(probe),
        (text) => this.reply(text),
        () => this.reply("ok")
      )
      return
    }
    // SpindleControl waits for the moves to end before M3, and before M5 with the spindle on;
    // PWMSpindleControl then dwells its delay when the spindle turns on or off.
    const spindle = /^M0*([35])(?![\d.])/.exec(code)?.[1]
    if (spindle === "3" || (spindle === "5" && this.spindleOn)) {
      this.afterDrain((at) => {
        const wasOn = this.spindleOn
        const known = this.machineCode(code)
        if (!this.halted && this.spindleOn !== wasOn)
          this.dwell(
            at,
            this.spindleOn
              ? this.limits.spindleDelay.on
              : this.limits.spindleDelay.off
          )
        this.reply(known ? "ok" : "error:Unsupported command")
      })
      return
    }
    // G4 waits for the moves, then dwells P seconds (grbl_mode) and S whole seconds more.
    if (/^G0*4(?![\d.])/.test(code)) {
      const seconds = (word(code, "P") ?? 0) + Math.trunc(word(code, "S") ?? 0)
      if (seconds > 0)
        this.afterDrain((at) => {
          this.dwell(at, seconds)
          this.reply("ok")
        })
      else this.reply("ok")
      return
    }
    if (/^M0*(?:400|2|30)(?![\d.])/.test(code)) {
      this.afterDrain(() =>
        this.reply(this.machineCode(code) ? "ok" : "error:Unsupported command")
      )
      return
    }
    this.motion(code, player.index)
    this.reply(this.machineCode(code) ? "ok" : "error:Unsupported command")
  }

  /** M6 for a tool other than the active one: an ATC machine changes it, a manual one runs its scripts. */
  private changeToolTo(tool: number) {
    this.spindleOn = false
    // ATCHandler: M6 for the active tool's number does nothing, not even the measurement.
    if (tool === this.tool) {
      this.log(`M6 T${tool} skipped: T${tool} is the active tool`)
      return
    }
    this.requestedTool = tool
    if (this.options.atc)
      this.move(2000 / this.speed, "Run", () => {
        this.tool = tool
        this.lines("Done ATC")
      })
    else
      this.runRoutine(
        changeTool(tool, this.changePosition, this.sensor, this.stepMs, [
          this.mpos[0],
          this.mpos[1],
        ]),
        this.time()
      )
  }

  /**
   * What a line does to the modes and where the machine goes (Robot), whether it is played or
   * typed in the console: G90 and G91, F, G0 to G3, G53, G28, G10 and G32. Its moves go to the
   * queue, from `line` of the program (0 for the console's); G28 and G32 wait for the moves
   * before them to end.
   */
  private motion(code: string, line: number) {
    const mode = /\bG0*9([01])(?![\d.])/.exec(code)?.[1]
    if (mode !== undefined) this.absolute = mode === "0"
    const motion = /\bG0*([0-3])(?![\d.])/.exec(code)?.[1]
    if (motion !== undefined) this.motionMode = Number(motion)
    // Robot::process_move: an F sets G0's rate in G0, otherwise G1 to G3's.
    const feed = word(code, "F")
    if (feed !== null && feed > 0) {
      if (this.motionMode === 0) this.seekRate = feed
      else this.feedRate = feed
    }
    const g123 = this.motionMode !== null && this.motionMode >= 1
    const from: Xyz = [...this.mpos]
    const machineMove = /^G0*53\b/.test(code)
    if (machineMove) {
      for (const [index, axis] of ["X", "Y", "Z"].entries()) {
        const value = word(code, axis)
        if (value !== null) this.mpos[index] = value
      }
      this.queueMove(from, this.modalRate, line, g123)
    }
    if (/^G0*28(?![\d.])/.test(code)) this.afterDrain(() => this.park())
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
    if (/^G0*32\b/.test(code)) this.afterDrain(() => this.recordProbe(code))
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
      this.queueMove(from, this.modalRate, line, g123, this.arc(code, from))
    }
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
   * G38.2 to G38.5 (ZProbe::probe_XYZ): X Y Z are distances in either distance mode, searched at
   * F without the override. It waits for the moves before it to end; going down, the probe
   * meets the tool sensor under it, else the stock top, and the touch stops it there at once.
   * Once it has stopped, the contact goes to the line's stream (`say`) and the line is `done`;
   * G38.2 and G38.4 halt with a probe failure when it meets nothing.
   */
  private probe(
    code: string,
    subcode: number,
    say: (text: string) => void,
    done: () => void
  ) {
    this.afterDrain((at) => {
      const target = this.mpos.map(
        (value, index) => value + (word(code, "XYZ"[index]) ?? 0)
      ) as Xyz
      const surface = this.surfaceAt(target[0], target[1])
      const toward = subcode === 2 || subcode === 3
      if (toward && this.mpos[2] <= surface) {
        this.halt(3, "Error:ZProbe triggered before move, aborting command.")
        return
      }
      const met = toward && target[2] <= surface
      if (met) target[2] = surface
      const from: Xyz = [...this.mpos]
      for (const index of [0, 1, 2]) this.mpos[index] = target[index]
      // Probe moves carry no line (Robot::delta_move).
      this.queue.push(
        {
          from,
          to: target,
          arc: null,
          rate: word(code, "F") ?? PROBE_RATE,
          line: 0,
          g123: false,
          touches: met,
        },
        at
      )
      this.afterDrain(() => {
        say(
          `[PRB:${f3(target[0])},${f3(target[1])},${f3(target[2])}:${flag(met)}]`
        )
        if (met) this.log(`probe contact at machine Z ${f3(surface)}`)
        // Meeting nothing, it searches its whole distance, then alarms.
        if (!met && (subcode === 2 || subcode === 4))
          this.halt(3, "ALARM: Probe fail")
        else done()
      })
    })
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

  /** How long a script line takes besides its moves, at the machine's speed. */
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
    this.runRoutine(steps, this.time())
  }

  /** The firmware's script queue takes a routine's steps, from `at`. */
  private runRoutine(steps: Step[], at: number) {
    this.automation = { steps, index: 0, nextAt: at, waiting: false }
  }

  /**
   * ATCHandler::on_main_loop: the script lines due since the turn before (`since`), each echoed
   * with what it prints, as of when the one before it was done. Their moves go to the queue: a
   * probe's search and a wait for the tool change start once the moves before them have ended,
   * and the search reports its contact once it has touched; a wait for the tool change holds
   * the scripts. "Done ATC" when the moves have ended.
   */
  private automate(now: number, since: number) {
    for (let steps = 0; steps < MAX_LINES; steps++) {
      const automation = this.automation
      const player = this.player
      if (
        !automation ||
        !player ||
        automation.waiting ||
        now < automation.nextAt ||
        this.drains.length
      )
        return
      const at = Math.min(
        now,
        Math.max(since, automation.nextAt, this.drainedAt)
      )
      this.readAt = at
      this.step(automation, player, at)
      this.readAt = null
    }
  }

  /** Runs a routine's next step at `now`. */
  private step(
    automation: NonNullable<SimulatedZ1["automation"]>,
    player: Player,
    now: number
  ) {
    if (automation.index >= automation.steps.length) {
      this.afterDrain(() => {
        if (this.automation !== automation) return
        this.automation = null
        this.lines("Done ATC")
      })
      return
    }
    const step = automation.steps[automation.index]
    const script = step.echo ?? step.runs ?? ""
    const probing = /^G0*38\./.test(script)
    if (
      (probing || step.waitsForTool !== undefined) &&
      !this.queue.idle(Date.now())
    ) {
      this.afterDrain(() => {})
      return
    }
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
    // The routines come down slower by the override (M220 S10), which scales their G0s too.
    const percent = /^M0*220(?![\d.])/.test(script) ? word(script, "S") : null
    if (percent !== null) this.feedOverride = overrideOf(percent)
    const echo = step.echo === null ? [] : [step.echo]
    const pause = step.ms / this.speed
    automation.nextAt = now + pause
    if (this.mpos.some((value, index) => value !== from[index]))
      this.queue.push(
        {
          from,
          to: [...this.mpos],
          arc: null,
          rate: probing
            ? (word(script, "F") ?? PROBE_RATE)
            : (this.seekRate * this.feedOverride) / 100,
          line: 0,
          g123: false,
          touches: probing,
        },
        now
      )
    if (probing) {
      // ZProbe reports the contact once the touch has stopped the probe.
      this.lines(...echo)
      this.afterDrain((at) => {
        this.lines(...output)
        automation.nextAt = at + pause
      })
    } else this.lines(...echo, ...output)
    if (step.waitsForTool !== undefined) {
      automation.waiting = true
      player.toolWait = true
      this.log(
        `tool change: waiting for T${step.waitsForTool} (confirm with M490.2)`
      )
    }
  }

  /** Player::on_main_loop end of file, once the moves have ended: done snapshot burst, job complete. */
  private done() {
    const player = this.player
    if (!player) return
    if (this.options.noDoneSnapshot) {
      this.log("done snapshot suppressed")
      this.finish()
      return
    }
    player.doneAt = this.time()
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
    this.feedOverride = 100
    this.motionMode = null
    this.absolute = true
    // The firmware loads its saved configuration as it starts.
    const anchor = (index: 0 | 1) => {
      const saved = savedSetting(this.configuration, ANCHOR_KEYS[index])
      const value = saved === undefined ? NaN : Number(saved)
      return Number.isFinite(value) ? value : this.options.anchors[index]
    }
    this.anchor1 = [anchor(0), anchor(1)]
    this.loadVacuumDefaultPower()
    this.loadMotion()
    this.bootHoming()
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
