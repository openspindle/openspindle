import { PLATE_SUBJECT } from "../diagnostics"
import type { StageRule } from "../rules/stages"

/** The plate's gates before Run: without a plate, it has no operations to check. */
export const PLATE_CHAIN = "plate"

const plateChosen: StageRule<"run"> = {
  id: "run/plate",
  stage: "run",
  label: "Plate",
  description: "Run machines a plate, so there must be one.",
  severity: "error",
  configurable: false,
  chain: PLATE_CHAIN,
  test: ({ plate }) => plate !== null,
  explain: () => ({ problem: "Add a plate in Prepare.", about: PLATE_SUBJECT }),
}

const plateHasOperations: StageRule<"run"> = {
  id: "run/operations",
  stage: "run",
  label: "Operations",
  description:
    "A plate without operations has nothing to run; Prepare reports nothing for it.",
  severity: "error",
  configurable: false,
  chain: PLATE_CHAIN,
  test: ({ plate }) => !plate || plate.operations.length > 0,
  explain: () => ({
    problem: "Add an operation to this plate.",
    about: PLATE_SUBJECT,
  }),
}

/** What Run needs of the plate itself: a plate, with operations. */
export const PLATE_RUN_RULES: readonly StageRule<"run">[] = [
  plateChosen,
  plateHasOperations,
]
