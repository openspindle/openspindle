import * as THREE from "three"
import type { ToolShape } from "@/domain/tools/tool-shape"
import type { GCodeProgram, GCodeSegment, Point3 } from "@/domain/nc/gcode"
import type { Playhead } from "@/domain/nc/move-times"
import type { ViewerToolRun } from "@/components/workspace/viewer/viewer-input"
import { disposeObjects } from "@/lib/three-assets"
import { TOOL_MARKER_LENGTH } from "../bed-viewer-layout"
import type { LineRange } from "../bed-viewer-layout"
import type { ViewerPalette } from "./palette"
import { sameRanges } from "./plate-identity"
import { disposeToolModel, toolMaterials, toolModel } from "./tool-model"
import type { ToolMaterials } from "./tool-model"
import {
  MOTIONS,
  motionOf,
  motionSegmentsBefore,
  segmentWindows,
  toolpathBuffers,
} from "./toolpath-buffers"
import type { Motion, SegmentWindow, ToolpathBuffers } from "./toolpath-buffers"

/** LineSegments draw two vertices per program segment. */
const SEGMENT_VERTICES = 2

type PathLines<TMaterial extends THREE.Material | THREE.Material[]> =
  THREE.LineSegments<THREE.BufferGeometry, TMaterial>

type MotionLayer = {
  motion: Motion
  /** Groups mark the revealed windows that no hidden range covers. */
  base: PathLines<THREE.LineBasicMaterial[]>
  /** Groups mark the selected windows; the draw range clips them to the revealed prefix. */
  selected: PathLines<THREE.LineBasicMaterial[]>
}

function pathMaterial(color: THREE.Color) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    depthTest: false,
  })
}

/** Views of one attribute share its GPU buffer, so they are disposed together. */
function bufferView(attribute: THREE.BufferAttribute, bounds: THREE.Sphere) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", attribute)
  geometry.boundingSphere = bounds.clone()
  return geometry
}

function cutOpacity(active: boolean, dimmed: boolean) {
  if (dimmed) return 0.2
  if (active) return 1
  return 0.65
}

/** Loads tool models for playback, and asks for a frame once one has arrived. */
export type ToolModels = {
  /**
   * A tool model (a GLB's URL) in tool space, or null when it is unavailable. It stays the
   * viewer's: clones share its geometry and materials.
   */
  load: (url: string) => Promise<THREE.Object3D | null>
  invalidate: () => void
}

/** The point `fraction` of the way along a move. */
const along = ({ start, end }: GCodeSegment, fraction: number): Point3 => [
  start[0] + (end[0] - start[0]) * fraction,
  start[1] + (end[1] - start[1]) * fraction,
  start[2] + (end[2] - start[2]) * fraction,
]

/**
 * The run of the tool in the spindle at `line`: the run whose lines hold it, else the last before
 * it, as a tool stays in until the next change; -1 before the first. Runs are in program order.
 */
function runIndexAt(runs: readonly ViewerToolRun[], line: number) {
  let low = 0
  let high = runs.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (runs[middle].lineEnd < line) low = middle + 1
    else high = middle
  }
  return low < runs.length && runs[low].lineStart <= line ? low : low - 1
}

/**
 * One plate's toolpath, drawn from the plate's work origin. Each motion's vertices upload
 * once and stay on the GPU: playback and hidden ranges only regroup what is drawn, a
 * selection change only regroups the overlay, and a new work origin only moves the group. Playback shows the
 * tool that makes the revealed segment: its 3D model once that has loaded, else as its
 * shape describes it.
 */
