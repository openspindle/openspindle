import type { AnchorConfiguration } from "@/machine/contract"
import { plateAutoLevelParams } from "../auto-level/fit"
import { generateAutoLevelNc } from "../auto-level/generate"
import type { AutoLevelIssueCode } from "../auto-level/issues"
import type { AutoLevelParams } from "../auto-level/params"
import { autoLevelRunIssues, validateAutoLevel } from "../auto-level/rules"
import { generateAutoScanNc } from "../auto-scan/generate"
import { defaultAutoScanParams } from "../auto-scan/params"
import type { AutoScanParams } from "../auto-scan/params"
import { outlineStockIssues, scanOrderIssues } from "../auto-scan/rules"
import { plateAutoZHeightParams } from "../auto-z-height/fit"
import { generateAutoZHeightNc } from "../auto-z-height/generate"
import type { AutoZHeightParams } from "../auto-z-height/params"
import {
  autoLevelOrderIssues,
  validateAutoZHeight,
} from "../auto-z-height/rules"
import type {
  AutoZHeightIssueCode,
  LaterAutoLevel,
} from "../auto-z-height/rules"
import { generateProbe3dNc } from "../probe-3d/generate"
import { defaultProbe3dParams } from "../probe-3d/params"
import type { Probe3dParams } from "../probe-3d/params"
import { probe3dOrderIssues, validateProbe3d } from "../probe-3d/rules"
import type { Probe3dIssueCode } from "../probe-3d/rules"
import { error, operationSubject } from "../diagnostics"
import type { Diagnostic, Issue, QuickFix } from "../diagnostics"
import { kitForPlate } from "../fixtures/catalog"
import type { FixtureKit } from "../fixtures/fixture-kit"
import { toolpathBoundsOf } from "../compile/cutting-bounds"
import { PLAIN_NC, withoutClosingPark } from "../compile/nc-unit"
import type { NcPolicy } from "../compile/nc-unit"
import type { Plate } from "../plate/plate"
import { workOriginOnMachine } from "../plate/work-origin"
import { fail, ok } from "../primitives"
import type { Result } from "../primitives"
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

/** The connected machine, as far as running an operation depends on it. */
export type RunContext = {
  readonly connectedDeviceId: string | null
  /** Stored anchors from the connected device's latest successful read. */
  readonly anchors: AnchorConfiguration | null
}

/**
 * Strategy per operation source kind: how it becomes NC, its phase, whether a lone
 * operation may be emitted byte-for-byte, and what to check while editing and before Run.
 * New kinds register here; nothing else switches on plugin ids. Kinds resolve and validate with
 * the kit of the plate's machine (`kitForPlate`): its probe measures for the probing kinds, which
 * also give the UI their availability and defaults here (`available`, `defaults`), so it never
 * reads a probe or a default kit itself.
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
  /** Advice about an operation whose NC resolves; errors block Run. */
  validate?: (
    operation: OperationOf<TKind>,
    plate: Plate,
    kit: FixtureKit
  ) => Diagnostic[]
  /** What blocks running the operation on the connected machine. */
  runChecks?: (
    operation: OperationOf<TKind>,
    plate: Plate,
    machine: RunContext
  ) => Diagnostic[]
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

/** Where an auto-level grid is placed: the plate's device and its anchor snapshot. */
export const placementContext = (plate: Plate) => ({
  deviceId: plate.setup.deviceId,
  anchorSetup: plate.setup.anchors ?? undefined,
  machineWorkOrigin: workOriginOnMachine(plate.setup)?.position ?? null,
  workOriginZ: plate.setup.workOrigin[2],
})

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

/** Issues that block generating the NC; the compiler reports those already. */
const GENERATION_BLOCKERS: ReadonlySet<AutoLevelIssueCode> = new Set([
  "invalid-parameters",
  "anchor-snapshot-missing",
  "anchor-unavailable",
  "anchor-grid-out-of-range",
])

const ANCHOR_READS: ReadonlySet<string> = new Set([
  "anchors-not-read",
  "live-anchors-unavailable",
  "anchors-changed",
])

/**
 * A probing kind's issue as the operation's diagnostic: its code namespaced by the kind
 * (`auto-level/grid-limit`), and where it is, as the issue says.
 */
