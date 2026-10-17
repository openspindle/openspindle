/**
 * The operation kinds that keep their NC (`generated: false`): NC files, PCB operations and
 * sources of earlier formats that are no longer supported. What they machine is where a plate cuts, which probing fits to, so nothing here
 * reads probing: probing methods measure a plate's machining through this module while the
 * registry of every kind (`OPERATION_KINDS`) holds their methods.
 */

import { PLAIN_NC, withoutClosingPark } from "../compile/nc-unit"
import { error, operationSubject } from "../diagnostics"
import type { FixtureKit } from "../fixtures/fixture-kit"
import type { Plate } from "../plate/plate"
import { fail, ok } from "../primitives"
import type { OperationKind, ResolveContext, ResolvedNc } from "./kinds"
import type { Operation, SourceKind } from "./operation"
import { suppressedParts, withoutParts } from "./toolpath-parts"

const plain = (nc: string): ResolvedNc => ({
  nc,
  policy: PLAIN_NC,
  reviewLines: [],
})

/**
 * The context for resolving kinds that keep their NC (files and PCB, `generated: false`): the
 * kit alone, as their NC never reads the tool library.
 */
export const keptNcContext = (kit: FixtureKit): ResolveContext => ({
  kit,
  tools: [],
})

export const fileKind: OperationKind<"file"> = {
  kind: "file",
  label: "NC file",
  verbatim: true,
  generated: false,
  phase: ({ source }) => source.phase ?? "machining",
  resolve: ({ source }, _plate, { kit }) =>
    ok(plain(source.park ? source.nc : withoutClosingPark(source.nc, kit))),
}

/** A line's words without its comments, in capitals. */
const words = (line: string) =>
  line
    .replace(/\([^)]*\)|;.*$/g, "")
    .trim()
    .toUpperCase()

/** A word's number as the line writes it; null without the word. */
const wordText = (text: string, letter: string) =>
  new RegExp(`(?:^|[^A-Z])${letter}\\s*([-+]?(?:\\d+\\.?\\d*|\\.\\d+))`).exec(
    text
  )?.[1] ?? null

const changesTool = (text: string) => /(?:^|[^0-9.])M0*6(?![0-9.])/.test(text)

/**
 * pcb2gcode's program with travel over where each tool starts cutting, after the change to it:
 * pcb2gcode goes down to its travel height wherever the change left the tool, then moves in X
 * and Y. Before that descent the tool goes to its tool change height (the Z it retracted to for
 * the change) and over its first move there, every axis in the line.
 */
function withTravelAfterChanges(nc: string): string {
  const lines = nc.split(/\r?\n/)
  const output: string[] = []
  let z: string | null = null
  let changedAt: string | null = null
  for (const [index, line] of lines.entries()) {
    const text = words(line)
    const lineZ = wordText(text, "Z")
    const movesXY = wordText(text, "X") !== null || wordText(text, "Y") !== null
    if (changedAt !== null && (movesXY || lineZ !== null)) {
      const height = changedAt
      changedAt = null
      if (!movesXY) {
        const first = lines
          .slice(index + 1)
          .map(words)
          .find(
            (later) =>
              changesTool(later) ||
              wordText(later, "X") !== null ||
              wordText(later, "Y") !== null
          )
        const x = first && wordText(first, "X")
        const y = first && wordText(first, "Y")
        if (first && !changesTool(first) && x !== null && y !== null)
          output.push(`G00 Z${height}`, `G00 X${x} Y${y} Z${height}`)
      }
    }
    if (changesTool(text) && z !== null) changedAt = z
    if (lineZ !== null) z = lineZ
    output.push(line)
  }
  return output.join("\n")
}

export const pcbKind: OperationKind<"pcb"> = {
  kind: "pcb",
  label: "PCB",
  verbatim: true,
  generated: false,
  phase: () => "machining",
  /**
   * Its program without the parts it suppresses (`withoutParts`), going over where each tool
   * starts cutting before it goes down (`withTravelAfterChanges`).
   */
  resolve: (operation) => {
    const { nc } = operation.source
    if (nc === null)
      return fail(
        error(
          "operation-pending",
          `Generate the toolpath for "${operation.name}" before running it.`,
          {
            subject: operationSubject(operation.id),
            fix: { kind: "edit-operation", operationId: operation.id },
          }
        )
      )
    const parts = operation.suppressedParts?.length
      ? suppressedParts(operation)
      : null
    return ok(
      plain(
        withTravelAfterChanges(
          parts ? withoutParts(nc, parts.parts, parts.matched) : nc
        )
      )
    )
  },
}

export const unsupportedKind: OperationKind<"unsupported"> = {
  kind: "unsupported",
  label: "Unavailable operation",
  verbatim: false,
  generated: false,
  phase: ({ source }) => source.phase,
  resolve: (operation) =>
    fail(
      error(
        "operation-unsupported",
        `"${operation.name}" has no generated NC and its source is no longer supported. Replace or remove this operation before running the plate.`,
        { subject: operationSubject(operation.id) }
      )
    ),
}

const KEPT_NC_KINDS = {
  file: fileKind,
  pcb: pcbKind,
  unsupported: unsupportedKind,
}

/**
 * The kind of an operation that keeps its NC; null for a probing operation, which generates
 * its NC in the setup phase. The table pairs each kind with its own source type; TypeScript
 * cannot correlate the union on its own, so this one cast states it, as `kindOf` does.
 */
function keptNcKindOf(operation: Operation): OperationKind<SourceKind> | null {
  const { kind } = operation.source
  return kind === "probing"
    ? null
    : (KEPT_NC_KINDS[kind] as unknown as OperationKind<SourceKind>)
}

/**
 * The NC of a plate's operations outside the setup phase, those that machine it, in order; null
 * for one whose NC does not resolve. Where a plate cuts is measured from them
 * (`plateMachining`). Only kinds that keep their NC machine (the probing kinds are setup), so
 * they resolve without the library (`keptNcContext`).
 */
export function machiningPrograms(
  plate: Plate,
  kit: FixtureKit
): (string | null)[] {
  const context = keptNcContext(kit)
  return plate.operations.flatMap((operation) => {
    const kind = keptNcKindOf(operation)
    if (!kind || kind.phase(operation) === "setup") return []
    const resolved = kind.resolve(operation, plate, context)
    return [resolved.ok ? resolved.value.nc : null]
  })
}
