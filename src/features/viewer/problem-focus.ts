import { createAtom, useSelector } from "@tanstack/react-store"

/**
 * The problem the 3D view shows: a plate's diagnostic, by its key (`keyDiagnostics`) among the
 * plate's diagnostics or its design rule violations. Picking it anywhere shows it: in the view,
 * the inspector or the design rule results.
 */
export type ProblemFocus = { readonly plateId: string; readonly key: string }

const focusAtom = createAtom<ProblemFocus | null>(null)

export const useProblemFocus = () => useSelector(focusAtom)

/** Shows a problem in the 3D view; null shows none. */
export const focusProblem = (focus: ProblemFocus | null) =>
  focusAtom.set(() => focus)

export const isFocused = (
  focus: ProblemFocus | null,
  plateId: string,
  key: string
) => focus?.plateId === plateId && focus.key === key

/** Stops showing the problem shown when `test` picks it. */
export const unfocusProblem = (test: (focus: ProblemFocus) => boolean) =>
  focusAtom.set((focus) => (focus && test(focus) ? null : focus))
