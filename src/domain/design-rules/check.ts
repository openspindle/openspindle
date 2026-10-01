import { readNcBlock, ruleSetting, runRules } from "@/machine/contract"
import type { RuleSettings } from "@/machine/contract"
import type { GCodeSegment, Point3 } from "@/domain/nc/gcode"
import { linesText, programLines } from "@/domain/nc/program-lines"
import type { Tool } from "@/domain/tools/tool"
import type { CompiledPlate, OperationSpan } from "../compile/compile"
import { machineRetract } from "../compile/sections"
import {
  PLATE_SUBJECT,
  diagnosticOperation,
  error,
  operationSubject,
  warning,
} from "../diagnostics"
import type { Diagnostic, Place, ProgramLines, QuickFix } from "../diagnostics"
import { kitForPlate } from "../fixtures/catalog"
import type { FixtureKit } from "../fixtures/fixture-kit"
import { keptNcContext, kindOf } from "../operations/kinds"
import type { Operation } from "../operations/operation"
import type { Plate } from "../plate/plate"
import { capitalize } from "../primitives"
import { rulesOf } from "../rules/rules"
import { programSubject } from "../rules/stages"
import type { MoveSubject, StageFailure } from "../rules/stages"
import { isProbeSlot } from "../tools/tool-table"
import { EPSILON, maxDepthUnderStock } from "./move-rules"
import {
  FRESH_START,
  IGNORE,
  programEnd,
  programIssue,
  suggestedChoice,
  suggestionOf,
} from "./program-rules"
import type { ProgramStart } from "./program-rules"

/**
 * A rule that one operation breaks, with where it does: its moves break one of the move rules,
 * or its lines one of the machine's program rules. The message says what is wrong.
 */
export type DesignRuleViolation = Diagnostic & {
  /** Its rule's id: "max-cutting-feed", "spindle-reverse". */
  readonly rule: string
  /** The rule as the design rules name it: "Max cutting feed", "Spindle reverse (M4)". */
  readonly label: string
  /** What resolves it: "Cut at 2,000 mm/min or slower.", "Replace with M3". */
  readonly suggestion: string
  /** How many program lines break the rule. */
  readonly lineCount: number
  /** Those lines in the compiled program, merged into a few ranges to show them by. */
  readonly lines: readonly ProgramLines[]
}

export type DesignRuleCheck = {
  /** Errors first, then by operation and rule. */
  readonly violations: readonly DesignRuleViolation[]
  /** What was not checked, and why. */
  readonly notes: readonly string[]
}

/** How far above the stock top a tool at the machine's clearance is taken to be. */
const CLEARANCE = 1e6
/** Violations are shown by at most this many ranges of lines each. */
const SHOWN_RANGES = 200

/**
 * Where the plate is cut, in the program's coordinates (from the work origin): the stock's box,
 * or without stock, below Z0 over the extent of the cutting moves.
 */
type Region = {
  readonly min: readonly [number, number]
  readonly max: readonly [number, number]
  readonly top: number
  /** The stock's bottom; null without stock. */
  readonly bottom: number | null
}

/** Feed moves cut, except the probes' (T0, and the 3D probe's slot). */
const cutting = (segment: GCodeSegment) =>
  !segment.rapid && !isProbeSlot(segment.tool)

function stockRegion(
  plate: Plate,
  segments: readonly GCodeSegment[]
): Region | null {
  const { stock, stockAnchor, workOrigin } = plate.setup
  if (stock) {
    const [x, y, z] = [0, 1, 2].map(
      (axis) => stockAnchor[axis] - workOrigin[axis]
    )
    return {
      min: [x, y],
      max: [x + stock.width, y + stock.depth],
      top: z + stock.height,
      bottom: z,
    }
  }
  const min: [number, number] = [Infinity, Infinity]
  const max: [number, number] = [-Infinity, -Infinity]
  for (const segment of segments) {
    if (!cutting(segment)) continue
    for (const point of [segment.start, segment.end])
      for (const axis of [0, 1]) {
        min[axis] = Math.min(min[axis], point[axis])
        max[axis] = Math.max(max[axis], point[axis])
      }
  }
  return min[0] <= max[0] ? { min, max, top: 0, bottom: null } : null
}

