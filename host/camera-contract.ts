import { z } from "zod"

export const CameraIdSchema = z.enum(["machine", "webcam"])
export type CameraId = z.infer<typeof CameraIdSchema>
export const CAMERA_IDS: CameraId[] = ["machine", "webcam"]
export const TimelapseSettingSchema = z.strictObject({
  enabled: z.boolean(),
  intervalSeconds: z.int().min(1).max(300),
})
export type TimelapseSetting = z.infer<typeof TimelapseSettingSchema>
export const CameraSettingsSchema = z.object({
  machine: TimelapseSettingSchema,
  webcam: TimelapseSettingSchema,
})
export type CameraSettings = z.infer<typeof CameraSettingsSchema>
export type CameraState = {
  id: CameraId
  name: string
  available: boolean
  status: string
  error: string | null
  timelapse: TimelapseSetting
}
export const TimelapseManifestSchema = z.object({
  version: z.literal(1),
  jobId: z.uuid(),
  cameraId: CameraIdSchema,
  endedAt: z.number().nullable(),
  stopReason: z.string().nullable(),
  frames: z
    .array(
      z.object({
        at: z.number(),
        capturedAt: z.number(),
        intervalSeconds: z.number(),
      })
    )
    .max(3600),
  bytes: z.number().nonnegative(),
})
export type TimelapseManifest = z.infer<typeof TimelapseManifestSchema>
