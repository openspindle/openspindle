import type { GridPlan, GridProbing, ProbeProgram } from "../probing/probe"
import { roundMillimetres } from "../geometry/millimetres"
import type { Vec2, XY } from "../geometry/frame"
import { PROBE_START } from "../probing/preview"
import type { ProbeAt, ProbeGrid } from "../probing/preview"
import type { AutoLevelParams } from "./params"
import { planAutoLevel } from "./rules"
import type { AutoLevelIssue } from "./issues"
import type { PlacementContext } from "../probing/placement"

/** The NC from the machine's probe, and the grid it probes. */
export type AutoLevelProgram = ProbeProgram & {
  /** Planned samples for the viewer; `sourceLine` is the probing line in `nc`. */
  readonly grid: ProbeGrid<"probe" | "machine">
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
  const from: ProbeAt<"probe" | "machine"> =
    start.kind === "anchor"
      ? { frame: "machine", at: start.machine }
      : PROBE_START
  return {
    ...program,
    grid: plannedGrid(from, params, probing, program.probeLine),
  }
}

/**
 * The grid a plan probes from where the probe starts, in that frame. It holds the values the NC
 * words carry, as the firmware and the NC preview read them.
 */
function plannedGrid<TFrame extends "probe" | "machine">(
  { frame, at }: ProbeAt<TFrame>,
  params: GridPlan["params"],
  probing: GridProbing,
  sourceLine: number
): ProbeGrid<TFrame> {
  const start: XY<TFrame> = [roundMillimetres(at[0]), roundMillimetres(at[1])]
  const size: Vec2 = [
    roundMillimetres(params.size[0]),
    roundMillimetres(params.size[1]),
  ]
  return {
    sourceLine,
    frame,
    start,
    size,
    points: params.points,
    samples: probing.samples(start, size, params.points),
    clearance: roundMillimetres(params.clearance),
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
