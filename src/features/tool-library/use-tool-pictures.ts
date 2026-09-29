import { useEffect } from "react"
import { toolPictureCache, toolThumbnail } from "@/app/tools/tool-picture-cache"
import { useWorkspace } from "@/app/workspace/workspace-context"
import { toolPictures } from "./tool-pictures"

/**
 * Draws the pictures tool cards ask for, which they cannot draw themselves (a plugin's view has
 * no renderer), and every library tool's thumbnail in the background, so a card mostly finds its
 * tool's drawn: also in a plugin's view, which gets it with the tool.
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
