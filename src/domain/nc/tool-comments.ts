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

/**
 * What a program says of its tools: what its CAM's markers describe (`CamMarkers.tools`), else
 * its comments as Fusion 360's posts write them.
 */
export function programTools(
  text: string,
  markers: CamMarkers | null
): ReadonlyMap<number, ProgramTool> {
  const lines = text.split(/\r\n?|\n/)
  return markers?.tools?.(lines) ?? commentTools(lines)
}
