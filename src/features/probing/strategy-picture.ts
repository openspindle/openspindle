import * as THREE from "three"
import {
  Line2NodeMaterial,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  WebGPURenderer,
} from "three/webgpu"
import { LineSegments2 } from "three/addons/lines/webgpu/LineSegments2.js"
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js"
import { themeColor } from "@/components/workspace/viewer/palette"
import { SolidStyle } from "@/components/workspace/viewer/solid-style"
import { studioEnvironment } from "@/components/workspace/viewer/studio"
import { fitIsometric } from "@/lib/isometric-view"
import { disposeObjects } from "@/lib/three-assets"
import type { SceneMove, ScenePart, StrategyScene } from "./strategy-scene"

/** The picture's size in CSS pixels, drawn at twice that. */
export const PICTURE = { width: 240, height: 160 } as const
const SCALE = 2

/**
 * What the pictures are drawn in, like a CAD model's shaded view with visible edges: glossy parts
 * lit by a studio, with their edges drawn, on no background (the page's shows through); the 3D
 * view's probe green and next-touch magenta, and a probe like Makera's 3D probe: a metal stylus
 * with a magenta ball.
 */
const LOOK = {
  /** The parts' colour where the theme has no primary colour. */
  part: "#3159d7",
  path: 0x22c55e,
  /** Travel, paler than a search, on any background. */
  travelPath: 0x86dfa6,
  touch: 0xd946ef,
  stylus: 0xb9c0c8,
  /** Line widths in CSS pixels, of a search and of travel. */
  probing: 2,
  travel: 1.25,
  /** How wide the parts' edges are drawn, CSS pixels. */
  edges: 0.75,
  /**
   * A touch's disc, half see-through, and its opaque centre, how far off its surface they lie,
   * and the stylus over the ball, mm.
   */
  dot: { radius: 0.9, centre: 0.4, lift: 0.05 },
  shaft: { radius: 0.45, length: 16 },
} as const

/** How much room the picture leaves around what it frames, as a share of it. */
const MARGIN = 0.18

/** A part as a mesh, glossy in `color`. */
function partMesh(part: ScenePart, color: THREE.Color): THREE.Object3D {
  const group = new THREE.Group()
  const add = (geometry: THREE.BufferGeometry, at: THREE.Vector3) => {
    const mesh = new THREE.Mesh(
      geometry,
      new MeshPhysicalNodeMaterial({
        color,
        roughness: 0.35,
        metalness: 0,
        clearcoat: 0.6,
        clearcoatRoughness: 0.15,
      })
    )
    mesh.position.copy(at)
    group.add(mesh)
  }
  switch (part.kind) {
    case "box": {
      const size = part.max.map((value, index) => value - part.min[index])
      add(
        new THREE.BoxGeometry(size[0], size[1], size[2]),
        new THREE.Vector3(
          ...part.min.map((value, index) => value + size[index] / 2)
        )
      )
      break
    }
    case "cylinder": {
      const geometry = new THREE.CylinderGeometry(
        part.radius,
        part.radius,
        part.top - part.bottom,
        64
      ).rotateX(Math.PI / 2)
      add(
        geometry,
        new THREE.Vector3(...part.center, (part.top + part.bottom) / 2)
      )
      break
    }
    case "bore": {
      const [x0, y0, z0] = part.min
      const [x1, y1, z1] = part.max
      const shape = new THREE.Shape()
        .moveTo(x0, y0)
        .lineTo(x1, y0)
        .lineTo(x1, y1)
        .lineTo(x0, y1)
        .closePath()
      shape.holes.push(
        new THREE.Path().absarc(...part.center, part.radius, 0, Math.PI * 2)
      )
      add(
        new THREE.ExtrudeGeometry(shape, {
          depth: z1 - part.floor,
          bevelEnabled: false,
          curveSegments: 64,
        }),
        new THREE.Vector3(0, 0, part.floor)
      )
      add(
        new THREE.BoxGeometry(x1 - x0, y1 - y0, part.floor - z0),
        new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + part.floor) / 2)
      )
      break
    }
  }
  return group
}

/**
 * Moves as lines of one width and colour, over the parts. Opaque: a see-through fat line blends
 * with a copy of the screen that every renderer in the window shares, which drawing a picture
 * would resize under the 3D view.
 */
function lines(
  moves: readonly SceneMove[],
  width: number,
  color: THREE.ColorRepresentation
) {
  const geometry = new LineSegmentsGeometry().setPositions(
    moves.flatMap(({ start, end }) => [...start, ...end])
  )
  const line = new LineSegments2(
    geometry,
    new Line2NodeMaterial({ color, linewidth: width })
  )
  line.renderOrder = 2
  return line
}

/**
 * The scene's parts in `color`, its moves, a dot at every touch, and the probe's tip where it
 * starts.
 */
