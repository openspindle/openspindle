import { camLabel } from "./cam-markers"
import type { CamMarkers, ProgramTool } from "./cam-markers"

/** Tool kinds as Fusion 360 names them in its posts' comments, which libraries use too. */
const FUSION_KINDS =
  /^(?:flat|ball|bull nose|lollipop|tapered|radius|chamfer|face|slot|dovetail|thread|form|boring|reamer|tap|counter bore|counter sink|spot|center|drill|engrave|probe|barrel|lens|oval)\b/i

/** The first units a program sets: 25.4 millimetres per value in inches (G20), 1 otherwise. */
function unitScale(lines: readonly string[]): number {
  for (const line of lines) {
    const code = line.replace(/\([^)]*\)|;.*$/g, "").toUpperCase()
    if (/\bG0*20(?![\d.])/.test(code)) return 25.4
    if (/\bG0*21(?![\d.])/.test(code)) return 1
  }
  return 1
}

/**
 * The tools a program describes in comments as Fusion 360's posts write them, each first time:
 * "(T1  Spiral O Metal 3.175*12mm  Makera  D=3.175 SD=3.175 FL=12. - ZMIN=-5.325 - flat end
 * mill)". The name comes before the dimensions, the diameter is D and the flute length FL, in
 * the program's units, and the kind ends the comment.
 */
export function commentTools(
  lines: readonly string[]
): Map<number, ProgramTool> {
  const tools = new Map<number, ProgramTool>()
  const scale = unitScale(lines)
  for (const line of lines) {
    const match = /^\s*\(\s*T(\d{1,6})\s+(.*?)\s*\)\s*$/i.exec(line)
    if (!match || line.length > 400) continue
    const number = Number(match[1])
    if (tools.has(number)) continue
    const parts = match[2].split(/\s+-\s+/)
    const last = parts.length > 1 ? parts[parts.length - 1] : ""
    const kind = !last.includes("=") && FUSION_KINDS.test(last) ? last : null
    const fields = new Map(
      [...parts[0].matchAll(/\b([A-Z]{1,4})=(-?\d*\.?\d+)/g)].map(
        ([, key, value]) => [key, Number(value)] as const
      )
    )
    const measure = (key: string) => {
      const value = fields.get(key)
      return value !== undefined && value > 0 ? value * scale : null
    }
    const name = parts[0]
      .replace(/\s*\b[A-Z]{1,4}=.*$/, "")
      .replace(/\s+/g, " ")
    const tool: ProgramTool = {
      number,
      name: name.trim() || null,
      diameter: measure("D"),
      fluteLength: measure("FL"),
      kind: kind?.toLowerCase() ?? null,
    }
    if (tool.diameter !== null || tool.kind !== null) tools.set(number, tool)
  }
  return tools
}

const FREECAD_KINDS: ReadonlyMap<string, string> = new Map([
  ["endmill", "flat end mill"],
  ["ballend", "ball end mill"],
  ["chamfer", "chamfer mill"],
  ["vbit", "chamfer mill"],
  ["drill", "drill"],
])

/** Makera's FreeCAD post uses program units; the bridge can mark its dimensions explicitly. */
function freecadTools(lines: readonly string[]): Map<number, ProgramTool> {
  const tools = new Map<number, ProgramTool>()
  const programScale = unitScale(lines)
  for (const line of lines) {
    if (line.length > 4096) continue
    const marker =
      /^\s*(?:\(\s*@FC\|TOOL\|([^()]*)\)|;\s*@FC\|TOOL\|(.*))\s*$/i.exec(line)
    if (!marker) continue
    const fields = new Map<string, string>()
    for (const field of (marker.at(1) ?? marker[2]).split("|")) {
      const separator = field.indexOf("=")
      if (separator > 0)
        fields.set(
          field.slice(0, separator).toLowerCase(),
          field.slice(separator + 1).trim()
        )
    }
    const register = fields.get("number") ?? ""
    if (!/^\d{1,6}$/.test(register)) continue
    const number = Number(register)
    const scale = fields.get("unit") === "mm" ? 1 : programScale
    const measure = (key: string, min = Number.MIN_VALUE) => {
      const raw = fields.get(key)
      const value = raw ? Number(raw) : NaN
      return Number.isFinite(value) && value >= min ? value : null
    }
    const length = (key: string, min?: number) => {
      const value = measure(key, min)
      return value === null ? null : value * scale
    }
    const shape =
      fields
        .get("type")
        ?.toLowerCase()
        .replace(/[-_\s]+/g, "") ?? ""
    const tool: ProgramTool = {
      number,
      name: camLabel(fields.get("name")),
      diameter: length("diameter"),
      fluteLength: length("flutelength"),
      kind: FREECAD_KINDS.get(shape) ?? null,
      freecad: {
        tipDiameter: length("tipdiameter", 0),
        includedAngle: measure("tipangle") ?? measure("cuttingedgeangle"),
      },
    }
    const previous = tools.get(number)
    // Keep a record for this number when descriptions conflict, so number fallback stays off.
    if (previous && JSON.stringify(previous) !== JSON.stringify(tool)) {
      tools.set(number, { ...tool, kind: null })
    } else {
      tools.set(number, tool)
    }
  }
  return tools
}

/**
 * What a program says of its tools: its machine CAM's markers, FreeCAD tool descriptors, or
 * comments as Fusion 360's posts write them.
 */
export function programTools(
  text: string,
  markers: CamMarkers | null
): ReadonlyMap<number, ProgramTool> {
  const lines = text.split(/\r\n?|\n/)
  const freecad = freecadTools(lines)
  return freecad.size
    ? freecad
    : (markers?.tools?.(lines) ?? commentTools(lines))
}
