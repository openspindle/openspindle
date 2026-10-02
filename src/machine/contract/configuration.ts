import { z } from "zod"

export const CONFIGURATION_MAX_BYTES = 256 * 1024
export const VacuumDefaultPowerSchema = z.int().min(50).max(100)

/** The saved text, including comments and whitespace; no firmware commands are executed. */
export const ConfigurationContentSchema = z
  .string()
  .min(1, "The configuration cannot be empty.")
  .max(CONFIGURATION_MAX_BYTES, "The configuration is too large.")
  .refine(
    (content) =>
      new TextEncoder().encode(content).length <= CONFIGURATION_MAX_BYTES,
    "The configuration must be at most 256 KiB."
  )
  .refine(
    (content) =>
      Array.from(content).every((character) => {
        const code = character.charCodeAt(0)
        return (
          code !== 127 &&
          (code >= 32 || code === 9 || code === 10 || code === 13)
        )
      }),
    "Remove control characters from the configuration."
  )
  .refine(
    (content) =>
      content.split(/\r?\n/).some((line) => {
        const setting = line.split("#", 1)[0].trim()
        return /^\S+\s+\S+/.test(setting)
      }),
    "The configuration needs at least one setting."
  )

/** A picture's size in pixels. */
export const PictureSizeSchema = z.object({
  width: z.int().positive(),
  height: z.int().positive(),
})
export type PictureSize = z.infer<typeof PictureSizeSchema>

export const FirmwareConfigurationSchema = z.object({
  path: z.string().min(1).max(256),
  content: ConfigurationContentSchema,
  /** The saved vacuum default, including values outside the editable range; null when unknown. */
  vacuumDefaultPower: z.number().nullable(),
  /** The size of the camera's stream the configuration sets; null when it sets none. */
  cameraPicture: PictureSizeSchema.nullable(),
  /** The firmware's own light timer in minutes when it switches a dimmed light off; 0 when not. */
  dimmingLightTimer: z.number().nonnegative(),
  revision: z.string().regex(/^[a-f0-9]{32}$/),
  connectionId: z.string().uuid(),
  fetchedAt: z.number().nonnegative(),
})
export type FirmwareConfiguration = z.infer<typeof FirmwareConfigurationSchema>

/** Save only to the connection and version from which the editor read. */
export const WriteConfigurationRequestSchema = z.union([
  z.strictObject({
    content: ConfigurationContentSchema,
    revision: FirmwareConfigurationSchema.shape.revision,
    connectionId: FirmwareConfigurationSchema.shape.connectionId,
  }),
  z.strictObject({
    vacuumDefaultPower: VacuumDefaultPowerSchema,
    revision: FirmwareConfigurationSchema.shape.revision,
    connectionId: FirmwareConfigurationSchema.shape.connectionId,
  }),
  z.strictObject({
    cameraPicture: PictureSizeSchema,
    revision: FirmwareConfigurationSchema.shape.revision,
    connectionId: FirmwareConfigurationSchema.shape.connectionId,
  }),
  /** Only off: any other value keeps switching a dimmed light off. */
  z.strictObject({
    lightTimerMinutes: z.literal(0),
    revision: FirmwareConfigurationSchema.shape.revision,
    connectionId: FirmwareConfigurationSchema.shape.connectionId,
  }),
])
export type WriteConfigurationRequest = z.infer<
  typeof WriteConfigurationRequestSchema
>

export const WriteConfigurationResultSchema = z.object({
  configuration: FirmwareConfigurationSchema,
  afterRestart: z.boolean(),
})
export type WriteConfigurationResult = z.infer<
  typeof WriteConfigurationResultSchema
>
