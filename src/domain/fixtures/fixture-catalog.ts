import type { FixtureDefinition } from "./definitions"
import {
  defaultFixtureCompatibility,
  sameFixtureIdentity,
} from "./compatibility"

const PLACEMENT_FIELDS = new Set([
  "id",
  "defaultEnabled",
  "defaultPosition",
  "defaultRotation",
  "compatibility",
])

/** Stable content comparison, including unknown fields that decoding must still report. */
export function fixtureContentKey(value: unknown): string {
  const sorted = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sorted)
    if (!item || typeof item !== "object") return item
    return Object.fromEntries(
      Object.entries(item)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sorted(child)])
    )
  }
  const intrinsic =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).filter(([key]) => !PLACEMENT_FIELDS.has(key))
        )
      : value
  return JSON.stringify(sorted(intrinsic))
}

/** A deterministic id for differing legacy definitions that shared an id. */
export function fixtureVariantId(id: string, content: string): string {
  let first = 2166136261
  let second = 5381
  for (let index = 0; index < content.length; index++) {
    const code = content.charCodeAt(index)
    first = Math.imul(first ^ code, 16777619)
    second = Math.imul(second, 33) ^ code
  }
  const digest = `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`
  return `${id.slice(0, 170)}-variant-${digest}`
}

/** One fixture's portable snapshots and collision variants, excluding unrelated duplicate ids. */
export function sameFixtureFamily(
  left: FixtureDefinition,
  right: FixtureDefinition
): boolean {
  if (!sameFixtureIdentity(left, right)) return false
  if (left.id === right.id) return true
  const variantOf = (id: string, source: FixtureDefinition) => {
    const variant = fixtureVariantId(source.id, fixtureContentKey(source))
    return (
      id === variant ||
      (id.startsWith(`${variant}-`) &&
        /^\d+$/.test(id.slice(variant.length + 1)))
    )
  }
  return variantOf(left.id, right) || variantOf(right.id, left)
}

/** Interns portable snapshots without overwriting an existing, differently edited fixture. */
export function internFixtureDefinitions(
  existing: readonly FixtureDefinition[],
  incoming: readonly FixtureDefinition[]
): { definitions: FixtureDefinition[]; ids: ReadonlyMap<string, string> } {
  const definitions = [...existing]
  const ids = new Map<string, string>()
  for (const source of incoming) {
    const sameId = definitions.find((item) => item.id === source.id)
    const variant = fixtureVariantId(source.id, fixtureContentKey(source))
    const held = definitions.find(
      (item) =>
        (item.id === source.id ||
          item.id === variant ||
          item.id.startsWith(`${variant}-`)) &&
        sameFixtureIdentity(item, source)
    )
    if (held) {
      ids.set(source.id, held.id)
      continue
    }
    let id = source.id
    if (sameId) {
      id = variant
      let count = 2
      while (definitions.some((item) => item.id === id))
        id = `${variant}-${count++}`
    }
    definitions.push({
      ...source,
      id,
      compatibility:
        source.compatibility ?? defaultFixtureCompatibility(source),
    })
    ids.set(source.id, id)
  }
  return { definitions, ids }
}
