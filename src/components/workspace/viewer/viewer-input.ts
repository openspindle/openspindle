import type { Playhead } from "@/domain/nc/move-times"
import type { ToolpathBounds } from "@/domain/compile/toolpath-bounds"
import type { Place, Severity } from "@/domain/diagnostics"
import type { FixtureInstance } from "@/domain/fixtures/definitions"
import type { GCodeProgram, Point3 } from "@/domain/nc/gcode"
import type { Stock } from "@/domain/stock/stock"
import type { ToolShape } from "@/domain/tools/tool-shape"
import type { StoredAnchorSetup } from "@/domain/anchors/stored-anchors"

/**
 * What the 3D viewer draws: the viewer feature compiles a plate into it (features/viewer), and
 * the viewer's components lay it out and render it.
 */
export type StoredAnchor = {
  id: string
  name: string
  /** Registered bed XY in millimeters; never raw machine coordinates. */
  position: [number, number]
  source?: string
}

/** A stretch of the program with one tool in the spindle, and the segments that tool makes. */
export type ViewerToolRun = {
  /** Inclusive one-based lines of the program, from the tool's change on. */
  readonly lineStart: number
  readonly lineEnd: number
  /** Half-open indices into the program's segments; none while the probe only probes. */
  readonly segmentStart: number
  readonly segmentEnd: number
  /** The tool's number on the plate (0 and 9999 are the probes'); null for the implicit tool. */
  readonly tool: number | null
  /** The tool's shape; null when its record describes none, and a marker stands in. */
  readonly shape: ToolShape | null
  /** The tool's 3D model (a GLB's URL), drawn instead of its shape once it has loaded. */
  readonly model: string | null
}

export type ViewerPlate = {
  id: string
  /** The plate's name; empty while it has none, and its label shows its number. */
  name: string
  program: GCodeProgram
  /**
   * The program as the plate's machine moves through it, its firmware's own moves included
   * (tool changes, probing, machine coordinates): what the viewer draws. Its lines are the
   * program's, its segments are not.
   */
  machineProgram: GCodeProgram
  /** The tools that make the program's segments, in program order. */
  tools: readonly ViewerToolRun[]
  /** Where the plate's machining cuts, from its work origin; null when it cuts nothing. */
  toolpathBounds: ToolpathBounds | null
  stock: Stock | null
  /** Physical minimum stock corner and the plate's single NC zero, in millimeter bed coordinates. */
  stockAnchor: Point3
  workOrigin: Point3
  storedAnchors?: StoredAnchor[]
  anchorSetup?: StoredAnchorSetup
  fixtures?: FixtureInstance[]
  /**
   * The device the plate is set up for. With its fixtures, it names the machine whose bed and
   * probe the plate is drawn with (`kitForSetup`).
   */
  deviceId: string | null
}

/** A problem the viewer marks where it is on its plate's bed. */
export type ViewerProblem = {
  readonly plateId: string
  /** Stays while the problem does, among its plate's problems. */
  readonly key: string
  readonly severity: Severity
  readonly message: string
  /** In the plate's bed coordinates; the marker stands at the first. */
  readonly places: readonly [Place, ...Place[]]
}

/** Which problem: its plate and its key there. */
export type ViewerProblemRef = Pick<ViewerProblem, "plateId" | "key">

/**
 * Where simulated playback is along the selected plate's moves, which the view follows every
 * frame without its owner rendering again.
 */
export type PlayheadSource = {
  readonly get: () => Playhead | null
  readonly subscribe: (listener: () => void) => () => void
}
