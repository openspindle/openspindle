import { createAtom, useSelector } from "@tanstack/react-store"

const KEY = "openspindle:probing:guided"

function readGuided(): boolean {
  try {
    return localStorage.getItem(KEY) === "true"
  } catch {
    return false
  }
}

const preference = createAtom({
  guided: readGuided(),
  saveError: null as string | null,
})

/** An interface preference only; never changes program checks or saved jobs. */
export function useProbingPreferences() {
  const state = useSelector(preference)
  const update = (guided: boolean) => {
    let saveError: string | null = null
    try {
      localStorage.setItem(KEY, JSON.stringify(guided))
    } catch {
      saveError =
        "The probing workflow applies for this session but could not be saved."
    }
    preference.set({ guided, saveError })
  }
  return { ...state, update }
}
