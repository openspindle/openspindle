import { z } from "zod"
import { operationKind, operationKindLabel } from "./operation-settings"

/** The source and recipe kept by a PCB operation, including its last generated recipe. */
export const PCBOperationDataSchema = z.object({
  schemaVersion: z.literal(1),
  file: z.object({ name: z.string(), content: z.string(), role: z.string() }),
  values: z.record(z.string(), z.union([z.string(), z.boolean()])),
  generatedValues: z
    .record(z.string(), z.union([z.string(), z.boolean()]))
    .optional(),
  toolId: z.string(),
  presetId: z.string(),
  generationError: z.string().optional(),
})
export type PCBOperationData = z.infer<typeof PCBOperationDataSchema>
export type Values = PCBOperationData["values"]

export const OPERATION_DATA_BYTES = 8 * 1024 * 1024

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Reads the PCB source data saved with an operation. */
export function readData(data: unknown): PCBOperationData | null {
  const parsed = PCBOperationDataSchema.safeParse(data)
  return parsed.success ? parsed.data : null
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
export const dataBytes = (json: unknown) =>
  new TextEncoder().encode(JSON.stringify(json)).byteLength

/** The file and what the operation is, such as "board.drl · Mill drill". */
export const operationName = (data: PCBOperationData) =>
  `${data.file.name} · ${operationKindLabel(operationKind(data))}`.slice(0, 180)

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
