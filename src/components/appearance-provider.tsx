import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import type { ReactNode } from "react"
import type { Appearance } from "@/lib/appearance"
import {
  APPEARANCE_STORAGE_KEY,
  SYSTEM_DARK_QUERY,
  applyAppearance,
  isAppearance,
  readAppearance,
} from "@/lib/appearance"
import type { FontId, FontRole, Fonts } from "@/lib/fonts"
import {
  DEFAULT_FONTS,
  FONT_STORAGE_KEYS,
  applyFonts,
  isFontFor,
  readFonts,
} from "@/lib/fonts"

const AppearanceContext = createContext<{
  appearance: Appearance
  setAppearance: (appearance: Appearance) => void
  fonts: Fonts
  setFont: (role: FontRole, font: FontId) => void
  saveError: string | null
} | null>(null)

const SAVED_KEYS = new Set([
  APPEARANCE_STORAGE_KEY,
  FONT_STORAGE_KEYS.sans,
  FONT_STORAGE_KEYS.mono,
])

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setPreference] = useState<Appearance | null>(null)
  const [fonts, setFonts] = useState<Fonts>(DEFAULT_FONTS)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    const syncPreference = () => {
      setPreference(readAppearance())
      const saved = readFonts()
      setFonts(saved)
      applyFonts(saved)
      setSaveError(null)
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || SAVED_KEYS.has(event.key)) {
        syncPreference()
      }
    }
    syncPreference()
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  useEffect(() => {
    if (appearance === null) return
    const system = window.matchMedia(SYSTEM_DARK_QUERY)
    const update = () => applyAppearance(appearance, system.matches)
    update()
    system.addEventListener("change", update)
    return () => system.removeEventListener("change", update)
  }, [appearance])

  const setAppearance = useCallback((value: Appearance) => {
    if (!isAppearance(value)) return
    setPreference(value)
    applyAppearance(value, window.matchMedia(SYSTEM_DARK_QUERY).matches)
    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, value)
      setSaveError(null)
    } catch {
      setSaveError(
        "This appearance is applied, but could not be saved. Try again."
      )
    }
  }, [])

  const setFont = useCallback(
    (role: FontRole, font: FontId) => {
      if (!isFontFor(role, font)) return
      const next = { ...fonts, [role]: font }
      setFonts(next)
      applyFonts(next)
      try {
        localStorage.setItem(FONT_STORAGE_KEYS[role], font)
        setSaveError(null)
      } catch {
        setSaveError("This font is applied, but could not be saved. Try again.")
      }
    },
    [fonts]
  )

  return (
    <AppearanceContext.Provider
      value={{
        appearance: appearance ?? "system",
        setAppearance,
        fonts,
        setFont,
        saveError,
      }}
    >
      {children}
    </AppearanceContext.Provider>
  )
}

export function useAppearance() {
  const context = useContext(AppearanceContext)
  if (!context) throw new Error("AppearanceProvider is missing.")
  return context
}
