import type { JsonValue } from "@openspindle/plugin-sdk"

/** What the companion's `generate` method returns. */
export type Generation = {
  programs: { name: string; source: string }[]
  warnings: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export function readGeneration(value: JsonValue): Generation {
  if (
    !isRecord(value) ||
    !Array.isArray(value.programs) ||
    !Array.isArray(value.warnings)
  )
    throw new Error("The PCB companion returned an unexpected result.")
  const programs = value.programs.map((program) => {
    if (
      !isRecord(program) ||
      typeof program.name !== "string" ||
      typeof program.source !== "string"
    )
      throw new Error("The PCB companion returned an invalid program.")
    return { name: program.name, source: program.source }
  })
  const warnings = value.warnings.filter(
    (warning): warning is string => typeof warning === "string"
  )
  return { programs, warnings }
}

/** Distinct tool numbers a program selects; words in comments do not count. */
export function generatedToolSlots(source: string): string[] {
  const slots = new Set<number>()
  const words = /\([^)]*\)|;[^\r\n]*|([a-z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi
  for (const match of source.matchAll(words)) {
    const letter = match[1] as string | undefined
    if (letter?.toUpperCase() === "T") slots.add(Number(match[2]))
  }
  return [...slots].sort((a, b) => a - b).map(String)
}

export const multipleToolsMessage = (slots: readonly string[], role: string) =>
  `This file generates multiple tool slots (${slots.map((slot) => `T${slot}`).join(", ")}). PCB operations support one tool.${role === "drill" ? " Choose Mill drill to make every hole with one end mill." : ""}`

/** Generic notices every generation repeats; the editor does not show them. */
const GENERIC_WARNINGS = new Set([
  "Machining values are examples, not a verified tool/material recipe. Confirm work zero, tooling, clearances and depth before Run.",
  "SVGs show pcb2gcode geometry before back-side mirroring. OpenSpindle previews the actual generated CNC coordinates.",
])

/** The warnings worth showing for one generated operation. */
export function operationWarnings(
  warnings: readonly string[],
  context: { role: string; drillSide: unknown; zeroStart: unknown }
): string[] {
  return warnings
    .filter((warning) => !GENERIC_WARNINGS.has(warning))
    .map((warning) => {
      // pcb2gcode says this for every drill-only input. Front drilling with zero-start
      // disabled and no tiling preserves the exported coordinates.
      if (
        context.role === "drill" &&
        context.drillSide === "front" &&
        context.zeroStart === false
      )
        return warning
          .replace(
            "Warning: Board dimensions unknown. Gcode for drilling will be probably misaligned.",
            ""
          )
          .trim()
      return warning
    })
    .filter(Boolean)
}
