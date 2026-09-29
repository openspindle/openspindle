import { PlateSchema, notice } from "@/domain/plate/plate"
import { fail, ok } from "@/domain/primitives"
import type { FusionProgram } from "@/platform/contract/fusion"
import { importProgram } from "./import-program"
import type { ImportContext } from "./import-program"

/** A posted Fusion NC program imports as a complete program on its own plate. */
export function importFusionProgram(
  program: FusionProgram,
  context: ImportContext
) {
  // Fusion tool numbers do not identify physical cutters in the local library.
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
    tools: imported.value.tools.map((tool) => ({ ...tool, toolId: null })),
    notices: [
      ...imported.value.notices,
      notice(
        `From Fusion 360: ${program.documentName}. Assign the cutters used in Fusion and check the stock and work origin before running this program.`
      ),
    ],
  })
  if (!checked.success)
    return fail(checked.error.issues.at(0)?.message ?? "It cannot be used.")
  return ok(checked.data)
}
