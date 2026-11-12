import { useEffect, useId, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { OptionSelect } from "@/components/option-select"
import { TimelapseSettingSchema } from "../camera-contract"
import type {
  CameraId,
  CameraState,
  TimelapseManifest,
} from "../camera-contract"

async function request<T>(
  token: string,
  path: string,
  method = "GET",
  body?: unknown
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? "Camera request failed.")
  return data as T
}
/** One outstanding image request per visible camera, with immediate URL/HTTP cleanup. */
function useCameraImage(token: string, path: string, enabled: boolean) {
  const [image, setImage] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    const abort = new AbortController()
    let objectUrl: string | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    async function refresh() {
      try {
        const response = await fetch(path, {
          headers: { Authorization: `Bearer ${token}` },
          signal: abort.signal,
        })
        if (!response.ok) throw new Error("Frame unavailable.")
        const blob = await response.blob()
        if (abort.signal.aborted) return
        const next = URL.createObjectURL(blob)
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        objectUrl = next
        setImage(next)
      } catch {
        if (!abort.signal.aborted) setImage(null)
      }
      if (!abort.signal.aborted) timer = setTimeout(() => void refresh(), 1000)
    }
    void refresh()
    return () => {
      abort.abort()
      clearTimeout(timer)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setImage(null)
    }
  }, [token, path, enabled])
  return image
}
function CameraCard({
  camera,
  token,
  refresh,
}: {
  camera: CameraState
  token: string
  refresh: () => void
}) {
  const id = useId()
  const action = useMutation({
    mutationFn: (kind: "start" | "stop") =>
      request(token, `/api/cameras/${camera.id}/${kind}`, "POST"),
    onSuccess: refresh,
  })
  const save = useMutation({
    mutationFn: (setting: { enabled: boolean; intervalSeconds: number }) =>
      request(token, `/api/cameras/${camera.id}/timelapse`, "POST", setting),
    onSuccess: refresh,
  })
  const form = useForm({
    defaultValues: camera.timelapse,
    validators: { onSubmit: TimelapseSettingSchema },
    onSubmit: ({ value }) => save.mutate(value),
  })
  const enabled = camera.status !== "off" && camera.status !== "error"
  const image = useCameraImage(
    token,
    `/api/cameras/${camera.id}/frame`,
    enabled
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>{camera.name}</CardTitle>
        <CardDescription>
          {camera.status}
          {camera.timelapse.enabled ? " · Job timelapse armed" : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {image && (
          <img
            src={image}
            alt={`Live ${camera.name}`}
            className="w-full object-contain"
          />
        )}
        <Button
          variant="outline"
          disabled={!camera.available || action.isPending}
          onClick={() => action.mutate(enabled ? "stop" : "start")}
        >
          {enabled ? "Disable camera" : "Enable camera"}
        </Button>
        {!camera.available && (
          <FieldDescription>
            {camera.id === "webcam"
              ? "Configure a USB webcam on the host to enable this view."
              : "Connect the machine and configure its camera endpoint."}
          </FieldDescription>
        )}
        {(camera.error || action.error) && (
          <FieldError>{camera.error ?? action.error?.message}</FieldError>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <FieldGroup>
            <form.Field name="enabled">
              {(field) => (
                <Field orientation="horizontal">
                  <Switch
                    id={`${id}-record`}
                    checked={field.state.value}
                    onCheckedChange={field.handleChange}
                  />
                  <FieldLabel htmlFor={`${id}-record`}>
                    Record job timelapse
                  </FieldLabel>
                </Field>
              )}
            </form.Field>
            <form.Field name="intervalSeconds">
              {(field) => (
                <Field data-invalid={!field.state.meta.isValid}>
                  <FieldLabel htmlFor={`${id}-interval`}>
                    Seconds between frames
                  </FieldLabel>
                  <Input
                    id={`${id}-interval`}
                    className="font-numeric"
                    type="number"
                    min={1}
                    max={300}
                    value={field.state.value}
                    onChange={(event) =>
                      field.handleChange(Number(event.target.value))
                    }
                    onBlur={field.handleBlur}
                    aria-invalid={!field.state.meta.isValid}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
            <Button type="submit" variant="outline" disabled={save.isPending}>
              Save timelapse settings
            </Button>
            <FieldDescription>
              Recording requires an enabled camera and an active host job.
            </FieldDescription>
            {save.error && <FieldError>{save.error.message}</FieldError>}
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
export function CameraPanel({
  cameras,
  token,
  refresh,
}: {
  cameras: CameraState[]
  token: string
  refresh: () => void
}) {
  const [view, setView] = useState<"both" | CameraId>("both")
  return (
    <section className="flex flex-col gap-3" aria-label="Cameras">
      <Field>
        <FieldLabel htmlFor="camera-view">Camera view</FieldLabel>
        <OptionSelect
          id="camera-view"
          value={view}
          onValueChange={setView}
          options={[
            { value: "both", label: "Both cameras" },
            { value: "machine", label: "Makera camera" },
            { value: "webcam", label: "Workshop webcam" },
          ]}
        />
      </Field>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {cameras
          .filter((camera) => view === "both" || camera.id === view)
          .map((camera) => (
            <CameraCard
              key={`${camera.id}:${camera.timelapse.enabled}:${camera.timelapse.intervalSeconds}`}
              camera={camera}
              token={token}
              refresh={refresh}
            />
          ))}
      </div>
    </section>
  )
}
function TimelapseClip({
  record,
  token,
}: {
  record: TimelapseManifest
  token: string
}) {
  const [video, setVideo] = useState<string | null>(null)
  const pendingExport = useRef<AbortController | null>(null)
  useEffect(() => () => pendingExport.current?.abort(), [])
  const exportVideo = useMutation({
    mutationFn: async () => {
      const abort = new AbortController()
      pendingExport.current = abort
      const response = await fetch(
        `/api/history/${record.jobId}/timelapses/${record.cameraId}/export`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          signal: abort.signal,
        }
      )
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error ?? "MP4 export failed.")
      }
      const blob = await response.blob()
      if (abort.signal.aborted) throw new Error("MP4 export cancelled.")
      return URL.createObjectURL(blob)
    },
    onSuccess: (url) => {
      if (pendingExport.current?.signal.aborted) URL.revokeObjectURL(url)
      else setVideo(url)
    },
  })
  useEffect(
    () => () => {
      if (video) URL.revokeObjectURL(video)
    },
    [video]
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {record.cameraId === "machine"
            ? "Makera timelapse"
            : "Webcam timelapse"}
        </CardTitle>
        <CardDescription>
          {record.frames.length} frames ·{" "}
          {record.endedAt === null ? "Recording" : record.stopReason}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button
          variant="outline"
          disabled={exportVideo.isPending || !record.frames.length}
          onClick={() => exportVideo.mutate()}
        >
          {exportVideo.isPending ? "Building MP4…" : "Build / refresh MP4"}
        </Button>
        {video && (
          <>
            <video src={video} controls preload="metadata" className="w-full" />
            <Button
              variant="outline"
              onClick={() => {
                const link = document.createElement("a")
                link.href = video
                link.download = `${record.jobId}-${record.cameraId}.mp4`
                link.click()
              }}
            >
              Download MP4
            </Button>
          </>
        )}
        {exportVideo.error && (
          <FieldError>{exportVideo.error.message}</FieldError>
        )}
      </CardContent>
    </Card>
  )
}
export function JobTimelapses({
  jobId,
  token,
}: {
  jobId: string
  token: string
}) {
  const records = useQuery({
    queryKey: ["timelapses", jobId],
    queryFn: () =>
      request<(TimelapseManifest | null)[]>(
        token,
        `/api/history/${jobId}/timelapses`
      ),
    refetchInterval: 5000,
    retry: false,
  })
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {records.data?.map(
        (record) =>
          record && (
            <TimelapseClip
              key={record.cameraId}
              record={record}
              token={token}
            />
          )
      )}
      {records.error && <FieldError>{records.error.message}</FieldError>}
    </div>
  )
}
