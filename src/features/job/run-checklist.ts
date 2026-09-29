import type { CompiledPlate } from "@/domain/compile/compile"
import type { DesignRuleCheck } from "@/domain/design-rules/check"
import {
  blocking,
  diagnosticOperation,
  keyDiagnostics,
} from "@/domain/diagnostics"
import type { Diagnostic, QuickFix, Severity } from "@/domain/diagnostics"
import type { Plate } from "@/domain/plate/plate"
import { plural } from "@/domain/primitives"
import { QUICK_FIX_LABELS } from "@/features/prepare/quick-fix"
import type { MachineSnapshot } from "@/machine/contract"
import type { PrepareSearch } from "@/routes/_workspace/prepare"
import type { ProgramCheck } from "./program-check"

/** What a check offers to resolve it: a Prepare or Device link, or a machine action. */
export type RunFix =
  | {
      readonly kind: "prepare"
      readonly label: string
      readonly search: PrepareSearch
    }
  | { readonly kind: "device"; readonly label: string }
  | { readonly kind: "read-anchors"; readonly label: string }
  /** Checks the plate's design rules in Prepare, which shows what the check finds. */
  | {
      readonly kind: "design-rules"
      readonly label: string
      readonly plateId: string
    }

export type RunCheckStatus = "pass" | "fail" | "pending"

/** A problem a check lists, and what resolves it. */
export type RunIssue = {
  readonly key: string
  readonly severity: Severity
  readonly problem: string
  readonly suggestion: string
}

export type RunCheckResult = {
  readonly status: RunCheckStatus
  /** Why the check fails or waits; on a pass, a note that does not block Run. */
  readonly reason?: string
  readonly fix?: RunFix
  /** A pass whose note is a warning: Run is allowed, but it is worth a look first. */
  readonly warning?: boolean
  /** The first problems behind the reason, each with what resolves it. */
  readonly issues?: readonly RunIssue[]
}

/** Everything the checks read: the plate to run and the machine that would run it. */
export type RunContext = {
  readonly plate: Plate | null
  readonly compiled: CompiledPlate | null
  /** `plateDiagnostics` of the plate: everything that blocks or qualifies Run. */
  readonly diagnostics: readonly Diagnostic[]
  /** What the plate's operations need from the connected machine (e.g. anchors read from it). */
  readonly machineDiagnostics: readonly Diagnostic[]
  /** What the plate breaks of the project's design rules; null without a plate. */
  readonly designRules: DesignRuleCheck | null
  readonly snapshot: MachineSnapshot
  readonly check: ProgramCheck
}

/** Specification pattern: one named condition of Run, evaluated over the context. */
export interface RunSpec {
  readonly id: string
  readonly label: string
  evaluate: (context: RunContext) => RunCheckResult
}

const pass = (reason?: string, fix?: RunFix): RunCheckResult => ({
  status: "pass",
  reason,
  fix,
})
const pending = (reason: string): RunCheckResult => ({
  status: "pending",
  reason,
})
const fail = (reason: string, fix?: RunFix): RunCheckResult => ({
  status: "fail",
  reason,
  fix,
})

const OPEN_DEVICE: RunFix = { kind: "device", label: "Open Device" }
const OPEN_PREPARE: RunFix = {
  kind: "prepare",
  label: "Open Prepare",
  search: {},
}

/** Diagnostic quick fixes lead to Prepare, except machine actions, which run here. */
export function fixFor(diagnostic: Diagnostic): RunFix {
  const fix = diagnostic.fix
  const operation = diagnosticOperation(diagnostic)
  if (!fix)
    return {
      kind: "prepare",
      label: operation ? "Open operation" : "Open Prepare",
      search: operation ? { operation } : {},
    }
  const label = QUICK_FIX_LABELS[fix.kind]
  switch (fix.kind) {
    case "assign-tool":
      return { kind: "prepare", label, search: { panel: "tools" } }
    case "update-operation":
    case "edit-operation":
      return { kind: "prepare", label, search: { operation: fix.operationId } }
    case "install-plugin":
      return { kind: "prepare", label, search: operation ? { operation } : {} }
    case "read-anchors":
      return { kind: "read-anchors", label }
    case "resolve-rule":
      return {
        kind: "prepare",
        label: "Open operation",
        search: { operation: fix.operationId },
      }
  }
}

