/** A JSON object as a saved document holds it, before any schema has read it. */
export type JsonObject = Record<string, unknown>

/** Whether a value is a JSON object, not an array or null. */
export const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
