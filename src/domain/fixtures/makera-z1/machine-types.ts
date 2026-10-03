/** Machine families supported by fixture compatibility, independent of controller support. */
export const MAKERA_FIXTURE_MACHINE_TYPES = [
  { id: "z1", label: "Z1", models: ["z1", "z1pro"] },
  { id: "carvera", label: "Carvera", models: ["carvera"] },
  { id: "carvera-air", label: "Carvera Air", models: ["carveraair"] },
] as const

/** Legacy bundled Z1 fixtures were saved before compatibility was explicit. */
export function isZ1Fixture(value: {
  id: string
  model: { source: { kind: string; url?: string } } | null
}): boolean {
  return (
    value.id.startsWith("z1-") ||
    (value.model?.source.kind === "bundled" &&
      value.model.source.url?.startsWith("/models/makera-z1-") === true)
  )
}
