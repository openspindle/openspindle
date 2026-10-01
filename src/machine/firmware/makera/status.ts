import { MACHINE_STATES } from "../../contract/index.ts"
import type {
  MachineModel,
  MachineState,
  Position,
  Telemetry,
} from "../../contract/index.ts"
import type { Identity } from "../adapter.ts"

/** Diagnose reports older than this are not merged into status. */
const DIAGNOSTICS_MAX_AGE_MS = 5000
/** FuncSetting bit 2: automatic tool changer (Kernel.cpp, ATCHandler.cpp). */
const ATC_FLAG = 1 << 2

export type Diagnostics = {
  receivedAt: number
  spindleOn: boolean | null
  lightOn: boolean | null
  beepOn: boolean | null
  vacuumOn: boolean | null
  vacuumPower: number | null
  estop: boolean | null
}

const numeric = (value: string | undefined): number | null =>
  value !== undefined &&
  /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim()) &&
  Number.isFinite(Number(value))
    ? Number(value)
    : null

/**
 * A field Kernel.cpp prints as an integer (`%d`, `%lu`): a safe integer, as the machine contract
 * takes tool numbers and lines (`z.int()`), else null. One decimal value there would make every
 * snapshot that carries it invalid.
 */
const integer = (value: string | undefined): number | null => {
  const number = numeric(value)
  return number !== null && Number.isSafeInteger(number) ? number : null
}

const flag = (value: string | undefined): boolean | null => {
  const text = value?.trim()
  if (text === "1") return true
  if (text === "0") return false
  return null
}

function fields(payload: string, brackets: "<>" | "{}") {
  const text = payload.trim()
  if (
    text.length > 512 ||
    text[0] !== brackets[0] ||
    text.at(-1) !== brackets[1] ||
    /[\r\n]/.test(text)
  )
    return null
  const parts = text.slice(1, -1).split("|")
  const values: Partial<Record<string, string[]>> = {}
  for (const part of parts) {
    const colon = part.indexOf(":")
    if (colon < 0) continue
    const key = part.slice(0, colon)
    if (Object.hasOwn(values, key)) return null
    values[key] = part.slice(colon + 1).split(",")
  }
  return { parts, values }
}

function position(
  values: string[] | undefined,
  scale: number
): Position | null {
  if (!values || values.length < 3 || values.length > 5) return null
  const [x, y, z] = values.slice(0, 3).map(numeric)
  if (x == null || y == null || z == null) return null
  return {
    x: x * scale,
    y: y * scale,
    z: z * scale,
    a: numeric(values[3]),
    b: numeric(values[4]),
  }
}

/**
 * Work zero in machine coordinates. Robot.cpp mcs2wcs reports WPos as MPos less the work
 * offset, plus G92, less the tool offset, of which T carries Z. In laser mode the tool offset
 * holds the laser's X and Y too, which the status leaves out; without a laser module (no L)
 * there is none.
 */
function workOrigin(
  machine: Position | null,
  work: Position | null,
  toolOffset: number | null,
  laserMode: boolean | null
): Position | null {
  if (!machine || !work || toolOffset === null || laserMode === true)
    return null
  const angle = (m: number | null, w: number | null) =>
    m === null || w === null ? null : m - w
  return {
    x: machine.x - work.x,
    y: machine.y - work.y,
    z: machine.z - work.z - toolOffset,
    a: angle(machine.a, work.a),
    b: angle(machine.b, work.b),
  }
}

export function modelById(id: number): MachineModel | null {
  if (id === 3) return "Z1"
  if (id === 4) return "Z1 Pro"
  return null
}

const isState = (value: string | undefined): value is MachineState =>
  (MACHINE_STATES as readonly string[]).includes(value ?? "")

/**
 * Kernel.cpp get_query_string. C carries model, FuncSetting, inch and absolute
 * modes; MPos/WPos/F follow the unit mode. Returns null for anything else.
 */
