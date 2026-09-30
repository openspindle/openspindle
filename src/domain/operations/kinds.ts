import type { AnchorConfiguration } from "@/machine/contract"
import { plateAutoLevelParams } from "../auto-level/fit"
import { generateAutoLevelNc } from "../auto-level/generate"
import type { AutoLevelIssueCode } from "../auto-level/issues"
import { autoLevelRunIssues, validateAutoLevel } from "../auto-level/rules"
import { generateAutoScanNc } from "../auto-scan/generate"
import { outlineStockIssues, scanOrderIssues } from "../auto-scan/rules"
import { plateAutoZHeightParams } from "../auto-z-height/fit"
import { generateAutoZHeightNc } from "../auto-z-height/generate"
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
import { defaultsOf } from "../probing/parameters"
import { offering } from "../probing/probe"
import type {
  Capabilities,
  CapabilityKind,
  ProbeProgram,
  ProbeTool,
} from "../probing/probe"
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

/** The kinds whose NC, defaults and availability come from the plate's machine's probes. */
export type ProbingSourceKind =
  "auto-level" | "auto-z-height" | "auto-scan" | "probe-3d"

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
 * the kit of the plate's machine (`kitForPlate`): its probes measure for the probing kinds
 * (`ProbingKind`), which also give the UI a new operation fitted to the probe here (`offer`), so
 * it never reads a capability itself.
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
}

/**
 * A probing kind: an operation kind whose NC the first of the machine's probes to offer its kind
 * of probing (`capability`) writes, and which the machine offers only with such a probe.
 */
export interface ProbingKind<
  TKind extends ProbingSourceKind,
