import {
  DEFAULT_KIT,
  FIXTURE_KITS,
  kitForDeviceId,
} from "@/domain/fixtures/catalog"
import { WORKSPACE_PROFILE } from "@/domain/fixtures/profiles"
import {
  fixtureContentKey,
  fixtureVariantId,
} from "@/domain/fixtures/fixture-catalog"
import { isJsonObject } from "./json"
import type { JsonObject } from "./json"

/**
 * Version 3's copied bed definitions become global records and bed placements. Equal fixture
 * content shares one record; differing copies keep their names and model ids under stable ids.
 * Unknown data is retained for the reader to report, rather than silently discarded here.
 */
export function upgradeFixtureCatalog(data: unknown): unknown {
  if (!isJsonObject(data) || !isJsonObject(data.profiles)) return data
  const definitions: unknown[] = []
  const contentIds = new Map<string, string>()
  const usedIds = new Set<string>()
  const bundles: Record<string, number> = {}
  const profiles = Object.fromEntries(
    Object.entries(data.profiles).map(([profileId, raw]) => {
      if (!isJsonObject(raw) || !Array.isArray(raw.bedSetups))
        return [profileId, raw]
      const originals: JsonObject[] = []
      const bedSetups = raw.bedSetups.map((setup: unknown) => {
        if (!isJsonObject(setup) || !Array.isArray(setup.definitions))
          return setup
        const { definitions: copied, ...rest } = setup
        const fixtures = copied.map((definition: unknown) => {
          if (!isJsonObject(definition) || typeof definition.id !== "string") {
            definitions.push(definition)
            return definition
          }
          originals.push(definition)
          const key = fixtureContentKey(definition)
          const identity = `${definition.id}\u0000${key}`
          let id = contentIds.get(identity)
          if (!id) {
            id = definition.id
            if (usedIds.has(id)) {
              const variant = fixtureVariantId(id, key)
              id = variant
              let count = 2
              while (usedIds.has(id)) id = `${variant}-${count++}`
            }
            contentIds.set(identity, id)
            usedIds.add(id)
            definitions.push({ ...definition, id })
          }
          return {
            definitionId: id,
            enabled: definition.defaultEnabled,
            position: definition.defaultPosition,
            rotation: definition.defaultRotation,
          }
        })
        return { ...rest, fixtures }
      })
      for (const kit of FIXTURE_KITS) {
        const deviceKit =
          profileId === WORKSPACE_PROFILE
            ? DEFAULT_KIT
            : kitForDeviceId(profileId)
        const belongs =
          deviceKit?.id === kit.id ||
          originals.some((definition) =>
            kit.fixtures.some(
              ({ fixture }) =>
                fixture.id === definition.id ||
                (isJsonObject(definition.model) &&
                  isJsonObject(definition.model.source) &&
                  definition.model.source.kind === "bundled" &&
                  fixture.model.source.kind === "bundled" &&
                  definition.model.source.url === fixture.model.source.url)
            )
          )
        if (!belongs) continue
        const version =
          typeof raw.bundle === "number" &&
          Number.isInteger(raw.bundle) &&
          raw.bundle >= 1
            ? raw.bundle
            : 1
        // Anything a newer profile already knew but no profile kept was deleted. An older
        // profile must not make that globally absent fixture look like a new kit addition.
        bundles[kit.id] = Math.max(bundles[kit.id] ?? version, version)
      }
      return [profileId, { ...raw, bedSetups }]
    })
  )
  return { ...data, definitions, profiles, bundles }
}
