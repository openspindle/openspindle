import { camLabel } from "@/domain/nc/cam-markers"
import type { CamMarkers, ProgramTool } from "@/domain/nc/cam-markers"
import { UNSPECIFIED_STOCK_NAME, isStock } from "@/domain/stock/stock"
import type { Stock } from "@/domain/stock/stock"

function metadata(
  lines: readonly string[],
  tag: string
): Record<string, string> {
  const line = lines.find((value) => value.trim().startsWith(`;@MKR|${tag}|`))
  return Object.fromEntries(
    (line?.trim().split("|").slice(2) ?? []).map((entry) => {
      const separator = entry.indexOf("=")
      return [entry.slice(0, separator), entry.slice(separator + 1)]
    })
  )
}

/**
 * Stock described by Makera CAM markers (`;@MKR|STOCK|` cuboid size and `;@MKR|MATERIAL|`).
 * Without markers the result is null: a program that does not describe its stock never
 * inherits one. Neither does one whose markers, names included, do not make a valid stock.
 */
function stockFromMetadata(
  lines: readonly string[],
  fileName: string,
  fallback: Stock
): Stock | null {
  const sourceStock = metadata(lines, "STOCK")
  if (sourceStock.id !== "cuboid") return null
  const material = metadata(lines, "MATERIAL")
  const units = metadata(lines, "UNIT").value
  const scale = units === "in" || units === "inch" ? 25.4 : 1
  // Its own id, not the fallback's, which would pass it off as that library stock.
  const stock: Stock = {
    ...fallback,
    id: `source-${fileName}`,
    name: material.name2 || material.name1 || UNSPECIFIED_STOCK_NAME,
    material: material.name1 || "Unspecified",
    color: "#a9b3c0",
    width: Number(sourceStock.length) * scale,
    depth: Number(sourceStock.width) * scale,
    height: Number(sourceStock.height) * scale,
  }
  return isStock(stock) ? stock : null
}

/** A Makera CAM marker (`;@MKR|TYPE|key=value|…`): its type, upper case, and its values. */
function marker(
  line: string
): { type: string; values: Record<string, string> } | null {
  if (!/^\s*;@MKR\|/i.test(line) || line.length > 4096) return null
  const parts = line.trim().slice(6).split("|")
  const values: Record<string, string> = {}
  for (const part of parts.slice(1)) {
    const equals = part.indexOf("=")
    if (equals > 0) values[part.slice(0, equals)] = part.slice(equals + 1)
  }
  return { type: parts[0].toUpperCase(), values }
}

/**
 * Where Makera CAM's toolpaths start (`;@MKR|TOOLPATH_START|toolpath_number=…`), named as its
 * header defines them (`;@MKR|TOOLPATH|number=…|name=…`), else by their number. Duplicate names
 * are legitimate: the toolpath's number is its identity, and its first definition names it.
 */
function toolpaths(
  lines: readonly string[]
): ReadonlyMap<number, string> | null {
  const definitions = new Map<string, string>()
  const starts = new Map<number, string>()
  let marked = false
  for (const [index, line] of lines.entries()) {
    const entry = marker(line)
    if (!entry) continue
    if (entry.type === "TOOLPATH_START") {
      marked = true
      const number = entry.values.toolpath_number
      if (number) starts.set(index, number)
    }
    const name = camLabel(entry.values.name)
    if (
      entry.type === "TOOLPATH" &&
      entry.values.number &&
      name &&
      !definitions.has(entry.values.number)
    )
      definitions.set(entry.values.number, name)
  }
  if (!marked) return null
  return new Map(
    [...starts].map(([index, number]) => [
      index,
      definitions.get(number) ?? `Toolpath ${number}`,
    ])
  )
}

/** Makera CAM's tool types as tool libraries name them; others are left to the size and name. */
const TOOL_KINDS: ReadonlyMap<string, string> = new Map([
  ["flat end", "flat end mill"],
  ["ball end", "ball end mill"],
  ["ball nose", "ball end mill"],
  ["drill", "drill"],
])

/**
 * The tools Makera CAM's header describes (`;@MKR|TOOL|number=…|name=…|type=…|diameter=…|
 * flutelength=…`), in millimetres; null without them.
 */
function tools(
  lines: readonly string[]
): ReadonlyMap<number, ProgramTool> | null {
  const unit = metadata(lines, "UNIT").value
  const scale = unit === "in" || unit === "inch" ? 25.4 : 1
  const described = new Map<number, ProgramTool>()
  for (const line of lines) {
    const entry = marker(line)
    if (entry?.type !== "TOOL") continue
    const number = Number(entry.values.number)
    if (!Number.isInteger(number) || number < 0 || described.has(number))
      continue
    const measure = (key: string) => {
      const value = Number(entry.values[key])
      return Number.isFinite(value) && value > 0 ? value * scale : null
    }
    const tool: ProgramTool = {
      number,
      name: camLabel(entry.values.name),
      diameter: measure("diameter"),
      fluteLength: measure("flutelength"),
      kind:
        TOOL_KINDS.get(String(entry.values.type).trim().toLowerCase()) ?? null,
    }
    // A name alone would fit any tool: without a size or kind, the number picks it.
    if (tool.diameter !== null || tool.kind !== null)
      described.set(number, tool)
  }
  return described.size ? described : null
}

/** The markers Makera CAM writes in its programs. */
export const MAKERA_CAM: CamMarkers = {
  toolpaths,
  stock: stockFromMetadata,
  tools,
}
