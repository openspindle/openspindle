import { FIXTURE_KITS } from "@/domain/fixtures/catalog"
import { MAKERA_Z1_ID } from "@/domain/fixtures/makera-z1/makera-z1"
import { EPSILON, formatMillimetres } from "@/domain/geometry/millimetres"
import { PlateSchema, notice } from "@/domain/plate/plate"
import type { PlateNotice } from "@/domain/plate/plate"
import { runsWith, strategyById } from "@/domain/probing/strategies"
import { isProbe, isTool, probeProfile } from "@/domain/tools/tool"
import type { Tool } from "@/domain/tools/tool"
import { libraryPreferences } from "@/domain/tools/tool-table"
import { upgradeTool } from "../tool-library/upgrade"
import { upgradeBedFrame } from "./bed-frame"
import { isJsonObject } from "./json"
import type { JsonObject } from "./json"
import { upgradeProbingSource } from "./probing"
import {
  currentStrategy,
  earlierStrategyLabel,
  upgradeStrategies,
} from "./strategies"

/** What upgrading a plate's saved data makes of it. */
export type UpgradedPlate = {
  readonly plate: JsonObject
  /** What the user should review, as the plate's notices say it (`withNotices`). */
  readonly notices: readonly string[]
  /** The names of the operations it renamed as they were saved, by operation id. */
  readonly savedNames: ReadonlyMap<string, string>
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
 * The probing of the Z1, the only machine earlier formats probed with: their probing operations
 * wrote its NC, selecting its probe slots.
 */
const Z1_PROBING =
  FIXTURE_KITS.find((kit) => kit.id === MAKERA_Z1_ID)?.probing ?? null

/**
 * What an operation of an earlier kind (named by its `label`) should tell the user when the
 * strategy its probing `source` is now (`currentStrategy`) cannot run with the probe in its table
 * entry (`T<number>`) on the Z1 (`runsWith`): nothing for a tool that is no probe of known
 * profile, which resolving reports.
 */
function probeNotice(
  label: string,
  source: JsonObject,
  { number, tool }: ReturnType<typeof boundTool>
): string | null {
  const profile = tool && probeProfile(tool)
  const id = currentStrategy(source)
  const strategy = id === null ? null : strategyById(id)
  if (!tool || !profile || !Z1_PROBING || !strategy) return null
  if (runsWith(strategy, profile, Z1_PROBING)) return null
  return `${label} is now ${strategy.label}, which cannot probe with ${tool.name} in T${number}: assign a probe it runs with.`
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
 * A G32 grid's program section as earlier formats named it in the section ids its plate's groups
 * hold (`<operation id>/probe:<name>#<occurrence>`, `ProgramSection.key`), and as it is named now.
 */
const GRID_SECTION = {
  was: "/probe:Auto-level probing#",
  is: "/probe:Height map probing#",
} as const

/** A plate's groups holding their grids' sections by their current name. */
function upgradeGroups(groups: unknown): unknown {
  if (!Array.isArray(groups)) return groups
  return groups.map((group: unknown) =>
    isJsonObject(group) && Array.isArray(group.sectionIds)
      ? {
          ...group,
          sectionIds: group.sectionIds.map((id: unknown) =>
            typeof id === "string"
              ? id.replace(GRID_SECTION.was, GRID_SECTION.is)
              : id
          ),
        }
      : group
  )
}

/**
 * The steps that bring a plate's saved data up to the current format, in order:
 * - `operations`: its operations take their current shape (`upgradeOperations`), for projects
 *   before format 8 and exports before version 7;
 * - `bed-frame`: its bed positions move to bed coordinates from Anchor 1 (`upgradeBedFrame`),
 *   before format 9 and version 8;
 * - `strategies`: its probing operations name their strategy by what it does
 *   (`upgradeStrategies`), before format 10 and version 9.
 */
export type PlateUpgrade = "operations" | "bed-frame" | "strategies"

/**
 * A plate's saved data as earlier formats saved it (projects before format 10, exports before
 * version 9), in the current one: a project's plate, or an export's payload, which holds the
 * plate's setup, tool table and operations alike. It takes the steps from the first its format
 * needs (`from`) on, and no earlier one: a step changes what the formats before it saved, as the
 * bed frame's moves positions. The names it gives as saved are those the plate was saved with.
 */
export function upgradePlate(
  saved: JsonObject,
  library: readonly unknown[],
  from: PlateUpgrade
): UpgradedPlate {
  const operations =
    from === "operations"
      ? upgradeOperations(saved, library)
      : { plate: saved, notices: [], savedNames: new Map<string, string>() }
  const strategies = upgradeStrategies(
    from === "strategies" ? operations.plate : upgradeBedFrame(operations.plate)
  )
  return {
    plate: strategies.plate,
    notices: operations.notices,
    // The names before the operations step stand over those it gave.
    savedNames: new Map([...strategies.savedNames, ...operations.savedNames]),
  }
}

/**
 * A plate's saved data with operations of earlier formats (projects before format 8, exports
 * before version 7) in the shape of format 8. Its auto-level, auto Z-height, auto-scan and 3D
 * probing operations become probing operations (`upgradeProbingSource`), and one still named after
 * its kind is named after its strategy, as format 8 named a new one (`earlierStrategyLabel`); one
 * that does not bind its probe binds it to the entry of that number. Where the table has none it
 * gains one, holding the probe of the `library` (the tools the table's entries name, as saved or
 * as the app holds them) that adding the operation picks for that number (`libraryPreferences`),
 * or no tool when it has none. A probe there that the strategy it is now cannot run with is a
 * notice, and so is a 3D probing set for another ball than its probe's, or without a probe from
 * the library. Its groups hold its grids' sections by their current name. What it does not
 * recognize stays as it is, for reading to leave out and report.
 */
function upgradeOperations(
  saved: JsonObject,
  library: readonly unknown[]
): UpgradedPlate {
  const plate = Object.hasOwn(saved, "groups")
    ? { ...saved, groups: upgradeGroups(saved.groups) }
    : saved
  const savedNames = new Map<string, string>()
  if (!Array.isArray(plate.operations))
    return { plate, notices: [], savedNames }
  let table = plate.tools
  let tools: Tool[] | null = null
  const notices: string[] = []
  const operations = plate.operations.map((operation: unknown) => {
    if (!isJsonObject(operation) || !isJsonObject(operation.source))
      return operation
    const upgraded = upgradeProbingSource(operation.source, plate.setup)
    if (!upgraded) return operation
    const { label, strategy, probe, ball } = upgraded
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
    if (probe !== null) {
      const bound = boundTool(bindings, table, probe, library)
      // A probe the strategy cannot run with is wrong whatever its ball.
      const message =
        probeNotice(label, upgraded.source, bound) ??
        (ball === null ? null : ballNotice(ball, bound))
      if (message) notices.push(message)
    }
    // The inspector renames an operation named after its strategy along with it.
    const strategyLabel =
      strategy === null ? null : earlierStrategyLabel(strategy)
    const renamed = strategyLabel !== null && operation.name === label
    if (renamed && typeof operation.id === "string")
      savedNames.set(operation.id, label)
    const named = renamed ? { ...operation, name: strategyLabel } : operation
    return bindings === operation.tools
      ? { ...named, source: upgraded.source }
      : { ...named, tools: bindings, source: upgraded.source }
  })
  return {
    plate:
      table === plate.tools
        ? { ...plate, operations }
        : { ...plate, tools: table, operations },
    notices,
    savedNames,
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
