import { EPSILON, formatMillimetres } from "@/domain/geometry/millimetres"
import { PlateSchema, notice } from "@/domain/plate/plate"
import type { PlateNotice } from "@/domain/plate/plate"
import { isTool } from "@/domain/tools/tool"
import type { Tool } from "@/domain/tools/tool"
import { isProbe, libraryPreferences } from "@/domain/tools/tool-table"
import { upgradeTool } from "../tool-library/upgrade"
import { isJsonObject } from "./json"
import type { JsonObject } from "./json"
import { upgradeProbingSource } from "./probing"

/** What upgrading a plate's saved data makes of it. */
export type UpgradedPlate = {
  readonly plate: JsonObject
  /** What the user should review, as the plate's notices say it (`withNotices`). */
  readonly notices: readonly string[]
}

/**
 * The library's tool with an id, brought up to date as reading brings it (`upgradeTool`); null
 * when the library holds no valid tool with it.
 */
function libraryTool(library: readonly unknown[], id: unknown): Tool | null {
  if (typeof id !== "string") return null
  const tool = upgradeTool(
    library.find((item) => isJsonObject(item) && item.id === id)
  )
  return isTool(tool) ? tool : null
}

/** The library's tools, brought up to date as reading brings them; invalid ones left out. */
const libraryTools = (library: readonly unknown[]): Tool[] =>
  library.map(upgradeTool).filter(isTool)

/** Whether bindings bind a tool number, as an operation's `tools` hold them. */
const binds = (bindings: readonly unknown[], local: number) =>
  bindings.some((binding) => isJsonObject(binding) && binding.local === local)

/** A table entry's number; the program's tool (null) comes first. */
const entryNumber = (entry: unknown) =>
  isJsonObject(entry) && typeof entry.number === "number" ? entry.number : -1

/** Whether a tool table has an entry for a number. */
const hasEntry = (table: readonly unknown[], number: number) =>
  table.some((entry) => isJsonObject(entry) && entry.number === number)

/** A tool table with a new entry for a number, holding a tool or none, in number order. */
function withEntry(
  table: readonly unknown[],
  number: number,
  toolId: string | null
): readonly unknown[] {
  const index = table.findIndex((entry) => entryNumber(entry) > number)
  const entry = { number, toolId }
  return index < 0
    ? [...table, entry]
    : [...table.slice(0, index), entry, ...table.slice(index)]
}

/**
 * The table number an operation's own tool number runs as (its binding's), and the library tool
 * the table's entry of that number holds: null for a library without a valid tool of its id.
 */
function boundTool(
  bindings: unknown,
  table: unknown,
  local: number,
  library: readonly unknown[]
): { readonly number: number; readonly tool: Tool | null } {
  const binding = Array.isArray(bindings)
    ? bindings.find(
        (item: unknown) => isJsonObject(item) && item.local === local
      )
    : undefined
  const number =
    isJsonObject(binding) && typeof binding.plate === "number"
      ? binding.plate
      : local
  const entry = Array.isArray(table)
    ? table.find(
        (item: unknown) => isJsonObject(item) && item.number === number
      )
    : undefined
  return {
    number,
    tool: isJsonObject(entry) ? libraryTool(library, entry.toolId) : null,
  }
}

/**
 * What a 3D probing operation set for a ball of its own should tell the user, now that it takes
 * the ball of the probe in its table entry (`T<number>`): nothing when that probe's ball is the
 * same.
 */
function ballNotice(
  ball: number,
  { number, tool }: ReturnType<typeof boundTool>
): string | null {
  const was = `3D probing was set for a ${formatMillimetres(ball)} mm ball; it now takes the ball of the probe in T${number}`
  if (!tool || !isProbe(tool))
    return `${was}, which holds no probe from the tool library: assign the probe you use.`
  if (tool.diameter === null)
    return `${was}, ${tool.name}, which has no ball set: assign the probe you use, or set its ball in the tool library.`
  if (Math.abs(tool.diameter - ball) <= EPSILON) return null
  return `${was}, ${tool.name} (${formatMillimetres(tool.diameter)} mm): assign the probe you use, or correct its ball in the tool library.`
}

/**
 * A plate's saved data as formats 4 and 5 saved it, in format 6: a project's plate, or an
 * export's payload, which holds the plate's setup, tool table and operations alike. Its
 * auto-level, auto Z-height, auto-scan and 3D probing operations become probing operations
 * (`upgradeProbingSource`); one that does not bind its probe binds it to the entry of that
 * number. Where the table has none it gains one, holding the probe of the `library` (the tools
 * the table's entries name, as saved or as the app holds them) that adding the operation picks
 * for that number (`libraryPreferences`), or no tool when it has none. A 3D probing set for
 * another ball than its probe's, or without a probe from the library, is a notice. What it does
 * not recognize stays as it is, for reading to leave out and report.
 */
export function upgradePlate(
  plate: JsonObject,
  library: readonly unknown[]
): UpgradedPlate {
  if (!Array.isArray(plate.operations)) return { plate, notices: [] }
  let table = plate.tools
  let tools: Tool[] | null = null
  const notices: string[] = []
  const operations = plate.operations.map((operation: unknown) => {
    if (!isJsonObject(operation) || !isJsonObject(operation.source))
      return operation
    const upgraded = upgradeProbingSource(operation.source, plate.setup)
    if (!upgraded) return operation
    const { probe, ball } = upgraded
    let bindings = operation.tools
    if (
      probe !== null &&
      Array.isArray(table) &&
      Array.isArray(bindings) &&
      !binds(bindings, probe)
    ) {
      bindings = [...bindings, { local: probe, plate: probe }]
      if (!hasEntry(table, probe)) {
        tools ??= libraryTools(library)
        const preferred = libraryPreferences([probe], tools).get(probe)
        table = withEntry(table, probe, preferred ?? null)
      }
    }
    if (probe !== null && ball !== null) {
      const message = ballNotice(
        ball,
        boundTool(bindings, table, probe, library)
      )
      if (message) notices.push(message)
    }
    return bindings === operation.tools
      ? { ...operation, source: upgraded.source }
      : { ...operation, tools: bindings, source: upgraded.source }
  })
  return {
    plate:
      table === plate.tools
        ? { ...plate, operations }
        : { ...plate, tools: table, operations },
    notices,
  }
}

/**
 * A plate's notices and one for each message they do not hold yet (`notice`), as many as a plate
 * holds (`PlateSchema`): one that would exceed its limits is left out.
 */
export function withNotices<T>(
  notices: readonly T[],
  messages: readonly string[]
): (T | PlateNotice)[] {
  const held = PlateSchema.shape.notices
  const result: (T | PlateNotice)[] = [...notices]
  for (const message of messages) {
    if (result.some((item) => isJsonObject(item) && item.message === message))
      continue
    const added = notice(message)
    if (held.safeParse([...result, added]).success) result.push(added)
  }
  return result
}
