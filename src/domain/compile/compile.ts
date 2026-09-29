import { NC_BLOCK_PROBLEMS, utf8ByteLength } from "@/machine/contract"
import { MAX_PROGRAM_LINES, parseGCode } from "@/domain/nc/gcode"
import type { GCodeProgram } from "@/domain/nc/gcode"
import { PLATE_SUBJECT, error, operationSubject } from "../diagnostics"
import type { Diagnostic } from "../diagnostics"
import { kitForPlate } from "../fixtures/catalog"
import type { FixtureKit } from "../fixtures/fixture-kit"
import { kindOf } from "../operations/kinds"
import type { ResolvedNc } from "../operations/kinds"
import { OPERATION_LIMITS } from "../operations/operation"
import type { Operation } from "../operations/operation"
import type { Plate } from "../plate/plate"
import { workOriginNc } from "../plate/work-origin"
import { plural } from "../primitives"
import { isEndWord, readNcUnit } from "./nc-unit"
import type { NcLine } from "./nc-unit"
import { buildProgramSections } from "./sections"
import type { ProgramSection } from "./sections"

/** An exported program imports again as one NC operation, so it shares that limit. */
const MAX_BYTES = OPERATION_LIMITS.ncBytes
const TOO_LARGE = `The combined program exceeds ${MAX_BYTES / 1024 ** 2} MiB or ${MAX_PROGRAM_LINES.toLocaleString("en")} lines.`

export type OperationSpan = {
  readonly operationId: string
  /** Inclusive 1-based lines of the compiled program, including the operation header. */
  readonly startLine: number
  readonly endLine: number
  /** Line of the operation's own first NC line (after the header). */
  readonly bodyStartLine: number
}

export type CompiledSection = ProgramSection & {
  /** `${operationId}/${key}`: stable across edits of other operations. */
  readonly id: string
  readonly operationId: string
}

export type PausePoint = {
  readonly line: number
  readonly operationId: string
  /** stop-before: the operation's Stop before; review: an auto-level review; program: M0/M1 in the NC. */
  readonly reason: "stop-before" | "review" | "program"
}

export type CompiledPlate = {
  /** verbatim: one operation emitted byte-for-byte; compose: operations combined with headers. */
  readonly mode: "empty" | "verbatim" | "compose"
  readonly program: GCodeProgram
  readonly spans: readonly OperationSpan[]
  readonly sections: readonly CompiledSection[]
  readonly pausePoints: readonly PausePoint[]
  readonly diagnostics: readonly Diagnostic[]
}

type Resolved = { readonly operation: Operation; readonly nc: ResolvedNc }

const identity = (operation: Operation) =>
  operation.tools.every((binding) => binding.local === binding.plate)

/** An operation's numbered bindings: its own T number, and the table number it runs as. */
const numberedBindings = (operation: Operation): [number, number][] =>
  operation.tools.flatMap((binding): [number, number][] =>
    binding.local !== null && binding.plate !== null
      ? [[binding.local, binding.plate]]
      : []
  )

/** T words rewritten through the operation's bindings; end words and `%` removed. */
function rewrite(line: NcLine, toolMap: ReadonlyMap<number, number>): string {
  const edits: Array<{ start: number; end: number; replacement: string }> = []
  if (line.delimiter !== null)
    edits.push({
      start: line.delimiter,
      end: line.delimiter + 1,
      replacement: "",
    })
  // "N100 M30" must not leave a bare "N100" block behind.
  const endOnly =
    line.words.some(isEndWord) &&
    line.words.every((word) => isEndWord(word) || word.letter === "N")
  for (const word of line.words) {
    if (isEndWord(word) || (endOnly && word.letter === "N"))
      edits.push({ start: word.start, end: word.end, replacement: "" })
    else if (word.letter === "T") {
      const target = toolMap.get(word.value)
      if (target !== undefined && target !== word.value)
        edits.push({
          start: word.start,
          end: word.end,
          replacement: `T${target}`,
        })
    }
  }
  let rewritten = line.original
  for (const edit of edits.sort((a, b) => b.start - a.start))
    rewritten =
      rewritten.slice(0, edit.start) +
      edit.replacement +
      rewritten.slice(edit.end)
  return rewritten
}

/**
 * What comes before every operation and before the program's end: the modes the NC assumes,
 * the tool retracted to the machine's clearance, then the spindle and coolant stopped, as the
 * end words removed from the operation before would stop them. A tool left in the cut rises
 * out of it still turning. The modes come first, as the retract is in millimetres.
 */
