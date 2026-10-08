import type { ViewerGhost } from "@/components/workspace/viewer/viewer-input"
import { machineProgram } from "@/app/workspace/machine-program"
import { compileOperation } from "@/domain/compile/compile"
import { parseGCode } from "@/domain/nc/gcode"
import type { GCodeProgram } from "@/domain/nc/gcode"
import type { Operation } from "@/domain/operations/operation"
import { suppressedParts } from "@/domain/operations/toolpath-parts"
import { isSuppressed } from "@/domain/plate/active"
import type { Plate } from "@/domain/plate/plate"
import type { Tool } from "@/domain/tools/tool"

/** Each plate's ghosts, with the library they were drawn with. */
const ghosts = new WeakMap<
  Plate,
  { readonly tools: readonly Tool[]; readonly ghosts: readonly ViewerGhost[] }
>()

/** Each PCB source's whole program, its suppressed parts included, parsed once. */
const wholePrograms = new WeakMap<object, GCodeProgram>()

/** An operation's program with every part, which its suppressed parts are drawn from. */
function wholeProgram(operation: Operation): GCodeProgram | null {
  const { source } = operation
  if (source.kind !== "pcb" || source.nc === null) return null
  let program = wholePrograms.get(source)
  if (!program) {
    program = parseGCode(source.nc, operation.name)
    wholePrograms.set(source, program)
  }
  return program
}

/** The parts an operation leaves out of its toolpath, drawn faint; null for none. */
function partGhost(plate: Plate, operation: Operation): ViewerGhost | null {
  if (!operation.suppressedParts?.length) return null
  const parts = suppressedParts(operation)
  const program = wholeProgram(operation)
  if (!parts?.matched.size || !program) return null
  return {
    operationId: operation.id,
    program: machineProgram(plate, program),
    lines: parts.parts
      .filter((part) => parts.matched.has(part.index))
      .map((part) => ({ start: part.startLine, end: part.endLine })),
  }
}

/**
 * What a plate leaves out of its program, drawn faint where it would be: each suppressed
 * operation's own program as the plate's machine moves through it, and the suppressed parts of
 * the others. Kept per plate object while the library stays the same, so the drawing is built
 * once.
 */
export function plateGhosts(
  plate: Plate,
  tools: readonly Tool[]
): readonly ViewerGhost[] {
  const saved = ghosts.get(plate)
  if (saved?.tools === tools) return saved.ghosts
  const drawn = plate.operations.flatMap((operation): ViewerGhost[] => {
    if (!isSuppressed(operation)) {
      const parts = partGhost(plate, operation)
      return parts ? [parts] : []
    }
    // Every part of it, so its paths' lines are those of its own program.
    const program =
      wholeProgram(operation) ??
      compileOperation(plate, operation, tools).program
    return [
      { operationId: operation.id, program: machineProgram(plate, program) },
    ]
  })
  ghosts.set(plate, { tools, ghosts: drawn })
  return drawn
}
