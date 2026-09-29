import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { cn } from "cn"
import { toolShape } from "@/domain/tools/tool-shape"
import type { ToolShapeSource } from "@/domain/tools/tool-shape"
import type { Tool } from "@/domain/tools/tool"
import { ToolImage } from "./tool-image"
import type { ToolImageSubject } from "./tool-image"
import { toolPictures } from "./tool-pictures"
import type { ToolFraming, ToolPictureSubject } from "./tool-pictures"

/** A picture's size in CSS pixels, with the classes that give its box that size. */
export type ToolPictureSize = {
  readonly width: number
  readonly height: number
  readonly className: string
}

/** Beside a tool's name in the list: its cutting end. */
export const THUMBNAIL: ToolPictureSize = {
  width: 24,
  height: 48,
  className: "h-12 w-6",
}
/** On a tool card: its cutting end, as tall as the card's name and details. */
export const CARD: ToolPictureSize = {
  width: 24,
  height: 40,
  className: "h-10 w-6",
}
/** Beside the editor's fields: the whole tool. */
export const PORTRAIT: ToolPictureSize = {
  width: 128,
  height: 384,
  className: "h-96 w-32",
}

/**
 * What a picture of the tool shows: its 3D model, or else the shape its dimensions describe.
 * A plugin's tool has no model.
 */
export type ToolPictureSource = ToolShapeSource & Partial<Pick<Tool, "model">>

/** Whether the tool has a picture: a 3D model, or dimensions that describe a shape. */
export function hasToolPicture(tool: ToolPictureSource) {
  // A plugin built against an earlier plugin kit may pass a tool without its dimensions.
  const { geometry, shaft } = tool as Partial<ToolPictureSource>
  return !!tool.model || (!!geometry && !!shaft && toolShape(tool) !== null)
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
  const shape = model === null ? toolShape(tool) : null
  const subject = useMemo<ToolPictureSubject | null>(
    () => (model !== null ? { model } : shape && { shape }),
    [model, shape]
  )
  const { width, height } = size
  const key = subject && toolPictures.key({ subject, framing, width, height })
  const image = useSyncExternalStore(toolPictures.subscribe, () =>
    key === null ? null : toolPictures.image(key)
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

/**
 * The tool beside its name, in the library's list and on tool cards: its cutting end, else its
 * product photo, else (with `fallback`) a placeholder.
 */
export function ToolThumbnail({
  tool,
  size = THUMBNAIL,
  fallback = false,
}: {
  tool: ToolPictureSource & ToolImageSubject
  size?: ToolPictureSize
  fallback?: boolean
}) {
  if (hasToolPicture(tool))
    return <ToolPicture tool={tool} framing="tip" size={size} />
  return (
    <ToolImage tool={tool} fallback={fallback} className={size.className} />
  )
}
