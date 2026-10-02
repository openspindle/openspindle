import type { OutlineParams, OutlineSpecs } from "../tasks/outline/params"
import { planOutline } from "../tasks/outline/plan"
import { roundOutward } from "../../compile/cutting-bounds"
import { issueOf } from "../../diagnostics"
import type { Issue } from "../../diagnostics"
import { formatMillimetres, roundMillimetres } from "../../geometry/millimetres"
import { boxRect } from "../../geometry/rect"
import { EDGE_SIDES, itemEdges } from "../../plate/item-edges"
import type { ItemEdge } from "../../plate/item-edges"
import type { Plate } from "../../plate/plate"
import type { Point3 } from "../../primitives"
import { defaultsOf } from "../parameters"
import { placementContext, resolvePlacement } from "../placement"
import type { PlacementFailure } from "../placement"
import type { BoundProbe, MachineProbing, ProbingMethod } from "../strategy"
import { hasSpecs, specsOf } from "./specs"

const INTRODUCTION = [
  "; Outline trace",
  "; Traces the edges of the plate's work area with the probe's pointer.",
  "; REQUIRE: homed machine, installed probe; work X/Y set to the plate's work origin.",
]
const EDGES_INTRODUCTION = [
  "; Outline trace",
  "; Traces chosen edges of the plate's stock and fixtures with the probe's pointer, in machine",
  "; coordinates from the plate's first anchor, where its setup puts them.",
  "; REQUIRE: homed machine, installed probe; the plate's anchors read from its device.",
]
const PAUSE = [
  "; Check the outline against the stock and fixtures, then Resume or Stop.",
  "M0",
]

/**
 * A probe's pointer the machine cannot switch on traces nothing. Such a machine does not run the
 * trace (`runsOn`), so this only guards its NC.
 */
const NO_POINTER = issueOf<"no-pointer">("error")(
  "no-pointer",
  "This machine cannot switch on a probe's pointer to trace with."
)

const PLACEMENT_FAILURES: Readonly<Record<PlacementFailure, string>> = {
  "anchor-snapshot-missing":
    "Edges are traced from the anchors of the plate's device: read them.",
  "anchor-unavailable": "The plate's anchors have no first anchor.",
  "out-of-range": "An edge lies beyond the supported coordinate range.",
}

const edgeError = issueOf<"edge-placement">("error")

/** Machine X and Y of a bed point: the plate's first anchor plus its X and Y on the bed. */
function onMachine(
  plate: Plate,
  [x, y]: readonly number[]
):
  | { ok: true; xy: [string, string] }
  | { ok: false; issue: Issue<"edge-placement"> } {
  const context = placementContext(plate)
  const first = context.anchorSetup?.anchors[0]
  const start = resolvePlacement(
    {
      kind: "anchor",
      anchorId: first?.id ?? "",
      offset: [roundMillimetres(x), roundMillimetres(y)],
    },
    context
  )
  if (!first || !start.ok)
    return {
      ok: false,
      issue: edgeError(
        "edge-placement",
        PLACEMENT_FAILURES[start.ok ? "anchor-unavailable" : start.error]
      ),
    }
  if (start.value.kind !== "anchor")
    return {
      ok: false,
      issue: edgeError(
        "edge-placement",
        PLACEMENT_FAILURES["anchor-unavailable"]
      ),
    }
  const [mx, my] = start.value.machine
  return {
    ok: true,
    xy: [
      formatMillimetres(roundMillimetres(mx)),
      formatMillimetres(roundMillimetres(my)),
    ],
  }
}

/**
 * The trace of chosen edges, in machine coordinates: the pointer on, up to its machine Z, then
 * each edge from its start, an edge reversed where that continues the one before without a
 * travel, at the trace feed, and a pause to check them if the operation asks for one.
 */