export function parseStatus(
  payload: string,
  receivedAt: number,
  diagnostics: Diagnostics | null
): { telemetry: Telemetry; identity: Identity } | "unsupported" | null {
  const parsed = fields(payload, "<>")
  const state = parsed?.parts[0]
  if (!parsed || !isState(state)) return null
  const f = parsed.values
  const c = f.C
  const inch = flag(c?.[2])
  const absolute = flag(c?.[3])
  const funcSetting = integer(c?.[1])
  if (
    !c ||
    c.length !== 4 ||
    funcSetting === null ||
    inch === null ||
    absolute === null
  )
    return null
  const model = modelById(Number(c[0]))
  if (!model) return "unsupported"
  const scale = inch ? 25.4 : 1
  const n = (key: string, index = 0) => numeric(f[key]?.[index])
  const scaled = (key: string, index = 0) => {
    const value = n(key, index)
    return value === null ? null : value * scale
  }
  const diagnostic =
    diagnostics && receivedAt - diagnostics.receivedAt <= DIAGNOSTICS_MAX_AGE_MS
      ? diagnostics
      : null
  const progress = f.P?.map(numeric)
  // Z1 appends blowing, bed-clean, reserved and anti-static modes after zero, one or two temperatures.
  const assistTail =
    f.S && f.S.length >= 8 && f.S.length <= 10 ? f.S.slice(-4) : null
  const assists =
    assistTail &&
    assistTail.every((value) => flag(value) !== null) &&
    assistTail[2] === "0"
      ? assistTail
      : null
  const [line, percent, elapsed] = progress ?? []
  const job =
    progress?.length === 3 &&
    line != null &&
    percent != null &&
    elapsed != null &&
    line >= 0 &&
    Number.isSafeInteger(line) &&
    percent >= 0 &&
    percent <= 100 &&
    elapsed >= 0
      ? { line, percent, elapsedSeconds: elapsed }
      : null
  // Manual tool-change machines append the requested tool: T:active,offset,target.
  const manualTool = f.T?.length === 3
  const machine = position(f.MPos, scale)
  const work = position(f.WPos, scale)
  // Kernel.cpp prints the tool offset in millimetres whatever the unit mode.
  const toolOffset = n("T", 1)
  const laserMode = flag(f.L?.[0])
  return {
    identity: { model, atc: (funcSetting & ATC_FLAG) !== 0 },
    telemetry: {
      receivedAt,
      state,
      units: inch ? "in" : "mm",
      absolute,
      machine,
      work,
      workOrigin: workOrigin(machine, work, toolOffset, laserMode),
      feed: scaled("F"),
      requestedFeed: scaled("F", 1),
      feedOverride: n("F", 2),
      spindleRpm: n("S"),
      spindleTargetRpm: n("S", 1),
      spindleOverride: n("S", 2),
      spindleOn: diagnostic?.spindleOn ?? null,
      spindleTemperature: f.S?.length === 10 ? n("S", 4) : null,
      controllerTemperature: f.S?.length === 10 ? n("S", 5) : null,
      // Kernel.cpp prints tool numbers as integers ("T:%d,%1.3f,%d").
      tool: integer(f.T?.[0]),
      toolOffset,
      requestedTool: manualTool ? integer(f.T?.[2]) : null,
      laserMode,
      vacuumAuto: flag(f.S?.[3]),
      blowingAuto: flag(assists?.[0]),
      bedCleanAuto: flag(assists?.[1]),
      antiStatic: flag(assists?.[3]),
      lightOn: diagnostic?.lightOn ?? null,
      beepOn: diagnostic?.beepOn ?? null,
      vacuumOn: diagnostic?.vacuumOn ?? null,
      vacuumPower: diagnostic?.vacuumPower ?? null,
      job,
      alarm: integer(f.H?.[0]),
      estop: diagnostic?.estop ?? null,
      compensation: n("O"),
    },
  }
}

/** SimpleShell diagnose (0x82); G carries light, beep, extend-in, vacuum and its power. */
export function parseDiagnostics(
  payload: string,
  receivedAt: number
): Diagnostics | null {
  const parsed = fields(payload, "{}")
  if (!parsed || !Object.keys(parsed.values).length) return null
  const f = parsed.values
  return {
    receivedAt,
    spindleOn: flag(f.S?.[0]),
    lightOn: flag(f.G?.[0]),
    beepOn: flag(f.G?.[1]),
    vacuumOn: flag(f.G?.[3]),
    vacuumPower: numeric(f.G?.[4]),
    estop: flag(f.I?.[0]),
  }
}

/** SimpleShell model_command: "model = Z1, 3, <FuncSetting>, <probe>, <state>". */
export function parseModelLine(line: string): Identity | null | "unsupported" {
  const match = /^model\s*=\s*([^,]+),\s*(\d+),\s*(\d+)/.exec(line.trim())
  if (!match) return null
  const model = modelById(Number(match[2]))
  if (!model || !/^Z1(?:\s?Pro)?$/i.test(match[1].trim())) return "unsupported"
  return { model, atc: (Number(match[3]) & ATC_FLAG) !== 0 }
}
