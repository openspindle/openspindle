import { createAtom, useSelector } from "@tanstack/react-store"
import { selectedPlate } from "@/app/workspace/workspace-context"
import { compilePlate } from "@/domain/compile/compile"
import { keyDiagnostics } from "@/domain/diagnostics"
import type { KeyedDiagnostic } from "@/domain/diagnostics"
import { checkDesignRules } from "@/domain/design-rules/check"
import type {
  DesignRuleCheck,
  DesignRuleViolation,
} from "@/domain/design-rules/check"
import type { DesignRules } from "@/domain/design-rules/rules"
import type { Plate } from "@/domain/plate/plate"
import type { WorkspaceState } from "@/domain/workspace/workspace"
import { unfocusProblem } from "@/features/viewer/problem-focus"
import type { ProblemFocus } from "@/features/viewer/problem-focus"

/** A plate's last check: the plate and rules as checked, and what it found. */
export type DesignRuleResult = {
  readonly plate: Plate
  readonly rules: DesignRules
  readonly check: DesignRuleCheck
  /** The check's violations with the keys the 3D view shows them by (`keyDiagnostics`). */
  readonly violations: readonly KeyedDiagnostic<DesignRuleViolation>[]
}

type ResultsState = { readonly result: DesignRuleResult | null }

const resultsAtom = createAtom<ResultsState>({ result: null })

export const useDesignRuleResults = () => useSelector(resultsAtom)

/** Whether the results hold the problem the 3D view shows, in date or not. */
export const holdsViolation = ({ result }: ResultsState, focus: ProblemFocus) =>
  result?.plate.id === focus.plateId &&
  result.violations.some(({ key }) => key === focus.key)

/** The 3D view stops showing a violation of the results, which another check or Close ends. */
const unfocusResults = (results: ResultsState) =>
  unfocusProblem((focus) => holdsViolation(results, focus))

/**
 * Checks a plate of the workspace (the selected one unless named) against the project's design
 * rules, and shows what it finds; the check only reports.
 */
export function checkPlateDesignRules(state: WorkspaceState, plateId?: string) {
  const plate = plateId
    ? state.plates.find((item) => item.id === plateId)
    : selectedPlate(state)
  if (!plate) return
  const rules = state.designRules
  const check = checkDesignRules(plate, compilePlate(plate), rules, state.tools)
  unfocusResults(resultsAtom.get())
  resultsAtom.set(() => ({
    result: {
      plate,
      rules,
      check,
      violations: keyDiagnostics(check.violations),
    },
  }))
}

/** Closes the results; the 3D view stops showing one of their violations. */
export function closeDesignRuleResults() {
  unfocusResults(resultsAtom.get())
  resultsAtom.set(() => ({ result: null }))
}

/** A result no longer matches the workspace once its plate or the rules change. */
export const isOutOfDate = (result: DesignRuleResult, state: WorkspaceState) =>
  state.designRules !== result.rules || !state.plates.includes(result.plate)

/** The violation the 3D view shows, while the check is of this plate as it is. */
export function shownViolation(
  { result }: ResultsState,
  focus: ProblemFocus | null,
  plate: Plate | null
): KeyedDiagnostic<DesignRuleViolation> | null {
  if (!result || !focus || !plate || result.plate !== plate) return null
  if (focus.plateId !== plate.id) return null
  return result.violations.find(({ key }) => key === focus.key) ?? null
}
