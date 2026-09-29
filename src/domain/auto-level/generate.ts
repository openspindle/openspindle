import type { GridProbing } from "../probing/probe"
import { roundMillimetres } from "./params"
import type { AutoLevelGridField, AutoLevelParams } from "./params"
import type { ProbeGrid, ProbePoint } from "./probe-grid"
import { planAutoLevel } from "./rules"
import type { ProbeStart } from "./rules"
import type { AutoLevelIssue } from "./issues"
import type { PlacementContext } from "../probing/placement"

export type AutoLevelProgram = {
  /** Newline-terminated NC from the machine's probe. */
  nc: string
  /** Planned samples for the viewer; `sourceLine` is the probing line in `nc`. */
  grid: ProbeGrid
  /** One-based line of the review pause in `nc`; null when the job does not pause for review. */
  reviewPauseLine: number | null
}

export type AutoLevelGeneration =
  | { ok: true; program: AutoLevelProgram }
  | { ok: false; issues: AutoLevelIssue[] }

type GridSize = Pick<AutoLevelParams, AutoLevelGridField>

/**
 * Renders an already planned program with the machine's probe; generateAutoLevelNc validates
 * its parameters first.
 */
export function renderAutoLevelProgram(
  size: GridSize,
  start: ProbeStart,
  reviewAfterProbe: boolean,
  probing: GridProbing
): AutoLevelProgram {
  const text = probing.program(size, start, reviewAfterProbe)
  // The grid holds the values the NC words carry, as the firmware and the NC preview read them.
  const [x, y] = start.kind === "machine" ? start.target : start.offset
  const origin: ProbePoint = [roundMillimetres(x), roundMillimetres(y)]
  const width = roundMillimetres(size.width)
  const depth = roundMillimetres(size.depth)
  const { columns, rows } = size
  return {
    nc: text.nc,
    reviewPauseLine: text.reviewPauseLine,
    grid: {
      sourceLine: text.probeLine,
      start: origin,
      width,
      depth,
      columns,
      rows,
      pointCount: columns * rows,
      points: probing.samples({ start: origin, width, depth, columns, rows }),
      clearanceMm: roundMillimetres(size.clearance),
      coordinateMode:
        start.kind === "machine" ? "machine" : "relative-to-probe-start",
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
      plan.params,
      plan.start,
      plan.params.reviewAfterProbe,
      probing
    ),
  }
}
