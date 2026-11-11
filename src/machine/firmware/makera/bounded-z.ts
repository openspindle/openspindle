import {
  ProbeCheckBindingSchema,
  readNcBlock,
  ZProbeSettingsSchema,
} from "../../contract/index.ts"
import type { PreparedProgram } from "../../contract/index.ts"

const n = (value: number) => Number(value.toFixed(4))
const normalize = (line: string) => {
  const block = readNcBlock(line)
  if (block.problem || block.message !== null)
    throw new Error("Invalid bounded Z probing command.")
  return block.words.map((word) => `${word.letter}${word.value}`).join("")
}

export function boundedZRequirement(source: string, program: PreparedProgram) {
  const plans = [...source.matchAll(/^;@OPENSPINDLE_Z_PLAN (.*)$/gm)]
  if (!plans.length) return undefined
  const headers = [...source.matchAll(/^;@OPENSPINDLE_PROBE_CHECK (.*)$/gm)]
  if (
    plans.length !== 1 ||
    headers.length !== 1 ||
    /@OPENSPINDLE_(ANCHOR|DIAMETER)_PLAN/.test(source)
  )
    throw new Error("Include one bounded Z plan and one probe signal check.")
  const binding = ProbeCheckBindingSchema.parse(JSON.parse(headers[0][1]))
  if (![0, 9999].includes(binding.tool))
    throw new Error("Bounded Z probing requires a supported measured probe.")
  const plan = ZProbeSettingsSchema.parse(JSON.parse(plans[0][1]))
  if (plan.travel > 100)
    throw new Error("The Z search cannot exceed the Z1's 100 mm work height.")
  const expected = [
    "M5",
    "G21 G90 G17 G94 G54",
    "M370",
    "M494.1",
    "M400",
    `G38.2 Z-${n(plan.travel)} F30`,
    "G10 L20 P0 Z0",
    "G38.4 Z0.2 F15",
    "G91 G0 Z0.1",
    "M400",
    "G38.2 Z-0.4 F15",
    "G10 L20 P0 Z0",
    "G38.4 Z0.2 F15",
    `G90 G0 Z${n(plan.clearance)}`,
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
      "Recreate this Z probe run with the guide; its protected sequence has changed."
    )
  return binding
}
