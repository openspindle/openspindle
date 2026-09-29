import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { cn } from "cn"
import {
  TOOL_THUMBNAIL,
  pictureShape,
  pictureSubject,
  toolPictureCache,
} from "@/app/tools/tool-picture-cache"
import type {
  ToolFraming,
  ToolPictureSource,
} from "@/app/tools/tool-picture-cache"
import { toolPictures } from "./tool-pictures"

/** A picture's size in CSS pixels, with the classes that give its box that size. */
export type ToolPictureSize = {
  readonly width: number
  readonly height: number
  readonly className: string
}

/** Beside a tool's name in the list: its cutting end, the picture tool cards show too. */
export const THUMBNAIL: ToolPictureSize = {
  width: TOOL_THUMBNAIL.width,
  height: TOOL_THUMBNAIL.height,
  className: "h-12 w-6",
}
/** Beside the editor's fields: the whole tool. */
export const PORTRAIT: ToolPictureSize = {
  width: 128,
  height: 384,
  className: "h-96 w-32",
}

/**
 * A rendered picture of the tool: its 3D model, or the tool its dimensions describe, or
 * nothing without either. Pictures render once and are cached; while a changed tool renders,
 * the previous picture stays.
 */
export function ToolPicture({
  tool,
  framing,
  size,
  className,
}: {
  tool: ToolPictureSource
  framing: ToolFraming
  size: ToolPictureSize
  className?: string
}) {
  const model = tool.model ?? null
  const shape = model === null ? pictureShape(tool) : null
  const subject = useMemo(() => pictureSubject(model, shape), [model, shape])
  const { width, height } = size
  const key =
    subject && toolPictureCache.key({ subject, framing, width, height })
  const image = useSyncExternalStore(toolPictureCache.subscribe, () =>
    key === null ? null : toolPictureCache.image(key)
  )
  const [shown, setShown] = useState<string | null>(null)
  if (image !== null && image !== shown) setShown(image)
  /** The previous render's key, so a newly edited draft drops its predecessor's queued render. */
  const previousKey = useRef<string | null>(null)
  useEffect(() => {
    if (subject && key !== null)
      toolPictures.request(
        key,
        { subject, framing, width, height },
        previousKey.current ?? undefined
      )
    previousKey.current = key
  }, [key, subject, framing, width, height])
  if (!subject) return null
  const source = image ?? shown
  const box = cn("shrink-0", size.className, className)
  if (!source) return <span className={cn("block", box)} aria-hidden="true" />
  return (
    <img
      className={box}
      src={source}
      width={width}
      height={height}
      alt=""
      draggable={false}
    />
  )
}
