import { createAtom, useSelector } from "@tanstack/react-store"
import {
  DEFAULT_REMOVAL_RESOLUTION,
  RemovalResolutionSchema,
} from "@/domain/tools/removal-resolution"
import type { RemovalResolution } from "@/domain/tools/removal-resolution"

const KEY = "openspindle:removal:resolution"
function readResolution(): RemovalResolution {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved) {
      const parsed = RemovalResolutionSchema.safeParse(JSON.parse(saved))
      if (parsed.success) return parsed.data
    }
  } catch {
    // Invalid or unavailable storage uses the default for this session.
  }
  return DEFAULT_REMOVAL_RESOLUTION
}

const preference = createAtom({
  resolution: readResolution(),
  saveError: null as string | null,
})

export function useRemovalResolution() {
  const state = useSelector(preference)
  const update = (resolution: RemovalResolution) => {
    let saveError: string | null = null
    try {
      localStorage.setItem(KEY, JSON.stringify(resolution))
    } catch {
      saveError =
        "The resolution applies for this session but could not be saved."
    }
    preference.set({ resolution, saveError })
  }
  return { ...state, update }
}
