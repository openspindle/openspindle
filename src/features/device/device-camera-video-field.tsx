import { useId } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import type { Option } from "@/components/option-select"
import { Hint } from "@/components/workspace/hint"
import {
  useCachedConfiguration,
  useMachineSnapshot,
  useWriteConfiguration,
} from "@/platform/machine"

const CAMERA_VIDEO_HINT =
  "Size of the camera's video, saved in the machine's configuration"

/** From 640 × 480 up; 16:9 and 5:4 are the middle of the camera's 4:3 picture. */
const SIZES: readonly Option<string>[] = [
  { value: "640x480", label: "640 × 480" },
  { value: "800x600", label: "800 × 600" },
  { value: "1024x768", label: "1024 × 768" },
  { value: "1280x720", label: "1280 × 720 (16:9)" },
  { value: "1280x1024", label: "1280 × 1024 (5:4)" },
  { value: "1600x1200", label: "1600 × 1200" },
]

/**
 * Saves the camera's video size as soon as one is chosen, to the configuration the Device page
 * has read.
 */
export function DeviceCameraVideoField({ pending }: { pending: boolean }) {
  const id = useId()
  const { connection, availability } = useMachineSnapshot()
  const configuration = useCachedConfiguration(connection.id)
  const write = useWriteConfiguration()
  const picture = configuration?.cameraPicture ?? null
  const value = picture ? `${picture.width}x${picture.height}` : ""
  const options =
    picture && !SIZES.some((size) => size.value === value)
      ? [...SIZES, { value, label: `${picture.width} × ${picture.height}` }]
      : SIZES
  let reason = availability.writeConfiguration.allowed
    ? null
    : (availability.writeConfiguration.reason ?? "Unavailable.")
  if (!reason && !configuration) reason = "Read the configuration first."
  const disabled = pending || write.isPending || reason !== null

  return (
    <>
      <Field orientation="horizontal" data-disabled={disabled}>
        <FieldContent className="min-w-0 self-center">
          <FieldLabel htmlFor={id}>
            <Hint text={CAMERA_VIDEO_HINT}>Video size</Hint>
          </FieldLabel>
          {write.isPending && (
            <FieldDescription role="status">Saving…</FieldDescription>
          )}
        </FieldContent>
        <OptionSelect
          id={id}
          aria-label="Video size"
          aria-description={CAMERA_VIDEO_HINT}
          title={reason ?? undefined}
          className="w-44 shrink-0"
          numeric
          options={options}
          value={value}
          disabled={disabled}
          onValueChange={(next) => {
            if (!configuration || disabled || next === value) return
            const [width, height] = next.split("x").map(Number)
            write.mutate({
              cameraPicture: { width, height },
              revision: configuration.revision,
              connectionId: configuration.connectionId,
            })
          }}
        />
      </Field>
      {write.error && (
        <Alert variant="destructive">
          <AlertDescription>{write.error.message}</AlertDescription>
        </Alert>
      )}
    </>
  )
}
