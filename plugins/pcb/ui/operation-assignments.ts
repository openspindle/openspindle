import type { PCBOperationData } from "./operation-data"
import { drillMethod, geometryFields, toolFields } from "./operation-settings"

/** The library tools the workspace assigned to the tool numbers a program selects. */
function assignedSourceTools(
  source: string,
  assignments: Readonly<Partial<Record<string, string>>>
) {
  const slots = new Set<string>()
  for (const line of source.split(/\r?\n/)) {
    const code = line.replace(/;.*$/, "").replace(/\([^)]*\)/g, "")
    for (const match of code.matchAll(/(?:^|\s)T\s*(\d+)(?=\s|$)/gi))
      slots.add(String(Number(match[1])))
  }
  if (!slots.size) return [assignments.default ?? ""]
  return [...slots].map(
    (slot) => assignments[slot] ?? assignments.default ?? ""
  )
}

/**
 * Workspace tool assignments are authoritative for a generated operation. When they name
 * another tool, the operation follows it without silently choosing a cutting preset: its
 * cutting values stay as explicit edits, while the tool's geometry supplies the diameter.
 * Returns `data` itself when nothing changes.
 */
export function syncOperationAssignments(
  data: PCBOperationData,
  source: string,
  assignments: Readonly<Record<string, string>>
): PCBOperationData {
  const assignedIds = assignedSourceTools(source, assignments).filter(Boolean)
  const assigned = assignedIds.includes(data.toolId)
    ? data.toolId
    : (assignedIds[0] ?? "")
  if (assigned === data.toolId) return data
  const next: PCBOperationData = {
    ...data,
    toolId: assigned,
    presetId: "",
    values: { ...data.values },
  }
  const previousNumber = (key: string): string | undefined => {
    const value = data.values[key] ?? data.generatedValues?.[key]
    if (
      typeof value !== "string" ||
      !value.trim() ||
      !Number.isFinite(Number(value))
    )
      return undefined
    return value
  }
  for (const key of toolFields(data.file.role, drillMethod(data))) {
    if (geometryFields.includes(key)) delete next.values[key]
    else if (!Object.hasOwn(next.values, key)) {
      const value = previousNumber(key)
      if (value !== undefined) next.values[key] = value
    }
  }
  return next
}
