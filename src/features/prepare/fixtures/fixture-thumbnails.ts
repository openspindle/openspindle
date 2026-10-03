import { useEffect, useMemo, useSyncExternalStore } from "react"
import * as THREE from "three"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { log } from "@/app/errors/log"
import type { ModelMeshes } from "@/components/workspace/viewer/viewer-assets"
import { definitionFinish } from "@/domain/fixtures/catalog"
import type {
  FixtureDefinition,
  FixtureMeshSource,
  FixtureModel,
} from "@/domain/fixtures/definitions"
import {
  disposeMaterials,
  disposeObjects,
  glbInBedSpace,
  inFixtureFrame,
  materialsOf,
} from "@/lib/three-assets"
import { boxCorners, fitIsometric } from "@/lib/isometric-view"
import { useHost } from "@/platform/host-context"

/** A thumbnail's size, in CSS pixels. */
export const FIXTURE_THUMBNAIL = { width: 192, height: 144 } as const

/** Room left around the model, as a share of its size: it is seen isometrically. */
const MARGIN = 0.08
/** The renderer is released after this long without a picture to draw. */
const IDLE_MS = 5000
/** Pictures kept; a device holds a few dozen fixtures at most. */
const CACHE_LIMIT = 200

/** What a picture shows, which it is kept by; null for a fixture without a model. */
function thumbnailKey(definition: FixtureDefinition): string | null {
  const { model } = definition
  if (!model) return null
  return JSON.stringify([
    model.source,
    model.bounds,
    model.offset,
    model.orientation ?? null,
    definition.color,
    definition.material ?? null,
    definition.kind,
    window.devicePixelRatio,
  ])
}

/** A model's mesh in bed space; null for a library model the library does not have. */
async function loadMesh(
  source: FixtureMeshSource,
  meshes: ModelMeshes
): Promise<THREE.Object3D | null> {
  const loader = new GLTFLoader()
  if (source.kind === "bundled")
    return glbInBedSpace((await loader.loadAsync(source.url)).scene)
  const mesh = await meshes(source.modelId)
  if (!mesh) return null
  const gltf = await loader.parseAsync(new Uint8Array(mesh).buffer, "")
  return glbInBedSpace(gltf.scene)
}

/**
 * The fixture as the plate draws it, in its frame: its mesh in the fixture's colour and finish,
 * else its model's box.
 */
function fixtureContent(
  definition: FixtureDefinition,
  model: FixtureModel,
  mesh: THREE.Object3D | null
): THREE.Object3D {
  const { metalness, roughness } = definitionFinish(definition)
  const material = new THREE.MeshStandardMaterial({
    color: definition.color,
    metalness,
    roughness,
  })
  if (mesh) {
    const originals = new Set<THREE.Material>()
    mesh.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      for (const original of materialsOf(child)) originals.add(original)
      child.material = material
    })
    disposeMaterials(originals)
    return inFixtureFrame(model, mesh)
  }
  const { min, max } = model.bounds
  const size = max.map((value, axis) => Math.max(value - min[axis], 0.1))
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    material
  )
  box.position.set(
    min[0] + size[0] / 2,
    min[1] + size[1] / 2,
    min[2] + size[2] / 2
  )
  return box
}

/** The offscreen renderer, its lights and camera. */
class Studio {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera()

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
    const key = new THREE.DirectionalLight(0xffffff, 1.4)
    key.position.set(-60, -100, 140)
    this.scene.add(key)
  }

  /** The GPU dropped the context (a driver reset); a new studio draws again. */
  get lost() {
    return this.renderer.getContext().isContextLost()
  }

  dispose() {
    this.scene.environment?.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }

  /** A picture of the content as a PNG data URL, framed to fill it. */
  draw(content: THREE.Object3D): string {
    this.scene.add(content)
    try {
      content.updateMatrixWorld(true)
      fitIsometric(
        this.camera,
        boxCorners(new THREE.Box3().setFromObject(content, true)),
        {
          aspect: FIXTURE_THUMBNAIL.width / FIXTURE_THUMBNAIL.height,
          margin: MARGIN,
        }
      )
      const { width, height } = FIXTURE_THUMBNAIL
      this.renderer.setPixelRatio(window.devicePixelRatio)
      this.renderer.setSize(width, height, false)
      this.renderer.render(this.scene, this.camera)
      return this.renderer.domElement.toDataURL("image/png")
    } finally {
      content.removeFromParent()
    }
  }
}

