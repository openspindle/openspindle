import * as THREE from "three"
import type { ToolShape } from "@/domain/tools/tool-shape"
import type { PlaybackFrame } from "@/app/job/frame"
import type { GCodeProgram, GCodeSegment, Point3 } from "@/domain/nc/gcode"
import { isProbeSlot } from "@/domain/tools/tool-table"
import type { ViewerToolRun } from "@/components/workspace/viewer/viewer-input"
import { disposeObjects } from "@/lib/three-assets"
import { TOOL_MARKER_LENGTH } from "../bed-viewer-layout"
import type { LineRange } from "../bed-viewer-layout"
import type { ViewerPalette } from "./palette"
import { sameRanges } from "./plate-identity"
import { PathAhead } from "./path-ahead"
import { TouchMarker } from "./touch-marker"
import type { Collide } from "./touch-marker"
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

/** How far behind the tool's tip, in millimetres, a projection of what it meets starts. */
const PROJECTION_BACK_OFF = 1

/** The point `fraction` of the way along a move. */
export const along = (
  { start, end }: GCodeSegment,
  fraction: number
): Point3 => [
  start[0] + (end[0] - start[0]) * fraction,
  start[1] + (end[1] - start[1]) * fraction,
  start[2] + (end[2] - start[2]) * fraction,
]

/** How a tool is drawn: its 3D model once that has loaded, else its shape, else a marker. */
type ToolLook = Pick<ViewerToolRun, "shape" | "model">

/**
 * Which tool makes each move of a plate's machine program, and how each tool is drawn. A move's
 * tool is its own, but for the moves before the program first changes tools: the parse gives
 * those the number it starts with, while the spindle holds the implicit tool, or one the program
 * does not know. On the change's line, they are the ones that take that tool to the change.
 */
export type MoveTools = {
  /** How each tool the plate's runs name is drawn, by its number; null is the implicit tool's. */
  readonly looks: ReadonlyMap<number | null, ToolLook>
  /** How many of the program's first moves the implicit tool makes. */
  readonly implicitMoves: number
}

/** The tools making a machine program's moves, by the plate's tool runs, whose lines it shares. */
export function moveTools(
  program: GCodeProgram,
  runs: readonly ViewerToolRun[]
): MoveTools {
  const looks = new Map<number | null, ToolLook>()
  for (const { tool, shape, model } of runs) looks.set(tool, { shape, model })
  const change = runs.find((run) => run.tool !== null)
  const parsed = program.segments.at(0)?.tool
  let implicitMoves = 0
  for (const { line, tool } of program.segments) {
    // A change to the number the parse starts with leaves its moves alike: its line is the new
    // tool's.
    const changed =
      !!change &&
      (line > change.lineStart ||
        (line === change.lineStart && change.tool === parsed))
    if (tool !== parsed || changed) break
    implicitMoves++
  }
  return { looks, implicitMoves }
}

