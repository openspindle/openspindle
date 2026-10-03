import { useMemo } from "react"
import { useFixtureLibrary } from "@/app/fixtures/fixture-context"
import { useWorkspace } from "@/app/workspace/workspace-context"
import type { ModelId } from "@/domain/models/model"
import type { Plate } from "@/domain/plate/plate"
import { plural } from "@/domain/primitives"
import type { FixtureDefinition } from "@/domain/fixtures/definitions"
import { libraryModelId } from "@/domain/fixtures/definitions"

/** Where a model is used: shared fixture definitions, and plates with it on the bed. */
export type ModelUsage = {
  readonly definitions: number
  readonly plates: number
}

export function modelUsage(
  definitions: readonly FixtureDefinition[],
  plates: readonly Plate[]
): ReadonlyMap<ModelId, ModelUsage> {
  const usage = new Map<ModelId, { definitions: number; plates: number }>()
  const entry = (id: ModelId) => {
    const found = usage.get(id) ?? { definitions: 0, plates: 0 }
    usage.set(id, found)
    return found
  }
  for (const definition of definitions) {
    const id = libraryModelId(definition)
    if (id) entry(id).definitions++
  }
  for (const plate of plates) {
    const ids = new Set(
      plate.setup.fixtures.flatMap(
        (fixture) => libraryModelId(fixture.definition) ?? []
      )
    )
    for (const id of ids) entry(id).plates++
  }
  return usage
}

export function useModelUsage() {
  const definitions = useFixtureLibrary((library) => library.definitions)
  const plates = useWorkspace((state) => state.plates)
  return useMemo(() => modelUsage(definitions, plates), [definitions, plates])
}

/** "Used by 2 fixture definitions and 3 plates", or "Not used". */
export function usageText(usage: ModelUsage | undefined) {
  if (!usage || (!usage.definitions && !usage.plates)) return "Not used"
  const parts = [
    usage.definitions ? plural(usage.definitions, "fixture definition") : "",
    usage.plates ? plural(usage.plates, "plate") : "",
  ].filter(Boolean)
  return `Used by ${parts.join(" and ")}`
}
