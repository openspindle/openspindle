import { useEffect } from "react"
import { toolPictureCache, toolThumbnail } from "@/app/tools/tool-picture-cache"
import { useWorkspace } from "@/app/workspace/workspace-context"
import { toolPictures } from "./tool-pictures"

/**
 * Draws the pictures tool cards ask for and keeps library thumbnails ready for shared cards.
 */
export function useToolPictures() {
  const tools = useWorkspace((state) => state.tools)
  useEffect(
    () =>
      toolPictureCache.serve((key, request) =>
        toolPictures.request(key, request)
      ),
    []
  )
  useEffect(() => {
    for (const tool of tools) toolThumbnail(tool)
  }, [tools])
}
