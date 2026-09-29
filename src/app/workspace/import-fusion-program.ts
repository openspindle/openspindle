import type { DesignRules } from "@/domain/design-rules/rules"
import { kitForPlate } from "@/domain/fixtures/catalog"
import type { FixtureKit } from "@/domain/fixtures/fixture-kit"
import type { NcOrigin, Operation } from "@/domain/operations/operation"
import { PlateSchema, notice } from "@/domain/plate/plate"
import type { Plate } from "@/domain/plate/plate"
import { fail, ok } from "@/domain/primitives"
import type { Result } from "@/domain/primitives"
import type {
  FusionProgram,
  FusionProgramSummary,
} from "@/platform/contract/fusion"
import { planPrograms } from "./import-plan"
import type { ImportPlan, ProgramOrigin } from "./import-plan"
import { importProgram } from "./import-program"
import type { ImportContext } from "./import-program"

/**
 * The plate a posted Fusion NC program starts, when it goes to a new one: set up as the program
 * describes, named after it and saying where it came from, without its operation or tools,
 * which importing adds: the library tools the program's descriptions of its tools fit.
 */
export function fusionPlate(
  program: FusionProgram,
  context: ImportContext
): Result<Plate> {
  const imported = importProgram(program.fileName, program.contents, {
    ...context,
    tools: [],
  })
  if (!imported.ok) return imported
  const operations = imported.value.operations
  if (
    operations.length !== 1 ||
    operations[0].source.kind !== "file" ||
    operations[0].source.nc !== program.contents
  )
    return fail(
      "The Fusion post must produce plain NC without an OpenSpindle plate envelope."
    )
  const checked = PlateSchema.safeParse({
    ...imported.value,
    name: program.name,
    operations: [],
    tools: [],
    notices: [
      ...imported.value.notices,
      notice(
        `From Fusion 360: ${program.documentName}. Check its cutters, stock and work origin against Fusion before running this program.`
      ),
    ],
  })
  if (!checked.success)
    return fail(checked.error.issues.at(0)?.message ?? "It cannot be used.")
  return ok(checked.data)
}

/** Where a posted Fusion program came from, which its operations keep to be updated from. */
const fusionOrigin = (program: FusionProgram): ProgramOrigin => ({
  kind: "fusion",
  documentId: program.documentId ?? null,
  documentName: program.documentName,
  programId: program.operationId ?? null,
  programName: program.name,
})

/**
 * A posted Fusion NC program, planned for importing as a dropped program is: into the plate the
 * user chooses, the selected one at first, checked against the design rules and offered for
 * splitting. A new plate for it starts as the program describes (`fusionPlate`), and its
 * operations keep where it came from, to be updated from there.
 */
export function planFusionImport(
  program: FusionProgram,
  context: ImportContext,
  kit: FixtureKit,
  rules: DesignRules
): Result<ImportPlan> {
  const plate = fusionPlate(program, context)
  if (!plate.ok) return plate
  return ok(
    planPrograms(
      [
        {
          fileName: program.fileName,
          text: program.contents,
          origin: fusionOrigin(program),
        },
      ],
      { ...context, numberedTools: false },
      kit,
      rules,
      { kind: "plate", newPlate: plate.value, numberedTools: false }
    )
  )
}

/**
 * A posted Fusion NC program, planned for updating an operation imported from it: its issues
 * resolved as they were at import, asking only about new ones, and split as it was.
 */
export function planFusionUpdate(
  program: FusionProgram,
  plate: Plate,
  operation: Operation,
  origin: NcOrigin,
  context: ImportContext,
  rules: DesignRules
): ImportPlan {
  return planPrograms(
    [
      {
        fileName: program.fileName,
        text: program.contents,
        origin: fusionOrigin(program),
      },
    ],
    { ...context, numberedTools: false },
    kitForPlate(plate),
    rules,
    {
      kind: "operation",
      plateId: plate.id,
      operationId: operation.id,
      part: origin.part,
      resolutions: origin.resolutions,
    }
  )
}

/** A document's name without the version Fusion shows after it: "Bracket" for "Bracket v3". */
const unversioned = (name: string) => name.replace(/\s+v\d+$/i, "")

/**
 * The open Fusion program an operation came from: in the document with its lineage id, or its
 * name while an id is unknown, the program with its id there, or else its name. Fails, saying
 * what to open, when Fusion has no such program open or more than one.
 */
export function findFusionProgram(
  programs: readonly FusionProgramSummary[],
  origin: NcOrigin
): Result<FusionProgramSummary> {
  const byId = origin.documentId !== null && programs.some((p) => p.documentId)
  const inDocument = programs.filter((program) =>
    byId
      ? program.documentId === origin.documentId
      : unversioned(program.documentName) === unversioned(origin.documentName)
  )
  const byProgramId =
    origin.programId !== null &&
    inDocument.some((program) => typeof program.operationId === "number")
  const found = inDocument.filter((program) =>
    byProgramId
      ? program.operationId === origin.programId
      : program.name === origin.programName
  )
  if (found.length === 1) return ok(found[0])
  if (found.length > 1)
    return fail(
      `${origin.documentName} has more than one NC program named ${origin.programName}. Rename one in Fusion 360.`
    )
  if (!inDocument.length)
    return fail(
      `Open ${origin.documentName} in Fusion 360 to update this operation from its NC program ${origin.programName}.`
    )
  return fail(
    `${origin.documentName} no longer has the NC program ${origin.programName} in Fusion 360.`
  )
}
