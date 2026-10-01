import type { FirmwareAdapter } from "./adapter.ts"
import { makeraAdapter } from "./makera/adapter.ts"

/** Supporting another controller family is a new adapter here; the core and UI stay unchanged. */
export const FIRMWARE_ADAPTERS: readonly FirmwareAdapter[] = [makeraAdapter]

export const DEFAULT_FIRMWARE = makeraAdapter

/** The adapter of a firmware family by its id, as a host preparing programs elsewhere names it. */
export function firmwareAdapter(id: string): FirmwareAdapter {
  const adapter = FIRMWARE_ADAPTERS.find((candidate) => candidate.id === id)
  if (!adapter) throw new Error(`There is no firmware adapter "${id}".`)
  return adapter
}
