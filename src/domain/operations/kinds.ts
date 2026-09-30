import { plateAutoLevelParams } from "../auto-level/fit"
import { generateAutoLevelNc } from "../auto-level/generate"
import type { AutoLevelParams } from "../auto-level/params"
import { generateAutoScanNc } from "../auto-scan/generate"
import { defaultAutoScanParams } from "../auto-scan/params"
import type { AutoScanParams } from "../auto-scan/params"
import { plateAutoZHeightParams } from "../auto-z-height/fit"
import { generateAutoZHeightNc } from "../auto-z-height/generate"
import type { AutoZHeightParams } from "../auto-z-height/params"
import { generateProbe3dNc } from "../probe-3d/generate"
import { defaultProbe3dParams } from "../probe-3d/params"
import type { Probe3dParams } from "../probe-3d/params"
import { error, operationSubject } from "../diagnostics"
import type { Diagnostic } from "../diagnostics"
import { kitForPlate } from "../fixtures/catalog"
import type { FixtureKit } from "../fixtures/fixture-kit"
import { toolpathBoundsOf } from "../compile/cutting-bounds"
import { PLAIN_NC, withoutClosingPark } from "../compile/nc-unit"
import type { NcPolicy } from "../compile/nc-unit"
import type { Plate } from "../plate/plate"
import { fail, ok } from "../primitives"
import type { Result } from "../primitives"
import { placementContext } from "../probing/placement"
import type { OriginProbing, OutlineTrace, Probe } from "../probing/probe"
import type { Operation, Phase, SourceKind, SourceOf } from "./operation"

/** The NC an operation contributes and what that NC may contain. */
export type ResolvedNc = {
  readonly nc: string
  readonly policy: NcPolicy
  /** 1-based lines of `nc` where the program pauses for a review. */
  readonly reviewLines: readonly number[]
}

export type OperationOf<TKind extends SourceKind> = Operation & {
  source: SourceOf<TKind>
}

/** The kinds whose NC, defaults and availability come from the plate's machine's probe. */
export type ProbingSourceKind =
  "auto-level" | "auto-z-height" | "auto-scan" | "probe-3d"

/** A probing kind's operation parameters, by its kind. */
type ProbingParams<TKind extends SourceKind> = TKind extends "auto-level"
  ? AutoLevelParams
  : TKind extends "auto-z-height"
    ? AutoZHeightParams
    : TKind extends "auto-scan"
      ? AutoScanParams
      : TKind extends "probe-3d"
        ? Probe3dParams
        : never

/**
 * Strategy per operation source kind: how it becomes NC, its phase, and whether a lone
 * operation may be emitted byte-for-byte. New kinds register here; nothing else switches on
 * plugin ids. Kinds resolve with the kit of the plate's machine (`kitForPlate`): its probe
 * measures for the probing kinds, which also give the UI their availability and defaults here
 * (`available`, `defaults`), so it never reads a probe or a default kit itself. The operation
 * and run rules check an operation while editing and before Run.
 */
export interface OperationKind<TKind extends SourceKind> {
  readonly kind: TKind
  readonly label: string
  readonly verbatim: boolean
  /**
   * Its NC is generated from its parameters and the plate rather than kept: what a saved
   * project attaches documents the NC when it was saved, and opening generates it anew.
   */
  readonly generated: boolean
  phase: (operation: OperationOf<TKind>) => Phase
  resolve: (
    operation: OperationOf<TKind>,
    plate: Plate,
    kit: FixtureKit
  ) => Result<ResolvedNc, Diagnostic>
  /**
   * For a probing kind: whether the machine's probe offers it at all, before any plate names
   * one (`useAddProbingOperation`, `useBuiltInSources`). Other kinds need no probe and leave
   * this out.
   */
  available?: (probe: Probe | null) => boolean
  /**
   * For a probing kind: a new operation's parameters, fitted to the plate within the probe's
   * ranges. Called only once `available` has confirmed the probe offers the kind.
   */
  defaults?: (plate: Plate, probe: Probe) => ProbingParams<TKind>
}

