import { z } from "zod"

/**
 * Where a file an operation keeps was loaded from on disk, to tell when the file there changed
 * and load it again: the path it was chosen at, and when it was last modified as loaded (ms
 * since the epoch). Kept with any source that keeps a file's contents.
 */
export const FileLinkSchema = z.strictObject({
  path: z.string().min(1).max(4096),
  modifiedAt: z.number().nonnegative(),
})
export type FileLink = z.infer<typeof FileLinkSchema>
