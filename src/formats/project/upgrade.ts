import { PCBOperationDataSchema } from "@/domain/pcb/operation-data"
import type { Operation } from "@/domain/operations/operation"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Reads the operation sources written before PCB became a built-in feature. */
function upgradeSource(source: unknown): unknown {
  if (!isRecord(source)) return source
  if (source.kind !== "plugin" && source.kind !== "template") return source
  if (source.kind === "plugin" && source.pluginId === "pcb") {
    const data = PCBOperationDataSchema.safeParse(source.data)
    if (data.success) return { kind: "pcb", data: source.data, nc: source.nc }
  }
  if (typeof source.nc === "string")
    return { kind: "file", nc: source.nc, park: true, phase: source.phase }
  // Keep the entire source, including its recipe, until the user replaces the operation.
  return { kind: "unsupported", data: source, phase: source.phase }
}

/** Upgrades the sources in one saved plate, including an exported NC envelope. */
export function upgradePlateSources(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.operations)) return value
  return {
    ...value,
    operations: value.operations.map((operation: unknown) =>
      isRecord(operation)
        ? { ...operation, source: upgradeSource(operation.source) }
        : operation
    ),
  }
}

/** Upgrades saved projects and workspaces kept across a renderer reload. */
export function upgradeWorkspaceSources(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.plates)) return value
  return { ...value, plates: value.plates.map(upgradePlateSources) }
}

/** A pending legacy source moves intact into `data`, so none of its fields were lost. */
export function retainedSourceField(
  operations: readonly Operation[],
  path: readonly PropertyKey[]
): boolean {
  const [collection, operation, source] = path
  return (
    collection === "operations" &&
    typeof operation === "number" &&
    source === "source" &&
    operations[operation]?.source.kind === "unsupported"
  )
}
