import { useMemo } from "react"
import { toViewerPlate } from "@/features/viewer/viewer-plate"
import { useWorkspace } from "@/app/workspace/workspace-context"
import type { ViewerPlate } from "@/components/workspace/bed-viewer"
import { compilePlate } from "@/domain/compile/compile"
import type { CompiledPlate } from "@/domain/compile/compile"
import type { Plate } from "@/domain/plate/plate"
import type { Tool } from "@/domain/tools/tool"

/** A plate drawn as given rather than as the workspace holds it (a job's plate as run). */
export type ShownPlate = {
  readonly plate: Plate
  readonly compiled: CompiledPlate
  /** The library tools as they were at Run; the workspace's library when absent. */
  readonly tools?: readonly Tool[]
}

/**
 * Every workspace plate as the bed viewer draws it; compiling is cached per plate. A shown
 * plate replaces its workspace version, and stays on the bed after it was removed.
 */
export function useWorkspaceViewerPlates(
  shown: ShownPlate | null = null
): ViewerPlate[] {
  const plates = useWorkspace((state) => state.plates)
  const library = useWorkspace((state) => state.tools)
  return useMemo(() => {
    const drawShown = ({ plate, compiled, tools }: ShownPlate) =>
      toViewerPlate(plate, compiled, tools ?? library)
    const drawn = plates.map((plate) =>
      shown && plate.id === shown.plate.id
        ? drawShown(shown)
        : toViewerPlate(plate, compilePlate(plate, library), library)
    )
    if (shown && !plates.some((plate) => plate.id === shown.plate.id))
      drawn.push(drawShown(shown))
    return drawn
  }, [plates, library, shown])
}