const OPERATION_FIXES: ReadonlySet<QuickFix["kind"]> = new Set([
  "update-operation",
  "install-plugin",
  "edit-operation",
])

const isToolDiagnostic = (diagnostic: Diagnostic) =>
  diagnostic.fix?.kind === "assign-tool" || diagnostic.code.startsWith("tool-")
const isOperationDiagnostic = (diagnostic: Diagnostic) =>
  diagnostic.fix !== undefined && OPERATION_FIXES.has(diagnostic.fix.kind)
/** Whatever the tool and operation checks do not claim, so every error blocks through one check. */
const isProgramDiagnostic = (diagnostic: Diagnostic) =>
  !isToolDiagnostic(diagnostic) && !isOperationDiagnostic(diagnostic)

const summary = (diagnostic: Diagnostic, count: number) =>
  count > 1 ? `${diagnostic.message} (+${count - 1} more)` : diagnostic.message

/** Errors fail the check; warnings pass with a note. */
function diagnosticsResult(diagnostics: readonly Diagnostic[]): RunCheckResult {
  const errors = blocking(diagnostics)
  const error = errors.at(0)
  if (error) return fail(summary(error, errors.length), fixFor(error))
  const warning = diagnostics.at(0)
  return warning
    ? {
        ...pass(summary(warning, diagnostics.length), fixFor(warning)),
        warning: true,
      }
    : pass()
}

const compiles = (compiled: CompiledPlate | null) =>
  !!compiled &&
  compiled.mode !== "empty" &&
  !blocking(compiled.diagnostics).length

export const deviceConnected: RunSpec = {
  id: "device",
  label: "Device connected",
  evaluate: ({ snapshot }) => {
    const { status, device, error } = snapshot.connection
    if (status === "connected") return pass(device?.name)
    if (status === "connecting") return pending("Connecting…")
    return fail(error ?? "Connect a device first.", {
      kind: "device",
      label: "Connect",
    })
  },
}

export const plateCompiles: RunSpec = {
  id: "program",
  label: "Plate compiles",
  evaluate: ({ plate, diagnostics }) => {
    if (!plate) return fail("Add a plate in Prepare.", OPEN_PREPARE)
    // Prepare reports nothing for an empty plate, but there is nothing to run yet.
    if (!plate.operations.length)
      return fail("Add an operation to this plate.", OPEN_PREPARE)
    return diagnosticsResult(diagnostics.filter(isProgramDiagnostic))
  },
}

export const toolsAssigned: RunSpec = {
  id: "tools",
  label: "Tools assigned",
  evaluate: ({ plate, diagnostics }) =>
    plate
      ? diagnosticsResult(diagnostics.filter(isToolDiagnostic))
      : pending("Waits for a plate."),
}

export const operationsCurrent: RunSpec = {
  id: "operations",
  label: "Operations up to date",
  evaluate: ({ plate, diagnostics }) =>
    plate
      ? diagnosticsResult(diagnostics.filter(isOperationDiagnostic))
      : pending("Waits for a plate."),
}

/** Problems a check lists at most; its reason counts them all. */
const LISTED_ISSUES = 3

/** "2 errors, 1 warning". */
function counts(diagnostics: readonly Diagnostic[]) {
  const errors = blocking(diagnostics).length
  const warnings = diagnostics.length - errors
  return [
    errors ? plural(errors, "error") : null,
    warnings ? plural(warnings, "warning") : null,
  ]
    .filter((count) => count !== null)
    .join(", ")
}

