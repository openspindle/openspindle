import { webCryptoSha256 } from "@/lib/sha256"
import { MODEL_LIMITS, modelFormatOf } from "@/domain/models/model"
import type { ModelRecord } from "@/domain/models/model"
import { formatBytes, normalizeText } from "@/domain/primitives"
import { glbStats, validateGlb, writeGlb } from "@/formats/models/glb"
import type { ModelStore } from "@/persistence/models/model-library"

/** What an import is doing, for its progress line. */
export type ImportStep = "reading" | "tessellating" | "saving"

const MiB = 1024 * 1024
const withoutExtension = (fileName: string) => fileName.replace(/\.[^.]*$/, "")

/**
 * Adds a STEP or GLB file to the Models library. A STEP file is tessellated off the main
 * thread and kept beside its mesh; a GLB is its own mesh. A file the library already holds
 * returns that model.
 */
export async function importModel(
  file: File,
  options: {
    readonly store: ModelStore
    readonly existing: readonly ModelRecord[]
    readonly signal?: AbortSignal
    readonly onStep?: (step: ImportStep) => void
  }
): Promise<ModelRecord> {
  const format = modelFormatOf(file.name)
  if (!format)
    throw new Error("Choose a STEP (.step, .stp) or binary glTF (.glb) file.")
  if (file.size > MODEL_LIMITS.sourceBytes)
    throw new Error(
      `Model files must be ${MODEL_LIMITS.sourceBytes / MiB} MB or smaller.`
    )
  options.onStep?.("reading")
  const source = new Uint8Array(await file.arrayBuffer())
  const sha256 = await webCryptoSha256(source)
  const known = options.existing.find(
    (model) => model.id === sha256 || model.source?.sha256 === sha256
  )
  // A GLB of a model that came with a project is added again, and the store gives it its file.
  if (known?.source) return known
  const name = normalizeText(withoutExtension(file.name)) || "Model"
  let mesh: Uint8Array = source
  if (format === "step") {
    options.onStep?.("tessellating")
    const { tessellateStep } = await import("./tessellation")
    const tessellated = await tessellateStep(source, { signal: options.signal })
    mesh = writeGlb(tessellated.mesh, {
      name,
      generator: "OpenSpindle STEP import (occt-import-js)",
      extras: { source: file.name },
    })
    if (mesh.byteLength > MODEL_LIMITS.meshBytes)
      throw new Error(
        `The model is too detailed to display: its mesh would be ${formatBytes(mesh.byteLength)}, and meshes may be at most ${MODEL_LIMITS.meshBytes / MiB} MB. Simplify it and try again.`
      )
  }
  validateGlb(mesh, MODEL_LIMITS.meshBytes)
  const { triangles } = glbStats(mesh)
  if (!triangles) throw new Error("The model contains no surfaces to show.")
  if (triangles > MODEL_LIMITS.triangles)
    throw new Error(
      `The model has more than ${MODEL_LIMITS.triangles.toLocaleString("en-US")} triangles. Simplify it and try again.`
    )
  const { meshBounds } = await import("@/formats/models/mesh-bounds")
  const bounds = await meshBounds(mesh)
  options.signal?.throwIfAborted()
  options.onStep?.("saving")
  return options.store.add({
    record: {
      id: await webCryptoSha256(mesh),
      name,
      source: {
        format,
        fileName: normalizeText(file.name) || `${name}.${format}`,
        bytes: source.byteLength,
        sha256,
      },
      mesh: { bytes: mesh.byteLength, triangles },
      bounds,
      addedAt: Date.now(),
    },
    mesh,
    source,
  })
}
