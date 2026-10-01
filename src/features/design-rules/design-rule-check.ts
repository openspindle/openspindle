import { useMemo } from "react"
import { createAtom, useSelector } from "@tanstack/react-store"
import type { RuleSettings } from "@/machine/contract"
import { selectedPlate, useWorkspace } from "@/app/workspace/workspace-context"
import { compilePlate } from "@/domain/compile/compile"
import { keyDiagnostics } from "@/domain/diagnostics"
import type { KeyedDiagnostic } from "@/domain/diagnostics"
import { checkDesignRules } from "@/domain/design-rules/check"
import type {
  DesignRuleCheck,
  DesignRuleViolation,
} from "@/domain/design-rules/check"
import type { Plate } from "@/domain/plate/plate"
import type { Tool } from "@/domain/tools/tool"
import type { WorkspaceState } from "@/domain/workspace/workspace"
import { unfocusProblem } from "@/features/viewer/problem-focus"
import type { ProblemFocus } from "@/features/viewer/problem-focus"

/** A plate's last check: the plate and settings as checked, and what it found. */
export type DesignRuleResult = {
  readonly plate: Plate
  readonly settings: RuleSettings
  readonly check: DesignRuleCheck
  /** The check's violations with the keys the 3D view shows them by (`keyDiagnostics`). */
  readonly violations: readonly KeyedDiagnostic<DesignRuleViolation>[]
}

/** Each plate's latest check, with the settings and tools it was checked with. */
const checked = new WeakMap<
  Plate,
  {
    readonly settings: RuleSettings
    readonly tools: readonly Tool[]
    readonly check: DesignRuleCheck
  }
>()

/**
 * A plate's check against the design rules as the project sets them (`checkDesignRules`), with
 * the library's tools; kept per plate object while the settings and the tools stay the same.
 */
export function plateDesignRuleCheck(
  plate: Plate,
  settings: RuleSettings,
  tools: readonly Tool[]
): DesignRuleCheck {
  const saved = checked.get(plate)
  if (saved?.settings === settings && saved.tools === tools) return saved.check
  const check = checkDesignRules(
    plate,
    compilePlate(plate, tools),
    settings,
    tools
  )
  checked.set(plate, { settings, tools, check })
  return check
}

/** What a plate breaks of the project's design rules as it is now; null without a plate. */
export function usePlateDesignRuleCheck(
  plate: Plate | null
): DesignRuleCheck | null {
  const settings = useWorkspace((state) => state.ruleSettings)
  const tools = useWorkspace((state) => state.tools)
  return useMemo(
    () => (plate ? plateDesignRuleCheck(plate, settings, tools) : null),
    [plate, settings, tools]
  )
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
  const settings = state.ruleSettings
  const check = plateDesignRuleCheck(plate, settings, state.tools)
  unfocusResults(resultsAtom.get())
  resultsAtom.set(() => ({
    result: {
      plate,
      settings,
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

/** A result no longer matches the workspace once its plate or the settings change. */
export const isOutOfDate = (result: DesignRuleResult, state: WorkspaceState) =>
  state.ruleSettings !== result.settings || !state.plates.includes(result.plate)

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