/** Radii of the plate's tools by their table numbers; the program's tool under null. */
function toolRadii(plate: Plate, library: readonly Tool[]) {
  const radii = new Map<number | null, number>()
  for (const entry of plate.tools) {
    const tool = library.find((item) => item.id === entry.toolId)
    if (tool?.diameter) radii.set(entry.number, tool.diameter / 2)
  }
  return (number: number) => radii.get(number) ?? radii.get(null) ?? 0
}

/**
 * Lines that move Z alone in machine coordinates (`G53 G0 Z…`): lifts to the machine's
 * clearance, which the program's work coordinates cannot follow.
 */
function liftLines(lines: readonly string[]): number[] {
  const lifts: number[] = []
  for (const [index, line] of lines.entries())
    if (line.includes("53") && machineRetract(readNcBlock(line)))
      lifts.push(index + 1)
  return lifts
}

/**
 * The lowest the part of a move over the region's footprint, widened by `margin`, reaches;
 * null when the move is not over it.
 */
function lowestOver(
  start: Point3,
  end: Point3,
  region: Region,
  margin: number
): number | null {
  let from = 0
  let to = 1
  for (const axis of [0, 1]) {
    const low = region.min[axis] - margin
    const high = region.max[axis] + margin
    const delta = end[axis] - start[axis]
    if (Math.abs(delta) < 1e-12) {
      if (start[axis] < low || start[axis] > high) return null
      continue
    }
    const enter = (low - start[axis]) / delta
    const leave = (high - start[axis]) / delta
    from = Math.max(from, Math.min(enter, leave))
    to = Math.min(to, Math.max(enter, leave))
    if (from > to) return null
  }
  const z = (t: number) => start[2] + (end[2] - start[2]) * t
  return Math.min(z(from), z(to))
}

/**
 * The moves of a plate's compiled program that reach below the region's top over its footprint,
 * widened by the tool's radius where its side reaches, as the move rules test them. Moves straight
 * up (retracts) leave through what the tool has cut. After a lift to the machine's clearance and
 * at the start, the tool travels above everything until a move sets Z.
 */
function* moveSubjects(
  compiled: CompiledPlate,
  region: Region,
  radius: (tool: number) => number
): Generator<MoveSubject> {
  const { spans } = compiled
  let spanIndex = 0
  const operationAt = (line: number) => {
    while (spanIndex < spans.length && spans[spanIndex].endLine < line)
      spanIndex++
    const span = spans.at(spanIndex)
    return span && span.startLine <= line ? span.operationId : null
  }
  const lifts = liftLines(compiled.program.lines)
  let liftIndex = 0
  // Where the program starts is the preview's assumption, not a position it moves to: like a
  // lift, it leaves the tool above everything until a move sets Z.
  let lifted = true
  for (const segment of compiled.program.segments) {
    while (liftIndex < lifts.length && lifts[liftIndex] < segment.line) {
      lifted = true
      liftIndex++
    }
    const [x0, y0] = segment.start
    const [x1, y1, z1] = segment.end
    let z0 = segment.start[2]
    if (lifted) {
      // Moves that keep Z travel at the clearance; the first that sets it comes down from there.
      if (Math.abs(z1 - z0) < EPSILON) continue
      lifted = false
      z0 = region.top + CLEARANCE
    }
    const travel = Math.hypot(x1 - x0, y1 - y0)
    // Straight up leaves through what the tool has cut: a retract cuts nothing.
    if (travel < EPSILON && z1 > z0) continue
    const lowest = lowestOver(
      [x0, y0, z0],
      segment.end,
      region,
      radius(segment.tool)
    )
    if (lowest === null || lowest >= region.top - EPSILON) continue
    yield {
      segment,
      operationId: operationAt(segment.line),
      cutting: cutting(segment),
      plungeRate:
        z1 < z0 ? (segment.feed * (z0 - z1)) / Math.hypot(travel, z1 - z0) : 0,
      depth: region.top - lowest,
      under: region.bottom === null ? null : region.bottom - lowest,
    }
  }
}

