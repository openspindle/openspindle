import { z } from "zod"
import type { FixtureDefinition } from "./definitions"
import {
  isZ1Fixture,
  MAKERA_FIXTURE_MACHINE_TYPES,
} from "./makera-z1/machine-types"

export const FIXTURE_MACHINE_TYPES = MAKERA_FIXTURE_MACHINE_TYPES
export const FixtureMachineTypeSchema = z.enum(["z1", "carvera", "carvera-air"])
export type FixtureMachineType = z.infer<typeof FixtureMachineTypeSchema>
export const FixtureCompatibilitySchema = z.union([
  z.literal("all"),
  z
    .array(FixtureMachineTypeSchema)
    .min(1)
    .max(FIXTURE_MACHINE_TYPES.length)
    .refine(
      (types) => new Set(types).size === types.length,
      "Choose each machine type once."
    ),
])
export type FixtureCompatibility = z.infer<typeof FixtureCompatibilitySchema>

/** Limit for new definitions; migration never discards an existing valid definition. */
export const FIXTURE_CATALOG_LIMIT = 500

export function fixtureMachineType(
  deviceId: string | null
): FixtureMachineType | null {
  if (!deviceId) return null
  const model = deviceId
    .split(":", 1)[0]
    .toLowerCase()
    .replace(/[\s_-]/g, "")
  return (
    FIXTURE_MACHINE_TYPES.find((type) =>
      type.models.some((name) => name === model)
    )?.id ?? null
  )
}

/** Without an assigned machine, all fixtures remain available for preparation. */
export function fixtureCompatible(
  definition: FixtureDefinition,
  deviceId: string | null
): boolean {
  if (
    !deviceId ||
    !definition.compatibility ||
    definition.compatibility === "all"
  )
    return true
  const type = fixtureMachineType(deviceId)
  return type !== null && definition.compatibility.includes(type)
}

/** Existing custom fixtures become global; bundled fixtures retain their machine family. */
export function defaultFixtureCompatibility(
  definition: FixtureDefinition
): FixtureCompatibility {
  return isZ1Fixture(definition) ? ["z1"] : "all"
}

const INSTANCE_DEFAULTS = new Set([
  "id",
  "defaultEnabled",
  "defaultPosition",
  "defaultRotation",
  "compatibility",
])

/** Intrinsic content identifies legacy snapshots even when migration renamed a colliding id. */
export function sameFixtureIdentity(
  left: FixtureDefinition,
  right: FixtureDefinition
): boolean {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable)
    if (!value || typeof value !== "object") return value
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stable(child)])
    )
  }
  const intrinsic = (definition: FixtureDefinition) =>
    stable(
      Object.fromEntries(
        Object.entries(definition).filter(
          ([key]) => !INSTANCE_DEFAULTS.has(key)
        )
      )
    )
  return JSON.stringify(intrinsic(left)) === JSON.stringify(intrinsic(right))
}