function sceneOf(
  { parts, moves, touches, tip, ball }: StrategyScene,
  color: THREE.Color
) {
  const scene = new THREE.Scene()
  for (const part of parts) scene.add(partMesh(part, color))
  // The studio's light all round, and a soft key from above and the front right.
  const key = new THREE.DirectionalLight(0xffffff, 1.2)
  key.position.set(1, -0.6, 1.6)
  scene.add(key)
  const probing = moves.filter((move) => move.probing)
  const travel = moves.filter((move) => !move.probing)
  if (travel.length) scene.add(lines(travel, LOOK.travel, LOOK.travelPath))
  if (probing.length) scene.add(lines(probing, LOOK.probing, LOOK.path))
  // Each touch a disc lying on the surface it touches, facing out of it: half see-through,
  // around an opaque centre lying just over it.
  const disc = new THREE.CircleGeometry(LOOK.dot.radius, 32)
  const centre = new THREE.CircleGeometry(LOOK.dot.centre, 32)
  const halo = new MeshBasicNodeMaterial({
    color: LOOK.touch,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  })
  const magenta = new MeshBasicNodeMaterial({
    color: LOOK.touch,
    side: THREE.DoubleSide,
  })
  const face = new THREE.Vector3(0, 0, 1)
  for (const { point, normal } of touches) {
    const facing = new THREE.Vector3(...normal).normalize()
    for (const [geometry, paint, lift] of [
      [disc, halo, LOOK.dot.lift],
      [centre, magenta, 2 * LOOK.dot.lift],
    ] as const) {
      const mesh = new THREE.Mesh(geometry, paint)
      mesh.quaternion.setFromUnitVectors(face, facing)
      mesh.position.set(...point).addScaledVector(facing, lift)
      mesh.renderOrder = 3
      scene.add(mesh)
    }
  }
  const ruby = new MeshStandardNodeMaterial({
    color: LOOK.touch,
    roughness: 0.35,
    metalness: 0,
  })
  const steel = new MeshStandardNodeMaterial({
    color: LOOK.stylus,
    roughness: 0.3,
    metalness: 0.6,
  })
  const head = new THREE.Mesh(new THREE.SphereGeometry(ball, 32, 24), ruby)
  head.position.set(tip[0], tip[1], tip[2] + ball)
  const { radius, length } = LOOK.shaft
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 24).rotateX(Math.PI / 2),
    steel
  )
  shaft.position.set(tip[0], tip[1], tip[2] + ball + length / 2)
  scene.add(head, shaft)
  return scene
}

/** The isometric view, centred on and framing where the probe moves and touches. */
function cameraFor({ moves, touches, tip, ball }: StrategyScene) {
  const points = [
    ...moves.flatMap(({ start, end }) => [start, end]),
    ...touches.map(({ point }) => point),
    tip,
    [tip[0], tip[1], tip[2] + 2 * ball] as const,
  ].map((point) => new THREE.Vector3(...point))
  const camera = new THREE.OrthographicCamera()
  fitIsometric(camera, points, {
    aspect: PICTURE.width / PICTURE.height,
    margin: MARGIN,
    least: 10,
  })
  return camera
}

/**
 * The one renderer the pictures are drawn with, on a canvas of their size, and the studio they
 * are lit in; null without one.
 */
let renderer: Promise<{
  readonly drawer: WebGPURenderer
  readonly studio: THREE.Texture
} | null> | null = null
function pictureRenderer() {
  renderer ??= (async () => {
    const drawer = new WebGPURenderer({ antialias: true, alpha: true })
    drawer.setPixelRatio(SCALE)
    drawer.setSize(PICTURE.width, PICTURE.height, false)
    drawer.setClearColor(0x000000, 0)
    drawer.outputColorSpace = THREE.SRGBColorSpace
    try {
      await drawer.init()
    } catch {
      return null
    }
    return { drawer, studio: studioEnvironment(drawer) }
  })()
  return renderer
}

/** Pictures by key while they are drawn, and once drawn; drawn one at a time. */
const pictures = new Map<string, Promise<string | null>>()
let queue: Promise<unknown> = Promise.resolve()

/**
 * A picture of the scene `make` builds, as an object URL of a PNG; null where it builds none or
 * nothing can draw it. Built and drawn once per key, one after another on one renderer, and kept
 * while the app runs.
 */
export function strategyPicture(
  key: string,
  make: () => StrategyScene | null
): Promise<string | null> {
  const known = pictures.get(key)
  if (known) return known
  const drawn = queue.then(async () => {
    const scene = make()
    if (!scene) return null
    const drawing = await pictureRenderer()
    if (!drawing) return null
    const { drawer, studio } = drawing
    // The parts in the theme's primary colour, as it is now.
    const three = sceneOf(
      scene,
      themeColor(document.documentElement, "--primary", LOOK.part)
    )
    three.environment = studio
    const camera = cameraFor(scene)
    // With their edges drawn, as the 3D view's Shaded Edges style draws them.
    const style = new SolidStyle()
    style.set("edges")
    style.lineWidth = LOOK.edges
    three.add(style.group)
    try {
      style.update(three, camera)
      drawer.render(three, camera)
      // A WebGPU canvas keeps what was drawn only until the task ends: copy it now.
      const copy = document.createElement("canvas")
      copy.width = PICTURE.width * SCALE
      copy.height = PICTURE.height * SCALE
      copy.getContext("2d")?.drawImage(drawer.domElement, 0, 0)
      const blob = await new Promise<Blob | null>((resolve) =>
        copy.toBlob(resolve, "image/png")
      )
      return blob ? URL.createObjectURL(blob) : null
    } finally {
      style.dispose()
      disposeObjects(three)
    }
  })
  queue = drawn.catch(() => null)
  pictures.set(key, drawn)
  return drawn
}