/** Ranges merged across their smallest gaps until at most `limit` remain. */
function coarsen(
  ranges: readonly ProgramLines[],
  limit: number
): ProgramLines[] {
  if (ranges.length <= limit) return [...ranges]
  const gaps = ranges
    .slice(1)
    .map((range, index) => range.start - ranges[index].end)
  const bridges = ranges.length - limit
  const threshold = [...gaps].sort((a, b) => a - b)[bridges - 1]
  // Gaps as small as the last one bridged are bridged evenly along the program.
  const tied = gaps.filter((gap) => gap === threshold).length
  const quota = bridges - gaps.filter((gap) => gap < threshold).length
  let seen = 0
  let taken = 0
  const bridged = gaps.map((gap) => {
    if (gap !== threshold) return gap < threshold
    seen++
    if (Math.floor((seen * quota) / tied) === taken) return false
    taken++
    return true
  })
  const merged: { start: number; end: number }[] = []
  for (const [index, range] of ranges.entries()) {
    const previous = merged.at(-1)
    if (previous && bridged[index - 1]) previous.end = range.end
    else merged.push({ ...range })
  }
  return merged
}

const count = (value: number) => value.toLocaleString("en-US")

/**
 * Where the moves are: the one line, or how many there are and the worst of them, as its rule
 * names it ("fastest", "deepest", "first").
 */
function where(lineCount: number, worst: string, line: number) {
  if (lineCount === 1) return `At line ${count(line)}.`
  return `${count(lineCount)} lines, the ${worst} at line ${count(line)}.`
}

/** A rule's diagnostic code: "design-rule/max-cutting-feed", "design-rule/spindle-reverse". */
const ruleCode = (rule: string) => `design-rule/${rule}`

/**
 * An operation's own NC: NC it keeps, from a file or PCB conversion, rather than NC generated for the
 * machine, which its rules need not check and which sets no spindle speed. Null for generated NC
 * and for NC that does not resolve, which its own diagnostic reports.
 */
function ownNc(operation: Operation, plate: Plate, kit: FixtureKit) {
  const kind = kindOf(operation)
  if (kind.generated) return null
  const resolved = kind.resolve(operation, plate, keptNcContext(kit))
  return resolved.ok ? resolved.value.nc : null
}

/** What an operation's own NC leaves set, from a fresh start, by the kit it was read with. */
const operationEnds = new WeakMap<
  Operation,
  { readonly kit: FixtureKit; readonly end: ProgramStart }
>()

function operationEnd(
  operation: Operation,
  plate: Plate,
  kit: FixtureKit
): ProgramStart {
  const saved = operationEnds.get(operation)
  if (saved?.kit === kit) return saved.end
  const nc = ownNc(operation, plate, kit)
  const end =
    nc === null ? FRESH_START : programEnd(programLines(nc), FRESH_START)
  operationEnds.set(operation, { kit, end })
  return end
}

/** What each of a plate's operations starts with: what the operations before it leave set. */
function operationStarts(plate: Plate, kit: FixtureKit): ProgramStart[] {
  let start = FRESH_START
  return plate.operations.map((operation) => {
    const own = start
    const { spindleSpeed } = operationEnd(operation, plate, kit)
    start = { spindleSpeed: spindleSpeed ?? start.spindleSpeed }
    return own
  })
}

/** What an operation of a plate starts with: what the operations before it leave set. */
export function operationStart(
  plate: Plate,
  operationId: string,
  kit: FixtureKit = kitForPlate(plate)
): ProgramStart {
  const index = plate.operations.findIndex((item) => item.id === operationId)
  return index < 0 ? FRESH_START : operationStarts(plate, kit)[index]
}

