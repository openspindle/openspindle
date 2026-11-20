import { defineContract } from "@spinnvill/rpc"
import { z } from "zod"
import { MODEL_LIMITS } from "@/domain/models/model"

// Typed arrays cross the worker boundary as themselves (cloned or transferred).
const MeshArraysSchema = z.object({
  positions: z.custom<Float32Array>((value) => value instanceof Float32Array),
  normals: z.custom<Float32Array>((value) => value instanceof Float32Array),
  indices: z.custom<Uint32Array>((value) => value instanceof Uint32Array),
})

/** Served by the tessellation worker to the renderer. */
export const tessellationContract = defineContract({
  methods: {
    // Reading dominates, and grows with the file: a 56 MB assembly takes 40–50 s on an
    // M4 Max. Five minutes leaves room for the size limit on slower machines, and still
    // ends a conversion that hangs (the client stops the worker when a call times out).
    tessellate: {
      params: z.strictObject({
        step: z
          .custom<Uint8Array>((value) => value instanceof Uint8Array)
          .refine(
            (bytes) => bytes.byteLength <= MODEL_LIMITS.sourceBytes,
            "The STEP file is too large."
          ),
      }),
      result: z.object({
        mesh: MeshArraysSchema,
        solids: z.int().positive(),
        triangles: z.int().positive().max(MODEL_LIMITS.triangles),
      }),
      timeoutMs: 5 * 60_000,
    },
  },
  events: {},
})
export type TessellationContract = typeof tessellationContract