const boundary = (kit: FixtureKit) => [
  "G21 G90 G17 G94",
  kit.clearanceRetract,
  "M5 M9",
]

function compose(
  resolved: readonly Resolved[],
  diagnostics: Diagnostic[],
  preamble: readonly string[],
  kit: FixtureKit
) {
  const output: string[] = [...preamble]
  const spans: OperationSpan[] = []
  const stopLines = new Map<number, string>()
  const reviewLines = new Map<number, string>()
  const combined = resolved.length > 1
  for (const { operation, nc } of resolved) {
    const startLine = output.length + 1
    output.push(`; Operation: ${operation.name}`)
    const unit = readNcUnit(nc.nc, nc.policy, combined, (words, state) =>
      kit.readNcBlock(words, state)
    )
    if (!unit.ok) {
      diagnostics.push(
        error(
          "operation-unsafe",
          `${operation.name}, line ${unit.error.line}: ${unit.error.message}`,
          {
            subject: operationSubject(operation.id),
            line: unit.error.line,
          }
        )
      )
      output.push("; Skipped: this operation cannot be combined safely.")
      spans.push({
        operationId: operation.id,
        startLine,
        endLine: output.length,
        bodyStartLine: output.length + 1,
      })
      continue
    }
    output.push(...boundary(kit))
    if (operation.stopBefore) {
      output.push("M0")
      stopLines.set(output.length, operation.id)
    }
    const bodyStartLine = output.length + 1
    const toolMap = new Map(numberedBindings(operation))
    for (const line of unit.value.lines) output.push(rewrite(line, toolMap))
    for (const review of nc.reviewLines)
      reviewLines.set(bodyStartLine + review - 1, operation.id)
    spans.push({
      operationId: operation.id,
      startLine,
      endLine: output.length,
      bodyStartLine,
    })
  }
  // The program ends as every operation starts, so no job ends with the tool in the cut.
  if (resolved.length) output.push(...boundary(kit), "M2")
  return { text: output.join("\n"), spans, stopLines, reviewLines }
}

type Parsed = {
  readonly spans: readonly OperationSpan[]
  readonly program: GCodeProgram
  readonly sections: readonly CompiledSection[]
  /** The machine whose probing and markers the sections read. */
  readonly kit: FixtureKit
}

/**
 * Keyed by the plate's operations, which commands share across edits of anything else: moving
 * the stock or the work origin keeps the program object, and every cache keyed by it.
 */
const parsedPrograms = new WeakMap<readonly Operation[], Parsed>()

const sameSpans = (a: readonly OperationSpan[], b: readonly OperationSpan[]) =>
  a.length === b.length &&
  a.every(
    (span, index) =>
      span.operationId === b[index].operationId &&
      span.startLine === b[index].startLine &&
      span.endLine === b[index].endLine &&
      span.bodyStartLine === b[index].bodyStartLine
  )

/**
 * The program and its sections, parsed again only when they would come out different: the
 * sections follow from the program, the spans, the operations' tool bindings and the machine.
 */
function parsed(
  plate: Plate,
  text: string,
  spans: readonly OperationSpan[],
  kit: FixtureKit
): Parsed {
  const previous = parsedPrograms.get(plate.operations)
  if (
    previous &&
    previous.program.source === text &&
    previous.program.name === plate.name &&
    previous.kit === kit &&
    sameSpans(previous.spans, spans)
  )
    return previous
  const program = parseGCode(text, plate.name)
  const operations = new Map(
    plate.operations.map((operation) => [operation.id, operation])
  )
  const sections: CompiledSection[] = spans.flatMap((span) => {
    // Keys use the operation's own T numbers: renumbering the table keeps section ids.
    const operation = operations.get(span.operationId)
    const own = new Map(
      (operation ? numberedBindings(operation) : []).map(
        ([local, number]) => [number, local] as const
      )
    )
    return buildProgramSections(
      program,
      kit,
      { startLine: span.bodyStartLine, endLine: span.endLine },
      (tool) => own.get(tool) ?? tool
    ).map((section) => ({
      ...section,
      id: `${span.operationId}/${section.key}`,
      operationId: span.operationId,
    }))
  })
  const result = { spans, program, sections, kit }
  parsedPrograms.set(plate.operations, result)
  return result
}

