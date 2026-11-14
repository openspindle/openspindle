import {
  ProbeCheckBindingSchema,
  ProbeMovePlanSchema,
  readNcBlock,
} from "../../contract/index.ts"
import type { PreparedProgram } from "../../contract/index.ts"

const n = (value: number) => Number(value.toFixed(4))
const normalize = (line: string) => {
  const block = readNcBlock(line)
  if (block.problem || block.message !== null)
    throw new Error("Invalid protected probe move.")
  return block.words.map((word) => `${word.letter}${word.value}`).join("")
}

/** Independent exact-sequence assessment. No general-purpose G38.3 execution is admitted. */
export function boundedMoveRequirement(
  source: string,
  program: PreparedProgram
) {
  const headers = [...source.matchAll(/^;@OPENSPINDLE_PROBE_CHECK (.*)$/gm)]
  const plans = [...source.matchAll(/^;@OPENSPINDLE_MOVE_PLAN (.*)$/gm)]
  if (!plans.length) return undefined
  if (
    headers.length !== 1 ||
    plans.length !== 1 ||
    /@OPENSPINDLE_(ANCHOR|DIAMETER|Z)_PLAN/.test(source)
  )
    throw new Error(
      "Use one protected probe positioning plan and its signal check."
    )
  const binding = ProbeCheckBindingSchema.parse(JSON.parse(headers[0][1]))
  const plan = ProbeMovePlanSchema.parse(JSON.parse(plans[0][1]))
  if (![0, 9999].includes(binding.tool))
    throw new Error("Positioning requires a measured probe.")
  if (
    plan.target[2] < -102 ||
    plan.target[2] > -1 ||
    plan.feed.some((feed, axis) => feed > [4000, 4000, 2000][axis]) ||
    plan.target.some(
      (value, axis) =>
        Math.abs(value - binding.position[axis]) > [220, 220, 105][axis]
    ) ||
    plan.target.slice(0, 2).some((value) => value < -250 || value > 0)
  )
    throw new Error(
      "The probe positioning target or speed exceeds the Z1 envelope."
    )
  if (
    plan.mode === "xy" &&
    plan.target[2] !== Math.max(-3, binding.position[2])
  )
    throw new Error(
      "XY positioning must first retract to machine Z −3 and never lower Z."
    )
  if (plan.mode === "z" && plan.feed[2] > 400)
    throw new Error(
      "Z approach is limited to 20 percent of the Z1 axis maximum."
    )
  if (
    plan.mode === "z" &&
    (Math.abs(plan.target[0] - binding.position[0]) > 0.001 ||
      Math.abs(plan.target[1] - binding.position[1]) > 0.001)
  )
    throw new Error("Z positioning cannot move X or Y.")
  const axes = plan.mode === "xy" ? [2, 0, 1] : [2]
  const moves = axes.flatMap((axis) => {
    const delta = n(plan.target[axis] - binding.position[axis])
    return Math.abs(delta) < 0.001
      ? []
      : [
          `G38.3 ${["X", "Y", "Z"][axis]}${delta} F${n(plan.feed[axis])}`,
          "M400",
        ]
  })
  const expected = [
    "M5",
    "G21 G90 G17 G94",
    "M370",
    "M400",
    ...moves,
    "M5",
    "M2",
  ].map(normalize)
  const actual = program.text.split("\n").map(normalize).filter(Boolean)
  if (
    !moves.length ||
    program.parts.length > 1 ||
    actual.length !== expected.length ||
    actual.some((line, index) => line !== expected[index])
  )
    throw new Error(
      "Recreate this positioning run from the reviewed point; its protected sequence changed."
    )
  return binding
}
