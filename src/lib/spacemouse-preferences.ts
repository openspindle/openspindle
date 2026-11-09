import { createAtom, useSelector } from "@tanstack/react-store"

export type SpaceMouseZoomAxis = "forward" | "vertical"
const STORAGE_KEY = "openspindle:spacemouse:zoom-axis"

function readZoomAxis(): SpaceMouseZoomAxis {
  try {
    if (localStorage.getItem(STORAGE_KEY) === "vertical") return "vertical"
  } catch {
    // Unavailable storage uses the default.
  }
  return "forward"
}

const zoomAxis = createAtom<SpaceMouseZoomAxis>(readZoomAxis())

export const spaceMouseZoomAxis = () => zoomAxis.get()

export function useSpaceMouseZoomAxis() {
  const value = useSelector(zoomAxis)
  const set = (next: SpaceMouseZoomAxis) => {
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // The change still applies for this session.
    }
    zoomAxis.set(next)
  }
  return [value, set] as const
}
