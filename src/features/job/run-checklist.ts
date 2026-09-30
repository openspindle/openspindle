import type { CompiledPlate } from "@/domain/compile/compile"
import type { DesignRuleCheck } from "@/domain/design-rules/check"
import {
  PLATE_SUBJECT,
  blocking,
  diagnosticOperation,
  keyDiagnostics,
  operationSubject,
} from "@/domain/diagnostics"
import type { Diagnostic, QuickFix, Severity } from "@/domain/diagnostics"
import type { Plate } from "@/domain/plate/plate"
import { PLATE_CHAIN } from "@/domain/plate/run-rules"
import { plural } from "@/domain/primitives"
import { failureDiagnostic } from "@/domain/rules/diagnostics"
import type { StageFailure } from "@/domain/rules/stages"
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
  /**
   * What Run's rules find of the plate (or its absence) and its operations against the connected
   * machine (e.g. anchors read from it), in the order the rules find them.
   */
  readonly runFailures: readonly StageFailure<"run">[]
  /** What the plate breaks of the project's design rules; null without a plate. */
  readonly designRules: DesignRuleCheck | null
  readonly snapshot: MachineSnapshot
  readonly check: ProgramCheck
}

/** One row of the Run checklist: a named condition of Run, as it shows for the context. */
export type RunCheckRow = {
  readonly id: string
  readonly label: string
  readonly show: (context: RunContext) => RunCheckResult
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

/** A failure of Run's rules as a diagnostic, about what its rule names, else its operation or the plate. */
const runDiagnostic = (failure: StageFailure<"run">) =>
  failureDiagnostic(
    failure,
    failure.first.operation
      ? operationSubject(failure.first.operation.id)
      : PLATE_SUBJECT
  )

export const deviceConnected: RunCheckRow = {
  id: "device",
  label: "Device connected",
  show: ({ snapshot }) => {
    const { status, device, error } = snapshot.connection
    if (status === "connected") return pass(device?.name)
    if (status === "connecting") return pending("Connecting…")
    return fail(error ?? "Connect a device first.", {
      kind: "device",
      label: "Connect",
    })
  },
}

/**
 * The plate chain's failure (no plate, or one without operations: Prepare reports nothing for an
 * empty plate, but there is nothing to run yet), else what the plate's program reports.
 */
export const plateCompiles: RunCheckRow = {
  id: "program",
  label: "Plate compiles",
  show: ({ runFailures, diagnostics }) => {
    const failure = runFailures.find(({ rule }) => rule.chain === PLATE_CHAIN)
    if (failure)
      return fail(failure.rule.explain(failure).problem, OPEN_PREPARE)
    return diagnosticsResult(diagnostics.filter(isProgramDiagnostic))
  },
}

export const toolsAssigned: RunCheckRow = {
  id: "tools",
  label: "Tools assigned",
  show: ({ plate, diagnostics }) =>
    plate
      ? diagnosticsResult(diagnostics.filter(isToolDiagnostic))
      : pending("Waits for a plate."),
}

export const operationsCurrent: RunCheckRow = {
  id: "operations",
  label: "Operations up to date",
  show: ({ plate, diagnostics }) =>
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
export const designRulesMet: RunCheckRow = {
  id: "design-rules",
  label: "Design rules met",
  show: ({ plate, designRules }) => {
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

/**
 * What Run's rules find of the plate against the connected machine, as diagnostics: the work
 * origin's and the probing operations' failures, every one but the plate chain's.
 */
export const matchesMachine: RunCheckRow = {
  id: "setup",
  label: "Plate matches the machine",
  show: ({ plate, snapshot, runFailures }) => {
    if (!plate) return pending("Waits for a plate.")
    if (snapshot.connection.status !== "connected")
      return pending("Waits for a connected device.")
    return diagnosticsResult(
      runFailures
        .filter(({ rule }) => rule.chain !== PLATE_CHAIN)
        .map(runDiagnostic)
    )
  },
}

export const programTransfers: RunCheckRow = {
  id: "transfer",
  label: "Program transfers",
  show: ({ compiled, check }) => {
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

export const machineReady: RunCheckRow = {
  id: "machine",
  label: "Machine ready",
  show: ({ snapshot }) => {
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
export const RUN_CHECKLIST: readonly RunCheckRow[] = [
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
  rows: readonly RunCheckRow[] = RUN_CHECKLIST
): RunChecklist {
  const checks = rows.map((row) => ({
    id: row.id,
    label: row.label,
    result: row.show(context),
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