/**
 * The first line of the program that cannot run as written, which the preview leaves out, as a
 * diagnostic of its operation; null when every line can run.
 */
function unreadableLines(
  plate: Plate,
  program: GCodeProgram,
  spans: readonly OperationSpan[]
): Diagnostic | null {
  if (!program.unreadable) return null
  const { line, problem, count } = program.unreadable
  const span = spans.find(
    (item) => line >= item.bodyStartLine && line <= item.endLine
  )
  const operation = plate.operations.find(
    (item) => item.id === span?.operationId
  )
  const own = span ? line - span.bodyStartLine + 1 : line
  const where = operation ? `${operation.name}, line` : "Line"
  const more =
    count > 1 ? `; ${plural(count - 1, "more line")} cannot either` : ""
  return error(
    "nc-unreadable",
    `${where} ${own} ${NC_BLOCK_PROBLEMS[problem]}, so the machine cannot run it as written${more}.`,
    {
      subject: operation ? operationSubject(operation.id) : PLATE_SUBJECT,
      line: own,
    }
  )
}

function compileUncached(plate: Plate): CompiledPlate {
  const kit = kitForPlate(plate)
  const diagnostics: Diagnostic[] = []
  const resolved: Resolved[] = []
  for (const operation of plate.operations) {
    const result = kindOf(operation).resolve(operation, plate, kit)
    if (result.ok) resolved.push({ operation, nc: result.value })
    else diagnostics.push(result.error)
  }
  const lone =
    resolved.length === 1 && plate.operations.length === 1 ? resolved[0] : null
  // A work origin kept relative to an anchor sets the machine's work X/Y before everything.
  const preamble = workOriginNc(plate.setup, kit)
  let mode: CompiledPlate["mode"] = "compose"
  let text: string
  let spans: OperationSpan[]
  let stopLines = new Map<number, string>()
  let reviewLines = new Map<number, string>()
  if (!resolved.length) {
    mode = "empty"
    text = ""
    spans = []
  } else if (
    lone &&
    !preamble.length &&
    kindOf(lone.operation).verbatim &&
    !lone.operation.stopBefore &&
    identity(lone.operation)
  ) {
    // A single program is machined exactly as imported: its bytes are never rewritten.
    mode = "verbatim"
    text = lone.nc.nc
    const lineCount = text.replace(/\r\n?/g, "\n").split("\n").length
    spans = [
      {
        operationId: lone.operation.id,
        startLine: 1,
        endLine: lineCount,
        bodyStartLine: 1,
      },
    ]
    reviewLines = new Map(
      lone.nc.reviewLines.map((line) => [line, lone.operation.id])
    )
  } else {
    const composed = compose(resolved, diagnostics, preamble, kit)
    text = composed.text
    spans = composed.spans
    stopLines = composed.stopLines
    reviewLines = composed.reviewLines
  }
  const lineCount = text ? text.split("\n").length : 0
  if (lineCount > MAX_PROGRAM_LINES || utf8ByteLength(text) > MAX_BYTES) {
    diagnostics.push(
      error("program-too-large", TOO_LARGE, { subject: PLATE_SUBJECT })
    )
    text = ""
    spans = []
    mode = "empty"
  }
  const { program, sections } = parsed(plate, text, spans, kit)
  const unreadable = unreadableLines(plate, program, spans)
  if (unreadable) diagnostics.push(unreadable)
  const pausePoints: PausePoint[] = [
    ...sections
      .filter((section) => section.kind === "pause")
      .map((section): PausePoint => ({
        line: section.startLine,
        operationId: section.operationId,
        reason: reviewLines.has(section.startLine) ? "review" : "program",
      })),
    ...[...stopLines].map(([line, operationId]): PausePoint => ({
      line,
      operationId,
      reason: "stop-before",
    })),
  ].sort((a, b) => a.line - b.line)
  return { mode, program, spans, sections, pausePoints, diagnostics }
}

const cache = new WeakMap<Plate, CompiledPlate>()

/**
 * Pure and total: always returns a program plus diagnostics, never throws. Results are
 * cached per plate object, so unchanged plates (structural sharing) never recompile, and a
 * plate whose operations did not change keeps its parsed program.
 */
export function compilePlate(plate: Plate): CompiledPlate {
  const cached = cache.get(plate)
  if (cached) return cached
  const compiled = compileUncached(plate)
  cache.set(plate, compiled)
  return compiled
}
