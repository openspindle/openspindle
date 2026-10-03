import * as THREE from "three"
import { WebGPURenderer } from "three/webgpu"
import { disposeObjects } from "@/lib/three-assets"
import { createRenderLoop } from "./render-loop"
import type { FrameCallback } from "./render-loop"

/** The muted grid lines under a bed or a fixture model: the line colour, then the section. */
export const GRID_COLORS = [0xc2c9d1, 0xd7dde3] as const

/** The light rig's intensities: on its own, and under a studio (`useStudio`). */
const LIGHTS = { ambient: 2.4, key: 3, fill: 1.8 } as const
const STUDIO_LIGHTS = { ambient: 0, key: 1.2, fill: 0.3 } as const

export type ViewerStageEvents = {
  /** The renderer's new client size, both non-zero: update the camera's projection here. */
  resize: (width: number, height: number) => void
  /** The renderer could not start: neither WebGPU nor WebGL 2 is available. */
  unavailable?: (error: unknown) => void
}

/**
 * What the bed viewer and the fixture model preview share: a renderer (WebGPU, else WebGL 2)
 * sized to its container, the same light rig, a render-on-demand loop, and disposal. The caller
 * creates its own camera and controls and adds its own content to `scene`; call `resize()`
 * once, after they are ready, to size the renderer. Frames wait until the renderer has started.
 */
export class ViewerStage {
  readonly renderer: WebGPURenderer
  readonly scene = new THREE.Scene()
  private readonly ambient = new THREE.AmbientLight(0xffffff, LIGHTS.ambient)
  private readonly key = new THREE.DirectionalLight(0xffffff, LIGHTS.key)
  private readonly fill = new THREE.DirectionalLight(0xd4e5ff, LIGHTS.fill)
  private readonly container: HTMLElement
  private readonly events: ViewerStageEvents
  private readonly loop: ReturnType<typeof createRenderLoop>
  private readonly observer: ResizeObserver
  private started = false
  private disposed = false

  constructor(
    container: HTMLElement,
    frame: FrameCallback,
    events: ViewerStageEvents
  ) {
    this.container = container
    this.events = events
    const renderer = new WebGPURenderer({ antialias: true, alpha: true })
    this.renderer = renderer
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0xe9ecef, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(renderer.domElement)
    this.key.position.set(0, -100, 400)
    this.fill.position.set(300, 250, 100)
    this.scene.add(this.ambient, this.key, this.fill)
    this.loop = createRenderLoop(() => this.started && frame())
    this.observer = new ResizeObserver(this.resize)
    this.observer.observe(container)
    renderer.init().then(
      () => {
        if (this.disposed) return
        this.started = true
        this.resize()
      },
      (error: unknown) => {
        if (!this.disposed) this.events.unavailable?.(error)
      }
    )
  }

  /**
   * Lights the scene from `studio` (an environment map), the rig dimmed to a soft key so that
   * the studio's gradients and reflections show; null lights it with the rig alone.
   */
  useStudio(studio: THREE.Texture | null) {
    if (this.scene.environment === studio) return
    this.scene.environment = studio
    const lights = studio ? STUDIO_LIGHTS : LIGHTS
    this.ambient.intensity = lights.ambient
    this.key.intensity = lights.key
    this.fill.intensity = lights.fill
  }

  get canvas() {
    return this.renderer.domElement
  }

  readonly invalidate = () => this.loop.invalidate()

  /** Sizes the renderer to the container and lets the caller update its camera; then draws. */
  readonly resize = () => {
    const { clientWidth: width, clientHeight: height } = this.container
    if (!width || !height) return
    this.renderer.setSize(width, height)
    this.events.resize(width, height)
    // Resizing clears the canvas; draw in this frame so it never shows blank.
    this.loop.flush()
  }

  dispose() {
    this.disposed = true
    this.observer.disconnect()
    this.loop.dispose()
    disposeObjects(this.scene)
    this.renderer.dispose()
    // On WebGL 2 the context goes now, not once the canvas is collected: Chromium keeps only a
    // few alive and drops the oldest, which may be one still in use.
    const { gl } = this.renderer.backend as { gl?: WebGL2RenderingContext }
    gl?.getExtension("WEBGL_lose_context")?.loseContext()
    this.canvas.remove()
  }
}