/**
 * Pictures of fixture definitions' models, drawn offscreen once each and kept: the mesh in the
 * fixture's colour, or its box. The renderer is released while nothing is drawn.
 */
class FixtureThumbnails {
  /** PNG data URLs by `thumbnailKey`; null for a picture that could not be drawn. */
  private readonly images = new Map<string, string | null>()
  private readonly drawing = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private studio: Studio | null = null
  private idle: ReturnType<typeof setTimeout> | undefined
  /** WebGL failed once; pictures are not drawn rather than retried on every request. */
  private unavailable = false

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** The picture kept by `key`: null when it could not be drawn, undefined until it is drawn. */
  image(key: string): string | null | undefined {
    return this.images.get(key)
  }

  /** Draws the definition's picture, kept by `key`, unless it is kept or drawn already. */
  request(key: string, definition: FixtureDefinition, meshes: ModelMeshes) {
    const { model } = definition
    if (!model || this.images.has(key) || this.drawing.has(key)) return
    this.drawing.add(key)
    void this.draw(definition, model, meshes).then((image) => {
      this.drawing.delete(key)
      this.keep(key, image)
    })
  }

  private async draw(
    definition: FixtureDefinition,
    model: FixtureModel,
    meshes: ModelMeshes
  ): Promise<string | null> {
    if (this.unavailable) return null
    let mesh: THREE.Object3D | null = null
    // A library model missing from the library is drawn as its box, as the plate draws it.
    if (model.source.kind !== "box")
      try {
        mesh = await loadMesh(model.source, meshes)
      } catch (error) {
        log.warn("A fixture model could not be loaded for its picture", error)
        return null
      }
    const content = fixtureContent(definition, model, mesh)
    try {
      if (this.studio?.lost) {
        this.studio.dispose()
        this.studio = null
      }
      this.studio ??= new Studio()
      return this.studio.draw(content)
    } catch (error) {
      log.warn("Fixture pictures could not be drawn", error)
      this.unavailable = true
      return null
    } finally {
      disposeObjects(content)
      this.releaseLater()
    }
  }

  /** Releases the renderer once nothing has been drawn for a while. */
  private releaseLater() {
    clearTimeout(this.idle)
    this.idle = setTimeout(() => {
      if (this.drawing.size) {
        this.releaseLater()
        return
      }
      this.studio?.dispose()
      this.studio = null
    }, IDLE_MS)
  }

  private keep(key: string, image: string | null) {
    this.images.set(key, image)
    if (this.images.size > CACHE_LIMIT) {
      const oldest = this.images.keys().next()
      if (!oldest.done) this.images.delete(oldest.value)
    }
    for (const listener of this.listeners) listener()
  }
}

const fixtureThumbnails = new FixtureThumbnails()

/**
 * A picture of the definition's model, as a PNG data URL: drawn once and kept. Null for a
 * fixture without a model or a picture that could not be drawn; undefined while it is drawn.
 */
export function useFixtureThumbnail(
  definition: FixtureDefinition
): string | null | undefined {
  const models = useHost().models
  const key = useMemo(() => thumbnailKey(definition), [definition])
  const image = useSyncExternalStore(fixtureThumbnails.subscribe, () =>
    key === null ? null : fixtureThumbnails.image(key)
  )
  useEffect(() => {
    if (key !== null)
      fixtureThumbnails.request(key, definition, (id) => models.mesh(id))
  }, [key, definition, models])
  return image
}
