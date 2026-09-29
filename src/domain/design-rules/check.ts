import { readNcBlock } from "@/machine/contract"
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
import { kindOf } from "../operations/kinds"
import type { Operation } from "../operations/operation"
import type { Plate } from "../plate/plate"
import { capitalize, toMicrometre } from "../primitives"
import { isProbeSlot } from "../tools/tool-table"
import { programRulesFor } from "./common-rules"
import {
  FRESH_START,
  findIssues,
  programEnd,
  programRuleSeverity,
  suggestedChoice,
  suggestionOf,
} from "./program-rules"
import type { ProgramIssue, ProgramStart } from "./program-rules"
import { CHECK_RULES, LIMIT_RULES, LIMIT_RULE_INFO, ruleInfo } from "./rules"
import type { DesignRuleId, DesignRules } from "./rules"

/**
 * A rule that one operation breaks, with where it does: its moves break one of the project's
 * limits, or its lines one of the machine's program rules. The message says what is wrong.
 */
export type DesignRuleViolation = Diagnostic & {
  /** A limit or check rule's id (`DesignRuleId`), or a program rule's (`ProgramRule`). */
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

/** Less than this is float noise, or a cut that only grazes. */
const EPSILON = 0.001
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

type Group = {
  readonly rule: DesignRuleId
  readonly operationId: string | null
  worst: number
  worstLine: number
  /** Where the worst move ends, in the program's coordinates. */
  worstAt: Point3
  lineCount: number
  readonly ranges: { start: number; end: number }[]
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
const feed = (value: number) => count(Number(value.toFixed(1)))
const mm = (value: number) => String(toMicrometre(value))

const SUPERLATIVE: Record<DesignRuleId, string> = {
  maxCuttingFeed: "fastest",
  maxPlungeRate: "fastest",
  maxCutDepth: "deepest",
  maxDepthUnderStock: "deepest",
  spindleStoppedWhileCutting: "first",
  rapidIntoStock: "deepest",
}

/** What the moves do, in words: "cuts at up to 2,400 mm/min, over the 2,000 mm/min limit". */
function breach(group: Group, rules: DesignRules, region: Region): string {
  switch (group.rule) {
    case "maxCuttingFeed":
      return `cuts at up to ${feed(group.worst)} mm/min, over the ${feed(rules.maxCuttingFeed.value)} mm/min limit`
    case "maxPlungeRate":
      return `plunges at up to ${feed(group.worst)} mm/min, over the ${feed(rules.maxPlungeRate.value)} mm/min limit`
    case "maxCutDepth": {
      const top = region.bottom === null ? "Z0" : "the stock top"
      return `cuts ${mm(group.worst)} mm below ${top}, over the ${mm(rules.maxCutDepth.value)} mm limit`
    }
    case "maxDepthUnderStock":
      return `cuts ${mm(group.worst)} mm under the stock, over the ${mm(rules.maxDepthUnderStock.value)} mm limit`
    case "spindleStoppedWhileCutting":
      return "cuts with the spindle stopped or without a speed"
    case "rapidIntoStock":
      return region.bottom === null
        ? `moves rapidly ${mm(group.worst)} mm below Z0 where it cuts`
        : `moves rapidly ${mm(group.worst)} mm into the stock`
  }
}

/** What keeps the moves within the rule: "Cut at 2,000 mm/min or slower." */
function advice(group: Group, rules: DesignRules, region: Region): string {
  switch (group.rule) {
    case "maxCuttingFeed":
      return `Cut at ${feed(rules.maxCuttingFeed.value)} mm/min or slower.`
    case "maxPlungeRate":
      return `Plunge at ${feed(rules.maxPlungeRate.value)} mm/min or slower, or ramp in.`
    case "maxCutDepth": {
      const top = region.bottom === null ? "Z0" : "the stock top"
      return `Cut no deeper than ${mm(rules.maxCutDepth.value)} mm below ${top}.`
    }
    case "maxDepthUnderStock":
      return `Cut no deeper than ${mm(rules.maxDepthUnderStock.value)} mm under the stock.`
    case "spindleStoppedWhileCutting":
      return "Start the spindle with M3 and a speed before the cut."
    case "rapidIntoStock":
      return "Move into the stock with G1 rather than G0."
  }
}

/** Where the moves are: the one line, or how many there are and the worst of them. */
function where(group: Group, line: number) {
  if (group.lineCount === 1) return `At line ${count(line)}.`
  return `${count(group.lineCount)} lines, the ${SUPERLATIVE[group.rule]} at line ${count(line)}.`
}

/** A rule's diagnostic code: "design-rule/max-cutting-feed", "design-rule/spindle-reverse". */
const ruleCode = (rule: string) =>
  `design-rule/${rule.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`

/** Consecutive lines as ranges, in their order. */
function lineRanges(lines: readonly number[]): ProgramLines[] {
  const ranges: { start: number; end: number }[] = []
  for (const line of lines) {
    const last = ranges.at(-1)
    if (last && line === last.end + 1) last.end = line
    else ranges.push({ start: line, end: line })
  }
  return ranges
}

/**
 * An operation's own NC: NC it keeps, from a file or a plugin, rather than NC generated for the
 * machine, which its rules need not check and which sets no spindle speed. Null for generated NC
 * and for NC that does not resolve, which its own diagnostic reports.
 */
function ownNc(operation: Operation, plate: Plate, kit: FixtureKit) {
  const kind = kindOf(operation)
  if (kind.generated) return null
  const resolved = kind.resolve(operation, plate, kit)
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

/** What an operation's NC breaks of its machine's program rules, by the kit and start it was read with. */
const operationFindings = new WeakMap<
  Operation,
  {
    readonly kit: FixtureKit
    readonly start: ProgramStart
    readonly issues: readonly ProgramIssue[]
  }
>()

/** What the machine's program rules find in an operation's own NC (`ownNc`), from its start. */
function operationIssues(
  operation: Operation,
  plate: Plate,
  kit: FixtureKit,
  start: ProgramStart
): readonly ProgramIssue[] {
  const saved = operationFindings.get(operation)
  if (saved?.kit === kit && saved.start.spindleSpeed === start.spindleSpeed)
    return saved.issues
  const nc = ownNc(operation, plate, kit)
  const issues = nc === null ? [] : findIssues(nc, programRulesFor(kit), start)
  operationFindings.set(operation, { kit, start, issues })
  return issues
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
  rules: DesignRules
): DesignRuleViolation[] {
  const kit = kitForPlate(plate)
  const programRules = programRulesFor(kit)
  const starts = operationStarts(plate, kit)
  const [ox, oy, oz] = plate.setup.workOrigin
  return plate.operations.flatMap((operation, index) =>
    operationIssues(operation, plate, kit, starts[index]).flatMap(
      (issue): DesignRuleViolation[] => {
        const rule = programRules.find((item) => item.id === issue.rule)
        const severity = rule ? programRuleSeverity(rules, rule) : "ignore"
        if (!rule || severity === "ignore") return []
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
        const report = severity === "error" ? error : warning
        return [
          {
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
                    lineRanges(issue.lines.map((line) => offset + line)),
                    SHOWN_RANGES
                  ),
          },
        ]
      }
    )
  )
}

/**
 * Checks a plate's compiled program against a project's design rules: each rule its moves break,
 * per operation, with how often and where, and each of its machine's program rules the
 * operations' own NC breaks, even an operation the program leaves out. Heights are measured
 * over the stock's footprint (widened by the tool's radius, where its side reaches), so moves
 * beside the stock, such as a tool change's, do not count; without stock, below Z0 over the
 * extent of the cutting moves. The probe's feed moves and moves straight up (retracts) cut
 * nothing. After a lift to the machine's clearance (a `G53` move of Z alone, which compiling
 * adds between operations) and at the start, the tool travels above everything until a move
 * sets Z. Pure; it reports, and the Job tab's checks let errors block Run.
 */
export function checkDesignRules(
  plate: Plate,
  compiled: CompiledPlate,
  rules: DesignRules,
  library: readonly Tool[]
): DesignRuleCheck {
  const notes: string[] = []
  const { segments } = compiled.program
  const kit = kitForPlate(plate)
  const order = new Map<string | null, number>(
    plate.operations.map((operation, index) => [operation.id, index])
  )
  const ruleOrder: readonly string[] = [
    ...LIMIT_RULES,
    ...CHECK_RULES,
    ...programRulesFor(kit).map((rule) => rule.id),
  ]
  const sorted = (violations: DesignRuleViolation[]) =>
    violations.sort(
      (a, b) =>
        Number(a.severity !== "error") - Number(b.severity !== "error") ||
        (order.get(diagnosticOperation(a)) ?? -1) -
          (order.get(diagnosticOperation(b)) ?? -1) ||
        ruleOrder.indexOf(a.rule) - ruleOrder.indexOf(b.rule)
    )
  const programs = programViolations(plate, compiled, rules)
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
  if (region.bottom === null && rules.maxDepthUnderStock.severity !== "ignore")
    notes.push(
      `${LIMIT_RULE_INFO.maxDepthUnderStock.label} is not checked: the plate has no stock.`
    )

  const active = (rule: DesignRuleId) => rules[rule].severity !== "ignore"
  const radius = toolRadii(plate, library)
  const groups = new Map<string, Group>()
  let spanIndex = 0
  const operationAt = (line: number) => {
    const { spans } = compiled
    while (spanIndex < spans.length && spans[spanIndex].endLine < line)
      spanIndex++
    const span = spans.at(spanIndex)
    return span && span.startLine <= line ? span.operationId : null
  }
  const record = (
    rule: DesignRuleId,
    segment: GCodeSegment,
    operationId: string | null,
    value: number
  ) => {
    const key = `${rule}\n${operationId ?? ""}`
    let group = groups.get(key)
    if (!group) {
      group = {
        rule,
        operationId,
        worst: -Infinity,
        worstLine: segment.line,
        worstAt: segment.end,
        lineCount: 0,
        ranges: [],
      }
      groups.set(key, group)
    }
    const last = group.ranges.at(-1)
    if (!last || segment.line > last.end) {
      group.lineCount++
      if (last && segment.line === last.end + 1) last.end = segment.line
      else group.ranges.push({ start: segment.line, end: segment.line })
    }
    if (value > group.worst) {
      group.worst = value
      group.worstLine = segment.line
      group.worstAt = segment.end
    }
  }

  const lifts = liftLines(compiled.program.lines)
  let liftIndex = 0
  // Where the program starts is the preview's assumption, not a position it moves to: like a
  // lift, it leaves the tool above everything until a move sets Z.
  let lifted = true
  for (const segment of segments) {
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
    const operationId = operationAt(segment.line)
    if (segment.rapid) {
      if (active("rapidIntoStock"))
        record("rapidIntoStock", segment, operationId, region.top - lowest)
      continue
    }
    if (!cutting(segment)) continue
    if (active("maxCuttingFeed") && segment.feed > rules.maxCuttingFeed.value)
      record("maxCuttingFeed", segment, operationId, segment.feed)
    if (active("maxPlungeRate") && z1 < z0) {
      const rate = (segment.feed * (z0 - z1)) / Math.hypot(travel, z1 - z0)
      if (rate > rules.maxPlungeRate.value)
        record("maxPlungeRate", segment, operationId, rate)
    }
    if (active("spindleStoppedWhileCutting") && segment.spindle <= 0)
      record("spindleStoppedWhileCutting", segment, operationId, 0)
    const depth = region.top - lowest
    if (active("maxCutDepth") && depth > rules.maxCutDepth.value + EPSILON)
      record("maxCutDepth", segment, operationId, depth)
    if (region.bottom !== null && active("maxDepthUnderStock")) {
      const under = region.bottom - lowest
      if (under > rules.maxDepthUnderStock.value + EPSILON)
        record("maxDepthUnderStock", segment, operationId, under)
    }
  }

  const spans = new Map<string, OperationSpan>(
    compiled.spans.map((span) => [span.operationId, span])
  )
  const moves = [...groups.values()].map((group): DesignRuleViolation => {
    const operation = plate.operations.find(
      (item) => item.id === group.operationId
    )
    const span = group.operationId ? spans.get(group.operationId) : undefined
    // Lines are the operation's own, as its NC numbers them.
    const line = span
      ? group.worstLine - span.bodyStartLine + 1
      : group.worstLine
    const subject = operation?.name ?? "The program"
    const message = `${subject} ${breach(group, rules, region)}. ${where(group, line)}`
    const report = rules[group.rule].severity === "error" ? error : warning
    const [x, y, z] = group.worstAt
    const [ox, oy, oz] = plate.setup.workOrigin
    return {
      ...report(ruleCode(group.rule), message, {
        subject: operation ? operationSubject(operation.id) : PLATE_SUBJECT,
        line,
        places: [{ kind: "point", at: [ox + x, oy + y, oz + z] }],
      }),
      rule: group.rule,
      label: ruleInfo(group.rule).label,
      suggestion: advice(group, rules, region),
      lineCount: group.lineCount,
      lines: coarsen(group.ranges, SHOWN_RANGES),
    }
  })
  return { violations: sorted([...moves, ...programs]), notes }
}
