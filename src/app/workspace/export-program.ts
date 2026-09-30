import { z } from "zod"
import { compilePlate } from "@/domain/compile/compile"
import { blocking } from "@/domain/diagnostics"
import type { Diagnostic } from "@/domain/diagnostics"
import type { Plate } from "@/domain/plate/plate"
import { fail, ok } from "@/domain/primitives"
import type { Result } from "@/domain/primitives"
import type { Tool } from "@/domain/tools/tool"
import {
  PLATE_ENVELOPE_VERSION,
  PlateEnvelopeSchema,
  bodyChecksum,
  writeEnvelope,
} from "@/formats/plate-envelope"
import type { PlateEnvelope } from "@/formats/plate-envelope"

/**
 * The plate's compiled NC with its setup and editable operations embedded as leading comments.
 * The NC body is exactly what Run would send; the comments never execute.
 *
 * `tools` is the library the plate's table refers to. `diagnostics` are the plate's
 * `plateDiagnostics`, the list that blocks Run: any error in it refuses the export too. Checks
 * against a connected machine do not apply; export has none.
 */
export function exportPlateProgram(
  plate: Plate,
  tools: readonly Tool[],
  diagnostics: readonly Diagnostic[]
): Result<string> {
  const problem = blocking(diagnostics).at(0)
  if (problem) return fail(problem.message)
  const compiled = compilePlate(plate, tools)
  if (compiled.mode === "empty")
    return fail("The plate has no program to export.")
  const body = compiled.program.source
  const payload: PlateEnvelope = {
    schemaVersion: PLATE_ENVELOPE_VERSION,
    name: plate.name,
    setup: plate.setup,
    tools: plate.tools,
    operations: plate.operations,
    groups: plate.groups,
    bodyChecksum: bodyChecksum(body),
  }
  // Checked the same way `encodeProject` checks a project, so an export that could not be
  // imported back is refused rather than written.
  const checked = PlateEnvelopeSchema.safeParse(payload)
  if (!checked.success)
    return fail(
      `Refusing to export an invalid plate: ${z.prettifyError(checked.error)}`
    )
  try {
    return ok(writeEnvelope(body, PLATE_ENVELOPE_VERSION, checked.data))
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Could not export the plate."
    )
  }
}