function traceEdges(
  params: OutlineParams,
  edges: readonly ItemEdge[],
  plate: Plate,
  probe: BoundProbe,
  machine: MachineProbing
) {
  const { pointer } = machine.nc
  if (!pointer) return { ok: false as const, issues: [NO_POINTER] }
  const { travelZ, feed, pauseAfterScan } = params
  const same = (a: readonly number[], b: readonly number[]) =>
    Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6
  const moves: string[] = []
  let at: Point3 | null = null
  for (const edge of edges) {
    const reversed: boolean =
      at !== null && !same(edge.start, at) && same(edge.end, at)
    const [from, to]: [Point3, Point3] = reversed
      ? [edge.end, edge.start]
      : [edge.start, edge.end]
    const start = onMachine(plate, from)
    const end = onMachine(plate, to)
    if (!start.ok) return { ok: false as const, issues: [start.issue] }
    if (!end.ok) return { ok: false as const, issues: [end.issue] }
    if (at === null || !same(from, at))
      moves.push(`G53 G0 X${start.xy[0]} Y${start.xy[1]}`)
    moves.push(`G53 G1 X${end.xy[0]} Y${end.xy[1]} F${formatMillimetres(feed)}`)
    at = to
  }
  const lines = [
    ...EDGES_INTRODUCTION,
    `; Edges: ${edges.map((edge) => edge.label).join(", ")}.`,
    ...machine.nc.select(probe),
    ...pointer.on,
    `G53 G0 Z${formatMillimetres(travelZ)}`,
    ...moves,
    ...(pauseAfterScan ? PAUSE : []),
    "M2",
  ]
  return {
    ok: true as const,
    program: { nc: `${lines.join("\n")}\n`, reviewLine: null },
  }
}

/**
 * OpenSpindle's own trace of the plate's toolpath bounds, rounded outwards, with the probe's
 * pointer: the pointer on, up to a machine Z clear of the stock, then the rectangle in work
 * coordinates from its lower-left corner at the trace feed, and a pause to check it if the
 * operation asks for one. Nothing touches, so the job reviews no measurement.
 */
export const GENERIC_TRACE: ProbingMethod<
  "outline",
  OutlineParams,
  OutlineSpecs
> = {
  id: "outline",
  task: "outline",
  strategies: ["outline-trace"],
  description:
    "Traces the plate's work area, or chosen edges of its stock and fixtures, with the probe's pointer.",
  runsOn: (machine) =>
    machine.nc.pointer !== null && hasSpecs(machine, "outline"),
  accepts: (probe) => probe.pointer,
  parameters: (machine) => specsOf(machine, "outline"),
  // A plate without cuts has its stock's outline to trace.
  defaults: (plate, parameters, machining) => ({
    ...defaultsOf(parameters),
    pauseAfterScan: true,
    ...(plate.setup.stock &&
      !machining.toolpath().ok && {
        target: {
          kind: "edges",
          edges: EDGE_SIDES.map((side) => ({ item: { kind: "stock" }, side })),
        },
      }),
  }),
  // The outline is the plate's other operations' toolpath bounds, or its items' edges where its
  // setup puts them, so it never goes stale.
  generate: ({ params, plate, probe, machine, machining }) => {
    const { pointer } = machine.nc
    if (!pointer) return { ok: false, issues: [NO_POINTER] }
    const plan = planOutline(
      params,
      {
        toolpath: () => machining.toolpath(),
        edges: () => itemEdges(plate.setup),
      },
      specsOf(machine, "outline")
    )
    if (!plan.ok) return plan
    if (plan.trace.kind === "edges")
      return traceEdges(plan.params, plan.trace.edges, plate, probe, machine)
    const { travelZ, feed, pauseAfterScan } = plan.params
    const { min, max } = boxRect<"work">(roundOutward(plan.trace.bounds))
    const [x0, y0, x1, y1] = [min[0], min[1], max[0], max[1]].map(
      formatMillimetres
    )
    const lines = [
      ...INTRODUCTION,
      `; Outline: X${x0} to X${x1}, Y${y0} to Y${y1} in work coordinates.`,
      ...machine.nc.select(probe),
      ...pointer.on,
      `G53 G0 Z${formatMillimetres(travelZ)}`,
      `G0 X${x0} Y${y0}`,
      `G1 X${x0} Y${y1} F${formatMillimetres(feed)}`,
      `G1 X${x1} Y${y1}`,
      `G1 X${x1} Y${y0}`,
      `G1 X${x0} Y${y0}`,
      ...(pauseAfterScan ? PAUSE : []),
      "M2",
    ]
    return {
      ok: true,
      program: { nc: `${lines.join("\n")}\n`, reviewLine: null },
    }
  },
}
