import * as THREE from "three"
import type { Point3 } from "@/domain/nc/gcode"
import { probeGridProgress } from "@/domain/probing/preview"
import type { ProbeGrid, ProbeTouch } from "@/domain/probing/preview"
import { disposeObjects } from "@/lib/three-assets"
import { STORED_ANCHOR_RADIUS, lineInRanges } from "../bed-viewer-layout"
import type { LineRange } from "../bed-viewer-layout"
import type { ViewerPalette } from "./palette"

/** A registered grid and its XY diagram on the plate's nominal surface. */
export type ProbeGridShape = {
  grid: ProbeGrid<"probe" | "bed">
  /** Planned samples in visiting order. */
  points: Point3[]
  outline: Point3[]
  /** Flat XYZ vertex pairs of the grid's rows and columns. */
  lines: number[]
}

/** A registered touch-off and where it touches the plate's nominal surface. */
export type ProbeTouchShape = {
  touch: ProbeTouch<"probe" | "bed">
  point: Point3
}

/** What a plate's probe grids show at the current preview position. */
export type ProbePresentation = {
  active: boolean
  ranges: readonly LineRange[]
  /** Program lines left out of the view, such as a hidden operation's. */
  hidden: readonly LineRange[]
  progress: number
  previewLine?: number | null
  previewProbePoint?: number | null
}

/** Materials with their emphasized opacity; other grids and touches draw at half strength. */
type Faded = Array<{ material: THREE.Material; opacity: number }>

type GridView = {
  shape: ProbeGridShape
  /** Everything the grid draws, which a hidden operation hides. */
  root: THREE.Group
  faded: Faded
  /** The revealed samples' markers, over the faint ones of all samples. */
  samples: THREE.InstancedMesh[]
  marker: THREE.Mesh
}

type TouchView = { shape: ProbeTouchShape; root: THREE.Group; faded: Faded }

/** A marker's unit discs: its half-opaque border, and the dot inside it. */
type MarkerDiscs = Record<"border" | "dot", THREE.CircleGeometry>

/** The dot's share of a marker's width; the rest is its half-opaque border. */
const DOT_SHARE = 0.3
/** Samples of dense grids shrink to at most this share of their spacing in radius. */
const SAMPLE_SPACING_SHARE = 0.3

function positions(coordinates: number[]) {
  return new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute(coordinates, 3)
  )
}

function dashedLine(points: Point3[], material: THREE.LineDashedMaterial) {
  const line = new THREE.Line(positions(points.flat()), material)
  line.computeLineDistances()
  line.renderOrder = 5
  return line
}

function lineMaterial(color: THREE.Color) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    depthTest: false,
  })
}

function dashedMaterial(color: THREE.Color) {
  return new THREE.LineDashedMaterial({
    color,
    transparent: true,
    depthTest: false,
    dashSize: 2,
    gapSize: 1,
  })
}

function overlayMaterial(color: THREE.Color) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
}

/** Registers each material's emphasized opacity with `faded`. */
function fader(faded: Faded) {
  return <TMaterial extends THREE.Material>(
    material: TMaterial,
    opacity: number
  ) => {
    faded.push({ material, opacity })
    return material
  }
}

/**
 * Markers of `radius` lying flat on the surface, one per point: a dot in a half-opaque border,
 * as the plate's anchors are drawn. `material` makes each part's material at its share of the
 * marker's opacity.
 */
function markers(
  discs: MarkerDiscs,
  points: readonly Point3[],
  radius: number,
  material: (share: number) => THREE.Material,
  renderOrder: number
) {
  const matrix = new THREE.Matrix4()
  return (
    [
      [discs.border, 0.5],
      [discs.dot, 1],
    ] as const
  ).map(([geometry, share], layer) => {
    const mesh = new THREE.InstancedMesh(
      geometry,
      material(share),
      points.length
    )
    points.forEach((point, index) =>
      mesh.setMatrixAt(
        index,
        matrix.makeScale(radius, radius, 1).setPosition(...point)
      )
    )
    // The bounds of every instance, so that revealing more of them never leaves them culled.
    mesh.computeBoundingSphere()
    mesh.renderOrder = renderOrder + layer
    return mesh
  })
}

