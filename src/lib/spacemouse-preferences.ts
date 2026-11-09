import { createAtom, useSelector } from "@tanstack/react-store"
import { z } from "zod"

const Axis = z.enum(["x", "y", "z", "pitch", "yaw"])
export const SPACE_MOUSE_AXES = Axis.options
export type SpaceMouseAxis = z.infer<typeof Axis>

const AxisSettings = z.object({
  enabled: z.boolean(),
  sensitivity: z.number().int().min(25).max(200),
  reverse: z.boolean(),
})
const Settings = z.object({
  zoomAxis: z.enum(["forward", "vertical"]),
  panZoom: z.boolean(),
  rotation: z.boolean(),
  dominant: z.boolean(),
  axes: z.record(Axis, AxisSettings),
})
type Settings = z.infer<typeof Settings>

const defaultAxis = { enabled: true, sensitivity: 100, reverse: false }
export const DEFAULT_SPACE_MOUSE_SETTINGS: Settings = {
  zoomAxis: "forward",
  panZoom: true,
  rotation: true,
  dominant: false,
  axes: {
    x: defaultAxis,
    y: defaultAxis,
    z: defaultAxis,
    pitch: defaultAxis,
    yaw: defaultAxis,
  },
}

const STORAGE_KEY = "openspindle:spacemouse:settings"
const LEGACY_ZOOM_KEY = "openspindle:spacemouse:zoom-axis"

function readSettings(): Settings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = Settings.safeParse(JSON.parse(saved))
      if (parsed.success) return parsed.data
    }
    if (localStorage.getItem(LEGACY_ZOOM_KEY) === "vertical")
      return { ...DEFAULT_SPACE_MOUSE_SETTINGS, zoomAxis: "vertical" }
  } catch {
    // Unavailable or invalid storage uses the defaults.
  }
  return DEFAULT_SPACE_MOUSE_SETTINGS
}

const settings = createAtom(readSettings())
export const spaceMouseSettings = () => settings.get()

export function useSpaceMouseSettings() {
  const value = useSelector(settings)
  const update = (change: Partial<Settings>) => {
    const next = { ...settings.get(), ...change }
    settings.set(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // The change still applies for this session.
    }
  }
  return [value, update] as const
}