export class ToolpathView {
  readonly group = new THREE.Group()
  /** Holds the path and tool in program coordinates, placed at the work origin. */
  private readonly path = new THREE.Group()
  private readonly program: GCodeProgram
  private readonly buffers: ToolpathBuffers
  private readonly materials: Record<
    Motion | "selected" | "selectedProbe",
    THREE.LineBasicMaterial
  >
  private readonly layers: MotionLayer[]
  private tools: readonly ViewerToolRun[]
  private readonly toolMaterials: ToolMaterials
  /** Each tool shape's model, made when playback first shows it. */
  private readonly toolModels = new Map<ToolShape, THREE.Group>()
  private readonly models: ToolModels
  /** A clone of each tool model by URL; null while it loads, or when it is unavailable. */
  private readonly meshModels = new Map<string, THREE.Object3D | null>()
  /** Stands in for a tool whose record describes no shape. */
  private readonly marker: THREE.Mesh
  /** The move under way while playback simulates it, up to where the tool is. */
  private readonly move: THREE.Line<
    THREE.BufferGeometry,
    THREE.LineBasicMaterial
  >
  private shownTool: THREE.Object3D | null = null
  /** What `showTool` was last asked to show, to show again once a model arrives. */
  private shown: Parameters<ToolpathView["showTool"]> = [null]
  private disposed = false
  private ranges: readonly LineRange[] = []
  /** The selected windows that no hidden range covers. */
  private selection: SegmentWindow[] = []
  private hiddenRanges: readonly LineRange[] = []
  private hidden: SegmentWindow[] = []

