import { withDefinitionOrigin } from "@/domain/fixtures/definitions"
import type { FixtureDefinition } from "@/domain/fixtures/definitions"
import type { Point3 } from "@/domain/primitives"
import type { WorkspaceCommand } from "@/domain/workspace/workspace"
import type { FixtureLibrary } from "@/persistence/fixture-document"
import { sameData } from "../workspace/history"
import type { WorkspaceStore } from "../workspace/store"

/** A pure frame change, verified against the entire model so resizing or rotating cannot move placements. */
function restoredOrigin(
  previous: FixtureDefinition,
  definition: FixtureDefinition
): Point3 | undefined {
  const before = previous.model
  const after = definition.model
  if (!before || !after) return undefined
  const origin = before.offset.map(
    (coordinate, axis) => coordinate - after.offset[axis]
  ) as Point3
  if (origin.every((coordinate) => coordinate === 0)) return undefined
  return sameData(withDefinitionOrigin(previous, origin).model, after)
    ? origin
    : undefined
}

/** Library Undo/Redo owns shared definitions; workspace history replays their restored snapshots. */
export function followFixtureDefinitions(
  workspace: WorkspaceStore,
  before: FixtureLibrary,
  after: FixtureLibrary
) {
  const previous = new Map(
    before.definitions.map((definition) => [definition.id, definition])
  )
  const commands: WorkspaceCommand[] = []
  for (const definition of after.definitions) {
    const held = previous.get(definition.id)
    // Adding or deleting a definition leaves existing plate snapshots independent.
    if (!held || sameData(held, definition)) continue
    commands.push({
      type: "fixtures.redefine",
      previous: held,
      definition,
      origin: restoredOrigin(held, definition),
    })
  }
  return workspace.dispatch({ type: "batch", commands }, { record: false })
}
