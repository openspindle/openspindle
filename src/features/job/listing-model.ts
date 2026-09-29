import type { CompiledPlate, PausePoint } from "@/domain/compile/compile"
import type { SectionKind } from "@/domain/compile/sections"
import type { Operation } from "@/domain/operations/operation"
import type { PreparedProgram, ProgramChange } from "@/machine/contract"

export type ListingHeaderKind = "part" | "operation" | "pause" | "section"

/** A row above a program line naming what starts there. */
export type ListingHeader = {
  readonly kind: ListingHeaderKind
  /** The header sits directly above this program line. */
  readonly line: number
  readonly label: string
  readonly sectionKind?: SectionKind
  /** The operation an operation header starts. */
  readonly operationId?: string
}

export type ListingRow =
  | {
      readonly kind: "header"
      readonly key: string
      readonly header: ListingHeader
    }
  | { readonly kind: "line"; readonly key: string; readonly line: number }

/** The G-code list: program lines with headers between them, addressable both ways. */
export type ListingModel = {
  readonly rowCount: number
  /** Dialect rewrites by line: the machine receives these lines changed. */
  readonly changes: ReadonlyMap<number, ProgramChange>
  row: (index: number) => ListingRow
  rowOfLine: (line: number) => number
}

export const PAUSE_LABELS: Record<PausePoint["reason"], string> = {
  "stop-before": "Stop before operation",
  review: "Height-map review",
  program: "Program pause",
}

export const CHANGE_LABELS: Record<ProgramChange["reason"], string> = {
  "line-number": "Line number removed",
  case: "Uppercased",
  pause: "Program stop sent as M600",
  "tool-number": "Tool number added",
  "tool-change-stop": "Stop left out after a tool change",
  "spindle-speed": "Spindle speed added",
}

/** Sections that begin a block get a header; the rest (notes, pauses, end) do not. */
const HEADED_SECTIONS: ReadonlySet<SectionKind> = new Set([
  "setup",
  "toolpath",
  "tool-change",
  "probe",
  "touch-off",
  "scan",
  "message",
])

const HEADER_ORDER: Record<ListingHeaderKind, number> = {
  part: 0,
  operation: 1,
  pause: 2,
  section: 3,
}

/** The index of the first value that is not below `target` in an ascending array. */
function lowerBound(values: readonly number[], target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (values[middle] < target) low = middle + 1
    else high = middle
  }
  return low
}

export function buildListingModel({
  lineCount,
  compiled,
  operations,
  prepared,
}: {
  readonly lineCount: number
  readonly compiled: CompiledPlate
  readonly operations: readonly Operation[]
  /** The dialect's view of the program, when checked: its changes, pause lines and parts. */
  readonly prepared: PreparedProgram | null
}): ListingModel {
  const names = new Map(operations.map((item) => [item.id, item.name]))
  const parts = prepared?.parts ?? []
  const explained = new Set(compiled.pausePoints.map((point) => point.line))
  // Stops the dialect leaves out never pause the machine.
  const leftOut = new Set(
    (prepared?.changes ?? [])
      .filter((change) => change.reason === "tool-change-stop")
      .map((change) => change.line)
  )
  const headers = [
    // A program sent as parts: where each part's file begins.
    ...(parts.length > 1
      ? parts.map((part, index): ListingHeader => ({
          kind: "part",
          line: part.startLine,
          label: `Part ${index + 1} of ${parts.length}`,
        }))
      : []),
    ...compiled.spans.map((span): ListingHeader => ({
      kind: "operation",
      line: span.startLine,
      label: names.get(span.operationId) ?? "Operation",
      operationId: span.operationId,
    })),
    ...compiled.pausePoints
      .filter((point) => !leftOut.has(point.line))
      .map((point): ListingHeader => ({
        kind: "pause",
        line: point.line,
        label: PAUSE_LABELS[point.reason],
      })),
    // Pauses the NC writes as M600 itself have no compiled pause point.
    ...(prepared?.pauseLines ?? [])
      .filter((line) => !explained.has(line))
      .map((line): ListingHeader => ({
        kind: "pause",
        line,
        label: PAUSE_LABELS.program,
      })),
    ...compiled.sections
      .filter((section) => HEADED_SECTIONS.has(section.kind))
      .map((section): ListingHeader => ({
        kind: "section",
        line: section.startLine,
        label: section.name,
        sectionKind: section.kind,
      })),
  ]
    .filter((header) => header.line >= 1 && header.line <= lineCount)
    .sort(
      (a, b) => a.line - b.line || HEADER_ORDER[a.kind] - HEADER_ORDER[b.kind]
    )
  const headerLines = headers.map((header) => header.line)
  // A header's row is its line's row pushed down by every header above it.
  const headerRows = headers.map((header, index) => header.line - 1 + index)
  return {
    rowCount: lineCount + headers.length,
    changes: new Map(
      (prepared?.changes ?? []).map((change) => [change.line, change])
    ),
    row: (index) => {
      const above = lowerBound(headerRows, index)
      if (headerRows[above] === index)
        return {
          kind: "header",
          key: `header-${above}`,
          header: headers[above],
        }
      const line = index - above + 1
      return { kind: "line", key: `line-${line}`, line }
    },
    rowOfLine: (line) => line - 1 + lowerBound(headerLines, line + 1),
  }
}
