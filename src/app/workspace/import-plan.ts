import { runRules } from "@/machine/contract"
import type { RuleSettings } from "@/machine/contract"
import {
  FRESH_START,
  programEnd,
  programIssue,
  resolveProgram,
  suggestedChoice,
} from "@/domain/design-rules/program-rules"
import type {
  ProgramIssue,
  ProgramStart,
  Resolution,
} from "@/domain/design-rules/program-rules"
import type { Severity } from "@/domain/diagnostics"
import type { FixtureKit } from "@/domain/fixtures/fixture-kit"
import { programLines } from "@/domain/nc/program-lines"
import { programTools } from "@/domain/nc/tool-comments"
import type { NcOrigin } from "@/domain/operations/operation"
import type { Plate } from "@/domain/plate/plate"
import { fail, normalizeText, ok } from "@/domain/primitives"
import type { Result } from "@/domain/primitives"
import { rulesOf } from "@/domain/rules/rules"
import { programSubject } from "@/domain/rules/stages"
import {
  splitParts,
  splitPlan,
  splitProgram,
} from "@/domain/post-processing/split"
import type { SplitMode, SplitPlan } from "@/domain/post-processing/split"
import { carriesPlate } from "@/formats/plate-envelope"
import { programPlate, readProgramText, transferable } from "./import-files"
import type { FileProblem, TransferableOperation } from "./import-files"
import type { ImportContext } from "./import-program"

/**
 * An issue importing asks about: what a machine's rule finds, as the project reports it, with a
 * change to make. What it can change nothing about waits for the design rule check.
 */
export type PlannedIssue = ProgramIssue & {
  /** The rule, as the design rules name it: "Spindle reverse (M4)". */
  readonly label: string
  readonly severity: Severity
}

/**
 * Where a program came from, which its operations keep to be updated from there (`NcOrigin`),
 * without how importing made them of it.
 */
export type ProgramOrigin = Omit<NcOrigin, "part" | "resolutions">

/** A program to import, read: what the machine it is for would not run as written, and its splits. */
export type PlannedProgram = {
  readonly fileName: string
  readonly text: string
  /** Where it came from, for a program that can be updated from there; null for a file. */
  readonly origin: ProgramOrigin | null
  /** What the programs before it in the import leave set, as a CAM exporting one per operation counts on. */
  readonly start: ProgramStart
  readonly issues: readonly PlannedIssue[]
  readonly split: SplitPlan
}

/**
 * How a plan's programs come in: as operations of the plate the user chooses, or as the new NC
 * of an operation they update, as its program comes again.
 */
export type ImportTarget =
  | {
      readonly kind: "plate"
      /**
       * What a new plate for the programs starts as, when the user chooses one: set up as where
       * they came from describes it, as a Fusion 360 program's plate is; null for a plate set
       * up as the workspace sets up new ones.
       */
      readonly newPlate: Plate | null
      /**
       * Whether a tool number the programs do not describe takes the library tool with that
       * post-processor number, as for programs from your own CAM setup. Fusion's numbers do not
       * identify cutters in the library; the tools a program describes fit either way.
       */
      readonly numberedTools: boolean
    }
  | {
      readonly kind: "operation"
      readonly plateId: string
      readonly operationId: string
      /** The part of the program the operation is, as importing split it; null for all of it. */
      readonly part: NcOrigin["part"]
      /** How the operation's issues were resolved before: resolved alike, not asked again. */
      readonly resolutions: Readonly<Record<string, Resolution>>
    }

/** Programs as dropped ones come in: into the plate the user chooses, taking library tools. */
export const CHOSEN_PLATE: ImportTarget = {
  kind: "plate",
  newPlate: null,
  numberedTools: true,
}

/**
 * Files read for importing: programs, with what importing asks about each; plates exported
 * with their setup, which come in whole; and files that cannot be used, which are reported.
 */
export type ImportPlan = {
  readonly programs: readonly PlannedProgram[]
  readonly plates: readonly Plate[]
  readonly problems: readonly FileProblem[]
  readonly target: ImportTarget
}

/** A program's text to import, the name of the file it came as, and where it came from. */
export type ProgramText = {
  readonly fileName: string
  readonly text: string
  readonly origin?: ProgramOrigin
}

/** How a program is imported: whole or split, and each issue resolved as chosen, by rule. */
export type ProgramAnswer = {
  readonly split: SplitMode | null
  readonly resolutions: Readonly<Record<string, Resolution>>
}

/** A program imported as it is: whole, with nothing changed. */
export const AS_IS: ProgramAnswer = { split: null, resolutions: {} }

/**
 * Whether importing has something to ask about a program: an issue, or how to split it, which an
 * update does not ask: the operation it updates is the part of the program it was.
 */
export const asksAbout = (program: PlannedProgram, target: ImportTarget) =>
  program.issues.length > 0 ||
  (target.kind !== "operation" &&
    (program.split.tool.length > 0 || program.split.toolpath.length > 0))

/**
 * What the machine's rules the project reports find in a program, from its start, that they can
 * change: each with its rule's name.
 */
function plannedIssues(
  text: string,
  kit: FixtureKit,
  settings: RuleSettings,
  start: ProgramStart
): PlannedIssue[] {
  return runRules(rulesOf("program"), [programSubject(text, start)], {
    settings,
    machine: kit.id,
  }).flatMap((failure) => {
    const issue = programIssue(failure)
    return suggestedChoice(issue)
      ? [{ ...issue, label: failure.rule.label, severity: failure.severity }]
      : []
  })
}

