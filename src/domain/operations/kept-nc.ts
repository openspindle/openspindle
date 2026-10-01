/**
 * The operation kinds that keep their NC (`generated: false`): NC files, PCB operations and
 * sources of earlier formats that are no longer supported. What they machine is where a plate cuts, which probing fits to, so nothing here
 * reads probing: probing strategies measure a plate's machining through this module while the
 * registry of every kind (`OPERATION_KINDS`) holds their strategies.
 */

import { PLAIN_NC, withoutClosingPark } from "../compile/nc-unit"
import { error, operationSubject } from "../diagnostics"
import type { FixtureKit } from "../fixtures/fixture-kit"
import type { Plate } from "../plate/plate"
import { fail, ok } from "../primitives"
import type { OperationKind, ResolveContext, ResolvedNc } from "./kinds"
import type { Operation, SourceKind } from "./operation"

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

export const pcbKind: OperationKind<"pcb"> = {
  kind: "pcb",
  label: "PCB",
  verbatim: true,
  generated: false,
  phase: () => "machining",
  resolve: (operation) =>
    operation.source.nc === null
      ? fail(
          error(
            "operation-pending",
            `Generate the toolpath for "${operation.name}" before running it.`,
            {
              subject: operationSubject(operation.id),
              fix: { kind: "edit-operation", operationId: operation.id },
            }
          )
        )
      : ok(plain(operation.source.nc)),
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
