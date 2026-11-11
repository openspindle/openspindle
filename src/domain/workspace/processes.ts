import { z } from "zod"
import { PlateSchema } from "../plate/plate"
import type { Plate } from "../plate/plate"
import { EntityIdSchema, newId } from "../primitives"
import { ToolShapeSchema } from "../tools/tool"
import type { Tool } from "../tools/tool"

export const ProcessSchema = z.object({
  id: EntityIdSchema,
  name: z.string().trim().min(1).max(200),
  plate: PlateSchema,
  tools: z
    .array(ToolShapeSchema)
    .max(1000)
    .refine(
      (tools) => new Set(tools.map((tool) => tool.id)).size === tools.length,
      "Saved tool IDs repeat."
    ),
})
export const ProcessesSchema = z
  .array(ProcessSchema)
  .max(100)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    "Process IDs repeat."
  )
export type SavedProcess = z.infer<typeof ProcessSchema>

/** Pending generated sources may refer to a tool before they have NC/table bindings. */
export function processToolIds(plate: Plate): Set<string | null> {
  const ids = new Set(plate.tools.map((entry) => entry.toolId))
  for (const operation of plate.operations)
    if (operation.source.kind === "pcb" && operation.source.data.toolId)
      ids.add(operation.source.data.toolId)
  return ids
}

/** A separate plate, with tool conflicts copied under fresh IDs rather than overwritten. */
export function instantiateProcess(
  process: SavedProcess,
  library: readonly Tool[]
): { plate: Plate; tools: Tool[] } {
  const snapshot = structuredClone(process.plate)
  const tools = [...library]
  const ids = new Map<string, string>()
  for (const saved of process.tools) {
    const held = library.find((tool) => tool.id === saved.id)
    if (held && JSON.stringify(held) === JSON.stringify(saved)) {
      ids.set(saved.id, held.id)
      continue
    }
    const restored = structuredClone(saved)
    restored.id = newId()
    if (held) restored.name = `${restored.name} · process copy`
    tools.push(restored)
    ids.set(saved.id, restored.id)
  }
  const operationIds = new Map(
    snapshot.operations.map((operation) => [operation.id, newId()])
  )
  return {
    tools,
    plate: {
      ...snapshot,
      id: newId(),
      name: process.name,
      example: false,
      tools: snapshot.tools.map((entry) => ({
        ...entry,
        toolId: entry.toolId ? (ids.get(entry.toolId) ?? null) : null,
      })),
      operations: snapshot.operations.map((operation) => ({
        ...operation,
        id: operationIds.get(operation.id)!,
        revision: 0,
        source:
          operation.source.kind === "pcb"
            ? {
                ...operation.source,
                data: {
                  ...operation.source.data,
                  toolId: ids.get(operation.source.data.toolId) ?? "",
                  presetId: ids.has(operation.source.data.toolId)
                    ? operation.source.data.presetId
                    : "",
                },
              }
            : operation.source,
      })),
      // Named section selections contain compiled IDs; recreated programs get fresh selections.
      groups: [],
      notices: [],
      setup: {
        ...snapshot.setup,
        fixtures: snapshot.setup.fixtures.map((fixture) => ({
          ...fixture,
          id: newId(),
        })),
      },
    },
  }
}
