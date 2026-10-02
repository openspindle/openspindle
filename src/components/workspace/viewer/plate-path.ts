import * as THREE from "three"
import type { PlaybackFrame } from "@/app/job/frame"
import type { Point3 } from "@/domain/nc/gcode"
import type { ViewerPlate } from "@/components/workspace/viewer/viewer-input"
import {
  PATH_DISPLAY_LIFT,
  plateProbeGrids,
  plateProbeTouches,
  probeGridVertices,
  probeTouchPoint,
} from "../bed-viewer-layout"
import type { ViewerPalette } from "./palette"
import { samePlate } from "./plate-identity"
import { ProbeGridView } from "./probe-grid-view"
import type { ProbePresentation } from "./probe-grid-view"
import type { Collide } from "./touch-marker"
import { ToolpathView } from "./toolpath-view"
import type { ToolModels } from "./toolpath-view"
import { WorkAreaView } from "./work-area-view"

/** What one plate's drawing shows; inactive plates show their whole program. */
export type PathPresentation = Omit<
  ProbePresentation,
  "progress" | "previewLine" | "previewProbePoint"
> & {
  /**
   * The tool the machine reports in its spindle, with its tip on the bed, shown instead of the
   * program's (the simulator's camera) while there is no frame; null or absent for the program's.
   */
  liveTool?: { readonly tool: number | null; readonly position: Point3 } | null
  showRapids: boolean
  /**
   * The frame of playback the plate is drawn at: the moves before it made, the one under way up
   * to the tool. Null or absent shows the whole program.
   */
  frame?: PlaybackFrame | null
}

/**
 * Where a frame has the probe grids: up to its step's line in the preview, else the line of the
 * move under way, and on a grid's line, its sample. Without one, every grid is probed.
 */
function probeCursor(
  frame: PlaybackFrame | null
): Pick<ProbePresentation, "progress" | "previewLine" | "previewProbePoint"> {
  if (!frame) return { progress: 100 }
  const { plan } = frame.index
  const probePoint = plan.probePoint[frame.move]
  return {
    progress: 100,
    previewLine:
      frame.source === "preview" ? frame.line : plan.line[frame.move],
    previewProbePoint: probePoint < 0 ? null : probePoint,
  }
}

/** Where outlines lie: the stock top, or the work origin's height without stock. */
const surfaceZ = (plate: ViewerPlate) =>
  plate.stock ? plate.stockAnchor[2] + plate.stock.height : plate.workOrigin[2]

function probeGrids(plate: ViewerPlate, palette: ViewerPalette) {
  return new ProbeGridView(
    plateProbeGrids(plate).map((grid) => ({
      grid,
      ...probeGridVertices(grid, plate.stock, plate),
    })),
    plateProbeTouches(plate).map((touch) => ({
      touch,
      point: probeTouchPoint(touch, plate.stock, plate),
    })),
    palette
  )
}

/**
 * A plate's toolpath as its machine moves (its firmware's routines included), the outline of
 * where it cuts, probe grids and tool, lifted above the surfaces they describe.
 */
export class PlatePath {
  readonly group = new THREE.Group()
  private readonly palette: ViewerPalette
  private readonly models: ToolModels
  private readonly collide: Collide
  private plate: ViewerPlate
  private toolpath: ToolpathView
  private workArea: WorkAreaView
  private probes: ProbeGridView

  /** `collide` finds what the probe meets, for where it is going to touch. */
  constructor(
    plate: ViewerPlate,
    palette: ViewerPalette,
    models: ToolModels,
    collide: Collide
  ) {
    this.palette = palette
    this.models = models
    this.collide = collide
    this.plate = plate
    // Only the drawing is lifted above surfaces; physical setup coordinates remain exact.
    this.group.position.z = PATH_DISPLAY_LIFT
    this.toolpath = new ToolpathView(
      plate.machineProgram,
      plate.workOrigin,
      palette,
      plate.tools,
      models,
      collide
    )
    this.workArea = new WorkAreaView(plate.toolpathBounds, palette.workArea)
    this.workArea.place(plate.workOrigin, surfaceZ(plate))
    this.probes = probeGrids(plate, palette)
    this.group.add(this.toolpath.group, this.workArea.group, this.probes.group)
  }

  /**
   * Keeps the uploaded toolpath unless its program changed; a new origin only moves it, and
   * new tools only change the tool playback shows.
   */
  update(plate: ViewerPlate) {
    const previous = this.plate
    this.plate = plate
    const { workOrigin } = plate
    if (!samePlate(previous, plate, ["machineProgram"])) {
      this.toolpath.dispose()
      this.toolpath = new ToolpathView(
        plate.machineProgram,
        workOrigin,
        this.palette,
        plate.tools,
        this.models,
        this.collide
      )
      this.group.add(this.toolpath.group)
    } else {
      this.toolpath.place(workOrigin)
      if (!samePlate(previous, plate, ["tools"]))
        this.toolpath.setTools(plate.tools)
    }
    if (!samePlate(previous, plate, ["toolpathBounds"])) {
      this.workArea.dispose()
      this.workArea = new WorkAreaView(
        plate.toolpathBounds,
        this.palette.workArea
      )
      this.group.add(this.workArea.group)
    }
    this.workArea.place(workOrigin, surfaceZ(plate))
    // Probe grids have no cheap reposition: rebuild only when what they are drawn from changed,
    // not on every update (a fixture move, say, touches none of these fields).
    if (
      !samePlate(previous, plate, [
        "program",
        "anchorSetup",
        "stock",
        "stockAnchor",
        "workOrigin",
      ])
    ) {
      this.probes.dispose()
      this.probes = probeGrids(plate, this.palette)
      this.group.add(this.probes.group)
    }
  }

  /** Draws the toolpath moved by `delta`, as while the design is moved; zero restores it. */
  shift(delta: Point3) {
    const [x, y, z] = this.plate.workOrigin
    const origin: Point3 = [x + delta[0], y + delta[1], z + delta[2]]
    this.toolpath.place(origin)
    this.workArea.place(origin, surfaceZ(this.plate))
  }

  present(state: PathPresentation) {
    // Only the active plate follows playback, and only a frame of the plan of what it draws.
    const frame =
      state.active &&
      state.frame?.index.plan.program === this.plate.machineProgram
        ? state.frame
        : null
    this.toolpath.hide(state.hidden)
    this.toolpath.select(state.ranges)
    const selectionShown = this.toolpath.apply(frame, state.showRapids)
    this.toolpath.emphasize(
      state.active,
      selectionShown || (state.active && this.probes.intersects(state.ranges))
    )
    this.workArea.emphasize(state.active)
    this.probes.present({ ...state, ...probeCursor(frame) })
    if (state.liveTool && !frame) {
      const [x, y, z] = state.liveTool.position
      const [ox, oy, oz] = this.plate.workOrigin
      this.toolpath.showLiveTool({
        tool: state.liveTool.tool,
        position: [x - ox, y - oy, z - oz],
      })
    }
  }

  dispose() {
    this.toolpath.dispose()
    this.workArea.dispose()
    this.probes.dispose()
  }
}
