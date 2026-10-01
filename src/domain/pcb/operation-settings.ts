import type { CuttingPreset, Tool } from "../tools/tool"
import { isDrillFile, parameters } from "./manifest.mjs"
import type { DrillMethod } from "./manifest.mjs"
import { holeSizeCount } from "./excellon"
import { roleLabel } from "./inputs"
import type { PCBOperationData, Values } from "./operation-data"

type Role = string | null
type OperationGroup = "isolation" | "drilling" | "outline"
/** How an operation cuts: its group, with holes milled by an end mill apart from drilled ones. */
type Machining = OperationGroup | "milldrilling"

const normalized = (value: string) =>
  value.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim()
const tapered = (tool: Tool) => /chamfer|engraving/.test(normalized(tool.kind))

export function operationGroup(role: Role): OperationGroup | null {
  if (role === "front" || role === "back") return "isolation"
  if (role === "drill") return "drilling"
  if (role === "outline") return "outline"
  return null
}

/**
 * How a drill file's operation makes its holes: as chosen in its Operation field (Drill, or
 * Mill drill), else milled for a file of several hole sizes, which one drill cannot make.
 */
export function drillMethod(data: PCBOperationData): DrillMethod {
  const chosen = data.values.drillMethod
  if (chosen === "drill" || chosen === "mill") return chosen
  return data.file.role === "drill" && holeSizeCount(data.file.content) > 1
    ? "mill"
    : "drill"
}

/** A drill file's holes made with one end mill: an operation kind of its own. */
export const MILL_DRILL = "mill-drill"

/** What a file's operation can be, as its Operation field offers it. */
export const operationKinds = (
  file: PCBOperationData["file"]
): readonly string[] =>
  isDrillFile(file) ? ["drill", MILL_DRILL] : ["front", "back", "outline"]

/**
 * The file's role, or none when the file cannot make it (a Gerber set to Drill, which
 * pcb2gcode crashes on): the operation then waits for its Operation to be chosen again.
 */
export function operationRole(file: PCBOperationData["file"]): string {
  const { role } = file
  return role === "" || isDrillFile(file) === (role === "drill") ? role : ""
}

/**
 * What an operation is: its file's role, with a drill file whose holes an end mill makes
 * being Mill drill. The data keeps the role and the drill method.
 */
export function operationKind(data: PCBOperationData): string {
  const role = operationRole(data.file)
  return role === "drill" && drillMethod(data) === "mill" ? MILL_DRILL : role
}

export const operationKindLabel = (kind: string) =>
  kind === MILL_DRILL ? "Mill drill" : roleLabel(kind)

function machining(role: Role, method: DrillMethod): Machining | null {
  const group = operationGroup(role)
  return group === "drilling" && method === "mill" ? "milldrilling" : group
}

/** Tool types the app's chooser opens on; any tool in the library can still be chosen. */
const RECOMMENDED_KINDS: Readonly<Record<Machining, readonly string[]>> = {
  isolation: [
    "flat end mill",
    "bull nose end mill",
    "bull end mill",
    "chamfer mill",
    "engraving",
  ],
  outline: ["flat end mill"],
  drilling: ["drill"],
  milldrilling: ["flat end mill"],
}

export function recommendedKinds(role: Role, method: DrillMethod): string[] {
  const kind = machining(role, method)
  return kind ? [...RECOMMENDED_KINDS[kind]] : []
}

/** A preset named PCB, else one for the stock material; never an arbitrary first preset. */
export function preferredPreset(
  tool: Tool | undefined,
  stockMaterial?: string | null
): CuttingPreset | undefined {
  if (!tool) return undefined
  const pcb = tool.presets.find((preset) => /\bpcb\b/i.test(preset.name))
  if (pcb) return pcb
  const material = normalized(stockMaterial ?? "")
  if (!material) return undefined
  return tool.presets.find(
    (preset) =>
      normalized(preset.name) === material ||
      normalized(preset.material ?? "") === material
  )
}

const DEGREES = Math.PI / 180

/** Half a tapered tip's included angle: half its point angle, else its taper angle. */
function taperHalfAngle(tool: Tool): number | null {
  const { pointAngle, taperAngle } = tool.geometry
  if (pointAngle !== null && pointAngle > 0 && pointAngle < 180)
    return pointAngle / 2
  if (taperAngle !== null && taperAngle > 0 && taperAngle < 90)
    return taperAngle
  return null
}

