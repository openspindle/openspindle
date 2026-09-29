import { readNcBlock } from "@/machine/contract"
import { toolKindKey } from "@/domain/tools/tool"
import type { Tool } from "@/domain/tools/tool"
import { error, toolSubject } from "../diagnostics"
import type { Diagnostic } from "../diagnostics"
import type { Binding, Operation } from "../operations/operation"
import type { Plate, PlateTool } from "../plate/plate"
import { capitalize, fail, ok, toolNumberText } from "../primitives"
import type { Result } from "../primitives"

/** The firmware's probe slot. */
export const PROBE_TOOL = 0
/** The firmware's 3D probe slot: the Z1 keeps its probe port on and its double tap off for it. */
export const PROBE_3D_TOOL = 9999
const MAX_TOOL_NUMBER = 999999

/** Whether a tool number is a probe's slot, which only a probe fills and which never moves. */
export const isProbeSlot = (number: number | null) =>
  number === PROBE_TOOL || number === PROBE_3D_TOOL

/** What a probe slot holds, as messages name it. */
const slotName = (number: number) =>
  number === PROBE_3D_TOOL ? "3D probe" : "probe"

/** Whether a tool is the probe, compared loosely like any other kind ({@link toolKindKey}). */
export function isProbe(tool: { readonly kind: string }): boolean {
  return toolKindKey(tool.kind) === toolKindKey("probe")
}

/** Distinct tool numbers an NC program selects. Comments and M117 text never count. */
export function collectToolWords(nc: string): number[] {
  const tools = new Set<number>()
  for (const line of nc.split(/\r\n?|\n/)) {
    const block = readNcBlock(line)
    if (block.message !== null || block.problem) continue
    for (const word of block.words)
      if (
        word.letter === "T" &&
        Number.isInteger(word.value) &&
        word.value >= 0 &&
        word.value <= MAX_TOOL_NUMBER
      )
        tools.add(word.value)
  }
  return [...tools].sort((a, b) => a - b)
}

/** The tools an operation's NC needs: its T words, or the implicit tool when it selects none. */
export function localTools(nc: string): (number | null)[] {
  const words = collectToolWords(nc)
  return words.length ? words : [null]
}

function lowestFree(used: ReadonlySet<number | null>): number {
  let number = 1
  while (used.has(number)) number++
  return number
}

const sameNumber = (tool: PlateTool, number: number | null) =>
  tool.number === number

/**
 * The library tool meant for one of an NC program's own tool numbers: the tool whose
 * post-processor number matches, a probe for a probe slot. T0 takes the probe numbered 0, else
 * one the 3D probe's slot does not number, else any.
 */
function preferredTool(local: number, library: readonly Tool[]) {
  const numbered = (item: Tool) => item.postProcess.number === local
  if (local === PROBE_3D_TOOL)
    return library.find((item) => isProbe(item) && numbered(item))
  if (local !== PROBE_TOOL) return library.find(numbered)
  return (
    library.find((item) => isProbe(item) && numbered(item)) ??
    library.find(
      (item) => isProbe(item) && item.postProcess.number !== PROBE_3D_TOOL
    ) ??
    library.find((item) => isProbe(item))
  )
}

/**
 * Library tools meant for an NC program's own tool numbers: the tool whose post-processor
 * number matches, and the probes for T0 and the 3D probe's slot.
 */
export function libraryPreferences(
  locals: readonly (number | null)[],
  library: readonly Tool[]
): Map<number | null, string> {
  const preferred = new Map<number | null, string>()
  for (const local of locals) {
    if (local === null) continue
    const tool = preferredTool(local, library)
    if (tool) preferred.set(local, tool.id)
  }
  return preferred
}

/** The library tools an operation's bindings hold on its plate, by the operation's own numbers. */
export function boundTools(
  plate: Plate,
  operation: Operation
): Map<number | null, string> {
  const bound = new Map<number | null, string>()
  for (const binding of operation.tools) {
    const toolId = plate.tools.find((tool) =>
      sameNumber(tool, binding.plate)
    )?.toolId
    if (toolId) bound.set(binding.local, toolId)
  }
  return bound
}

