import { z } from "zod"

/** Every persisted store. Each is one versioned JSON document. */
export const STORAGE_KEYS = ["library", "fixtures", "processes"] as const
export const StorageKeySchema = z.enum(STORAGE_KEYS)
export type StorageKey = z.infer<typeof StorageKeySchema>

/** Upper bound for one stored document. */
export const STORAGE_MAX_BYTES = 512 * 1024 * 1024

export const StorageWriteSchema = z.strictObject({
  key: StorageKeySchema,
  value: z.string().max(STORAGE_MAX_BYTES),
})

/** Where a backup went, in words the user can follow: its file path. */
export const BackupResultSchema = z.object({ location: z.string() }).nullable()
export type BackupResult = z.infer<typeof BackupResultSchema>

const KeyParams = z.strictObject({ key: StorageKeySchema })

/** Host storage served by the desktop main process. */
export const storageMethods = {
  "storage.read": {
    params: KeyParams,
    result: z.string().nullable(),
    timeoutMs: 60_000,
  },
  "storage.write": {
    params: StorageWriteSchema,
    result: z.void(),
    timeoutMs: 60_000,
  },
  "storage.backup": {
    params: KeyParams,
    result: BackupResultSchema,
    timeoutMs: 60_000,
  },
  "storage.remove": {
    params: KeyParams,
    result: z.void(),
    timeoutMs: 60_000,
  },
} as const
