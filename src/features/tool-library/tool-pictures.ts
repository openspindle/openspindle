import * as THREE from "three"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { log } from "@/app/errors/log"
import { toolPictureCache } from "@/app/tools/tool-picture-cache"
import type {
  ToolFraming,
  ToolPictureRequest,
} from "@/app/tools/tool-picture-cache"
import { viewerPalette } from "@/components/workspace/viewer/palette"
import {
  disposeToolModel,
  toolMaterials,
  toolModel,
} from "@/components/workspace/viewer/tool-model"
import type { ToolMaterials } from "@/components/workspace/viewer/tool-model"
import type { ProfilePoint, ToolShape } from "@/domain/tools/tool-shape"
import { disposeObjects, glbInBedSpace } from "@/lib/three-assets"

/**
 * How far a tool reaches on screen, across its axis and up from its tip, and a length it
 * stays within.
 */
type Extent = {
  readonly across: number
  readonly bottom: number
  readonly top: number
  readonly size: number
}

/** The camera looks down on the tool from this far above its horizon. */
const ELEVATION = THREE.MathUtils.degToRad(18)
/** Room left around the tool, as a share of its size. */
const MARGIN = 0.08
/**
 * Loaded models kept; each keeps its data URL (chosen models run up to 1.4 MB) and its
 * three.js objects and GPU buffers alive, so far fewer than the pictures kept.
 */
const MODEL_CACHE_LIMIT = 50
/** Rendering yields to the page after this long, so scrolling and typing stay smooth. */
const TASK_BUDGET_MS = 8

/** A shape's extent: its outlines' circles. */
function shapeExtent(shape: ToolShape): Extent {
  const sin = Math.sin(ELEVATION)
  const cos = Math.cos(ELEVATION)
  let across = 0
  let bottom = Infinity
  let top = -Infinity
  const points: ProfilePoint[] = shape.parts.flatMap((part) => part.outline)
  for (const [radius, height] of points) {
    across = Math.max(across, radius)
    bottom = Math.min(bottom, height * cos - radius * sin)
    top = Math.max(top, height * cos + radius * sin)
  }
  return { across, bottom, top, size: shape.length + shape.radius }
}

/** A model's extent: the corners of its bounds, with the axis in the middle of the frame. */
function modelExtent(model: THREE.Object3D): Extent {
  const sin = Math.sin(ELEVATION)
  const cos = Math.cos(ELEVATION)
  const { min, max } = new THREE.Box3().setFromObject(model)
  let across = 0
  let bottom = Infinity
  let top = -Infinity
  let size = 0
  for (const x of [min.x, max.x])
    for (const y of [min.y, max.y])
      for (const z of [min.z, max.z]) {
        across = Math.max(across, Math.abs(x))
        bottom = Math.min(bottom, z * cos + y * sin)
        top = Math.max(top, z * cos + y * sin)
        size = Math.max(size, Math.abs(z) + Math.hypot(x, y))
      }
  return { across, bottom, top, size }
}

/** Half the frame's height and its middle's height on screen, for a frame of `aspect`. */
function frame(
  { across, bottom, top }: Extent,
  framing: ToolFraming,
  aspect: number
) {
  if (framing === "tool") {
    const tall = top - bottom
    const half = Math.max(across / aspect, tall / 2) * (1 + MARGIN)
    // The tool hangs from the top of the frame, as from a spindle.
    const pad = Math.min(across * MARGIN, half - tall / 2)
    return { half, middle: top + pad - half }
  }
  // The tool's widest part fills the width, and the tip stands at the bottom.
  const half = (across * (1 + MARGIN)) / aspect
  if (top - bottom <= 2 * half) return { half, middle: (bottom + top) / 2 }
  return { half, middle: bottom - across * MARGIN + half }
}

/** The renderer, lights and materials, made on the first picture. */
class Studio {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera()
  private readonly materials = new Map<string, ToolMaterials>()

  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      // The picture is read from the canvas after the frame is drawn.
      preserveDrawingBuffer: true,
    })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    const environment = new RoomEnvironment()
    const generator = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = generator.fromScene(environment, 0.04).texture
    generator.dispose()
    environment.dispose()
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(-60, -100, 140)
    this.scene.add(key)
    this.camera.up.set(0, 0, 1)
  }

  /** The GPU dropped the context (a driver reset); a new studio renders again. */
  get lost() {
    return this.renderer.getContext().isContextLost()
  }

  dispose() {
    for (const materials of this.materials.values())
      for (const material of Object.values(materials)) material.dispose()
    this.scene.environment?.dispose()
    this.renderer.dispose()
  }

  /** The picture of a shape, its flutes in `cut`, as a PNG data URL. */
  shape(request: ToolPictureRequest, shape: ToolShape, cut: string) {
    let materials = this.materials.get(cut)
    if (!materials) {
      materials = toolMaterials(cut)
      this.materials.set(cut, materials)
    }
    const model = toolModel(shape, materials)
    try {
      return this.render(request, model, shapeExtent(shape))
    } finally {
      disposeToolModel(model)
    }
  }

  /** The picture of a model in its own materials, as a PNG data URL. */
  model(request: ToolPictureRequest, model: THREE.Object3D) {
    try {
      return this.render(request, model, modelExtent(model))
    } finally {
      model.removeFromParent()
    }
  }

  private render(
    { framing, width, height }: ToolPictureRequest,
    model: THREE.Object3D,
    extent: Extent
  ): string {
    this.scene.add(model)
    const aspect = width / height
    const { half, middle } = frame(extent, framing, aspect)
    Object.assign(this.camera, {
      left: -half * aspect,
      right: half * aspect,
      top: half,
      bottom: -half,
      near: 0.1,
      far: 4 * extent.size + 20,
    })
    this.camera.updateProjectionMatrix()
    const target = new THREE.Vector3(0, 0, middle / Math.cos(ELEVATION))
    const distance = 2 * extent.size + 10
    this.camera.position
      .set(0, -Math.cos(ELEVATION), Math.sin(ELEVATION))
      .multiplyScalar(distance)
      .add(target)
    this.camera.lookAt(target)
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(width, height, false)
    this.renderer.render(this.scene, this.camera)
    return this.renderer.domElement.toDataURL("image/png")
  }
}

