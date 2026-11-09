import { log } from "@/app/errors/log"
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
let translation = { axes: REST, time: -Infinity }
let rotation = { axes: REST, time: -Infinity }
let foreAftMotionAt = -Infinity

/** Ignore idle jitter and bound the speed even if a device reports out-of-range values. */
function axis(value: number): number {
  const travel = Math.max(0, Math.abs(value) - 15) / (350 - 15)
  return Math.sign(value) * Math.min(1, travel)
}

function readAxes(data: DataView, offset: number): Axes {
  const read = (index: number) => axis(data.getInt16(offset + index, true))
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
    if (translation.axes[1]) foreAftMotionAt = time
    if (data.byteLength >= 12) recordRotation(data, 6, time)
  } else if (reportId === 2) {
    recordRotation(data, 0, time)
  } else return
  const { x, y, z, pitch, yaw } = spaceMouseMotion(time)
  if (!(x || y || z || pitch || yaw)) return
  for (const listener of listeners) listener()
}

function recordRotation(data: DataView, offset: number, time: number) {
  rotation = { axes: readAxes(data, offset), time }
  if (rotation.axes[0]) foreAftMotionAt = time
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
    reset()
    discover()
  })
  window.addEventListener("blur", reset)
  discover()
}

/** One device per renderer, shared by the bed viewers as tabs mount and unmount. */
export function observeSpaceMouse(invalidate: () => void): () => void {
  if (!watching) {
    watching = true
    const hid = (navigator as Navigator & { readonly hid?: Hid }).hid
    if (hid) watch(hid)
  }
  listeners.add(invalidate)
  return () => {
    listeners.delete(invalidate)
    if (!listeners.size) reset()
  }
}

/** Separate expiry for split reports, so a dropped report cannot keep an axis moving. */
export function spaceMouseMotion(now: number) {
  const [x, y, z] =
    now - translation.time < REPORT_TIMEOUT ? translation.axes : REST
  const [pitch, , yaw] =
    now - rotation.time < REPORT_TIMEOUT ? rotation.axes : REST
  return { x, y, z, pitch, yaw }
}