/**
 * Binds an operation's tools into the plate's table. Existing bindings stay; the probe slots
 * (T0, and the 3D probe's) keep their number; a tool already in the table is reused; otherwise
 * the operation's own number, the tool's post-processor number, or the lowest free number is
 * taken.
 */
export function bindTools(
  plate: Plate,
  operation: Operation,
  locals: readonly (number | null)[],
  options: {
    /** Library tool intended for a local number (legacy assignments, plugin choices). */
    readonly preferred?: ReadonlyMap<number | null, string>
    readonly library?: readonly Tool[]
  } = {}
): { plate: Plate; operation: Operation } {
  const table = plate.tools.map((tool) => ({ ...tool }))
  const used = new Set(table.map((tool) => tool.number))
  const bindings: Binding[] = []
  for (const local of locals) {
    const existing = operation.tools.find((binding) => binding.local === local)
    if (existing && table.some((tool) => sameNumber(tool, existing.plate))) {
      bindings.push(existing)
      continue
    }
    const toolId = options.preferred?.get(local) ?? null
    let number: number | null
    if (local === null || isProbeSlot(local)) number = local
    else {
      const holder = toolId
        ? table.find(
            (tool) =>
              tool.toolId === toolId &&
              tool.number !== null &&
              !isProbeSlot(tool.number)
          )
        : undefined
      const post =
        options.library?.find((tool) => tool.id === toolId)?.postProcess
          .number ?? null
      if (holder) number = holder.number
      else if (!used.has(local)) number = local
      else if (post !== null && !isProbeSlot(post) && !used.has(post))
        number = post
      else number = lowestFree(used)
    }
    const entry = table.find((tool) => sameNumber(tool, number))
    if (!entry) {
      table.push({ number, toolId })
      used.add(number)
    } else if (entry.toolId === null && toolId !== null) entry.toolId = toolId
    bindings.push({ local, plate: number })
  }
  const next = { ...operation, tools: bindings }
  return {
    operation: next,
    plate: pruneTools({
      ...plate,
      tools: table,
      operations: plate.operations.map((item) =>
        item.id === operation.id ? next : item
      ),
    }),
  }
}

/** Drops table entries no operation binds and keeps the table ordered. */
export function pruneTools(plate: Plate): Plate {
  const bound = new Set(
    plate.operations.flatMap((operation) =>
      operation.tools.map((binding) => binding.plate)
    )
  )
  const tools = plate.tools
    .filter((tool) => bound.has(tool.number))
    .sort((a, b) => (a.number ?? -1) - (b.number ?? -1))
  const same =
    tools.length === plate.tools.length &&
    tools.every((tool, index) => tool === plate.tools[index])
  return same ? plate : { ...plate, tools }
}

function rebind(plate: Plate, from: number, to: number): Plate {
  return {
    ...plate,
    operations: plate.operations.map((operation) =>
      operation.tools.some((binding) => binding.plate === from)
        ? {
            ...operation,
            revision: operation.revision + 1,
            tools: operation.tools.map((binding) =>
              binding.plate === from ? { ...binding, plate: to } : binding
            ),
          }
        : operation
    ),
  }
}

/**
 * Puts a library tool in a table entry. When another numbered entry already holds that tool,
 * the two merge into the existing number, so the machine never changes to the same tool twice.
 */
export function assignTool(
  plate: Plate,
  number: number | null,
  toolId: string | null
): Result<Plate> {
  const entry = plate.tools.find((tool) => sameNumber(tool, number))
  if (!entry)
    return fail(
      `${capitalize(toolNumberText(number))} is not in this plate's tool table.`
    )
  const holder =
    toolId !== null && number !== null && !isProbeSlot(number)
      ? plate.tools.find(
          (tool) =>
            tool.toolId === toolId &&
            tool.number !== number &&
            tool.number !== null &&
            !isProbeSlot(tool.number)
        )
      : undefined
  if (holder?.number != null && number !== null)
    return ok(pruneTools(rebind(plate, number, holder.number)))
  return ok({
    ...plate,
    tools: plate.tools.map((tool) =>
      tool === entry ? { ...tool, toolId } : tool
    ),
  })
}

