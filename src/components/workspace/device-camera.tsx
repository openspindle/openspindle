import { useEffect, useRef, useState } from "react"
import type { ComponentProps, ReactNode } from "react"
import {
  Camera,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Play,
  Square,
} from "lucide-react"
import { cn } from "cn"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { endpointLabel, isSimulator } from "@/machine/contract"
import type { ConnectedDevice } from "@/machine/contract"
import { useMachineHost } from "@/platform/machine"

type Phase = "idle" | "connecting" | "live" | "paused" | "error"

/** A button on the camera's feed: the secondary colour, see-through. */
export function CameraFeedButton({
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="secondary"
      size="icon-sm"
      type="button"
      className={cn("bg-secondary/70", className)}
      {...props}
    />
  )
}

/**
 * The machine camera, streamed by the main process; the renderer opens no sockets. A card has
 * its buttons in a header; an overlay has them on the feed, Start and Stop in the middle. On
 * the simulator, which has no camera, it shows `simulated` instead.
 */
export function DeviceCamera({
  device,
  available,
  variant = "card",
  hidden = false,
  className,
  actions,
  simulated,
  title = "Camera",
}: {
  device: ConnectedDevice | null
  available: boolean
  variant?: "card" | "overlay"
  /** Hidden, it streams nothing; shown again, it resumes a stream that was started. */
  hidden?: boolean
  className?: string
  /** More buttons, after Fullscreen; an overlay's are `CameraFeedButton`s. */
  actions?: ReactNode
  /** What the camera would see, drawn here when the device is the simulator. */
  simulated?: ReactNode
  title?: string
}) {
  const machine = useMachineHost()
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<Phase>("idle")
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [fullscreenError, setFullscreenError] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const urls = useRef(new Set<string>())
  const watching = attempt > 0 && available && !!device && !hidden
  const simulator = !!device && isSimulator(device) && simulated !== undefined
  const subject = simulator ? "preview" : "camera"
  const active =
    phase === "connecting" || phase === "live" || phase === "paused"
  const fullscreenSupported =
    typeof document.documentElement.requestFullscreen === "function"

  // A new device always starts stopped.
  useEffect(() => setAttempt(0), [device ? endpointLabel(device) : null])

  useEffect(() => {
    const syncFullscreen = () => {
      setFullscreen(
        !!panel.current && document.fullscreenElement === panel.current
      )
      setFullscreenError(false)
    }
    document.addEventListener("fullscreenchange", syncFullscreen)
    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreen)
  }, [])

  // Hiding it leaves fullscreen, which would otherwise show nothing.
  useEffect(() => {
    if (hidden && fullscreen && panel.current === document.fullscreenElement)
      void document.exitFullscreen().catch(() => setFullscreenError(true))
  }, [hidden, fullscreen])

  useEffect(() => {
    if (!watching) {
      setPhase("idle")
      return
    }
    // The simulator has no camera to stream: its picture is drawn here.
    if (simulator) {
      setPhase("live")
      return
    }
    const created = urls.current
    setPhase("connecting")
    const stop = machine.watchCamera((event) => {
      if (event.kind === "status") {
        if (event.status === "error") setFrameUrl(null)
        setPhase(event.status)
        return
      }
      const url = URL.createObjectURL(
        new Blob([event.jpeg.slice()], { type: "image/jpeg" })
      )
      created.add(url)
      setFrameUrl(url)
    })
    return () => {
      stop()
      for (const url of created) URL.revokeObjectURL(url)
      created.clear()
      setFrameUrl(null)
    }
  }, [watching, machine, attempt, simulator])

  /** Older frames are released once the newest one is on screen. */
  const loaded = (url: string) => {
    for (const other of urls.current)
      if (other !== url) {
        URL.revokeObjectURL(other)
        urls.current.delete(other)
      }
  }
  let cameraAction = "Start"
  if (phase === "error") cameraAction = "Retry"
  if (active) cameraAction = "Stop"
  let cameraStatus = simulator ? "Preview stopped" : "Camera stopped"
  if (phase === "connecting") cameraStatus = "Connecting to camera…"
  if (phase === "paused") cameraStatus = "Camera paused for job setup"
  if (phase === "error" || !available) cameraStatus = "Camera unavailable"
  if (!device) cameraStatus = "Camera offline"
  const toggleCamera = () => setAttempt((value) => (active ? 0 : value + 1))
  const fullscreenLabel = fullscreen
    ? "Exit camera fullscreen"
    : "Fullscreen camera"
  const fullscreenTitle = fullscreenError
    ? "Fullscreen unavailable"
    : fullscreenLabel
  const FullscreenIcon = fullscreen ? Minimize2 : Maximize2
  const toggleFullscreen = () => {
    const element = panel.current
    if (!element?.requestFullscreen) return
    setFullscreenError(false)
    const change =
      document.fullscreenElement === element
        ? document.exitFullscreen()
        : element.requestFullscreen()
    void change.catch(() => setFullscreenError(true))
  }
  const image = frameUrl && (
    <img
      className="size-full object-contain"
      src={frameUrl}
      alt="Live machine camera"
      draggable={false}
      onLoad={() => loaded(frameUrl)}
      onError={() => setPhase("error")}
    />
  )
  const statusRole = phase === "error" ? "alert" : "status"
  const showing = simulator ? phase === "live" : !!frameUrl
  const picture = simulator
    ? phase === "live" && <div className="relative size-full">{simulated}</div>
    : image

  if (variant === "overlay") {
    // Over a live picture the buttons fade in while it is pointed at, and out once it is not,
    // also after a click on one; a keyboard's focus keeps them in.
    const reveal =
      showing &&
      "opacity-0 transition-opacity duration-300 group-hover/camera:opacity-100 group-has-[:focus-visible]/camera:opacity-100"
    return (
      <div
        ref={panel}
        role="region"
        hidden={hidden}
        className={cn(
          "group/camera relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-neutral-950 ring-1 ring-foreground/10",
          className
        )}
        aria-label={title}
      >
        {picture}
        <div
          className={cn(
            "absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center",
            reveal
          )}
        >
          <CameraFeedButton
            size="icon-lg"
            className="size-10 rounded-full [&_svg:not([class*='size-'])]:size-5"
            disabled={!available || !device}
            onClick={toggleCamera}
            aria-label={`${cameraAction} ${subject}`}
            title={cameraAction}
          >
            {phase === "connecting" && (
              <LoaderCircle className="animate-spin" />
            )}
            {(phase === "live" || phase === "paused") && <Square />}
            {!active && <Play />}
          </CameraFeedButton>
          {!showing && (
            <CardDescription role={statusRole}>{cameraStatus}</CardDescription>
          )}
        </div>
        {showing && (phase === "paused" || phase === "connecting") && (
          <Badge
            variant="secondary"
            className="absolute top-2 left-2"
            role="status"
          >
            {cameraStatus}
          </Badge>
        )}
        <div className={cn("absolute top-2 right-2 flex gap-1", reveal)}>
          <CameraFeedButton
            disabled={!fullscreenSupported}
            aria-label={fullscreenLabel}
            title={fullscreenTitle}
            onClick={toggleFullscreen}
          >
            <FullscreenIcon />
          </CameraFeedButton>
          {actions}
        </div>
      </div>
    )
  }
  return (
    <Card
      ref={panel}
      size="sm"
      role="region"
      hidden={hidden}
      className={cn(
        "fullscreen:flex fullscreen:h-screen fullscreen:flex-col fullscreen:rounded-none pb-0",
        className
      )}
      aria-label={title}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera size={16} />
          <span>{title}</span>
          {active && (
            <Badge variant="secondary">
              {phase === "live" ? "Live" : cameraStatus}
            </Badge>
          )}
        </CardTitle>
        <CardAction className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={!available || !device}
            onClick={toggleCamera}
            aria-label={`${cameraAction} ${subject}`}
          >
            {active ? <Square /> : <Play />}
            {cameraAction}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            disabled={!fullscreenSupported}
            aria-label={fullscreenLabel}
            title={fullscreenTitle}
            onClick={toggleFullscreen}
          >
            <FullscreenIcon />
          </Button>
          {actions}
        </CardAction>
      </CardHeader>
      <CardContent className="fullscreen:flex-1 relative flex aspect-video min-h-0 items-center justify-center overflow-hidden bg-neutral-950 p-0">
        {picture}
        {!showing && (
          <div
            className="flex flex-col items-center gap-3 p-6 text-center text-neutral-500"
            role={statusRole}
          >
            {phase === "connecting" ? (
              <LoaderCircle
                className="size-7 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Camera className="size-8" aria-hidden="true" />
            )}
            <CardDescription>{cameraStatus}</CardDescription>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