> extends OperationKind<TKind> {
  readonly capability: CapabilityKind
  /**
   * What a machine's probes offer of the kind, known before the plate is
   * (`useAddProbingOperation`, `useBuiltInSources`): a new operation's source, fitted to the
   * plate it is added to within the ranges of the probe offering the capability; null when none
   * of the probes offers it.
   */
  offer: (
    probes: readonly ProbeTool[]
  ) => ((plate: Plate) => SourceOf<TKind>) | null
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

/** A probing kind's parameters, as its operations store them. */
type ParamsOf<TKind extends ProbingSourceKind> = SourceOf<TKind>["params"]

/** A probing operation's NC, or the issues that keep it from being generated. */
type ProbingGeneration =
  | { readonly ok: true; readonly program: ProbeProgram }
  | { readonly ok: false; readonly issues: readonly Issue[] }

/** What sets a probing kind apart; `probingKind` makes the rest of it. */
type ProbingKindSpec<
  TKind extends ProbingSourceKind,
  TCapability extends CapabilityKind,
> = {
  readonly kind: TKind
  readonly label: string
  readonly capability: TCapability
  /** What a machine without the capability has none of, as `probing-unsupported` names it. */
  readonly lacking: string
  /** Why generating failed, as `<kind>-invalid` says when no issue does. */
  readonly invalid: string
  /** Whether an operation probes from a stored anchor (`anchoredProbing`); never without it. */
  readonly anchored?: (operation: OperationOf<TKind>) => boolean
  /** A new operation's parameters, fitted to the plate within the capability's ranges. */
  readonly defaults: (
    plate: Plate,
    capability: Capabilities[TCapability]
  ) => ParamsOf<TKind>
  /** An operation's NC on its plate, as the capability writes it. */
  readonly generate: (
    operation: OperationOf<TKind>,
    plate: Plate,
    capability: Capabilities[TCapability],
    kit: FixtureKit
  ) => ProbingGeneration
  readonly validate?: OperationKind<TKind>["validate"]
  readonly runChecks?: OperationKind<TKind>["runChecks"]
}

/**
 * A probing kind from what sets it apart: a setup operation whose NC is generated, and kept
 * verbatim, by the first of the kit's probes that offers its capability. Without one it does
 * not resolve (`probing-unsupported`); an operation whose NC is not generated reports its first
 * issue as `<kind>-invalid`.
 */
function probingKind<
  TKind extends ProbingSourceKind,
  TCapability extends CapabilityKind,
>({
  kind,
  label,
  capability,
  lacking,
  invalid,
  anchored,
  defaults,
  generate,
  validate,
  runChecks,
}: ProbingKindSpec<TKind, TCapability>): ProbingKind<TKind> {
  return {
    kind,
    label,
    verbatim: true,
    generated: true,
    phase: () => "setup",
    capability,
    offer: (probes) => {
      const offered = offering(probes, capability)
      if (!offered) return null
      // `SourceOf<TKind>` is the source whose kind is `TKind`, which holds `ParamsOf<TKind>`;
      // TypeScript cannot narrow the union for a kind not known yet, so this states it.
      return (plate) =>
        ({
          kind,
          params: defaults(plate, offered.capability),
        }) as SourceOf<TKind>
    },
    resolve: (operation, plate, kit) => {
      const offered = offering(kit.probes, capability)
      if (!offered) return fail(unsupported(operation, lacking))
      const generated = generate(operation, plate, offered.capability, kit)
      if (!generated.ok)
        return fail(
          error(
            `${kind}-invalid`,
            `${operation.name}: ${generated.issues.at(0)?.message ?? invalid}`,
            {
              subject: operationSubject(operation.id),
              fix: { kind: "edit-operation", operationId: operation.id },
            }
          )
        )
      const { nc, reviewLine } = generated.program
      return ok({
        nc,
        policy: {
          probing: capability,
          anchoredProbing: anchored?.(operation) ?? false,
        },
        reviewLines: reviewLine === null ? [] : [reviewLine],
      })
    },
    validate,
    runChecks,
  }
}

const autoLevelKind = probingKind({
  kind: "auto-level",
  label: "Auto-level",
  capability: "grid",
  lacking: "probe",
  invalid: "the probe grid is invalid.",
  anchored: ({ source }) => source.params.placement.kind === "anchor",
  defaults: (plate, grid) => plateAutoLevelParams(plate, grid.parameters),
  generate: ({ source }, plate, grid) =>
    generateAutoLevelNc(source.params, placementContext(plate), grid),
  validate: (operation, plate, kit) => {
    const grid = offering(kit.probes, "grid")?.capability
    if (!grid) return []
    return validateAutoLevel(
      operation.source.params,
      {
        ...placementContext(plate),
        stock: plate.setup.stock,
        stockAnchor: plate.setup.stockAnchor,
      },
      grid.parameters
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
})

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

const autoZHeightKind = probingKind({
  kind: "auto-z-height",
  label: "Auto Z-height",
  capability: "touch-off",
  lacking: "probe",
  invalid: "the touch-off is invalid.",
  defaults: (plate, touchOff) =>
    plateAutoZHeightParams(plate, touchOff.parameters),
  generate: ({ source }, plate, touchOff) =>
    generateAutoZHeightNc(source.params, placementContext(plate), touchOff),
  validate: (operation, plate, kit) => {
    const touchOff = offering(kit.probes, "touch-off")?.capability
    if (!touchOff) return []
    return [
      ...validateAutoZHeight(
        operation.source.params,
        {
          ...placementContext(plate),
          stock: plate.setup.stock,
          stockAnchor: plate.setup.stockAnchor,
        },
        touchOff.parameters
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
})

const autoScanKind = probingKind({
  kind: "auto-scan",
  label: "Auto-scan",
  capability: "outline",
  lacking: "pointer to trace with",
  invalid: "the scan is invalid.",
  defaults: (_plate, trace) => ({
    ...defaultsOf(trace.parameters),
    pauseAfterScan: true,
  }),
  // The outline is the plate's other operations' toolpath bounds, so it never goes stale.
  generate: ({ source }, plate, trace, kit) =>
    generateAutoScanNc(
      source.params,
      toolpathBoundsOf(machiningPrograms(plate, kit)),
      trace
    ),
  // Outline and order advice needs no pointer, so a machine without one still reports it.
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
})

/** Issues that block generating the 3D probing NC; the compiler reports those already. */
const PROBE_3D_BLOCKERS: ReadonlySet<Probe3dIssueCode> = new Set([
  "invalid-parameters",
  "anchor-snapshot-missing",
  "anchor-unavailable",
  "anchor-point-out-of-range",
])

const probe3dKind = probingKind({
  kind: "probe-3d",
  label: "3D probing",
  capability: "origin",
  lacking: "3D probe",
  invalid: "the probing is invalid.",
  defaults: (_plate, probing) => defaultProbe3dParams(probing.parameters),
  generate: ({ source }, plate, probing) =>
    generateProbe3dNc(source.params, placementContext(plate), probing),
  validate: (operation, plate, kit) => {
    const probing = offering(kit.probes, "origin")?.capability
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
})

/** The probing kinds, each with its own source type. */
const PROBING: { readonly [TKind in ProbingSourceKind]: ProbingKind<TKind> } = {
  "auto-level": autoLevelKind,
  "auto-z-height": autoZHeightKind,
  "auto-scan": autoScanKind,
  "probe-3d": probe3dKind,
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
 * A probing kind, with what it asks of a machine's probes and the new operation it offers. The
 * UI adds an operation and offers it through this, never reading a capability itself.
 */
export function probingOf<TKind extends ProbingSourceKind>(
  kind: TKind
): ProbingKind<TKind> {
  return PROBING[kind]
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
