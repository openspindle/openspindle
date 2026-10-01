import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import type { ReactNode } from "react"
import { z } from "zod"

export const WorkLightPercentSchema = z.number().int().min(1).max(100)
export const WorkLightIdleMinutesSchema = z.number().int().min(0).max(1440)

const BrightnessSchema = z.strictObject({
  light: WorkLightPercentSchema,
  dark: WorkLightPercentSchema,
})
type Brightness = z.infer<typeof BrightnessSchema>
type LightMode = keyof Brightness

const STORAGE_KEY = "openspindle:work-light"
const IDLE_STORAGE_KEY = "openspindle:work-light:idle-minutes"
const DEFAULT_BRIGHTNESS: Brightness = { light: 100, dark: 100 }

/** Read before synchronization mounts so it never applies a temporary default. */
function readBrightness(): Brightness {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved !== null) {
      const parsed = BrightnessSchema.safeParse(JSON.parse(saved))
      if (parsed.success) return parsed.data
    }
  } catch {
    // Malformed or unavailable storage leaves the default preferences usable.
  }
  return DEFAULT_BRIGHTNESS
}

function readIdleMinutes(): number {
  try {
    const saved = localStorage.getItem(IDLE_STORAGE_KEY)
    if (saved !== null) {
      const parsed = WorkLightIdleMinutesSchema.safeParse(JSON.parse(saved))
      if (parsed.success) return parsed.data
    }
  } catch {
    // A missing or invalid preference never enables automatic light changes.
  }
  return 0
}

const WorkLightPreferencesContext = createContext<{
  brightness: Brightness
  setBrightness: (mode: LightMode, percent: number) => void
  idleMinutes: number
  setIdleMinutes: (minutes: number) => void
  saveError: string | null
} | null>(null)

/** App preferences, shared by the Accessories fields and the active-theme controller. */
export function WorkLightPreferencesProvider({
  children,
}: {
  children: ReactNode
}) {
  const [brightness, setValues] = useState(readBrightness)
  const [idleMinutes, setIdleValue] = useState(readIdleMinutes)
  const current = useRef(brightness)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (
        event.key !== null &&
        event.key !== STORAGE_KEY &&
        event.key !== IDLE_STORAGE_KEY
      )
        return
      if (event.key === null || event.key === STORAGE_KEY) {
        const saved = readBrightness()
        current.current = saved
        setValues(saved)
      }
      if (event.key === null || event.key === IDLE_STORAGE_KEY)
        setIdleValue(readIdleMinutes())
      setSaveError(null)
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const setBrightness = useCallback((mode: LightMode, percent: number) => {
    const parsed = WorkLightPercentSchema.safeParse(percent)
    if (!parsed.success) return
    const next = { ...current.current, [mode]: parsed.data }
    current.current = next
    setValues(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      setSaveError(null)
    } catch {
      setSaveError(
        "These work light preferences are applied, but could not be saved. Try again."
      )
    }
  }, [])

  const setIdleMinutes = useCallback((minutes: number) => {
    const parsed = WorkLightIdleMinutesSchema.safeParse(minutes)
    if (!parsed.success) return
    setIdleValue(parsed.data)
    try {
      localStorage.setItem(IDLE_STORAGE_KEY, JSON.stringify(parsed.data))
      setSaveError(null)
    } catch {
      setSaveError(
        "These work light preferences are applied, but could not be saved. Try again."
      )
    }
  }, [])

  return (
    <WorkLightPreferencesContext.Provider
      value={{
        brightness,
        setBrightness,
        idleMinutes,
        setIdleMinutes,
        saveError,
      }}
    >
      {children}
    </WorkLightPreferencesContext.Provider>
  )
}

export function useWorkLightPreferences() {
  const context = useContext(WorkLightPreferencesContext)
  if (!context) throw new Error("WorkLightPreferencesProvider is missing.")
  return context
}