/**
 * One plate's toolpath, drawn from the plate's work origin at a frame of playback. Each motion's
 * vertices upload once and stay on the GPU: playback and hidden ranges only regroup what is
 * drawn, a selection change only regroups the overlay, and a new work origin only moves the
 * group. A frame shows the tool it names, making the move under way: its 3D model once that has
 * loaded, else as its shape describes it.
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
  private tools: MoveTools
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
  /** Where the probe is going to touch, while the tool shows. */
  private readonly touch: TouchMarker | null
  /** The moves the tool makes next, while playback follows them. */
  private readonly ahead: PathAhead
  /** What the probe meets, projected from the tool's tip; without it, where the moves touch. */
  private readonly collide: Collide | null
  /**
   * Where the tool's tip is on show, in the program's coordinates, and the tool making the move
   * it is on; null while none is.
   */
  private tip: { readonly at: Point3; readonly tool: number } | null = null
  /** The tip and probing move the marker was last projected for: it stays while they do. */
  private projected = ""
  private shownTool: THREE.Object3D | null = null
  /** The frame the tool was last shown at, to show again once a model arrives. */
  private shown: PlaybackFrame | null = null
  /**
   * How many segments were last revealed, with which motions drawn, and whether a selected one
   * showed: revealing again regroups every motion's buffers, so it waits for these to change.
   */
  private revealed: {
    readonly count: number
    readonly showRapids: boolean
    readonly selectionShown: boolean
  } | null = null
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
    models: ToolModels,
    collide: Collide | null = null
  ) {
    this.program = program
    this.tools = moveTools(program, tools)
    this.models = models
    this.collide = collide
    this.buffers = toolpathBuffers(program)
    this.ahead = new PathAhead(palette.pathAhead)
    // Only a program a probe touches in gets the marker, and with it its light.
    const touches = program.segments.some(
      (segment) => segment.probing && isProbeSlot(segment.tool)
    )
    this.touch = touches ? new TouchMarker(palette.nextTouch) : null
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
    this.path.add(this.marker, this.move, this.ahead.object)
    if (this.touch) this.path.add(this.touch.object)
    this.group.add(this.path)
    this.place(origin)
  }

  /** New tools for the same program; models no run uses any more are released. */
  setTools(tools: readonly ViewerToolRun[]) {
    this.tools = moveTools(this.program, tools)
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
      if (!this.shown) return
      this.showTool(this.shown)
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
    this.revealed = null
  }

  /** Regroups the selection overlay when the selected source ranges change. */
  select(ranges: readonly LineRange[]) {
    if (sameRanges(ranges, this.ranges)) return
    this.ranges = ranges
    this.regroupSelection()
    this.revealed = null
  }

  /**
   * Draws a frame of a plan of this program: the segments before it made, the move under way up
   * to the tool, the tool, where the probe touches next and the moves ahead. Null, or a frame of
   * another program's plan, shows the whole program and no tool. Rapids show only with
   * `showRapids`. Returns whether a selected segment shows.
   */
  apply(frame: PlaybackFrame | null, showRapids: boolean) {
    const own = frame?.index.plan.program === this.program ? frame : null
    const count = own ? own.revealed : this.program.segments.length
    const { revealed } = this
    const selectionShown =
      revealed?.count === count && revealed.showRapids === showRapids
        ? revealed.selectionShown
        : this.reveal(count, showRapids)
    this.revealed = { count, showRapids, selectionShown }
    this.showMove(own, showRapids)
    // The moves ahead and the next touch go from the tool as it is drawn.
    this.showTool(own)
    this.showAhead(own)
    this.showTouch(own)
    return selectionShown
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
  private reveal(count: number, showRapids: boolean) {
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

  /**
   * Draws the move under way, while the frame has one it does not draw made, up to where it has
   * the tool along it; else hides it.
   */
  private showMove(frame: PlaybackFrame | null, showRapids: boolean) {
    const segment =
      frame && frame.move >= frame.revealed
        ? this.program.segments.at(frame.move)
        : undefined
    const motion = segment ? motionOf(segment) : null
    if (!frame || !segment || (motion === "rapid" && !showRapids)) {
      this.move.visible = false
      return
    }
    const position = this.move.geometry.getAttribute("position")
    position.setXYZ(0, ...segment.start)
    position.setXYZ(1, ...along(segment, frame.fraction))
    position.needsUpdate = true
    this.move.material = this.materials[motion ?? "cut"]
    this.move.visible = true
  }

  /**
   * Shows the tool the frame names with its tip where the frame has it: along the move under way,
   * or where the machine reported it off the moves. Null hides it.
   */
  private showTool(frame: PlaybackFrame | null) {
    this.shown = frame
    if (this.shownTool) this.shownTool.visible = false
    this.shownTool = null
    this.tip = null
    const current = frame && this.program.segments.at(frame.move)
    if (!frame || !current) return
    this.tip = { at: frame.tip, tool: current.tool }
    const look = this.tools.looks.get(frame.tool)
    // Before the first change, without an implicit tool, the spindle holds one the program does
    // not know: none shows.
    if (frame.tool === null && !look?.shape && !look?.model) return
    this.placeTool(look ?? null, frame.tip)
  }

  /**
   * Marks what the probe is going to hit, for the frame's next touch: the first probing move a
   * probe makes from the move under way on, or from the one after the tool on show. With a probe
   * in the spindle it is projected from the tip along that move, onto what it meets, else onto
   * the plane the move touches in; before, it is where that move touches. Null hides it.
   */
  private showTouch(frame: PlaybackFrame | null) {
    const { touch } = this
    if (!touch) return
    const index = frame ? frame.nextTouch : -1
    const segment = index < 0 ? null : this.program.segments.at(index)
    const { tip } = this
    if (!segment || !tip) {
      this.projected = ""
      touch.show(null)
      return
    }
    const key = `${index}:${tip.tool}:${tip.at.join()}`
    if (key === this.projected) return
    this.projected = key
    const { start, end } = segment
    const direction = new THREE.Vector3(
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2]
    ).normalize()
    const facing = direction.clone().negate().toArray()
    if (!isProbeSlot(tip.tool)) {
      touch.show(end, facing)
      return
    }
    const hit = this.project(tip.at, direction)
    if (hit) {
      touch.show(hit.point, hit.normal)
      return
    }
    // Where the tip meets the plane through the touch, facing back along the move.
    const ahead = Math.max(
      0,
      direction.dot(new THREE.Vector3(...end).sub(new THREE.Vector3(...tip.at)))
    )
    touch.show(
      new THREE.Vector3(...tip.at).addScaledVector(direction, ahead).toArray(),
      facing
    )
  }

  /** What a move from `tip` along `direction` meets, in the program's coordinates. */
  private project(tip: Point3, direction: THREE.Vector3) {
    if (!this.collide) return null
    this.path.updateWorldMatrix(true, false)
    // From a little behind the tip, so that a probe touching a surface still meets it.
    const origin = this.path
      .localToWorld(new THREE.Vector3(...tip))
      .addScaledVector(direction, -PROJECTION_BACK_OFF)
    const hit = this.collide(origin, direction)
    if (!hit) return null
    return {
      point: this.path.worldToLocal(hit.point.clone()).toArray(),
      normal: hit.normal.toArray(),
    }
  }

  /** Shows the moves the frame has ahead of the tool, from the tool as it was just drawn. */
  private showAhead(frame: PlaybackFrame | null) {
    const { tip } = this
    if (!frame || !tip || frame.aheadEnd <= frame.move) {
      this.ahead.hide()
      return
    }
    this.ahead.show(frame.index.plan, frame.move, frame.aheadEnd, tip.at)
  }

  /**
   * Shows the tool the machine reports in its spindle with its tip at `position` (in the
   * program's coordinates): the program's tool of that number, else a plain marker. Null hides
   * it.
   */
  showLiveTool(live: { tool: number | null; position: Point3 } | null) {
    if (this.shownTool) this.shownTool.visible = false
    this.shownTool = null
    this.tip = null
    if (!live) return
    this.placeTool(this.tools.looks.get(live.tool) ?? null, live.position)
  }

  /** A tool (its model, else its shape, else the marker) with its tip at `position`. */
  private placeTool(look: ToolLook | null, position: Point3) {
    const model = look?.model ? this.meshModel(look.model) : null
    const tool =
      model ?? (look?.shape ? this.toolModel(look.shape) : this.marker)
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
