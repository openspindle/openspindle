import {
  PointZProbePlanSchema,
  ProbeCheckBindingSchema,
  readNcBlock,
} from "../../contract/index.ts"
import type { PreparedProgram } from "../../contract/index.ts"

const n = (value: number) => Number(value.toFixed(4))
const normalize = (line: string) => {
  const block = readNcBlock(line)
  if (block.problem || block.message !== null)
    throw new Error("Invalid protected point Z command.")
  return block.words.map((word) => `${word.letter}${word.value}`).join("")
}

/** Independent admission of one exact retract/XY/contact sequence. */
export function boundedPointZRequirement(
  source: string,
  program: PreparedProgram
) {
  const plans = [...source.matchAll(/^;@OPENSPINDLE_POINT_Z_PLAN (.*)$/gm)]
  if (!plans.length) return undefined
  const headers = [...source.matchAll(/^;@OPENSPINDLE_PROBE_CHECK (.*)$/gm)]
  if (
    plans.length !== 1 ||
    headers.length !== 1 ||
    /@OPENSPINDLE_(ANCHOR|DIAMETER|MOVE|Z)_PLAN/.test(source)
  )
    throw new Error(
      "Use one reviewed point Z plan with its original signal check."
    )
  const binding = ProbeCheckBindingSchema.parse(JSON.parse(headers[0][1]))
  const plan = PointZProbePlanSchema.parse(JSON.parse(plans[0][1]))
  const { target, feed, settings } = plan
  if (
    ![0, 9999].includes(binding.tool) ||
    settings.travel > 100 ||
    feed.some((value, axis) => value > [4000, 4000, 2000][axis]) ||
    target.some(
      (value, axis) =>
        value < -250 ||
        value > -1 ||
        Math.abs(value - binding.position[axis]) > 220
    )
  )
    throw new Error(
      "The point Z approach or search exceeds the Z1 envelope. Review the model registration, start height and search distance."
    )
  const start = [...binding.position]
  const moves: string[] = []
  const move = (axis: number, end: number, rate: number) => {
    const delta = n(end - start[axis])
    if (Math.abs(delta) >= 0.001)
      moves.push(`G38.3 ${["X", "Y", "Z"][axis]}${delta} F${n(rate)}`, "M400")
    start[axis] = end
  }
  move(2, Math.max(-3, start[2]), feed[2])
  move(0, target[0], feed[0])
  move(1, target[1], feed[1])
  const expected = [
    "M5",
    "G21 G90 G17 G94 G54",
    "M370",
    "M494.1",
    "M400",
    ...moves,
    `G38.2 Z-${n(settings.travel)} F30`,
    "G10 L20 P0 Z0",
    "G38.4 Z0.2 F15",
    "G91 G0 Z0.1",
    "M400",
    "G38.2 Z-0.4 F15",
    "G10 L20 P0 Z0",
    "G38.4 Z0.2 F15",
    `G90 G0 Z${n(settings.clearance)}`,
    "M400",
    "M494.2",
    "M5",
    "M2",
  ].map(normalize)
  const actual = program.text.split("\n").map(normalize).filter(Boolean)
  if (
    program.parts.length > 1 ||
    actual.length !== expected.length ||
    actual.some((line, index) => line !== expected[index])
  )
    throw new Error(
      "This point Z sequence changed. Recreate it from the picked point before running."
    )
  return { probeCheck: binding, probeDownToLimit: true }
}