/**
 * Plans importing programs into a plate of `kit`'s machine, whose program rules the project's
 * settings report (`settings`), as `target` says: into the plate the user chooses, or as the
 * update of an operation. Each program starts with what the ones before it leave set, in their order. An
 * update resolves what was resolved before alike, so it asks only about issues that are new.
 */
export function planPrograms(
  texts: readonly ProgramText[],
  context: ImportContext,
  kit: FixtureKit,
  settings: RuleSettings,
  target: ImportTarget = CHOSEN_PLATE
): ImportPlan {
  const programs: PlannedProgram[] = []
  const plates: Plate[] = []
  const problems: FileProblem[] = []
  let start = FRESH_START
  const resolved = target.kind === "operation" ? target.resolutions : {}
  for (const { fileName, text, origin = null } of texts) {
    // A program that cannot be used as it is imports as nothing, and is said so.
    const plate = programPlate(fileName, text, context)
    if (!plate.ok) {
      problems.push({ fileName, message: plate.error })
      continue
    }
    if (carriesPlate(text)) {
      plates.push(plate.value)
      continue
    }
    programs.push({
      fileName,
      text,
      origin,
      start,
      issues: plannedIssues(text, kit, settings, start).filter(
        (issue) => !Object.hasOwn(resolved, issue.rule)
      ),
      split: splitPlan(text, kit),
    })
    start = programEnd(programLines(text), start)
  }
  return { programs, plates, problems, target }
}

/** Reads files and plans importing them (`planPrograms`); a file that cannot be read is reported. */
export async function planImport(
  files: readonly File[],
  context: ImportContext,
  kit: FixtureKit,
  settings: RuleSettings
): Promise<ImportPlan> {
  const texts: ProgramText[] = []
  const unread: FileProblem[] = []
  for (const file of files) {
    const text = await readProgramText(file)
    if (text.ok) texts.push({ fileName: file.name, text: text.value })
    else unread.push({ fileName: file.name, message: text.error })
  }
  const plan = planPrograms(texts, context, kit, settings)
  return { ...plan, problems: [...unread, ...plan.problems] }
}

/**
 * A new plate for a plan's programs, set up as the first describes (`importProgram`): with the
 * setup kept of the empty plate it replaces, else the stock its CAM's markers describe, else
 * none. Null for a plan without programs, or a first program that cannot be used.
 */
export function describedPlate(
  plan: ImportPlan,
  context: ImportContext
): Plate | null {
  const program = plan.programs.at(0)
  if (!program) return null
  const plate = programPlate(program.fileName, program.text, context)
  return plate.ok ? { ...plate.value, operations: [], tools: [] } : null
}

/** A file's name without its extension: "1002_top_1_Face3_T1". */
const stem = (fileName: string) => fileName.replace(/\.[a-z0-9]+$/i, "")

/**
 * What a program is called, as a plate's name: its Fusion NC program's name, else its file's
 * name without the extension. Empty when nothing printable remains.
 */
export const programName = (
  program: Pick<PlannedProgram, "fileName" | "origin">
) => normalizeText(program.origin?.programName ?? stem(program.fileName))

/** An NC file operation that keeps where its NC came from; any other operation as it is. */
function withOrigin(
  { operation, preferredTools }: TransferableOperation,
  origin: NcOrigin | null
): TransferableOperation {
  const { source } = operation
  if (!origin || source.kind !== "file") return { operation, preferredTools }
  return {
    operation: { ...operation, source: { ...source, origin } },
    preferredTools,
  }
}

/**
 * The operations a program becomes, as answered: its issues resolved, then one operation, or
 * one per part it splits into, named after the file and the part. A program that came from
 * somewhere it can be updated from gives each operation its origin: the program, its part and
 * how its issues were resolved.
 */
export function plannedOperations(
  program: PlannedProgram,
  answer: ProgramAnswer,
  context: ImportContext,
  kit: FixtureKit
): Result<TransferableOperation[]> {
  const text = resolveProgram(
    program.text,
    kit,
    answer.resolutions,
    program.start
  )
  const mode = answer.split
  const parts = mode ? program.split[mode] : []
  const parted = parts.length
    ? { ...context, describedTools: programTools(text, kit.camMarkers) }
    : context
  const programs = parts.length
    ? splitProgram(text, parts).map((nc, index) => ({
        name: `${stem(program.fileName)} · ${parts[index].name}`,
        nc,
        part: mode ? { mode, name: parts[index].name } : null,
      }))
    : [{ name: program.fileName, nc: text, part: null }]
  const operations: TransferableOperation[] = []
  for (const { name, nc, part } of programs) {
    const plate = programPlate(name, nc, parted)
    if (!plate.ok) return fail(plate.error)
    const origin = program.origin
      ? { ...program.origin, part, resolutions: answer.resolutions }
      : null
    operations.push(
      ...transferable(plate.value).map((item) => withOrigin(item, origin))
    )
  }
  return ok(operations)
}

/**
 * The NC an operation gets when it is updated from where it came from: the program with its
 * issues resolved as before and as answered now, then the part of it the operation is, when
 * importing split it. Fails when the program no longer has that part.
 */
export function updatedNc(
  program: PlannedProgram,
  resolutions: Readonly<Record<string, Resolution>>,
  part: NcOrigin["part"],
  kit: FixtureKit
): Result<string> {
  const text = resolveProgram(program.text, kit, resolutions, program.start)
  if (!part) return ok(text)
  const parts = splitParts(text, kit)[part.mode]
  const index = parts.findIndex((item) => item.name === part.name)
  if (index < 0)
    return fail(
      `${program.fileName} no longer has ${part.name}, which this operation is. Import it again instead.`
    )
  return ok(splitProgram(text, parts)[index])
}