const plain = (nc: string): ResolvedNc => ({
  nc,
  policy: PLAIN_NC,
  reviewLines: [],
})

const fileKind: OperationKind<"file"> = {
  kind: "file",
  label: "NC file",
  verbatim: true,
  generated: false,
  phase: () => "machining",
  resolve: ({ source }, _plate, kit) =>
    ok(plain(source.park ? source.nc : withoutClosingPark(source.nc, kit))),
}

const templateKind: OperationKind<"template"> = {
  kind: "template",
  label: "Plugin program",
  verbatim: true,
  generated: false,
  phase: (operation) => operation.source.phase,
  resolve: (operation) => ok(plain(operation.source.nc)),
}

const pluginKind: OperationKind<"plugin"> = {
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

/**
 * A probing operation the machine cannot run, as it has no `what` to run it with. The
 * operation's inspector shows it; its editor has no settings to add.
 */
const unsupported = (operation: Operation, what: string): Diagnostic =>
  error(
    "probing-unsupported",
    `${operation.name}: this machine has no ${what}.`,
    { subject: operationSubject(operation.id) }
  )

const autoLevelKind: OperationKind<"auto-level"> = {
  kind: "auto-level",
  label: "Auto-level",
  verbatim: true,
  generated: true,
  phase: () => "setup",
  available: (probe) => probe !== null,
  defaults: (plate, probe) =>
    plateAutoLevelParams(plate, probe.autoLevel.parameters),
  resolve: (operation, plate, { probe }) => {
    if (!probe) return fail(unsupported(operation, "probe"))
    const { params } = operation.source
    const generated = generateAutoLevelNc(
      params,
      placementContext(plate),
      probe.autoLevel
    )
    if (!generated.ok)
      return fail(
        error(
          "auto-level-invalid",
          `${operation.name}: ${generated.issues.at(0)?.message ?? "the probe grid is invalid."}`,
          {
            subject: operationSubject(operation.id),
            fix: { kind: "edit-operation", operationId: operation.id },
          }
        )
      )
    const { nc, reviewPauseLine } = generated.program
    return ok({
      nc,
      policy: {
        probing: "grid",
        anchoredProbing: params.placement.kind === "anchor",
      },
      reviewLines: reviewPauseLine === null ? [] : [reviewPauseLine],
    })
  },
}

const autoZHeightKind: OperationKind<"auto-z-height"> = {
  kind: "auto-z-height",
  label: "Auto Z-height",
  verbatim: true,
  generated: true,
  phase: () => "setup",
  available: (probe) => probe !== null,
  defaults: (plate, probe) =>
    plateAutoZHeightParams(plate, probe.autoZHeight.parameters),
  resolve: (operation, plate, { probe }) => {
    if (!probe) return fail(unsupported(operation, "probe"))
    const generated = generateAutoZHeightNc(
      operation.source.params,
      placementContext(plate),
      probe.autoZHeight
    )
    if (!generated.ok)
      return fail(
        error(
          "auto-z-height-invalid",
          `${operation.name}: ${generated.issues.at(0)?.message ?? "the touch-off is invalid."}`,
          {
            subject: operationSubject(operation.id),
            fix: { kind: "edit-operation", operationId: operation.id },
          }
        )
      )
    return ok({
      nc: generated.program.nc,
      policy: { probing: "touch-off", anchoredProbing: false },
      reviewLines: [],
    })
  },
}

const autoScanKind: OperationKind<"auto-scan"> = {
  kind: "auto-scan",
  label: "Auto-scan",
  verbatim: true,
  generated: true,
  phase: () => "setup",
  available: (probe) => probe !== null && probe.autoScan !== null,
  // `available` above confirms `autoScan`; this states that guarantee for the type checker,
  // as `kindOf`'s cast below states its own.
  defaults: (_plate, probe) =>
    defaultAutoScanParams((probe.autoScan as OutlineTrace).parameters),
  // The outline is the plate's other operations' toolpath bounds, so it never goes stale.
  resolve: (operation, plate, kit) => {
    const trace = kit.probe?.autoScan
    if (!trace) return fail(unsupported(operation, "pointer to trace with"))
    const generated = generateAutoScanNc(
      operation.source.params,
      toolpathBoundsOf(machiningPrograms(plate, kit)),
      trace
    )
    if (!generated.ok)
      return fail(
        error(
          "auto-scan-invalid",
          `${operation.name}: ${generated.issues.at(0)?.message ?? "the scan is invalid."}`,
          {
            subject: operationSubject(operation.id),
            fix: { kind: "edit-operation", operationId: operation.id },
          }
        )
      )
    return ok({
      nc: generated.program.nc,
      policy: { probing: "outline", anchoredProbing: false },
      reviewLines: [],
    })
  },
}

const probe3dKind: OperationKind<"probe-3d"> = {
  kind: "probe-3d",
  label: "3D probing",
  verbatim: true,
  generated: true,
  phase: () => "setup",
  available: (probe) => probe !== null && probe.probe3d !== null,
  // `available` above confirms `probe3d`; this states that guarantee for the type checker, as
  // auto-scan's `defaults` does for its trace.
  defaults: (_plate, probe) =>
    defaultProbe3dParams((probe.probe3d as OriginProbing).parameters),
  resolve: (operation, plate, kit) => {
    const probing = kit.probe?.probe3d
    if (!probing) return fail(unsupported(operation, "3D probe"))
    const generated = generateProbe3dNc(
      operation.source.params,
      placementContext(plate),
      probing
    )
    if (!generated.ok)
      return fail(
        error(
          "probe-3d-invalid",
          `${operation.name}: ${generated.issues.at(0)?.message ?? "the probing is invalid."}`,
          {
            subject: operationSubject(operation.id),
            fix: { kind: "edit-operation", operationId: operation.id },
          }
        )
      )
    return ok({
      nc: generated.program.nc,
      policy: { probing: "origin", anchoredProbing: false },
      reviewLines: [],
    })
  },
}

export const OPERATION_KINDS: {
  readonly [TKind in SourceKind]: OperationKind<TKind>
} = {
  file: fileKind,
  template: templateKind,
  plugin: pluginKind,
  "auto-level": autoLevelKind,
  "auto-z-height": autoZHeightKind,
  "auto-scan": autoScanKind,
  "probe-3d": probe3dKind,
}

/**
 * The registry pairs each kind with its own source type; TypeScript cannot correlate the
 * union on its own, so this one cast is where that guarantee is stated.
 */
export function kindOf(operation: Operation): OperationKind<SourceKind> {
  return OPERATION_KINDS[
    operation.source.kind
  ] as unknown as OperationKind<SourceKind>
}

/**
 * A probing kind's `available` and `defaults`, always both defined for one of `auto-level`,
 * `auto-z-height`, `auto-scan` or `probe-3d`; this states that guarantee for the type checker, as `kindOf`'s
 * cast above states its own. The UI adds an operation and offers it through this, never reading
 * a probe or `DEFAULT_KIT` itself.
 */
export function probingOf<TKind extends ProbingSourceKind>(
  kind: TKind
): Required<Pick<OperationKind<TKind>, "available" | "defaults">> {
  return OPERATION_KINDS[kind] as unknown as Required<
    Pick<OperationKind<TKind>, "available" | "defaults">
  >
}

/** The NC an operation contributes, resolved with the kit of its plate's machine. */
export const resolveOperation = (
  operation: Operation,
  plate: Plate,
  kit: FixtureKit = kitForPlate(plate)
) => kindOf(operation).resolve(operation, plate, kit)

export const operationPhase = (operation: Operation): Phase =>
  kindOf(operation).phase(operation)

/**
 * The NC of a plate's operations outside the setup phase, those that machine it, in order; null
 * for one whose NC does not resolve. Where a plate cuts is measured from them
 * (`plateToolpathBounds`).
 */
export function machiningPrograms(
  plate: Plate,
  kit: FixtureKit = kitForPlate(plate)
): (string | null)[] {
  return plate.operations
    .filter((operation) => operationPhase(operation) !== "setup")
    .map((operation) => {
      const resolved = kindOf(operation).resolve(operation, plate, kit)
      return resolved.ok ? resolved.value.nc : null
    })
}
