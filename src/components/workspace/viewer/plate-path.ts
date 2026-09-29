import * as THREE from "three"
import type { Point3 } from "@/domain/nc/gcode"
import type { Playhead } from "@/domain/nc/move-times"
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
import { revealedSegments } from "./toolpath-buffers"
import { ToolpathView } from "./toolpath-view"
import type { ToolModels } from "./toolpath-view"
import { WorkAreaView } from "./work-area-view"

/** What one plate's drawing shows; inactive plates show their whole program. */
export type PathPresentation = ProbePresentation & {
  showRapids: boolean
  /** Where simulated playback is: the moves before it drawn, the one under way up to the tool. */
  playhead?: Playhead | null
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
  private plate: ViewerPlate
  private toolpath: ToolpathView
  private workArea: WorkAreaView
  private probes: ProbeGridView

  constructor(plate: ViewerPlate, palette: ViewerPalette, models: ToolModels) {
    this.palette = palette
    this.models = models
    this.plate = plate
    // Only the drawing is lifted above surfaces; physical setup coordinates remain exact.
    this.group.position.z = PATH_DISPLAY_LIFT
    this.toolpath = new ToolpathView(
      plate.machineProgram,
      plate.workOrigin,
      palette,
      plate.tools,
      models
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
        this.models
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
    const playhead = state.playhead ?? null
    const count =
      playhead?.segment ??
      revealedSegments(
        this.plate.machineProgram,
        state.progress,
        state.previewLine,
        state.previewProbePoint
      )
    this.toolpath.hide(state.hidden)
    this.toolpath.select(state.ranges)
    const selectionShown = this.toolpath.reveal(count, state.showRapids)
    this.toolpath.showMove(playhead, state.showRapids)
    this.toolpath.emphasize(
      state.active,
      selectionShown || (state.active && this.probes.intersects(state.ranges))
    )
    this.workArea.emphasize(state.active)
    this.probes.present(state)
    // While playback simulates the moves the tool is on the move under way, even where the step
    // on show ends the program, such as a firmware routine on the program's last line.
    this.toolpath.showTool(
      state.active && (playhead !== null || state.progress < 100)
        ? count
        : null,
      playhead ? null : (state.previewLine ?? null),
      playhead
    )
  }

  dispose() {
    this.toolpath.dispose()
    this.workArea.dispose()
    this.probes.dispose()
  }
}