/**
 * The width a tool isolates copper with at the depth `zwork` (negative, in mm). A tapered
 * tip widens with depth, tip + 2 × depth × tan(half angle), to the micrometre; without a
 * depth or an angle it is the tip itself.
 */
function isolationWidth(
  tool: Tool,
  zwork: Values[string] | undefined
): number | null {
  if (!tapered(tool)) return tool.diameter
  const tip = tool.geometry.tipDiameter
  const half = taperHalfAngle(tool)
  const depth = typeof zwork === "string" ? -Number(zwork) : Number.NaN
  if (tip === null || half === null || !(depth > 0)) return tip
  return Number((tip + 2 * depth * Math.tan(half * DEGREES)).toFixed(3))
}

const inheritedFields = {
  isolation: ["zwork", "millDiameter", "millFeed", "millVertfeed", "millSpeed"],
  drilling: ["drillFeed", "drillSpeed"],
  milldrilling: [
    "milldrillDiameter",
    "milldrillInfeed",
    "milldrillFeed",
    "drillFeed",
    "drillSpeed",
  ],
  outline: [
    "cutterDiameter",
    "cutFeed",
    "cutVertfeed",
    "cutSpeed",
    "cutInfeed",
  ],
} as const

/** The cutting values a tool's geometry supplies: they follow the tool, never a preset. */
export const geometryFields: readonly string[] = [
  "millDiameter",
  "cutterDiameter",
  "milldrillDiameter",
]

/** The cutting values an operation takes from its tool and preset. */
export function toolFields(role: Role, method: DrillMethod): string[] {
  const kind = machining(role, method)
  return kind ? [...inheritedFields[kind]] : []
}

function precision(value: number): number {
  const [mantissa, exponent = "0"] = String(value).toLowerCase().split("e")
  return Math.max(0, (mantissa.split(".")[1]?.length ?? 0) - Number(exponent))
}

/**
 * The values a tool and preset supply; `edits` are the operation's own values, whose depth
 * the isolation width follows. Values outside a parameter's range stay visible for
 * validation; never clamp them.
 */
export function toolValues(
  role: Role,
  method: DrillMethod,
  tool: Tool | undefined,
  preset: CuttingPreset | undefined,
  edits: Values
): Values {
  if (!tool) return {}
  const values: Values = {}
  const put = (id: string, reading: number | null | undefined) => {
    if (typeof reading !== "number" || !Number.isFinite(reading)) return
    const field = parameters.find((parameter) => parameter.id === id)
    if (!field || field.type !== "number") return
    let value = reading
    if (value >= field.min && value <= field.max && field.step > 0) {
      const places = Math.min(
        12,
        Math.max(precision(field.step), precision(field.min))
      )
      value = Number(
        (
          field.min +
          Math.round((value - field.min) / field.step) * field.step
        ).toFixed(places)
      )
    }
    values[id] = String(value)
  }
  const kind = machining(role, method)
  if (kind === "isolation") {
    put("millFeed", preset?.feedRate)
    put("millVertfeed", preset?.plungeFeed)
    put("millSpeed", preset?.rpm)
    // Copper isolation uses one depth; the preset's enabled stepdown supplies it.
    if (preset?.useStepdown === true && preset.stepdown !== null)
      put("zwork", -preset.stepdown)
    // A tapered tip cuts wider the deeper it goes; an entered width still wins.
    const depth = edits.zwork as string | boolean | undefined
    put("millDiameter", isolationWidth(tool, depth ?? values.zwork))
  } else if (kind === "outline") {
    put("cutterDiameter", tool.diameter)
    put("cutFeed", preset?.feedRate)
    put("cutVertfeed", preset?.plungeFeed)
    put("cutSpeed", preset?.rpm)
    if (preset?.useStepdown === true) put("cutInfeed", preset.stepdown)
  } else if (kind === "drilling") {
    // Diameter belongs to the Excellon table, never to a substitute selected tool.
    put("drillFeed", preset?.plungeFeed)
    put("drillSpeed", preset?.rpm)
  } else if (kind === "milldrilling") {
    // One end mill makes every hole, circling those wider than itself.
    put("milldrillDiameter", tool.diameter)
    put("milldrillFeed", preset?.feedRate)
    put("drillFeed", preset?.plungeFeed)
    put("drillSpeed", preset?.rpm)
    if (preset?.useStepdown === true) put("milldrillInfeed", preset.stepdown)
  }
  return values
}