/**
 * Puts library tools on an operation's own tool numbers (numbers its NC does not select are
 * ignored). An entry only this operation uses is assigned like `assignTool`; an entry other
 * operations share keeps its tool, and this operation moves to an entry holding the new
 * tool or to a free number. The program's implicit tool and the probe slots are one entry
 * per plate, so those are assigned in place.
 */
export function assignOperationTools(
  plate: Plate,
  operationId: string,
  tools: ReadonlyMap<number | null, string>,
  library: readonly Tool[]
): Result<Plate> {
  let current = plate
  for (const [local, toolId] of tools) {
    const operation = current.operations.find((item) => item.id === operationId)
    if (!operation) return fail("The operation no longer exists.")
    const binding = operation.tools.find((item) => item.local === local)
    if (!binding) continue
    const entry = current.tools.find((tool) => sameNumber(tool, binding.plate))
    if (entry?.toolId === toolId) continue
    const shared = current.operations.some(
      (item) =>
        item.id !== operationId &&
        item.tools.some((other) => other.plate === binding.plate)
    )
    if (!shared || binding.plate === null || isProbeSlot(binding.plate)) {
      const assigned = assignTool(current, binding.plate, toolId)
      if (!assigned.ok) return assigned
      current = assigned.value
      continue
    }
    const detached: Operation = {
      ...operation,
      tools: operation.tools.filter((item) => item !== binding),
    }
    current = bindTools(
      pruneTools({
        ...current,
        operations: current.operations.map((item) =>
          item.id === operationId ? detached : item
        ),
      }),
      detached,
      operation.tools.map((item) => item.local),
      { preferred: new Map([[local, toolId]]), library }
    ).plate
  }
  return ok(current)
}

/** Explicitly moves a table entry to another free number. The probe slots stay theirs. */
export function renumberTool(
  plate: Plate,
  from: number,
  to: number
): Result<Plate> {
  if (from === to) return ok(plate)
  for (const slot of [from, to])
    if (isProbeSlot(slot))
      return fail(`T${slot} is reserved for the ${slotName(slot)}.`)
  if (to < 1 || to > MAX_TOOL_NUMBER || !Number.isInteger(to))
    return fail("Choose a tool number from 1 to 999999.")
  if (!plate.tools.some((tool) => tool.number === from))
    return fail(`T${from} is not in use.`)
  if (plate.tools.some((tool) => tool.number === to))
    return fail(`T${to} is already in use.`)
  const moved = rebind(plate, from, to)
  return ok(
    pruneTools({
      ...moved,
      tools: moved.tools.map((tool) =>
        tool.number === from ? { ...tool, number: to } : tool
      ),
    })
  )
}

/**
 * Unassigned, dangling and misplaced-probe entries block Run: only a probe fills a probe slot
 * (T0, the 3D probe's), and a probe fills nothing else. The table itself never changes on its
 * own.
 */
export function toolDiagnostics(
  plate: Plate,
  library: readonly Tool[]
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const entry of plate.tools) {
    const details = {
      subject: toolSubject(entry.number),
      fix: { kind: "assign-tool", toolNumber: entry.number } as const,
    }
    if (entry.toolId === null) {
      diagnostics.push(
        error(
          "tool-unassigned",
          `${capitalize(toolNumberText(entry.number))} has no tool assigned.`,
          details
        )
      )
      continue
    }
    const tool = library.find((item) => item.id === entry.toolId)
    if (!tool)
      diagnostics.push(
        error(
          "tool-missing",
          `${capitalize(toolNumberText(entry.number))} uses a tool that is no longer in the library.`,
          details
        )
      )
    else if (
      entry.number !== null &&
      isProbeSlot(entry.number) &&
      !isProbe(tool)
    )
      diagnostics.push(
        error(
          "tool-probe-slot",
          `T${entry.number} is the ${slotName(entry.number)} slot; assign a probe.`,
          details
        )
      )
    else if (!isProbeSlot(entry.number) && isProbe(tool))
      diagnostics.push(
        error(
          "tool-probe-elsewhere",
          `${capitalize(toolNumberText(entry.number))} would cut with the probe; assign a cutting tool.`,
          details
        )
      )
  }
  return diagnostics
}