/**
 * What an operation's NC breaks of its machine's program rules, by the kit, start and settings it
 * was checked with.
 */
const operationFindings = new WeakMap<
  Operation,
  {
    readonly kit: FixtureKit
    readonly start: ProgramStart
    readonly settings: RuleSettings
    readonly failures: readonly StageFailure<"program">[]
  }
>()

/**
 * What the machine's program rules find in an operation's own NC (`ownNc`), from its start, as
 * the project reports them.
 */
function operationFailures(
  operation: Operation,
  plate: Plate,
  kit: FixtureKit,
  start: ProgramStart,
  settings: RuleSettings
): readonly StageFailure<"program">[] {
  const saved = operationFindings.get(operation)
  if (
    saved?.kit === kit &&
    saved.start.spindleSpeed === start.spindleSpeed &&
    saved.settings === settings
  )
    return saved.failures
  const nc = ownNc(operation, plate, kit)
  const failures =
    nc === null
      ? []
      : runRules(rulesOf("program"), [programSubject(nc, start)], {
          settings,
          machine: kit.id,
        })
  operationFindings.set(operation, { kit, start, settings, failures })
  return failures
}

/** Where the tool is when the program reaches a line: where the last move before it ends. */
function positionAt(
  segments: readonly GCodeSegment[],
  line: number
): Point3 | null {
  let low = 0
  let high = segments.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (segments[middle].line <= line) low = middle + 1
    else high = middle
  }
  return low ? segments[low - 1].end : null
}

/**
 * What the plate's operations break of their machine's program rules, as the project reports
 * them: each issue with the lines it is on, and the fix its rule suggests for an NC file's
 * operation, whose NC is its own to change.
 */
function programViolations(
  plate: Plate,
  compiled: CompiledPlate,
  settings: RuleSettings
): DesignRuleViolation[] {
  const kit = kitForPlate(plate)
  const starts = operationStarts(plate, kit)
  const [ox, oy, oz] = plate.setup.workOrigin
  return plate.operations.flatMap((operation, index) =>
    operationFailures(operation, plate, kit, starts[index], settings).map(
      (failure): DesignRuleViolation => {
        const { rule } = failure
        const issue = programIssue(failure)
        const span = compiled.spans.find(
          (item) => item.operationId === operation.id
        )
        // Lines of an operation the program leaves out are nowhere in it.
        const offset =
          span && span.bodyStartLine <= span.endLine
            ? span.bodyStartLine - 1
            : null
        const at =
          offset === null
            ? null
            : positionAt(compiled.program.segments, offset + issue.lines[0])
        const places: Place[] = at
          ? [{ kind: "point", at: [ox + at[0], oy + at[1], oz + at[2]] }]
          : []
        const choice = suggestedChoice(issue)
        const fix: QuickFix | undefined =
          operation.source.kind === "file" &&
          choice &&
          choice.resolution !== "ignore"
            ? {
                kind: "resolve-rule",
                operationId: operation.id,
                rule: rule.id,
                resolution: choice.resolution,
              }
            : undefined
        const report = failure.severity === "error" ? error : warning
        return {
          ...report(
            ruleCode(rule.id),
            `${issue.problem} ${capitalize(linesText(issue.lines))} of ${operation.name}.`,
            {
              subject: operationSubject(operation.id),
              line: issue.lines[0],
              places,
              fix,
            }
          ),
          rule: rule.id,
          label: rule.label,
          suggestion: suggestionOf(issue),
          lineCount: issue.lines.length,
          lines:
            offset === null
              ? []
              : coarsen(
                  failure.lines.map(({ start, end }): ProgramLines => ({
                    start: offset + start,
                    end: offset + end,
                  })),
                  SHOWN_RANGES
                ),
        }
      }
    )
  )
}

