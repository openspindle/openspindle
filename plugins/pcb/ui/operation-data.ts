import type { JsonValue } from "@openspindle/plugin-sdk"
import { roleLabel } from "./inputs"

export type Values = Record<string, string | boolean>

/** What a PCB operation keeps in its plugin-owned data. */
export type PCBOperationData = {
  schemaVersion: 1
  /** `role` is "" until a type is chosen. */
  file: { name: string; content: string; role: string }
  /** Explicit edits only; everything else follows the tool, its preset and the stock. */
  values: Values
  /** The effective values of the last generated toolpath. */
  generatedValues?: Values
  toolId: string
  presetId: string
  /** Why generation was refused; the operation stays pending until its settings change. */
  generationError?: string
}

/** operations.* accepts at most 8 MiB of plugin data per operation. */
export const OPERATION_DATA_BYTES = 8 * 1024 * 1024

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function readValues(value: unknown): Values | null {
  if (!isRecord(value)) return null
  const values: Values = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string" && typeof item !== "boolean") return null
    values[key] = item
  }
  return values
}

/** Reads saved data; null when it is not this plugin's format. */
export function readData(data: JsonValue | undefined): PCBOperationData | null {
  if (!isRecord(data) || data.schemaVersion !== 1) return null
  const file = data.file
  if (
    !isRecord(file) ||
    typeof file.name !== "string" ||
    typeof file.content !== "string" ||
    typeof file.role !== "string"
  )
    return null
  const values = readValues(data.values)
  if (!values) return null
  let generatedValues: Values | undefined
  const generated = data.generatedValues as JsonValue | undefined
  if (generated !== undefined) {
    const read = readValues(generated)
    if (!read) return null
    generatedValues = read
  }
  const generationError = data.generationError as JsonValue | undefined
  if (generationError !== undefined && typeof generationError !== "string")
    return null
  if (typeof data.toolId !== "string" || typeof data.presetId !== "string")
    return null
  const result: PCBOperationData = {
    schemaVersion: 1,
    file: { name: file.name, content: file.content, role: file.role },
    values,
    toolId: data.toolId,
    presetId: data.presetId,
  }
  if (generatedValues) result.generatedValues = generatedValues
  if (typeof generationError === "string")
    result.generationError = generationError
  return result
}

export function dataJson(data: PCBOperationData): JsonValue {
  const json: { [key: string]: JsonValue } = {
    schemaVersion: 1,
    file: { ...data.file },
    values: { ...data.values },
    toolId: data.toolId,
    presetId: data.presetId,
  }
  if (data.generatedValues) json.generatedValues = { ...data.generatedValues }
  if (data.generationError !== undefined)
    json.generationError = data.generationError
  return json
}

export function newData(
  file: { name: string; content: string },
  role: string
): PCBOperationData {
  return {
    schemaVersion: 1,
    file: { name: file.name, content: file.content, role },
    values: {},
    toolId: "",
    presetId: "",
  }
}

/** UTF-8 size of data as the app measures it. */
export const dataBytes = (json: JsonValue) =>
  new TextEncoder().encode(JSON.stringify(json)).byteLength

export const operationName = (data: PCBOperationData) =>
  `${data.file.name} · ${roleLabel(data.file.role)}`.slice(0, 180)

/** JSON with sorted keys, so equal data always gives the same text. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`
  const text = JSON.stringify(value) as string | undefined
  return text ?? "null"
}
