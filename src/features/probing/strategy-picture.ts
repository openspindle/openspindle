import * as THREE from "three"
import {
  Line2NodeMaterial,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  WebGPURenderer,
} from "three/webgpu"
import { LineSegments2 } from "three/addons/lines/webgpu/LineSegments2.js"
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js"
import { disposeObjects } from "@/lib/three-assets"
import type { SceneMove, ScenePart, StrategyScene } from "./strategy-scene"

/** The picture's size in CSS pixels, drawn at twice that. */
export const PICTURE = { width: 240, height: 160 } as const
const SCALE = 2

/** What the pictures are drawn in: the 3D view's probe green and next-touch magenta. */
const LOOK = {
  part: 0xc4cad2,
  edge: 0x5b6470,
  path: 0x22c55e,
  touch: 0xd946ef,
  probe: 0x2b3038,
  /** Line widths in CSS pixels, of a search and of travel. */
  probing: 2,
  travel: 1.25,
  /** A touch's dot and the stylus over the tip, mm. */
  dot: 0.8,
  stylus: { radius: 0.45, length: 16 },
} as const

/** Where the camera looks from, towards what is probed: front right, from above. */
const VIEW = new THREE.Vector3(0.9, -1.3, 1.05).normalize()
const FOV = 32

const material = () =>
  new MeshStandardNodeMaterial({
    color: LOOK.part,
    roughness: 0.85,
    metalness: 0,
  })

/** A part as a mesh, with its outline drawn in. */
function partMesh(part: ScenePart): THREE.Object3D {
  const group = new THREE.Group()
  const add = (geometry: THREE.BufferGeometry, at: THREE.Vector3) => {
    const mesh = new THREE.Mesh(geometry, material())
    mesh.position.copy(at)
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 30),
      new THREE.LineBasicMaterial({
        color: LOOK.edge,
        transparent: true,
        opacity: 0.6,
      })
    )
    edges.position.copy(at)
    group.add(mesh, edges)
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

/** Moves as lines of one width, over the parts. */
function lines(moves: readonly SceneMove[], width: number, opacity: number) {
  const geometry = new LineSegmentsGeometry().setPositions(
    moves.flatMap(({ start, end }) => [...start, ...end])
  )
  const line = new LineSegments2(
    geometry,
    new Line2NodeMaterial({
      color: LOOK.path,
      linewidth: width,
      transparent: opacity < 1,
      opacity,
    })
  )
  line.renderOrder = 2
  return line
}

/** The scene's parts, its moves, a dot at every touch, and the probe's tip where it starts. */
function sceneOf({ parts, moves, touches, tip, ball }: StrategyScene) {
  const scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(0xffffff, 2.2))
  const light = new THREE.DirectionalLight(0xffffff, 2.6)
  light.position.set(60, -120, 200)
  const fill = new THREE.DirectionalLight(0xd4e5ff, 1.2)
  fill.position.set(-120, 80, 60)
  scene.add(light, fill)
  for (const part of parts) scene.add(partMesh(part))
  const probing = moves.filter((move) => move.probing)
  const travel = moves.filter((move) => !move.probing)
  if (travel.length) scene.add(lines(travel, LOOK.travel, 0.55))
  if (probing.length) scene.add(lines(probing, LOOK.probing, 1))
  const dot = new THREE.SphereGeometry(LOOK.dot, 16, 12)
  const magenta = new MeshBasicNodeMaterial({ color: LOOK.touch })
  for (const touch of touches) {
    const mesh = new THREE.Mesh(dot, magenta)
    mesh.position.set(...touch)
    mesh.renderOrder = 3
    scene.add(mesh)
  }
  const probe = new MeshStandardNodeMaterial({
    color: LOOK.probe,
    roughness: 0.4,
    metalness: 0.3,
  })
  const head = new THREE.Mesh(new THREE.SphereGeometry(ball, 24, 16), probe)
  head.position.set(tip[0], tip[1], tip[2] + ball)
  const { radius, length } = LOOK.stylus
  const stylus = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 16).rotateX(Math.PI / 2),
    probe
  )
  stylus.position.set(tip[0], tip[1], tip[2] + ball + length / 2)
  scene.add(head, stylus)
  return scene
}

/** A camera from `VIEW` that frames where the probe moves and touches. */
function cameraFor({ moves, touches, tip }: StrategyScene) {
  const box = new THREE.Box3()
  for (const { start, end } of moves)
    box
      .expandByPoint(new THREE.Vector3(...start))
      .expandByPoint(new THREE.Vector3(...end))
  for (const touch of touches) box.expandByPoint(new THREE.Vector3(...touch))
  box.expandByPoint(new THREE.Vector3(...tip))
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const radius = Math.max(sphere.radius, 8) * 1.08
  const camera = new THREE.PerspectiveCamera(
    FOV,
    PICTURE.width / PICTURE.height,
    1,
    2000
  )
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(FOV) / 2)
  camera.up.set(0, 0, 1)
  camera.position.copy(sphere.center).addScaledVector(VIEW, distance)
  camera.lookAt(sphere.center)
  return camera
}

/** The one renderer the pictures are drawn with, on a canvas of their size; null without one. */
let renderer: Promise<WebGPURenderer | null> | null = null
function pictureRenderer() {
  renderer ??= (async () => {
    const made = new WebGPURenderer({ antialias: true, alpha: true })
    made.setPixelRatio(SCALE)
    made.setSize(PICTURE.width, PICTURE.height, false)
    made.setClearColor(0x000000, 0)
    made.outputColorSpace = THREE.SRGBColorSpace
    try {
      await made.init()
      return made
    } catch {
      return null
    }
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
    const drawer = await pictureRenderer()
    if (!drawer) return null
    const three = sceneOf(scene)
    try {
      drawer.render(three, cameraFor(scene))
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
      disposeObjects(three)
    }
  })
  queue = drawn.catch(() => null)
  pictures.set(key, drawn)
  return drawn
}