/**
 * Checks a plate's compiled program against the move rules and its machine's program rules, as a
 * project's settings report them: each rule its moves break, per operation, with how often and
 * where, and each program rule the operations' own NC breaks, even an operation the program
 * leaves out. Heights are measured over the stock's footprint (widened by the tool's radius,
 * where its side reaches), so moves beside the stock, such as a tool change's, do not count;
 * without stock, below Z0 over the extent of the cutting moves. The probe's feed moves and moves
 * straight up (retracts) cut nothing. After a lift to the machine's clearance (a `G53` move of Z
 * alone, which compiling adds between operations) and at the start, the tool travels above
 * everything until a move sets Z. Pure; it reports, and the Job tab's checks let errors block Run.
 */
export function checkDesignRules(
  plate: Plate,
  compiled: CompiledPlate,
  settings: RuleSettings,
  library: readonly Tool[]
): DesignRuleCheck {
  const notes: string[] = []
  const { segments } = compiled.program
  const kit = kitForPlate(plate)
  const order = new Map<string | null, number>(
    plate.operations.map((operation, index) => [operation.id, index])
  )
  const ruleOrder: readonly string[] = [
    ...rulesOf("move"),
    ...rulesOf("program"),
  ].map((rule) => rule.id)
  const sorted = (violations: DesignRuleViolation[]) =>
    violations.sort(
      (a, b) =>
        Number(a.severity !== "error") - Number(b.severity !== "error") ||
        (order.get(diagnosticOperation(a)) ?? -1) -
          (order.get(diagnosticOperation(b)) ?? -1) ||
        ruleOrder.indexOf(a.rule) - ruleOrder.indexOf(b.rule)
    )
  const programs = programViolations(plate, compiled, settings)
  const checked = new Set(
    compiled.spans
      .filter((span) => span.bodyStartLine <= span.endLine)
      .map((span) => span.operationId)
  )
  for (const operation of plate.operations)
    if (!checked.has(operation.id))
      notes.push(
        `${operation.name}'s moves are not checked: its problems keep it out of the program.`
      )
  if (compiled.mode === "empty") {
    notes.push("No moves are checked: the plate has no program.")
    return { violations: sorted(programs), notes }
  }
  const region = stockRegion(plate, segments)
  if (!region) {
    notes.push("No moves are checked: the plate has no stock and nothing cuts.")
    return { violations: sorted(programs), notes }
  }
  if (
    region.bottom === null &&
    ruleSetting(maxDepthUnderStock, settings).severity !== "ignore"
  )
    notes.push(
      `${maxDepthUnderStock.label} is not checked: the plate has no stock.`
    )

  const failures = runRules(
    rulesOf("move"),
    moveSubjects(compiled, region, toolRadii(plate, library)),
    {
      settings,
      group: (move) => move.operationId ?? "",
      machine: kit.id,
    }
  )
  const spans = new Map<string, OperationSpan>(
    compiled.spans.map((span) => [span.operationId, span])
  )
  const [ox, oy, oz] = plate.setup.workOrigin
  const moves = failures.map((failure): DesignRuleViolation => {
    const { rule, worst } = failure
    const { operationId } = failure.first
    const operation = plate.operations.find((item) => item.id === operationId)
    const span = operationId ? spans.get(operationId) : undefined
    // Lines are the operation's own, as its NC numbers them.
    const line = span
      ? worst.segment.line - span.bodyStartLine + 1
      : worst.segment.line
    const { problem, advice, worst: named = "first" } = rule.explain(failure)
    const subject = operation?.name ?? "The program"
    const message = `${subject} ${problem}. ${where(failure.count, named, line)}`
    const report = failure.severity === "error" ? error : warning
    const [x, y, z] = worst.segment.end
    return {
      ...report(ruleCode(rule.id), message, {
        subject: operation ? operationSubject(operation.id) : PLATE_SUBJECT,
        line,
        places: [{ kind: "point", at: [ox + x, oy + y, oz + z] }],
      }),
      rule: rule.id,
      label: rule.label,
      suggestion: advice ?? IGNORE.label,
      lineCount: failure.count,
      lines: coarsen(failure.lines, SHOWN_RANGES),
    }
  })
  return { violations: sorted([...moves, ...programs]), notes }
}
