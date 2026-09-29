/** Where a glossary entry is listed: what its code is for. */
export type NcGlossaryGroup =
  | "motion"
  | "plane-units"
  | "coordinates"
  | "spindle-tool"
  | "probing"
  | "accessories"
  | "program"
  | "settings"
  | "words"

export const NC_GLOSSARY_GROUPS: Record<NcGlossaryGroup, string> = {
  motion: "Motion",
  "plane-units": "Planes, units and modes",
  coordinates: "Coordinates and offsets",
  "spindle-tool": "Spindle and tools",
  probing: "Probing",
  accessories: "Accessories",
  program: "Program flow",
  settings: "Machine settings",
  words: "Words",
}

/**
 * A code of a machine's NC, as its glossary lists it: what the machine does with it, and a
 * block that uses it, which tells whether operations that contain it combine.
 */
export type NcGlossaryEntry = {
  /** The code as programs write it: "G38.2", "M851", or a word's letter. */
  readonly code: string
  readonly name: string
  readonly description: string
  /** The words it takes, space separated: "X Y Z F". */
  readonly words: string
  /** One block that uses it, as a CAM program writes it. */
  readonly example: string
  readonly group: NcGlossaryGroup
  /** Whether the machine acts on it, accepts it to no effect, or does not know it. */
  readonly machine: "runs" | "ignored" | "unsupported"
}
