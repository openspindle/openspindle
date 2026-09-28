import { inputs } from "../src/manifest.mjs"
import type { InputId } from "../src/manifest.mjs"

/**
 * Suggests roles from literal rules, preserving ambiguous matches: content markers take
 * priority across all inputs, then file name suffixes (case-insensitive).
 */
export function matchInputs(file: {
  name: string
  content: string
}): InputId[] {
  const content = file.content.toLowerCase()
  const byContent = inputs.filter(
    (input) =>
      input.detect.contentIncludesAll.length > 0 &&
      input.detect.contentIncludesAll.every((rule) =>
        content.includes(rule.toLowerCase())
      )
  )
  if (byContent.length) return byContent.map((input) => input.id)
  const name = file.name.toLowerCase()
  return inputs
    .filter((input) =>
      input.detect.suffixes.some((suffix) =>
        name.endsWith(suffix.toLowerCase())
      )
    )
    .map((input) => input.id)
}

/** The extensions the inputs accept: Gerber and Excellon drill files. */
const EXTENSIONS = [
  ...new Set(
    inputs.flatMap((input) =>
      input.accept.split(",").map((extension) => extension.trim().toLowerCase())
    )
  ),
]

/** File choosers offer only the files the inputs accept. */
export const ACCEPT = EXTENSIONS.join(",")

/** Whether a file name ends in an extension one of the inputs accepts. */
export function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase()
  return EXTENSIONS.some((extension) => lower.endsWith(extension))
}

export function roleLabel(role: string): string {
  return inputs.find((input) => input.id === role)?.label ?? "PCB"
}
