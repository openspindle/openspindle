import { defineContract } from "@spinnvill/rpc"
import { z } from "zod"

const Point3Schema = z.tuple([z.number(), z.number(), z.number()])

/** Served by the cut simulation worker to the renderer. */
export const cutSimulationContract = defineContract({
  methods: {
    // Sweeping a large program's stock takes a few seconds; parsing it again adds about one.
    simulate: {
      params: z.strictObject({
        /** The program's text: parsed again in the worker, it gives the same segments. */
        source: z.string(),
        spans: z.array(
          z.strictObject({
            segmentStart: z.int().nonnegative(),
            segmentEnd: z.int().nonnegative(),
            flutes: z.array(z.tuple([z.number(), z.number()])).nullable(),
          })
        ),
        stock: z
          .strictObject({ min: Point3Schema, max: Point3Schema })
          .nullable(),
      }),
      // Typed arrays cross the worker boundary as themselves (transferred).
      result: z.object({
        kinds: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
        depths: z.custom<Float32Array>(
          (value) => value instanceof Float32Array
        ),
        widths: z.custom<Float32Array>(
          (value) => value instanceof Float32Array
        ),
        belowTop: z.custom<Float32Array>(
          (value) => value instanceof Float32Array
        ),
        resolution: z.number().nonnegative(),
      }),
      timeoutMs: 2 * 60_000,
    },
  },
  events: {},
})
export type CutSimulationContract = typeof cutSimulationContract
