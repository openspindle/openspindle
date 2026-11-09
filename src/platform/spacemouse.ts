import { log } from "@/app/errors/log"
import {
  SPACE_MOUSE_AXES,
  spaceMouseSettings,
} from "@/lib/spacemouse-preferences"
import type { SpaceMouseAxis } from "@/lib/spacemouse-preferences"
import { isSpaceMouse } from "./contract/spacemouse"

// The read-only part of WebHID used by the Electron renderer.
type Device = EventTarget &
  Parameters<typeof isSpaceMouse>[0] & {
    readonly productName: string
    readonly opened: boolean
    open: () => Promise<void>
  }
type Hid = EventTarget & { getDevices: () => Promise<Device[]> }
type ConnectionEvent = Event & { readonly device: Device }
type InputReport = Event & {
  readonly reportId: number
  readonly data: DataView
}
type Axes = readonly [number, number, number]
const REST: Axes = [0, 0, 0]
const REPORT_TIMEOUT = 120
const WHEEL_GUARD_MS = 60
const listeners = new Set<() => void>()
let watching = false
let deviceName: string | null = null
let translation = { axes: REST, time: -Infinity }
let rotation = { axes: REST, time: -Infinity }
let translationCenter = REST
let rotationCenter = REST
let foreAftMotionAt = -Infinity

/** Ignore idle jitter and bound the speed even if a device reports out-of-range values. */
function axis(value: number): number {
  const travel = Math.max(0, Math.abs(value) - 15) / (350 - 15)
  return Math.sign(value) * Math.min(1, travel)
}

function readAxes(data: DataView, offset: number): Axes {
  const read = (index: number) => data.getInt16(offset + index, true)
  return [read(0), read(2), read(4)]
}

function reset() {
  translation = { axes: REST, time: -Infinity }
  rotation = { axes: REST, time: -Infinity }
  foreAftMotionAt = -Infinity
}

function onReport(event: Event) {
  const { reportId, data } = event as InputReport
  if (!document.hasFocus() || data.byteLength < 6) return
  const time = performance.now()
  // Report 1 can contain translation only or translation followed by rotation.
  // Devices using split reports send rotation in report 2. Buttons are ignored.
  if (reportId === 1) {
    translation = { axes: readAxes(data, 0), time }
    if (axis(translation.axes[1] - translationCenter[1])) foreAftMotionAt = time
    if (data.byteLength >= 12) recordRotation(data, 6, time)
  } else if (reportId === 2) {
    recordRotation(data, 0, time)
  } else return
  const { x, y, z, pitch, yaw } = spaceMouseInput(time)
  if (!(x || y || z || pitch || yaw)) return
  for (const listener of listeners) listener()
}

function recordRotation(data: DataView, offset: number, time: number) {
  rotation = { axes: readAxes(data, offset), time }
  if (axis(rotation.axes[0] - rotationCenter[0])) foreAftMotionAt = time
}

/** Driver-emulated wheel events lack a source ID. Match a recent fore/aft push or tilt. */
export const nearSpaceMouseForeAftMotion = (now: number) =>
  now - foreAftMotionAt < WHEEL_GUARD_MS

function watch(hid: Hid) {
  let device: Device | null = null
  const open = async (next: Device) => {
    if (device || !isSpaceMouse(next)) return
    device = next
    try {
      if (!next.opened) await next.open()
      if (device !== next) return
      next.addEventListener("inputreport", onReport)
      deviceName = next.productName || "SpaceMouse"
      log.debug(`SpaceMouse connected: ${next.productName}`)
    } catch (error) {
      if (device === next) device = null
      log.warn("Could not open SpaceMouse", error)
    }
  }
  const scan = async () => {
    for (const next of await hid.getDevices()) {
      if (device) break
      await open(next)
    }
  }
  const discover = () =>
    void scan().catch((error: unknown) =>
      log.debug("Could not discover SpaceMouse", error)
    )
  hid.addEventListener(
    "connect",
    (event) => void open((event as ConnectionEvent).device)
  )
  hid.addEventListener("disconnect", (event) => {
    if (!device || (event as ConnectionEvent).device !== device) return
    device.removeEventListener("inputreport", onReport)
    device = null
    deviceName = null
    translationCenter = REST
    rotationCenter = REST
    reset()
    discover()
  })
  window.addEventListener("blur", reset)
  discover()
}

export function startSpaceMouse() {
  if (!watching) {
    watching = true
    const hid = (navigator as Navigator & { readonly hid?: Hid }).hid
    if (hid) watch(hid)
  }
}

export const spaceMouseDeviceName = () => deviceName

/** One device per renderer, shared by the bed viewers as tabs mount and unmount. */
export function observeSpaceMouse(invalidate: () => void): () => void {
  startSpaceMouse()
  listeners.add(invalidate)
  return () => {
    listeners.delete(invalidate)
    if (!listeners.size) reset()
  }
}

/** Recenter near rest for this connection, without sending anything to the device. */
export function centerSpaceMouse(now: number): boolean {
  if (!deviceName) return false
  const nextTranslation =
    now - translation.time < REPORT_TIMEOUT ? translation.axes : REST
  const nextRotation =
    now - rotation.time < REPORT_TIMEOUT ? rotation.axes : REST
  if (
    [...nextTranslation, ...nextRotation].some((value) => Math.abs(value) > 50)
  )
    return false
  translationCenter = nextTranslation
  rotationCenter = nextRotation
  return true
}

/** Separate expiry for split reports, so a dropped report cannot keep an axis moving. */
export function spaceMouseInput(now: number) {
  const [x, y, z] = centeredAxes(translation, translationCenter, now)
  const [pitch, roll, yaw] = centeredAxes(rotation, rotationCenter, now)
  return { x, y, z, pitch, roll, yaw }
}

function centeredAxes(
  report: typeof translation,
  center: Axes,
  now: number
): Axes {
  if (now - report.time >= REPORT_TIMEOUT) return REST
  const [a, b, c] = report.axes
  return [axis(a - center[0]), axis(b - center[1]), axis(c - center[2])]
}

/** Apply preferences in physical-axis order, then route motion to the camera. */
export function spaceMouseMotion(now: number) {
  const {
    axes,
    panZoom,
    rotation: rotationEnabled,
    dominant,
    zoomAxis,
  } = spaceMouseSettings()
  const input = spaceMouseInput(now)
  for (const name of SPACE_MOUSE_AXES) {
    const { enabled, sensitivity, reverse } = axes[name]
    const groupEnabled =
      name === "pitch" || name === "yaw" ? rotationEnabled : panZoom
    input[name] =
      enabled && groupEnabled
        ? input[name] * (sensitivity / 100) * (reverse ? -1 : 1)
        : 0
  }
  if (dominant) {
    let strongest: SpaceMouseAxis = SPACE_MOUSE_AXES[0]
    for (const name of SPACE_MOUSE_AXES)
      if (Math.abs(input[name]) > Math.abs(input[strongest])) strongest = name
    for (const name of SPACE_MOUSE_AXES) if (name !== strongest) input[name] = 0
  }
  const verticalZoom = zoomAxis === "vertical"
  return {
    panX: input.x,
    panY: verticalZoom ? input.y : input.z,
    zoom: verticalZoom ? input.z : input.y,
    pitch: input.pitch,
    yaw: input.yaw,
  }
}