let themed: { theme: string; color: string } | null = null

/** The theme's primary colour, which cuts are drawn in; read again after a theme change. */
function cutColor() {
  const theme = document.documentElement.className
  if (themed?.theme !== theme)
    themed = {
      theme,
      color: `#${viewerPalette(document.body).primary.getHexString()}`,
    }
  return themed.color
}

/**
 * Draws tools' pictures, which it keeps in `toolPictureCache`: their 3D models, or the shapes
 * their dimensions describe. One offscreen renderer draws them a few at a time, so scrolling
 * and typing stay smooth. Each model loads once, and the least recently used beyond a limit are
 * dropped and disposed. A request may name the queued request it supersedes (an earlier draft
 * of the same picture), which is dropped undrawn.
 */
class ToolPictures {
  private readonly queue = new Map<
    string,
    { request: ToolPictureRequest; cut: string }
  >()
  /** Loaded models by URL, in tool space; null for one that could not be loaded. */
  private readonly models = new Map<string, THREE.Object3D | null>()
  private readonly loads = new Map<string, Promise<void>>()
  /** Models by use, oldest first, so the least recently used can be dropped. */
  private readonly used = new Set<string>()
  private studio: Studio | null = null
  /** WebGL failed once; the pictures stay empty rather than retrying on every request. */
  private unavailable = false
  private scheduled = false

  /**
   * Queues a picture, kept by `key` (`toolPictureCache.key`); `supersedes`, when given, is an
   * earlier request for the same subject (a previous draft's key) that is no longer wanted,
   * dropped from the queue undrawn if it is still there.
   */
  request(key: string, request: ToolPictureRequest, supersedes?: string) {
    if (supersedes !== undefined && supersedes !== key)
      this.queue.delete(supersedes)
    if (this.unavailable || toolPictureCache.has(key) || this.queue.has(key))
      return
    const { subject } = request
    if ("model" in subject) {
      this.use(subject.model)
      if (!this.models.has(subject.model)) {
        void this.load(subject.model).then(() => this.request(key, request))
        return
      }
    }
    this.queue.set(key, { request, cut: cutColor() })
    if (this.scheduled) return
    this.scheduled = true
    setTimeout(this.run)
  }

  private readonly run = () => {
    this.scheduled = false
    const start = performance.now()
    for (const [key, { request, cut }] of this.queue) {
      this.queue.delete(key)
      const image = this.draw(request, cut)
      if (image) toolPictureCache.keep(key, image)
      if (performance.now() - start > TASK_BUDGET_MS) break
    }
    if (this.queue.size && !this.unavailable) {
      this.scheduled = true
      setTimeout(this.run)
    }
  }

  /** Loads a model once; its pictures wait for it. */
  private load(url: string) {
    let load = this.loads.get(url)
    if (!load) {
      load = new GLTFLoader().loadAsync(url).then(
        (gltf) => {
          this.models.set(url, glbInBedSpace(gltf.scene))
        },
        () => {
          this.models.set(url, null)
        }
      )
      this.loads.set(url, load)
    }
    return load
  }

  /** Marks a model as just used; the least recently used beyond the limit is dropped. */
  private use(url: string) {
    this.used.delete(url)
    this.used.add(url)
    if (this.used.size > MODEL_CACHE_LIMIT)
      for (const candidate of this.used) {
        if (candidate === url || this.dropModel(candidate)) break
      }
  }

  /** Drops a model no longer wanted and releases its GPU resources; not one still loading. */
  private dropModel(url: string): boolean {
    if (this.loads.has(url) && !this.models.has(url)) return false
    this.used.delete(url)
    const model = this.models.get(url)
    this.models.delete(url)
    this.loads.delete(url)
    if (model) disposeObjects(model)
    return true
  }

  private draw(request: ToolPictureRequest, cut: string) {
    const { subject } = request
    try {
      if (this.studio?.lost) {
        this.studio.dispose()
        this.studio = null
      }
      this.studio ??= new Studio()
      if ("shape" in subject)
        return this.studio.shape(request, subject.shape, cut)
      const model = this.models.get(subject.model)
      return model ? this.studio.model(request, model) : null
    } catch (error) {
      log.warn("Tool pictures could not be drawn", error)
      this.unavailable = true
      this.queue.clear()
      return null
    }
  }
}

export const toolPictures = new ToolPictures()
