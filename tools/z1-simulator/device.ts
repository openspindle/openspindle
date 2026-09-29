import { FRAME_TYPES } from "../../src/machine/firmware/makera/codec.ts"
import type { Frame } from "../../src/machine/firmware/makera/codec.ts"
import {
  changeTool,
  heightTable,
  levelGrid,
  originRoutine,
  probeZ,
} from "./automation.ts"
import type { Grid, Step } from "./automation.ts"
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
  /** Milliseconds per played program line. */
  readonly lineMs: number
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
const f4 = (value: number) => value.toFixed(4)
const f1 = (value: number) => value.toFixed(1)
const flag = (value: boolean) => (value ? 1 : 0)
const word = (line: string, letter: string) => {
  const match = new RegExp(`${letter}([+-]?(?:\\d+\\.?\\d*|\\.\\d+))`).exec(
    line
  )
  return match ? Number(match[1]) : null
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
  /** The saved configuration's settings as text, as `config-get sd` and `config-set sd` see it. */
  private readonly config: Map<string, string>
  /** Anchor 1 as the firmware loaded it when it started; `config-set` takes effect at a reboot. */
  private anchor1: [number, number]
  private mpos: Xyz = [-200, -150, -5]
  private offset: Xyz = [-100, -100, -20]
  private spindleOn = false
  private targetRpm = 0
  private feedOverride = 100
  private spindleOverride = 100
  private light = false
  private beep = false
  private vacuum = false
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
    this.config = new Map(
      ANCHOR_KEYS.map((key, index) => [key, String(options.anchors[index])])
    )
    this.anchor1 = [options.anchors[0], options.anchors[1]]
    this.transfer = new TransferEndpoint(send, options.transfer, log)
    this.timer = setInterval(() => this.tick(), options.lineMs)
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
    const wpos = this.mpos.map((value, index) => value - this.offset[index])
    const moving =
      now < this.motionUntil || (this.player && !this.player.suspended)
    const rpm = this.spindleOn ? this.targetRpm : 0
    const toolField = this.options.atc
      ? `|T:${this.tool},0.000`
      : `|T:${this.tool},0.000,${this.requestedTool}`
    const progress = this.progress(now)
    return [
      `<${this.state(now)}`,
      `|MPos:${this.mpos.map(f4).join(",")},0.0000,0.0000`,
      `|WPos:${wpos.map(f4).join(",")},0.0000,0.0000`,
      `|F:${f1(moving ? 1200 : 0)},${f1(1200)},${f1(this.feedOverride)}`,
      `|S:${f1(rpm)},${f1(this.targetRpm)},${f1(this.spindleOverride)},${flag(this.vacuumAuto)},32.5,38.1,${flag(this.blowing)},${flag(this.bedClean)},0,${flag(this.antiStatic)}`,
      toolField,
      // Kernel.cpp prints the laser module as "|L:%d, %d, %d, %1.1f,%1.1f" (milling mode here).
      "|L:0, 0, 0, 0.0,100.0",
      progress
        ? `|P:${progress.line},${progress.percent},${progress.elapsed}`
        : "",
      this.halted ? `|H:${this.haltReason}` : "",
      `|C:${this.options.model},${this.options.atc ? 4 : 0},0,1>`,
    ].join("")
  }

  private reportStatus() {
    if (!this.answeringStatus) return
    this.send(FRAME_TYPES.status, this.statusText())
  }

  private diagnose() {
    this.send(
      FRAME_TYPES.diagnostics,
      `{S:${flag(this.spindleOn)},${this.targetRpm}|G:${flag(this.light)},${flag(this.beep)},0,${flag(this.vacuum)},${this.vacuum ? 100 : 0}|I:0}`
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
        const value = this.config.get(key)
        this.lines(
          value === undefined
            ? `${source}: ${key} is not in config`
            : `${source}: ${key} is set to ${value}`
        )
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
        this.config.set(key, value)
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
      this.move(1500, "Home", () => {
        this.homed = true
        this.mpos = [0, 0, 0]
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
        this.move(400, "Run", () => {
          this.mpos[index] = Number(
            (this.mpos[index] + Number(axis[2])).toFixed(4)
          )
        })
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
        if (word(code, axis) !== null) this.offset[index] = this.mpos[index]!
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
        return true
      case "5":
        this.spindleOn = false
        return true
      case "821":
      case "822":
        this.light = m === "821"
        return true
      case "861":
      case "862":
        this.beep = m === "861"
        return true
      case "851":
      case "852":
        this.vacuum = m === "851"
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
    const code = line.trim()
    if (!code) return
    if (/^M0*600\b/.test(code)) {
      this.suspend("Suspending , waiting for queue to empty...")
      // suspend_command saves the lines played before this one.
      player.suspendLine = player.index - 1
      this.reply("ok")
      return
    }
    // ATCHandler acts only on an M6 with its T word; a bare M6 (or T) does nothing.
    const toolChange = /\bM0*6\b/.test(code) ? word(code, "T") : null
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
          changeTool(toolChange, this.sensor, this.stepMs)
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
    if (/^G0*53\b/.test(code))
      for (const [index, axis] of ["X", "Y", "Z"].entries()) {
        const value = word(code, axis)
        if (value !== null) this.mpos[index] = value
      }
    // G10 L2 sets the work origin; L20 names the current position.
    if (/^G0*10\b/.test(code) && word(code, "P") === 0)
      for (const [index, axis] of ["X", "Y", "Z"].entries()) {
        const value = word(code, axis)
        if (value === null) continue
        if (word(code, "L") === 2) this.offset[index] = value
        if (word(code, "L") === 20)
          this.offset[index] = this.mpos[index] - value
      }
    if (/^M0*5\b/.test(code)) player.dwellUntil = Date.now() + 1500
    if (/^G0*4\b/.test(code))
      player.dwellUntil = Date.now() + (word(code, "P") ?? 0) * 1000
    if (/^G0*32\b/.test(code)) this.recordProbe(code)
    if (/^G0*[0123]\b/.test(code))
      for (const [index, axis] of ["X", "Y", "Z"].entries()) {
        const value = word(code, axis)
        if (value !== null) this.mpos[index] = value + this.offset[index]
      }
    this.reply(this.machineCode(code) ? "ok" : "error:Unsupported command")
  }

  /** Where the tool sensor is: 181 mm from anchor 1 in X and Y, as on a Z1. */
  private get sensor(): [number, number] {
    return [this.anchor1[0] + 181, this.anchor1[1] + 181]
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
      steps.push(...changeTool(0, this.sensor, this.stepMs).slice(0, -1))
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
    automation.nextAt = now + step.ms
    const machine = { mpos: this.mpos, offset: this.offset, tool: this.tool }
    const output = step.output(machine)
    this.tool = machine.tool
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
    // ATCHandler drops its script queue when the player stops.
    this.automation = null
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
    this.motionUntil = 0
    this.cleaningUntil = 0
    this.player = null
    this.abortSnapshot = null
    this.spindleOn = false
    this.targetRpm = 0
    // The firmware loads its saved configuration as it starts.
    this.anchor1 = [
      Number(this.config.get(ANCHOR_KEYS[0])),
      Number(this.config.get(ANCHOR_KEYS[1])),
    ]
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
    this.motionUntil = 0
    this.cleaningUntil = 0
    if (this.player) this.abort("Aborted by halt")
    else this.spindleOn = false
    this.lines(...report)
    this.log(`halted (reason ${reason})`)
  }
}
