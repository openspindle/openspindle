import type { GridPlan, GridProbing, ProbeProgram } from "../probing/probe"
import { roundMillimetres } from "../geometry/millimetres"
import type { AutoLevelParams } from "./params"
import type { ProbeGrid, ProbePoint } from "./probe-grid"
import { planAutoLevel } from "./rules"
import type { AutoLevelIssue } from "./issues"
import type { PlacementContext } from "../probing/placement"

/** The NC from the machine's probe, and the grid it probes. */
export type AutoLevelProgram = ProbeProgram & {
  /** Planned samples for the viewer; `sourceLine` is the probing line in `nc`. */
  readonly grid: ProbeGrid
}

export type AutoLevelGeneration =
  | { ok: true; program: AutoLevelProgram }
  | { ok: false; issues: AutoLevelIssue[] }

/**
 * Renders an already planned program with the machine's probe; generateAutoLevelNc validates
 * its parameters first.
 */
export function renderAutoLevelProgram(
  plan: GridPlan,
  probing: GridProbing
): AutoLevelProgram {
  const { params, start } = plan
  const program = probing.program(plan)
  // The grid holds the values the NC words carry, as the firmware and the NC preview read them.
  const [x, y] = start.kind === "anchor" ? start.machine : [0, 0]
  const origin: ProbePoint = [roundMillimetres(x), roundMillimetres(y)]
  const width = roundMillimetres(params.size[0])
  const depth = roundMillimetres(params.size[1])
  const [columns, rows] = params.points
  return {
    ...program,
    grid: {
      sourceLine: program.probeLine,
      start: origin,
      width,
      depth,
      columns,
      rows,
      pointCount: columns * rows,
      points: probing.samples({ start: origin, width, depth, columns, rows }),
      clearanceMm: roundMillimetres(params.clearance),
      coordinateMode:
        start.kind === "anchor" ? "machine" : "relative-to-probe-start",
    },
  }
}

/** The complete probing NC of an auto-level operation, from its parameters and the machine's probe. */
export function generateAutoLevelNc(
  params: AutoLevelParams,
  context: PlacementContext,
  probing: GridProbing
): AutoLevelGeneration {
  const plan = planAutoLevel(params, context, probing.parameters)
  if (!plan.ok) return plan
  return {
    ok: true,
    program: renderAutoLevelProgram(
      { params: plan.params, start: plan.start },
      probing
    ),
  }
}
