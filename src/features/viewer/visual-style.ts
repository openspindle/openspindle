import { createAtom, useSelector } from "@tanstack/react-store"
import type { VisualStyle } from "@/components/workspace/bed-viewer"

const STORAGE_KEY = "openspindle:viewer:visual-style"

export const isVisualStyle = (value: unknown): value is VisualStyle =>
  value === "smooth" || value === "edges"

function readStyle(): VisualStyle {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isVisualStyle(saved)) return saved
  } catch {
    // Unavailable storage leaves the 3D views smoothly shaded.
  }
  return "smooth"
}

/** The 3D views' visual style, one for all of them, kept across launches. */
const styleAtom = createAtom<VisualStyle>(readStyle())

export function useVisualStyle(): [VisualStyle, (style: VisualStyle) => void] {
  const style = useSelector(styleAtom)
  return [
    style,
    (next) => {
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // The style still applies until the app quits.
      }
      styleAtom.set(next)
    },
  ]
}