function issueDiagnostic(
  kind: ProbingSourceKind,
  issue: Issue,
  operation: Operation
): Diagnostic {
  const fix: QuickFix = ANCHOR_READS.has(issue.code)
    ? { kind: "read-anchors" }
    : { kind: "edit-operation", operationId: operation.id }
  return {
    ...issue,
    code: `${kind}/${issue.code}`,
    subject: operationSubject(operation.id),
    fix,
  }
}

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
  validate: (operation, plate, { probe }) => {
    if (!probe) return []
    return validateAutoLevel(
      operation.source.params,
      {
        ...placementContext(plate),
        stock: plate.setup.stock,
        stockAnchor: plate.setup.stockAnchor,
      },
      probe.autoLevel.parameters
    )
      .filter((issue) => !GENERATION_BLOCKERS.has(issue.code))
      .map((issue) => issueDiagnostic("auto-level", issue, operation))
  },
  runChecks: (operation, plate, machine) =>
    autoLevelRunIssues(
      operation.source.params,
      placementContext(plate),
      machine
    ).map((issue) => issueDiagnostic("auto-level", issue, operation)),
}

/** Issues that block generating the touch-off NC; the compiler reports those already. */
const TOUCH_OFF_BLOCKERS: ReadonlySet<AutoZHeightIssueCode> = new Set([
  "invalid-parameters",
  "anchor-snapshot-missing",
  "anchor-unavailable",
  "anchor-point-out-of-range",
])

/** The auto-levels after an operation, which measure their heights from their own grid start. */
function laterAutoLevels(plate: Plate, operation: Operation): LaterAutoLevel[] {
  const index = plate.operations.findIndex((item) => item.id === operation.id)
  if (index < 0) return []
  return plate.operations.slice(index + 1).flatMap((later, offset) =>
    later.source.kind === "auto-level"
      ? [
          {
            placement: later.source.params.placement,
            adjacent: offset === 0 && !later.stopBefore,
          },
        ]
      : []
  )
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
  validate: (operation, plate, { probe }) => {
    if (!probe) return []
    return [
      ...validateAutoZHeight(
        operation.source.params,
        {
          ...placementContext(plate),
          stock: plate.setup.stock,
          stockAnchor: plate.setup.stockAnchor,
        },
        probe.autoZHeight.parameters
      ).filter((issue) => !TOUCH_OFF_BLOCKERS.has(issue.code)),
      ...autoLevelOrderIssues(
        operation.source.params,
        laterAutoLevels(plate, operation)
      ),
    ].map((issue) => issueDiagnostic("auto-z-height", issue, operation))
  },
  runChecks: (operation, plate, machine) =>
    autoLevelRunIssues(
      operation.source.params,
      placementContext(plate),
      machine
    ).map((issue) => issueDiagnostic("auto-z-height", issue, operation)),
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
  validate: (operation, plate, kit) => {
    const toolpath = toolpathBoundsOf(machiningPrograms(plate, kit))
    const index = plate.operations.findIndex((item) => item.id === operation.id)
    const machiningBefore = plate.operations
      .slice(0, Math.max(0, index))
      .some((item) => operationPhase(item) !== "setup")
    return [
      ...(toolpath.ok ? outlineStockIssues(toolpath.bounds, plate.setup) : []),
      ...scanOrderIssues(machiningBefore),
    ].map((issue) => issueDiagnostic("auto-scan", issue, operation))
  },
}

/** Issues that block generating the 3D probing NC; the compiler reports those already. */
const PROBE_3D_BLOCKERS: ReadonlySet<Probe3dIssueCode> = new Set([
  "invalid-parameters",
  "anchor-snapshot-missing",
  "anchor-unavailable",
  "anchor-point-out-of-range",
])

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
  validate: (operation, plate, kit) => {
    const probing = kit.probe?.probe3d
    if (!probing) return []
    const { params } = operation.source
    return [
      ...validateProbe3d(
        params,
        placementContext(plate),
        probing.parameters
      ).filter((issue) => !PROBE_3D_BLOCKERS.has(issue.code)),
      ...probe3dOrderIssues(params, laterAutoLevels(plate, operation)),
    ].map((issue) => issueDiagnostic("probe-3d", issue, operation))
  },
  runChecks: (operation, plate, machine) =>
    autoLevelRunIssues(
      operation.source.params,
      placementContext(plate),
      machine
    ).map((issue) => issueDiagnostic("probe-3d", issue, operation)),
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

/** Advice about every operation of a plate (see OperationKind.validate). */
export const validateOperations = (
  plate: Plate,
  kit: FixtureKit = kitForPlate(plate)
): Diagnostic[] =>
  plate.operations.flatMap(
    (operation) => kindOf(operation).validate?.(operation, plate, kit) ?? []
  )

/** What blocks running a plate's operations on the connected machine. */
export const runChecks = (plate: Plate, machine: RunContext): Diagnostic[] =>
  plate.operations.flatMap(
    (operation) =>
      kindOf(operation).runChecks?.(operation, plate, machine) ?? []
  )
