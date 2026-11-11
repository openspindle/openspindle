import { z } from "zod"
import {
  ProbeCheckBindingSchema,
  ProbeSearchTravelSchema,
  ProbeTopGapSchema,
  readNcBlock,
} from "../../contract/index.ts"
import type {
  PreparedProgram,
  ProbeCheckBinding,
} from "../../contract/index.ts"

const planSchema = z.strictObject({
  gap: ProbeTopGapSchema,
  diameter: z.number().finite().min(0.5).max(3.2),
  maxTravel: z.tuple([
    ProbeSearchTravelSchema,
    ProbeSearchTravelSchema,
    ProbeSearchTravelSchema,
  ]),
})
const n = (value: number) => Number(value.toFixed(4))
const normalized = (line: string) => {
  const block = readNcBlock(line)
  if (block.problem || block.message !== null)
    throw new Error("Only canonical bounded calibration commands are accepted.")
  return block.words.map((word) => `${word.letter}${word.value}`).join("")
}

/** Exact small routine, not a general allow-list of commands that can be rearranged unsafely. */
export function boundedAnchorRequirement(
  source: string,
  program: PreparedProgram
): ProbeCheckBinding | undefined {
  const header = [...source.matchAll(/^;@OPENSPINDLE_PROBE_CHECK (.*)$/gm)]
  const plans = [...source.matchAll(/^;@OPENSPINDLE_ANCHOR_PLAN (.*)$/gm)]
  if (!header.length && !plans.length) return undefined
  if (header.length !== 1 || plans.length !== 1)
    throw new Error("Include one probe check and one bounded anchor plan.")
  const binding = ProbeCheckBindingSchema.parse(JSON.parse(header[0][1]))
  if (binding.tool !== 9999)
    throw new Error("Bounded Anchor 1 requires the selected 3D probe.")
  const plan = planSchema.parse(JSON.parse(plans[0][1]))
  if (plan.maxTravel[2] <= plan.gap)
    throw new Error(
      "Maximum downward search must exceed the estimated top gap. Recreate the calibration with the guide."
    )
  const radius = n(plan.diameter / 2)
  const depth = n(Math.max(2, radius + 0.5))
  const expected = [
    "M5",
    "G21G90G17G94G54",
    "M370",
    "M494.1",
    "M400",
    `G38.2Z-${n(plan.maxTravel[2])}F30`,
    "G10L20P0Z0",
    "G38.4Z0.2F15",
    "G91G0Z0.1",
    "M400",
    "G38.2Z-0.4F15",
    "G10L20P0Z0",
    "G38.4Z0.2F15",
    "G90G0Z5",
    "M400",
    "G91G0X10Y10",
    "M400",
    `G90G1Z-${depth}F30`,
    "M400",
    `G38.2X-${n(plan.maxTravel[0])}F30`,
    "G38.4X0.2F15",
    "G91G0X2",
    "M400",
    "G38.2X-2.4F15",
    `G10L20P0X${radius}`,
    "G38.4X0.2F15",
    "G91G0X2",
    "G90G0X5",
    "M400",
    `G38.2Y-${n(plan.maxTravel[1])}F30`,
    "G38.4Y0.2F15",
    "G91G0Y2",
    "M400",
    "G38.2Y-2.4F15",
    `G10L20P0Y${radius}`,
    "G38.4Y0.2F15",
    "G91G0Y2",
    "M400",
    "G90G0Z5",
    "M400",
    "M5",
    "M2",
  ].map(normalized)
  const actual = program.text.split("\n").map(normalized).filter(Boolean)
  if (
    actual.length !== expected.length ||
    actual.some((line, index) => line !== expected[index]) ||
    program.parts.length > 1
  )
    throw new Error(
      "This calibration differs from the reviewed bounded Anchor 1 sequence. Recreate it with the guide."
    )
  return binding
}