/** Samples are as wide as a touch-off's marker, or narrower where the grid is too dense. */
function sampleRadius({ size, points }: ProbeGrid) {
  const spacing = Math.min(
    Math.abs(size[0]) / (points[0] - 1),
    Math.abs(size[1]) / (points[1] - 1)
  )
  return Math.min(STORED_ANCHOR_RADIUS, spacing * SAMPLE_SPACING_SHARE)
}

/**
 * Planned probe grids, and where touch-offs touch; playback reveals a grid's samples and moves
 * one marker. The probe's moves are the toolpath's.
 */
export class ProbeGridView {
  readonly group = new THREE.Group()
  private readonly grids: GridView[]
  private readonly touches: TouchView[]

  constructor(
    shapes: readonly ProbeGridShape[],
    touches: readonly ProbeTouchShape[],
    palette: Pick<ViewerPalette, "probe" | "touchOff">
  ) {
    const color = palette.probe
    let discs: MarkerDiscs | undefined
    const markerDiscs = () =>
      (discs ??= {
        border: new THREE.CircleGeometry(1, 28),
        dot: new THREE.CircleGeometry(DOT_SHARE, 28),
      })
    this.grids = shapes.map((shape) => {
      const faded: Faded = []
      const fade = fader(faded)
      const { points } = shape
      const root = new THREE.Group()
      this.group.add(root)
      if (shape.lines.length) {
        const lines = new THREE.LineSegments(
          positions(shape.lines),
          fade(lineMaterial(color), 0.16)
        )
        lines.renderOrder = 3
        root.add(lines)
      }
      root.add(dashedLine(shape.outline, fade(dashedMaterial(color), 0.5)))
      const radius = sampleRadius(shape.grid)
      const sampleMarkers = (opacity: number) =>
        markers(
          markerDiscs(),
          points,
          radius,
          (share) => fade(overlayMaterial(color), opacity * share),
          6
        )
      const samples = sampleMarkers(1)
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(1.3, 1.7, 28),
        overlayMaterial(color)
      )
      marker.scale.setScalar(radius)
      marker.renderOrder = 7
      root.add(...sampleMarkers(0.24), ...samples, marker)
      return { shape, root, faded, samples, marker }
    })
    this.touches = touches.map((shape) => {
      const faded: Faded = []
      const fade = fader(faded)
      const root = new THREE.Group()
      this.group.add(root)
      root.add(
        ...markers(
          markerDiscs(),
          [shape.point],
          STORED_ANCHOR_RADIUS,
          (share) => fade(overlayMaterial(palette.touchOff), share),
          8
        )
      )
      return { shape, root, faded }
    })
  }

  /** Whether any grid's or touch-off's source line is inside the selection. */
  intersects(ranges: readonly LineRange[]) {
    return (
      this.grids.some(({ shape }) =>
        lineInRanges(shape.grid.sourceLine, ranges)
      ) ||
      this.touches.some(({ shape }) =>
        lineInRanges(shape.touch.sourceLine, ranges)
      )
    )
  }

  includesLine(line?: number | null) {
    return this.grids.some(({ shape }) => shape.grid.sourceLine === line)
  }

  present(state: ProbePresentation) {
    const strength = (line: number) =>
      state.active && (!state.ranges.length || lineInRanges(line, state.ranges))
        ? 1
        : 0.5
    for (const view of this.grids) {
      const { grid, points } = view.shape
      view.root.visible = !lineInRanges(grid.sourceLine, state.hidden)
      const cursor = probeGridProgress(
        grid,
        state.previewLine,
        state.previewProbePoint,
        state.progress
      )
      const emphasis = strength(grid.sourceLine)
      for (const { material, opacity } of view.faded)
        material.opacity = opacity * emphasis
      const revealed = Math.min(cursor.revealedCount, points.length)
      for (const mesh of view.samples) {
        mesh.count = revealed
        mesh.visible = revealed > 0
      }
      const active =
        cursor.activePoint === null ? undefined : points.at(cursor.activePoint)
      view.marker.visible = active !== undefined
      if (active) view.marker.position.set(...active)
    }
    for (const { shape, root, faded } of this.touches) {
      root.visible = !lineInRanges(shape.touch.sourceLine, state.hidden)
      const emphasis = strength(shape.touch.sourceLine)
      for (const { material, opacity } of faded)
        material.opacity = opacity * emphasis
    }
  }

  dispose() {
    this.group.removeFromParent()
    // Instances keep their placements in buffers of their own.
    this.group.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose()
    })
    disposeObjects(this.group)
  }
}
