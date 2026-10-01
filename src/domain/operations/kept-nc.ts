/**
 * The operation kinds that keep their NC (`generated: false`): NC files and plugins' programs and
 * operations. What they machine is where a plate cuts, which probing fits to, so nothing here
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
 * The context for resolving kinds that keep their NC (files and plugins, `generated: false`):
 * the kit alone, as their NC never reads the tool library.
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
  phase: () => "machining",
  resolve: ({ source }, _plate, { kit }) =>
    ok(plain(source.park ? source.nc : withoutClosingPark(source.nc, kit))),
}

export const templateKind: OperationKind<"template"> = {
  kind: "template",
  label: "Plugin program",
  verbatim: true,
  generated: false,
  phase: (operation) => operation.source.phase,
  resolve: (operation) => ok(plain(operation.source.nc)),
}

export const pluginKind: OperationKind<"plugin"> = {
  kind: "plugin",
  label: "Plugin operation",
  verbatim: true,
  generated: false,
  phase: (operation) => operation.source.phase,
  resolve: (operation) =>
    operation.source.nc === null
      ? fail(
          error(
            "operation-pending",
            `Generate "${operation.name}" in its plugin before running it.`,
            {
              subject: operationSubject(operation.id),
              fix: { kind: "edit-operation", operationId: operation.id },
            }
          )
        )
      : ok(plain(operation.source.nc)),
}

const KEPT_NC_KINDS = {
  file: fileKind,
  template: templateKind,
  plugin: pluginKind,
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
