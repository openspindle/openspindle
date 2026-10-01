import { webCryptoSha256 } from "@/lib/sha256"
import { MODEL_LIMITS, ModelRecordSchema } from "@/domain/models/model"
import type { ModelRecord } from "@/domain/models/model"
import { glbStats, validateGlb } from "@/formats/models/glb"

/** A library entry as stored: its record, display mesh and (when kept) uploaded file. */
export type ModelEntry = {
  readonly record: ModelRecord
  readonly mesh: Uint8Array
  readonly source: Uint8Array | null
}

const mismatch = (part: string) =>
  new Error(`The model's ${part} does not match its record.`)

/**
 * Checks an entry before a store keeps it: the id is the mesh's digest, the mesh is a valid
 * self-contained GLB with the triangles its record states, and the uploaded file matches its
 * record. Stores trust nothing their caller computed.
 */
export async function verifyModelEntry(entry: ModelEntry): Promise<ModelEntry> {
  const record = ModelRecordSchema.parse(entry.record)
  const { mesh, source } = entry
  if (mesh.byteLength !== record.mesh.bytes) throw mismatch("mesh")
  validateGlb(mesh, MODEL_LIMITS.meshBytes)
  if ((await webCryptoSha256(mesh)) !== record.id) throw mismatch("mesh")
  if (glbStats(mesh).triangles !== record.mesh.triangles)
    throw mismatch("triangle count")
  if (!source || !record.source) {
    if (source || record.source) throw mismatch("source file")
    return { record, mesh, source: null }
  }
  if (
    source.byteLength !== record.source.bytes ||
    (await webCryptoSha256(source)) !== record.source.sha256
  )
    throw mismatch("source file")
  return { record, mesh, source }
}
