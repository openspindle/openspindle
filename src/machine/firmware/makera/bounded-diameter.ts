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

const n = (value: number) => Number(value.toFixed(4))
const limit = ProbeSearchTravelSchema
const schema = z.strictObject({
  gap: ProbeTopGapSchema,
  width: z.number().finite().min(2).max(100),
  distance: z.number().finite().min(2).max(100),
  depth: z.number().finite().min(0.5).max(10),
  diameter: z.number().finite().min(0.5).max(3.2),
  maxTravel: z.tuple([limit, limit, limit]),
})
const normalized = (line: string) => {
  const block = readNcBlock(line)
  if (block.problem || block.message !== null)
    throw new Error("Only canonical bounded calibration commands are accepted.")
  return block.words.map((word) => `${word.letter}${word.value}`).join("")
}
/** Independently validates exact ordered commands; does not admit arbitrary raw G38 programs. */
export function boundedDiameterRequirement(
  source: string,
  program: PreparedProgram
): ProbeCheckBinding | undefined {
  const headers = [...source.matchAll(/^;@OPENSPINDLE_PROBE_CHECK (.*)$/gm)]
  const plans = [...source.matchAll(/^;@OPENSPINDLE_DIAMETER_PLAN (.*)$/gm)]
  if (!plans.length) return undefined
  if (
    headers.length !== 1 ||
    plans.length !== 1 ||
    /@OPENSPINDLE_ANCHOR_PLAN/.test(source)
  )
    throw new Error(
      "Include exactly one probe check and one bounded diameter plan."
    )
  const binding = ProbeCheckBindingSchema.parse(JSON.parse(headers[0][1]))
  const plan = schema.parse(JSON.parse(plans[0][1]))
  const { width, distance, depth, diameter, maxTravel, gap } = plan
  const sideGap = distance - width / 2 - diameter / 2
  if (
    binding.tool !== 9999 ||
    distance <= width / 2 + diameter / 2 + 1 ||
    depth < diameter + 0.25 ||
    maxTravel[2] <= gap ||
    maxTravel.slice(0, 2).some((value) => value <= sideGap || value >= distance)
  )
    throw new Error(
      "Invalid bounded Boss-X geometry, measured probe or search limits. Recreate the reading with the guide."
    )
  const expected = [
    "M5",
    "G21 G90 G17 G94 G54",
    "M370",
    "M494.1",
    "M400",
    `G38.2 Z-${n(maxTravel[2])} F30`,
    "G10 L20 P0 Z0",
    "G38.4 Z0.2 F15",
    "G91 G0 Z0.1",
    "M400",
    "G38.2 Z-0.4 F15",
    "G10 L20 P0 Z0",
    "G10 L20 P0 X0",
    "G38.4 Z0.2 F15",
    "G90 G0 Z5",
    "M400",
    `G90 G0 X-${n(distance)}`,
    "M400",
    `G90 G1 Z-${n(depth)} F30`,
    "M400",
    `G38.2 X${n(maxTravel[0])} F30`,
    "G38.4 X-0.2 F15",
    "G91 G0 X-0.1",
    "M400",
    "G38.2 X0.4 F15",
    "G38.4 X-0.2 F15",
    "G91 G0 X-0.1",
    "G90 G0 Z5",
    "M400",
    `G90 G0 X${n(distance)}`,
    "M400",
    `G90 G1 Z-${n(depth)} F30`,
    "M400",
    `G38.2 X-${n(maxTravel[1])} F30`,
    "G38.4 X0.2 F15",
    "G91 G0 X0.1",
    "M400",
    "G38.2 X-0.4 F15",
    "G38.4 X0.2 F15",
    "G91 G0 X0.1",
    "G90 G0 Z5",
    "M400",
    "G90 G0 X0",
    "M400",
    "M5",
    "M2",
  ].map(normalized)
  const actual = program.text.split("\n").map(normalized).filter(Boolean)
  if (
    program.parts.length > 1 ||
    actual.length !== expected.length ||
    actual.some((line, index) => line !== expected[index])
  )
    throw new Error(
      "This program differs from the reviewed bounded diameter sequence. Recreate it with the guide."
    )
  return binding
}
