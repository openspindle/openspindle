import * as THREE from "three"
import { WebGPURenderer } from "three/webgpu"
import { disposeObjects } from "@/lib/three-assets"
import { createRenderLoop } from "./render-loop"
import type { FrameCallback } from "./render-loop"

/** The muted grid lines under a bed or a fixture model: the line colour, then the section. */
export const GRID_COLORS = [0xc2c9d1, 0xd7dde3] as const

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
    this.scene.add(new THREE.AmbientLight(0xffffff, 2.4))
    const light = new THREE.DirectionalLight(0xffffff, 3)
    light.position.set(0, -100, 400)
    this.scene.add(light)
    const fill = new THREE.DirectionalLight(0xd4e5ff, 1.8)
    fill.position.set(300, 250, 100)
    this.scene.add(fill)
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
