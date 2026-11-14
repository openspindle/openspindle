import { z } from "zod"
import { createPlate } from "../plate/plate"
import type { Plate } from "../plate/plate"
import type { Operation, ProbingSource } from "../operations/operation"
import type { Tool } from "../tools/tool"
import { newId } from "../primitives"
import {
  anchorPlacementAt,
  placementAnchors,
  placementContext,
} from "./placement"
import {
  methodSpecs,
  newProbingOperation,
  reportsProbingMeasurements,
  strategyById,
} from "./strategies"
import type { MachineProbing } from "./strategy"
import { originParamsSchema } from "./tasks/origin/params"
import { GridParamsSchema } from "./tasks/grid/params"
import { rangedSchema } from "./parameters"
import { plateWorkArea } from "../compile/toolpath-bounds"
import { planOrigin } from "./tasks/origin/plan"
import { planGrid } from "./tasks/grid/plan"

export const INSPECTION_RECIPES = [
  {
    id: "stock",
    label: "Stock inspection",
    strategy: "boss-center",
    description: "Measure opposed stock sides, center and top.",
  },
  {
    id: "features",
    label: "Feature spacing",
    strategy: "pocket-center",
    description: "Measure two pockets or bores and compare their centers.",
  },
  {
    id: "surface",
    label: "Surface inspection",
    strategy: "height-map",
    description: "Measure a height grid and sampled surface flatness.",
  },
  {
    id: "repeatability",
    label: "Repeatability",
    strategy: "pocket-center",
    description:
      "Repeat an anchored pocket measurement and summarize its variation.",
  },
] as const

export type InspectionRecipe = (typeof INSPECTION_RECIPES)[number]["id"]
export const RepeatCountSchema = z.int().min(2).max(10)

/** A separate plate: no cutters or operations from the donor are copied. */
export function inspectionPlate(donor: Plate, recipe: InspectionRecipe): Plate {
  const plate = createPlate(structuredClone(donor.setup))
  plate.name = INSPECTION_RECIPES.find((item) => item.id === recipe)!.label
  const anchors = placementAnchors(plate.setup)
  if (!anchors.some((anchor) => anchor.id === plate.setup.workOriginAnchor))
    plate.setup.workOriginAnchor = anchors.at(0)?.id ?? null
  return plate
}

export function inspectionOperations(
  plate: Plate,
  recipe: InspectionRecipe,
  tool: Tool,
  machine: MachineProbing
): Operation[] {
  const definition = INSPECTION_RECIPES.find((item) => item.id === recipe)!
  const strategy = strategyById(definition.strategy)!
  const count = recipe === "features" ? 2 : 1
  const anchors = placementAnchors(plate.setup)
  return Array.from({ length: count }, (_, index) => {
    const { operation } = newProbingOperation(plate, tool, strategy, machine)
    const source = operation.source
    if (
      source.kind !== "probing" ||
      (source.task !== "origin" && source.task !== "grid")
    )
      return operation
    // Starts are bed points; convert them to the plate's stored anchor frame.
    let point: [number, number] = [
      plate.setup.workOrigin[0] + index * 20,
      plate.setup.workOrigin[1],
    ]
    const area = plateWorkArea(plate)
    if (recipe === "stock" && area.ok)
      point = [
        (area.area.min[0] + area.area.max[0]) / 2,
        (area.area.min[1] + area.area.max[1]) / 2,
      ]
    if (source.task === "grid" && source.params.placement.kind === "anchor")
      return operation
    const placement = anchorPlacementAt(
      point,
      anchors,
      source.params.placement,
      null
    )
    if (placement) {
      if (source.task === "origin" && source.params.routine === "pocket-center")
        placement.height = plate.setup.workOrigin[2] - 2
      source.params.placement = placement
    }
    operation.name = count > 1 ? `Feature ${index + 1}` : definition.label
    return operation
  })
}

/** Require repeatable machine-coordinate starts and a route that returns measurements. */
export function inspectionOperationProblem(
  source: ProbingSource,
  plate: Plate,
  machine: MachineProbing
): string | null {
  if (source.task !== "origin" && source.task !== "grid")
    return "This is not an inspection routine."
  if (source.params.placement.kind !== "anchor")
    return "Select a stored anchor for every inspection start."
  if (source.task === "origin") {
    const specs = methodSpecs(source, machine, plate)
    if (!specs || !originParamsSchema(specs).safeParse(source.params).success)
      return "Correct the probing parameters."
    if (!planOrigin(source.params, placementContext(plate), specs).ok)
      return "Check the stored anchor, start height and probing search limits."
    if (
      source.params.routine === "boss-center" &&
      source.params.placement.height !== undefined
    )
      return "Leave the boss start height empty: it must search from travel height after each changed work zero."
    if (
      source.params.routine === "pocket-center" &&
      source.params.placement.height === undefined
    )
      return "Set the pocket start height below its rim."
  } else {
    const specs = methodSpecs(source, machine, plate)
    if (
      !specs ||
      !rangedSchema(GridParamsSchema, specs).safeParse(source.params).success
    )
      return "Correct the grid parameters."
    if (!planGrid(source.params, placementContext(plate), specs).ok)
      return "Check the stored anchor and grid limits."
  }
  if (!reportsProbingMeasurements(source, machine, plate))
    return "This start cannot return inspection measurements; check the stored anchor and work origin."
  return null
}

/** Repetitions have distinct operation identities, but exactly the same parameters and probe. */
export function repeatInspection(
  operation: Operation,
  count: number
): Operation[] {
  const repetitions = RepeatCountSchema.parse(count)
  return Array.from({ length: repetitions }, (_, index) => ({
    ...structuredClone(operation),
    id: newId(),
    name: `Repeat ${index + 1}`,
  }))
}