  constructor(
    program: GCodeProgram,
    origin: Point3,
    palette: ViewerPalette,
    tools: readonly ViewerToolRun[],
    models: ToolModels
  ) {
    this.program = program
    this.tools = tools
    this.models = models
    this.buffers = toolpathBuffers(program)
    this.materials = {
      cut: pathMaterial(palette.primary),
      rapid: pathMaterial(palette.rapid),
      probe: pathMaterial(palette.probePath),
      selected: pathMaterial(palette.primary),
      // A selected probe path stays the probe's colour.
      selectedProbe: pathMaterial(palette.probePath),
    }
    this.layers = MOTIONS.flatMap((motion): MotionLayer[] => {
      const vertices = this.buffers.vertices[motion]
      if (!vertices.length) return []
      const attribute = new THREE.BufferAttribute(vertices, 3)
      const bounds = this.buffers.bounds[motion].getBoundingSphere(
        new THREE.Sphere()
      )
      const base = new THREE.LineSegments(bufferView(attribute, bounds), [
        this.materials[motion],
      ])
      base.renderOrder = 3
      const selected = new THREE.LineSegments(bufferView(attribute, bounds), [
        this.materials[motion === "probe" ? "selectedProbe" : "selected"],
      ])
      selected.renderOrder = 5
      this.path.add(base, selected)
      return [{ motion, base, selected }]
    })
    this.toolMaterials = toolMaterials(palette.primary)
    this.marker = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 0.5, TOOL_MARKER_LENGTH, 16),
      new THREE.MeshStandardMaterial({
        color: 0x2c333c,
        metalness: 0.8,
        roughness: 0.3,
      })
    )
    this.marker.rotation.x = Math.PI / 2
    this.marker.visible = false
    this.move = new THREE.Line(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(new Float32Array(6), 3)
      ),
      this.materials.cut
    )
    this.move.renderOrder = 3
    this.move.frustumCulled = false
    this.move.visible = false
    this.path.add(this.marker, this.move)
    this.group.add(this.path)
    this.place(origin)
  }

  /** New tools for the same program; models no run uses any more are released. */
  setTools(tools: readonly ViewerToolRun[]) {
    this.tools = tools
    const used = new Set(tools.map((run) => run.shape))
    for (const [shape, model] of this.toolModels) {
      if (used.has(shape)) continue
      if (model === this.shownTool) this.shownTool = null
      disposeToolModel(model)
      this.toolModels.delete(shape)
    }
    const urls = new Set(tools.map((run) => run.model))
    for (const [url, model] of this.meshModels) {
      if (urls.has(url)) continue
      if (model && model === this.shownTool) this.shownTool = null
      // The clone's geometry and materials stay with the viewer's model.
      model?.removeFromParent()
      this.meshModels.delete(url)
    }
  }

  /** A tool model's clone once it has loaded; asking for it the first time loads it. */
  private meshModel(url: string) {
    if (this.meshModels.has(url)) return this.meshModels.get(url) ?? null
    this.meshModels.set(url, null)
    void this.models.load(url).then((template) => {
      if (this.disposed || !template || !this.meshModels.has(url)) return
      const model = template.clone()
      model.visible = false
      this.path.add(model)
      this.meshModels.set(url, model)
      // The tool on show may be the one that arrived.
      if (this.shown[0] === null) return
      this.showTool(...this.shown)
      this.models.invalidate()
    })
    return null
  }

  private toolModel(shape: ToolShape) {
    let model = this.toolModels.get(shape)
    if (!model) {
      model = toolModel(shape, this.toolMaterials)
      model.visible = false
      this.toolModels.set(shape, model)
      this.path.add(model)
    }
    return model
  }

  /** Vertex range of one motion's segments among program segments [first, last). */
  private vertexRange(motion: Motion, first: number, last: number) {
    const start = motionSegmentsBefore(this.buffers, motion, first)
    const end = motionSegmentsBefore(this.buffers, motion, last)
    return {
      start: start * SEGMENT_VERTICES,
      count: (end - start) * SEGMENT_VERTICES,
    }
  }

  /** Moves the path to the plate's work origin without touching geometry. */
  place(origin: Point3) {
    this.path.position.set(...origin)
  }

  /** Segment windows within [first, last) that no hidden range covers. */
  private shownWindows(first: number, last: number): SegmentWindow[] {
    const shown: SegmentWindow[] = []
    let from = first
    for (const part of this.hidden) {
      if (part.last <= from) continue
      if (part.first >= last) break
      if (part.first > from) shown.push({ first: from, last: part.first })
      from = part.last
    }
    if (from < last) shown.push({ first: from, last })
    return shown
  }

  /** Leaves source ranges out of the drawing, as a hidden operation's. */
  hide(ranges: readonly LineRange[]) {
    if (sameRanges(ranges, this.hiddenRanges)) return
    this.hiddenRanges = ranges
    this.hidden = segmentWindows(this.program, ranges)
    this.regroupSelection()
  }

  /** Regroups the selection overlay when the selected source ranges change. */
  select(ranges: readonly LineRange[]) {
    if (sameRanges(ranges, this.ranges)) return
    this.ranges = ranges
    this.regroupSelection()
  }

  private regroupSelection() {
    this.selection = segmentWindows(this.program, this.ranges).flatMap((part) =>
      this.shownWindows(part.first, part.last)
    )
    for (const layer of this.layers) {
      const geometry = layer.selected.geometry
      geometry.clearGroups()
      for (const part of this.selection) {
        const { start, count } = this.vertexRange(
          layer.motion,
          part.first,
          part.last
        )
        if (count > 0) geometry.addGroup(start, count)
      }
    }
  }

  /**
   * Shows the first `count` program segments, the rapids only with `showRapids`; reports
   * whether a selected one shows.
   */
  reveal(count: number, showRapids: boolean) {
    const drawn = (motion: Motion) => motion !== "rapid" || showRapids
    const shown = this.shownWindows(0, count)
    for (const { motion, base, selected } of this.layers) {
      const revealed = this.vertexRange(motion, 0, count).count
      base.geometry.clearGroups()
      for (const part of shown) {
        const { start, count: vertices } = this.vertexRange(
          motion,
          part.first,
          part.last
        )
        if (vertices > 0) base.geometry.addGroup(start, vertices)
      }
      base.visible = drawn(motion) && base.geometry.groups.length > 0
      selected.geometry.setDrawRange(0, revealed)
      selected.visible =
        drawn(motion) &&
        selected.geometry.groups.some((group) => group.start < revealed)
    }
    return this.selection.some((part) =>
      MOTIONS.some(
        (motion) =>
          drawn(motion) &&
          this.vertexRange(motion, part.first, Math.min(part.last, count))
            .count > 0
      )
    )
  }

  /** A revealed selection dims the rest of the path; the active plate draws at full strength. */
  emphasize(active: boolean, dimmed: boolean) {
    this.materials.cut.opacity = cutOpacity(active, dimmed)
    this.materials.probe.opacity = cutOpacity(active, dimmed)
    this.materials.rapid.opacity = dimmed ? 0.12 : 0.55
  }

  /** Draws the move under way up to where simulated playback has the tool; null hides it. */
  showMove(playhead: Playhead | null, showRapids: boolean) {
    const segment = playhead && this.program.segments.at(playhead.segment)
    const motion = segment ? motionOf(segment) : null
    if (!playhead || !segment || (motion === "rapid" && !showRapids)) {
      this.move.visible = false
      return
    }
    const position = this.move.geometry.getAttribute("position")
    position.setXYZ(0, ...segment.start)
    position.setXYZ(1, ...along(segment, playhead.fraction))
    position.needsUpdate = true
    this.move.material = this.materials[motion ?? "cut"]
    this.move.visible = true
  }

  /**
   * Shows the tool in the spindle at `line` (without one, on the line of the last of the first
   * `count` segments) with its tip at that segment's end, or, while playback simulates the
   * moves, along the move under way; a null count hides it.
   */
  showTool(
    count: number | null,
    line: number | null = null,
    playhead: Playhead | null = null
  ) {
    this.shown = [count, line, playhead]
    if (this.shownTool) this.shownTool.visible = false
    this.shownTool = null
    if (count === null) return
    const current = this.program.segments.at(
      playhead?.segment ?? Math.max(0, count - 1)
    )
    if (!current) return
    let position = count > 0 ? current.end : current.start
    if (playhead) position = along(current, playhead.fraction)
    // Runs are in lines: the program's segments are not the ones drawn. Before the first line
    // there is none, and the tool is the one that makes the first move.
    let index = runIndexAt(
      this.tools,
      line !== null && line > 0 ? line : current.line
    )
    // A change's run starts on its line, where the firmware first moves the tool it changes.
    const named = index >= 0 ? this.tools[index].tool : null
    if (named !== null && named !== current.tool) index--
    const run = index >= 0 ? this.tools[index] : null
    // Before a tool change the spindle holds a tool the program does not know: none shows.
    if (!run || (run.tool === null && !run.shape && !run.model)) return
    this.placeTool(run, position)
  }

  /**
   * Shows the tool the machine reports in its spindle with its tip at `position` (in the
   * program's coordinates): the program's tool of that number, else a plain marker. Null hides
   * it.
   */
  showLiveTool(live: { tool: number | null; position: Point3 } | null) {
    if (this.shownTool) this.shownTool.visible = false
    this.shownTool = null
    if (!live) return
    const run = [...this.tools]
      .reverse()
      .find((item) => item.tool === live.tool)
    this.placeTool(run ?? null, live.position)
  }

  /** A run's tool (its model, else its shape, else the marker) with its tip at `position`. */
  private placeTool(run: ViewerToolRun | null, position: Point3) {
    const model = run?.model ? this.meshModel(run.model) : null
    const tool = model ?? (run?.shape ? this.toolModel(run.shape) : this.marker)
    const [x, y, z] = position
    // The marker is a centred cylinder; a model's origin is its tip.
    tool.position.set(
      x,
      y,
      tool === this.marker ? z + TOOL_MARKER_LENGTH / 2 : z
    )
    tool.visible = true
    this.shownTool = tool
  }

  dispose() {
    this.disposed = true
    // Tool models' clones share geometry and materials with the viewer's models.
    for (const model of this.meshModels.values()) model?.removeFromParent()
    this.group.removeFromParent()
    disposeObjects(this.group)
    // Tool materials no shown model used are not in the scene graph.
    for (const material of Object.values(this.toolMaterials)) material.dispose()
  }
}
