import { useEffect, useMemo, useSyncExternalStore } from "react"
import { toolShape } from "@/domain/tools/tool-shape"
import type { ToolShape, ToolShapeSource } from "@/domain/tools/tool-shape"
import type { Tool } from "@/domain/tools/tool"

/** "tool": the whole tool; "tip": its cutting end, as wide as the tool. */
export type ToolFraming = "tool" | "tip"

/** What a picture shows: the tool's 3D model (a GLB's URL), or the shape its dimensions describe. */
export type ToolPictureSubject =
  { readonly model: string } | { readonly shape: ToolShape }

/** A picture to draw, in CSS pixels. */
export type ToolPictureRequest = {
  readonly subject: ToolPictureSubject
  readonly framing: ToolFraming
  readonly width: number
  readonly height: number
}

/**
 * What a picture of a tool is drawn from: its 3D model, or else the shape its dimensions
 * describe. A plugin's tool has no model, and one from a plugin built against an earlier kit
 * may come without its dimensions.
 */
export type ToolPictureSource = Pick<Tool, "kind" | "diameter"> &
  Partial<Pick<Tool, "model" | "geometry" | "shaft">>

/**
 * The picture beside a tool's name, in the library's list and on tool cards: its cutting end,
 * in CSS pixels.
 */
export const TOOL_THUMBNAIL = {
  framing: "tip",
  width: 24,
  height: 48,
} as const satisfies Omit<ToolPictureRequest, "subject">

/** Pictures kept; the list shows a few dozen at a time. */
const CACHE_LIMIT = 600
/** Models a key names by number, as a chosen model's URL is its whole file (up to 1.4 MB). */
const MODEL_KEY_LIMIT = 50

/** The shape the tool's dimensions describe; null without them, or when they describe none. */
export function pictureShape(tool: ToolPictureSource): ToolShape | null {
  if (!tool.geometry || !tool.shaft) return null
  return toolShape(tool as ToolShapeSource)
}

/** What a picture shows: the model, or else the shape; null without either. */
export function pictureSubject(
  model: string | null,
  shape: ToolShape | null
): ToolPictureSubject | null {
  if (model !== null) return { model }
  return shape && { shape }
}

/** Whether the tool has a picture: a 3D model, or dimensions that describe a shape. */
export const hasToolPicture = (tool: ToolPictureSource) =>
  !!tool.model || pictureShape(tool) !== null

type Painter = (key: string, request: ToolPictureRequest) => void

/**
 * Pictures of tools as the tool library draws them (`toolPictures`, with three.js), which
 * anything shows without drawing: tool cards, also in plugins' views. A picture is kept by what
 * it shows at its size in the theme, so equal shapes share one. What is asked for (`want`) is
 * drawn by whatever draws here (`serve`); a plugin's view has none.
 */
class ToolPictureCache {
  private readonly images = new Map<string, string>()
  private readonly listeners = new Set<() => void>()
  /** Asked for before anything draws; drawn once something does. */
  private readonly wanted = new Map<string, ToolPictureRequest>()
  private painter: Painter | null = null
  private notifying = false
  private readonly shapeKeys = new WeakMap<ToolShape, string>()
  /** Models by number, oldest use first; a dropped model's number is never used again. */
  private readonly modelNumbers = new Map<string, number>()
  private modelCount = 0

  /** The key a picture is kept by: what it shows, at its size, in the theme cuts are drawn in. */
  key({ subject, framing, width, height }: ToolPictureRequest) {
    const theme = document.documentElement.className
    const size = `${theme} ${framing} ${width}×${height}@${window.devicePixelRatio}`
    if ("shape" in subject) return `${size} ${this.shapeKey(subject.shape)}`
    return `${size} model ${this.modelNumber(subject.model)}`
  }

  image(key: string) {
    return this.images.get(key) ?? null
  }

  has(key: string) {
    return this.images.has(key)
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Keeps a drawn picture; the least recently drawn beyond the limit go first. */
  keep(key: string, image: string) {
    this.images.set(key, image)
    if (this.images.size > CACHE_LIMIT) {
      const oldest = this.images.keys().next()
      if (!oldest.done) this.images.delete(oldest.value)
    }
    this.notify()
  }

  /** Asks for a picture that is not kept yet. */
  want(key: string, request: ToolPictureRequest) {
    if (this.images.has(key)) return
    if (this.painter) this.painter(key, request)
    else this.wanted.set(key, request)
  }

  /** Draws what is asked for, and was before, until the returned function stops it. */
  serve(painter: Painter) {
    this.painter = painter
    for (const [key, request] of this.wanted) painter(key, request)
    this.wanted.clear()
    return () => {
      if (this.painter === painter) this.painter = null
    }
  }

  /** Once for the pictures kept in one task. */
  private notify() {
    if (this.notifying) return
    this.notifying = true
    queueMicrotask(() => {
      this.notifying = false
      for (const listener of this.listeners) listener()
    })
  }

  private shapeKey(shape: ToolShape) {
    let key = this.shapeKeys.get(shape)
    if (key === undefined) {
      key = JSON.stringify(shape.parts)
      this.shapeKeys.set(shape, key)
    }
    return key
  }

  /** The model's number; the least recently used beyond the limit loses its own. */
  private modelNumber(url: string): number {
    let number = this.modelNumbers.get(url)
    if (number === undefined) number = this.modelCount++
    else this.modelNumbers.delete(url)
    this.modelNumbers.set(url, number)
    if (this.modelNumbers.size > MODEL_KEY_LIMIT) {
      const oldest = this.modelNumbers.keys().next()
      if (!oldest.done) this.modelNumbers.delete(oldest.value)
    }
    return number
  }
}

export const toolPictureCache = new ToolPictureCache()

/** The tool's thumbnail as the tool library drew it, asked for when it has not yet; null then. */
export function toolThumbnail(tool: ToolPictureSource): string | null {
  const model = tool.model ?? null
  const subject = pictureSubject(
    model,
    model === null ? pictureShape(tool) : null
  )
  if (!subject) return null
  const request = { subject, ...TOOL_THUMBNAIL }
  const key = toolPictureCache.key(request)
  toolPictureCache.want(key, request)
  return toolPictureCache.image(key)
}

/**
 * The tool's thumbnail: the one a plugin's view was given with the tool, else the tool
 * library's, asked for until it has drawn it; null until then, or without a picture.
 */
export function useToolThumbnail(
  tool: ToolPictureSource & { readonly picture?: string | null }
): string | null {
  const given = tool.picture ?? null
  const model = given === null ? (tool.model ?? null) : null
  const shape = given === null && model === null ? pictureShape(tool) : null
  const request = useMemo(() => {
    const subject = pictureSubject(model, shape)
    return subject && { subject, ...TOOL_THUMBNAIL }
  }, [model, shape])
  const key = request && toolPictureCache.key(request)
  const image = useSyncExternalStore(toolPictureCache.subscribe, () =>
    key === null ? null : toolPictureCache.image(key)
  )
  useEffect(() => {
    if (request && key !== null) toolPictureCache.want(key, request)
  }, [key, request])
  return given ?? image
}