/**
 * The project's design rules, which the plate's moves and its operations' NC must keep: errors
 * fail, warnings pass with a note. The first problems are listed with what resolves them; Prepare
 * shows them all, with Show and Apply.
 */
export const designRulesMet: RunSpec = {
  id: "design-rules",
  label: "Design rules met",
  evaluate: ({ plate, designRules }) => {
    if (!plate || !designRules) return pending("Waits for a plate.")
    const { violations } = designRules
    if (!violations.length) return pass()
    const reason = `${counts(violations)}.`
    const fix: RunFix = {
      kind: "design-rules",
      label: "Show in Prepare",
      plateId: plate.id,
    }
    const issues = keyDiagnostics(violations)
      .slice(0, LISTED_ISSUES)
      .map(({ key, diagnostic }) => ({
        key,
        severity: diagnostic.severity,
        problem: diagnostic.message,
        suggestion: diagnostic.suggestion,
      }))
    return blocking(violations).length
      ? { status: "fail", reason, fix, issues }
      : { status: "pass", warning: true, reason, fix, issues }
  },
}

export const matchesMachine: RunSpec = {
  id: "setup",
  label: "Plate matches the machine",
  evaluate: ({ plate, snapshot, machineDiagnostics }) => {
    if (!plate) return pending("Waits for a plate.")
    if (snapshot.connection.status !== "connected")
      return pending("Waits for a connected device.")
    return diagnosticsResult(machineDiagnostics)
  },
}

export const programTransfers: RunSpec = {
  id: "transfer",
  label: "Program transfers",
  evaluate: ({ compiled, check }) => {
    if (!compiles(compiled)) return pending("Waits for a plate that compiles.")
    switch (check.status) {
      case "unavailable":
        return pending(check.reason)
      case "checking":
        return pending("Checking the program against the machine's dialect…")
      case "rejected":
        return fail(check.error)
      case "ready": {
        const { changeCount, parts } = check.program
        const notes = [
          parts.length > 1
            ? `Sent in ${parts.length} parts, split at tool changes; every part is uploaded before the first plays.`
            : null,
          changeCount
            ? `${changeCount.toLocaleString()} lines adjusted for the machine; see the G-code list.`
            : null,
        ].filter((note) => note !== null)
        return pass(notes.length ? notes.join(" ") : undefined)
      }
    }
  },
}

export const machineReady: RunSpec = {
  id: "machine",
  label: "Machine ready",
  evaluate: ({ snapshot }) => {
    if (snapshot.connection.status !== "connected")
      return pending("Waits for a connected device.")
    const run = snapshot.availability.run
    return run.allowed
      ? pass()
      : fail(
          run.reason ?? "The machine cannot start a program now.",
          OPEN_DEVICE
        )
  },
}

/** In the order a user resolves them: machine access, the plate, then the machine itself. */
export const RUN_SPECS: readonly RunSpec[] = [
  deviceConnected,
  plateCompiles,
  toolsAssigned,
  operationsCurrent,
  designRulesMet,
  matchesMachine,
  programTransfers,
  machineReady,
]

export type RunCheck = {
  readonly id: string
  readonly label: string
  readonly result: RunCheckResult
}

export type RunChecklist = {
  readonly checks: readonly RunCheck[]
  /** Every check passes: the only condition under which Run is offered. */
  readonly ready: boolean
  /** Why Run is unavailable: the first check that does not pass. */
  readonly blocker: string | null
}

export function evaluateRunChecklist(
  context: RunContext,
  specs: readonly RunSpec[] = RUN_SPECS
): RunChecklist {
  const checks = specs.map((spec) => ({
    id: spec.id,
    label: spec.label,
    result: spec.evaluate(context),
  }))
  const blocked = checks.find((check) => check.result.status !== "pass")
  return {
    checks,
    ready: !blocked,
    blocker: blocked
      ? `${blocked.label}: ${blocked.result.reason ?? "not yet."}`
      : null,
  }
}
