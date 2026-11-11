import type { StoragePort } from "@/platform/host"
import { ProcessesSchema } from "@/domain/workspace/processes"
import type { SavedProcess } from "@/domain/workspace/processes"
import { Repository } from "./repository"

export function processRepository(storage: StoragePort) {
  return new Repository<SavedProcess[]>(storage, {
    key: "processes",
    title: "The reusable processes",
    version: 1,
    schema: ProcessesSchema,
    decode: (data) => ({ value: ProcessesSchema.parse(data), dropped: [] }),
    encode: (value) => value,
  })
}
