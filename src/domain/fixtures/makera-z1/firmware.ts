import type {
  FirmwareBlock,
  FirmwareEffect,
  FirmwareMove,
  GCodeFirmware,
  Point3,
} from "@/domain/nc/gcode"
import type {
  FirmwareModel,
  FirmwareSetup,
} from "../../firmware/firmware-model"
import { PROBE_TOOL } from "../../tools/tool-table"
import { ORIGIN_ROUTINE, routineOf } from "./3d-probe/blocks"
import { G32_GRID } from "./wired-probe/grid"
import { CLEARANCE_Z } from "./wired-probe/travel"
import { SETTER_RADIUS, SETTER_TOP, tipBedZ, tipMachineZ } from "./tool-setter"

/**
 * The Z1's settings as its firmware (1.1.2) moves by them: `src/configZ1.default` and the
 * scripts of ATCHandler.cpp, CartGridStrategy.cpp and ZProbe.cpp. Machine coordinates and
 * distances in millimetres, feeds in mm/min.
 */
const Z1 = {
  /** `coordinate.clearance_z`, as Makera sets it on the Z1 Pro (the default file says -1). */
  clearanceZ: CLEARANCE_Z,
  /** `coordinate.clearance_x` and `_y`: where G28 parks. */
  clearance: [-11.6, -14.6],
  /** `atc.safe_z_mm`: where calibrating a tool leaves it. */
  safeZ: -20,
  /** `coordinate.toolrack_z`: how far calibration and the Z probe search, as G38 distances. */
  search: -108,
  /** Where a manual tool change waits, from anchor 1: `toolrack_offset_x` + 132 and `_y`. */
  change: [48.78 + 132, 179.74],
  /** The tool setter, from anchor 1 (`fill_cali_scripts` on the Z1 and Z1 Pro). */
  setter: [181, 181],
  /** `default_seek_rate` and `default_feed_rate`: G0, and G1 before any F. */
  rapid: 2000,
  feed: 1000,
  /** `atc.probe.*`: the touches of a calibration and of the Z probe. */
  touch: { fast: 500, slow: 100, retract: 1 },
  /** `zprobe.*` (in mm/s there): grid probing, which moves between samples at four times fast. */
  grid: { fast: 300, slow: 90, back: 1200, travel: 1200, height: 2 },
  /** `atc.margin_rate_mm_m`. */
  marginFeed: 1000,
  /**
   * The 3D probing routines (M480): their defaults, and the speed override (M220 S10) they come
   * down beside a side at.
   */
  origin: { ball: 2, distance: 20, depth: 2, descent: 0.1 },
  /** Work Z the Z probe sets at its touch (`atc.probe.probe_height_mm`, unset). */
  probeHeight: 0,
  /** Samples the configured grid holds (`leveling-strategy.rectangular-grid.size`). */
  gridSize: 15,
} as const

const G_CODES = new Set([10, 28, 32, 38.2, 38.3, 38.4, 38.5, 38.6, 53])
/** Tool changes and the firmware's automation, and codes of the Z1's NC that move nothing. */
const M_CODES = new Set([6, 370, 494, 494.1, 494.2, 495])
/** M480 with a subcode: the firmware's 3D probing, which `routineOf` tells apart by its text. */
const runsOrigin = (code: number) =>
  Math.trunc(code) === ORIGIN_ROUTINE && code !== ORIGIN_ROUTINE

/**
 * The signs the firmware gives a 3D probing routine's X and Y distances, by subcode
 * (ATCHandler's M480): the first corner's move out goes towards −X and +Y.
 */
const ORIGIN_SIGNS: Readonly<Record<number, readonly [number, number]>> = {
  1: [1, 1],
  2: [-1, 1],
  3: [-1, -1],
  4: [1, -1],
  5: [1, 1],
  6: [-1, 1],
  7: [-1, -1],
  8: [1, -1],
  9: [1, 1],
  10: [1, 1],
}

const RAPID = { rapid: true, feed: Z1.rapid } as const

type XY = readonly [number, number]
type Style = Omit<FirmwareMove, "end">

/** Machine coordinates on a plate's bed, in the preview's coordinates, and what probing meets. */
class Z1Frame {
  private readonly setup: FirmwareSetup
  /** Anchor 1 in machine coordinates, and from there to the bed. */
  private readonly anchor: XY
  private readonly shift: XY

  constructor(setup: FirmwareSetup) {
    this.setup = setup
    const [first] = setup.anchors.anchors
    const [bedX, bedY] = setup.anchors.anchor1BedPosition
    this.anchor = first.machinePosition
    this.shift = [bedX - this.anchor[0], bedY - this.anchor[1]]
  }

  /** Machine X and Y in the preview's coordinates. */
  xy([x, y]: XY): [number, number] {
    const [ox, oy] = this.setup.workOrigin
    return [x + this.shift[0] - ox, y + this.shift[1] - oy]
  }

  machineXY([x, y]: XY): [number, number] {
    const [ox, oy] = this.setup.workOrigin
    return [x - this.shift[0] + ox, y - this.shift[1] + oy]
  }

  /** A position given from anchor 1 in machine coordinates. */
  fromAnchor([dx, dy]: XY) {
    return this.xy([this.anchor[0] + dx, this.anchor[1] + dy])
  }

  /** Where a tool's tip is at machine Z. */
  z(machineZ: number) {
    return tipBedZ(machineZ) - this.setup.workOrigin[2]
  }

  machineZ(z: number) {
    return tipMachineZ(z + this.setup.workOrigin[2])
  }

  /** What a tool going straight down at `at` meets: the tool setter, the stock or its support. */
  surface([x, y]: readonly number[]) {
    const [ox, oy, oz] = this.setup.workOrigin
    const [bedX, bedY] = [x + ox, y + oy]
    const [setterX, setterY] = this.fromAnchor(Z1.setter)
    if (Math.hypot(x - setterX, y - setterY) <= SETTER_RADIUS)
      return SETTER_TOP - oz
    const { stock } = this.setup
    if (
      stock &&
      bedX >= stock.min[0] &&
      bedX <= stock.max[0] &&
      bedY >= stock.min[1] &&
      bedY <= stock.max[1]
    )
      return stock.max[2] - oz
    return this.setup.supportZ - oz
  }
}

/** One block's moves, from where the tool is. */
class Moves {
  readonly list: FirmwareMove[] = []
  at: Point3

  constructor(at: Point3) {
    this.at = at
  }

  to(end: Point3, style: Style) {
    this.list.push({ ...style, end })
    this.at = end
  }

  /** Straight up or down to `z`. */
  z(z: number, style: Style) {
    this.to([this.at[0], this.at[1], z], style)
  }

  /** Over to `xy` at the current height. */
  xy([x, y]: XY, style: Style) {
    this.to([x, y, this.at[2]], style)
  }
}

/**
 * The Z1's firmware for one parse of a plate: which tool it holds (none at first, as Run clears
 * it so that the first change always runs) and how its routines move.
 */
class Z1Preview implements GCodeFirmware {
  /** `default_seek_rate`, which an F in G0 mode sets, and `default_feed_rate`. */
  readonly rates = { seek: Z1.rapid, feed: Z1.feed }
  private readonly frame: Z1Frame
  private active: number | null = null

  constructor(setup: FirmwareSetup) {
    this.frame = new Z1Frame(setup)
  }

  handles(letter: "G" | "M", code: number) {
    if (letter === "G") return G_CODES.has(code)
    return M_CODES.has(code) || runsOrigin(code)
  }

  run(block: FirmwareBlock): FirmwareEffect | null {
    const moves = new Moves(block.position)
    const g = (code: number) => block.gCodes.includes(code)
    if (block.mCodes.includes(6)) return this.change(block, moves)
    if (block.mCodes.includes(495)) return this.automation(block, moves)
    if (block.mCodes.some(runsOrigin)) return this.originProbing(block, moves)
    if (g(53)) return this.machineMove(block, moves)
    if (g(32)) return this.grid(block, moves) ? { moves: moves.list } : null
    if (block.gCodes.some((code) => code > 38 && code < 39))
      return this.probe(block, moves)
    if (g(10)) return this.workOffset(block)
    if (g(28)) {
      this.park(moves, block.tool)
      return { moves: moves.list }
    }
    // M370, M494: compensation and the probe's laser.
    return { moves: [] }
  }

  /** G53: X, Y and Z in machine coordinates, for this block only. */
  private machineMove(block: FirmwareBlock, moves: Moves) {
    if (block.motion !== 0 && block.motion !== 1) return null
    const { frame } = this
    const { words, scale } = block
    const value = (letter: string, current: number) => {
      const given = words.get(letter)
      return given === undefined ? current : given * scale
    }
    const [x, y] = frame.machineXY([moves.at[0], moves.at[1]])
    const target = frame.xy([value("X", x), value("Y", y)])
    const z = frame.z(value("Z", frame.machineZ(moves.at[2])))
    // Its F sets the feed, as any move's does.
    const given = words.get("F")
    const feed = given && given > 0 ? given * scale : block.feed
    moves.to(
      [target[0], target[1], z],
      block.motion === 0 ? RAPID : { rapid: false, feed: feed ?? Z1.feed }
    )
    return { moves: moves.list, ...(feed === null ? {} : { feed }) }
  }

  /**
   * A G38 search from where the tool is: X, Y and Z are distances, in millimetres whatever the
   * units (ZProbe::probe_XYZ). Straight down it stops where it touches.
   */
  private search(moves: Moves, delta: Point3, style: Style) {
    const [x, y, z] = moves.at
    const end: Point3 = [x + delta[0], y + delta[1], z + delta[2]]
    if (!delta[0] && !delta[1] && delta[2] < 0) {
      const surface = this.frame.surface(moves.at)
      // Already down on it, the firmware refuses to move.
      if (surface > z) return
      end[2] = Math.max(end[2], surface)
    }
    moves.to(end, { ...style, probing: true })
  }

  private probe(block: FirmwareBlock, moves: Moves) {
    const { words } = block
    const delta: Point3 = [
      words.get("X") ?? 0,
      words.get("Y") ?? 0,
      words.get("Z") ?? 0,
    ]
    if (delta.every((distance) => distance === 0)) return { moves: [] }
    this.search(moves, delta, {
      rapid: false,
      feed: words.get("F") ?? Z1.grid.slow,
    })
    return { moves: moves.list }
  }

  /**
   * A search along X or Y, at the probe's height: it stops where the ball meets `side`, its
   * radius short of it, when the side is ahead within the search; otherwise it searches its
   * whole distance.
   */
  private sideSearch(
    moves: Moves,
    axis: 0 | 1,
    distance: number,
    side: number | null,
    radius: number,
    style: Style
  ) {
    const from = moves.at[axis]
    const direction = Math.sign(distance)
    let reach = from + distance
    if (side !== null) {
      const contact = side - direction * radius
      if (
        (contact - from) * direction >= 0 &&
        (reach - contact) * direction >= 0
      )
        reach = contact
    }
    const end: Point3 = [...moves.at]
    end[axis] = reach
    moves.to(end, { ...style, probing: true })
  }

  /**
   * M480 (ATCHandler's fill_OutCorner_scripts, fill_InCorner_scripts, fill_InPocket_scripts and
   * fill_OutPocket_scripts): the 3D probe finds a corner or centre from where it is and sets the
   * work origin there. The preview does not have what it probes: it touches a top where
   * `surface` is, and finds the feature where the plate's work origin puts it, as the work
   * origin belongs on it: a corner's sides through the work origin in effect, a pocket's walls
   * and a boss's sides half the distances either side of it. A side out of reach is searched
   * for the whole distance.
   */
  private originProbing(
    block: FirmwareBlock,
    moves: Moves
  ): FirmwareEffect | null {
    const found = routineOf(block.text)
    if (!found) return null
    const { words, tool } = block
    const { ball, distance, depth, descent } = Z1.origin
    const [signX, signY] = ORIGIN_SIGNS[found.subcode]
    const radius = (words.get("D") ?? ball) / 2
    const dx = signX * (words.get("X") ?? distance)
    const dy = signY * (words.get("Y") ?? distance)
    const dz = words.get("Z") ?? depth
    // The work origin in effect, which what the routine finds is taken to be on.
    const origin = block.offset
    const offset: Point3 = [...block.offset]
    const start: Point3 = [...moves.at]
    const { slow, retract } = Z1.touch
    const rapid = { ...RAPID, tool }
    const down = { rapid: true, feed: Z1.rapid * descent, tool }
    const touch = { rapid: false, feed: slow, tool }
    const again = { rapid: false, feed: slow / 2, tool }
    const axis = (index: 0 | 1, value: number): Point3 => {
      const point: Point3 = [...moves.at]
      point[index] = value
      return point
    }
    const topTouches = () => {
      this.search(moves, [0, 0, Z1.search], touch)
      moves.z(moves.at[2] + retract, rapid)
      this.search(moves, [0, 0, Z1.search], touch)
      offset[2] = moves.at[2]
      moves.z(start[2], rapid)
    }
    // Two touches on a side, the retract between and after them, from where the probe is.
    const sideTouches = (
      index: 0 | 1,
      first: number,
      second: number,
      side: (direction: number) => number | null
    ) => {
      this.sideSearch(moves, index, first, side(first), radius, touch)
      const back = -Math.sign(first) * retract
      moves.to(axis(index, moves.at[index] + back), rapid)
      this.sideSearch(moves, index, second, side(second), radius, again)
      const contact = moves.at[index]
      moves.to(axis(index, moves.at[index] + back), rapid)
      return contact
    }
    switch (found.routine) {
      case "outside-corner": {
        topTouches()
        moves.to(axis(0, start[0] - dx), rapid)
        moves.z(offset[2] - dz, down)
        const x = sideTouches(0, dx, dx, () => origin[0])
        offset[0] = x + Math.sign(dx) * radius
        moves.z(start[2], rapid)
        moves.to(axis(0, start[0]), rapid)
        moves.to(axis(1, start[1] + dy), rapid)
        moves.z(offset[2] - dz, down)
        const y = sideTouches(1, -dy, -dy, () => origin[1])
        offset[1] = y - Math.sign(dy) * radius
        moves.z(start[2], rapid)
        moves.xy([offset[0], offset[1]], rapid)
        break
      }
      case "inside-corner": {
        topTouches()
        moves.xy([start[0] + dx, start[1] - dy], rapid)
        moves.z(offset[2] - dz, down)
        const inside = moves.at[0]
        const x = sideTouches(0, -dx, -dx, () => origin[0])
        offset[0] = x - Math.sign(dx) * radius
        moves.to(axis(0, inside), rapid)
        const y = sideTouches(1, dy, dy, () => origin[1])
        offset[1] = y + Math.sign(dy) * radius
        moves.z(start[2], rapid)
        moves.xy([offset[0], offset[1]], rapid)
        break
      }
      case "pocket-center": {
        for (const [index, reach] of [
          [0, dx],
          [1, dy],
        ] as const) {
          if (!reach) continue
          const wall = (direction: number) =>
            origin[index] + (Math.sign(direction) * Math.abs(reach)) / 2
          const minus = sideTouches(index, -reach, -reach, wall)
          const plus = sideTouches(index, 2 * reach, reach, wall)
          const middle = (minus + plus) / 2
          moves.to(axis(index, middle), rapid)
          offset[index] = middle
        }
        break
      }
      case "boss-center": {
        topTouches()
        for (const [index, reach] of [
          [0, dx],
          [1, dy],
        ] as const) {
          if (!reach) continue
          const side = (direction: number) =>
            origin[index] - (Math.sign(direction) * Math.abs(reach)) / 2
          moves.to(axis(index, moves.at[index] - reach), rapid)
          moves.z(offset[2] - dz, down)
          const minus = sideTouches(index, reach, reach, side)
          moves.z(start[2], rapid)
          moves.to(axis(index, moves.at[index] + 2 * reach + 5), rapid)
          moves.z(offset[2] - dz, down)
          const plus = sideTouches(index, -2 * reach, -reach, side)
          moves.z(start[2], rapid)
          const middle = (minus + plus) / 2
          moves.to(axis(index, middle), rapid)
          offset[index] = middle
        }
        break
      }
    }
    return { moves: moves.list, offset }
  }

  /** G10 L20: the current position becomes the given work coordinates. */
  private workOffset(block: FirmwareBlock): FirmwareEffect | null {
    const { words, position, scale } = block
    if (words.get("L") !== 20 || ![0, 1].includes(words.get("P") ?? 0))
      return null
    const offset: Point3 = [...block.offset]
    ;(["X", "Y", "Z"] as const).forEach((letter, axis) => {
      const value = words.get(letter)
      if (value !== undefined) offset[axis] = position[axis] - value * scale
    })
    return { moves: [], offset }
  }

  /** G28 on the Z1 parks: up to the clearance, then over to its X and Y (ATCHandler). */
  private park(moves: Moves, tool: number) {
    moves.z(this.frame.z(Z1.clearanceZ), { ...RAPID, tool })
    moves.xy(this.frame.xy(Z1.clearance), { ...RAPID, tool })
  }

  /** M6: the manual tool change, then calibrating the new tool; a held tool changes nothing. */
  private change(block: FirmwareBlock, moves: Moves): FirmwareEffect {
    const next = block.selectedTool
    if (next !== this.active) this.toolChange(moves, block.tool, next, false)
    this.active = next
    return { moves: moves.list, tool: next }
  }

  /**
   * `fill_change_scripts` and `fill_cali_scripts`: up to the clearance and over to where the
   * change waits, then with the new tool over the tool setter, a fast touch, back, a slow touch
   * and up to the safe height. Unless the firmware's automation changed it, back up to the
   * clearance and over to where the change began.
   */
  private toolChange(
    moves: Moves,
    from: number,
    to: number,
    automation: boolean
  ) {
    const { frame } = this
    const [x, y] = moves.at
    moves.z(frame.z(Z1.clearanceZ), { ...RAPID, tool: from })
    moves.xy(frame.fromAnchor(Z1.change), { ...RAPID, tool: from })
    const style = { ...RAPID, tool: to }
    moves.z(frame.z(Z1.clearanceZ), style)
    moves.xy(frame.fromAnchor(Z1.setter), style)
    this.touches(moves, to)
    moves.z(frame.z(Z1.safeZ), style)
    if (automation) return
    moves.z(frame.z(Z1.clearanceZ), style)
    moves.xy([x, y], style)
  }

  /** A fast touch, back off, a slow touch: calibration's and the Z probe's (G38 distances). */
  private touches(moves: Moves, tool: number) {
    const { fast, slow, retract } = Z1.touch
    this.search(moves, [0, 0, Z1.search], { rapid: false, feed: fast, tool })
    moves.z(moves.at[2] + retract, { ...RAPID, tool })
    this.search(moves, [0, 0, -1 - retract], {
      rapid: false,
      feed: slow,
      tool,
    })
  }

  /**
   * M495 (ATCHandler): changing to the probe first, then tracing the margin (C, D), the Z probe
   * (O, F offsets from X, Y) and the grid (A, B, I, J, H) from X and Y in work coordinates, and
   * with P going over X and Y. The probe stays where the routines leave it.
   */
  private automation(
    block: FirmwareBlock,
    moves: Moves
  ): FirmwareEffect | null {
    const { words } = block
    const x = words.get("X")
    const y = words.get("Y")
    if (x === undefined || y === undefined) return { moves: [] }
    const margin = words.has("C") && words.has("D")
    const zProbe = words.has("O")
    // Without F, the Z probe is the fourth axis's: not followed.
    if (zProbe && !words.has("F")) return null
    const leveling = ["A", "B", "I", "J", "H"].every((letter) =>
      words.has(letter)
    )
    const offset: Point3 = [...block.offset]
    const work = (vx: number, vy: number): XY => [
      vx + offset[0],
      vy + offset[1],
    ]
    const clearance = this.frame.z(Z1.clearanceZ)
    let tool = block.tool
    if (margin || zProbe || leveling) {
      if (this.active !== PROBE_TOOL)
        this.toolChange(moves, block.tool, PROBE_TOOL, true)
      this.active = tool = PROBE_TOOL
      const style = { ...RAPID, tool }
      if (margin) {
        const [left, front] = work(x, y)
        const [right, back] = work(words.get("C")!, words.get("D")!)
        const trace = { rapid: false, feed: Z1.marginFeed, tool }
        moves.z(clearance, style)
        moves.xy([left, front], style)
        moves.xy([left, back], trace)
        moves.xy([right, back], trace)
        moves.xy([right, front], trace)
        moves.xy([left, front], trace)
      }
      if (zProbe) {
        moves.z(clearance, style)
        moves.xy(work(x + words.get("O")!, y + words.get("F")!), style)
        this.touches(moves, tool)
        offset[2] = moves.at[2] - Z1.probeHeight
        moves.z(moves.at[2] + Z1.touch.retract, style)
      }
      if (leveling) {
        moves.xy(work(x, y), style)
        const grid = new Map([
          ["R", 1],
          ["X", 0],
          ["Y", 0],
          ...["A", "B", "I", "J", "H"].map(
            (letter) => [letter, words.get(letter)!] as const
          ),
        ])
        this.grid({ ...block, words: grid, tool }, moves)
      }
    }
    if (words.has("P")) {
      moves.z(clearance, { ...RAPID, tool })
      moves.xy(work(x, y), { ...RAPID, tool })
    }
    return { moves: moves.list, offset, tool }
  }

  /**
   * G32 R1 (CartGridStrategy::doProbe): from the probe's position offset by X and Y, over the
   * grid's start at its height, a fast touch and back, then down to H above that touch. It
   * probes the start once more, then every sample in turn: over it at that height, down to it
   * slowly and back. False for grids the preview does not follow.
   */
  private grid(block: FirmwareBlock, moves: Moves) {
    const { words } = block
    if (words.get("R") !== 1) return false
    const [dx, dy, width, depth] = ["X", "Y", "A", "B"].map((letter) =>
      words.get(letter)
    )
    const columns = words.get("I") ?? Z1.gridSize
    const rows = words.get("J") ?? Z1.gridSize
    // The firmware refuses these before it moves.
    if (
      dx === undefined ||
      dy === undefined ||
      !width ||
      !depth ||
      columns < 2 ||
      rows < 2 ||
      columns * rows > Z1.gridSize ** 2
    )
      return true
    const { frame } = this
    const { fast, slow, back, travel } = Z1.grid
    const start: [number, number] = [moves.at[0] + dx, moves.at[1] + dy]
    const from = moves.at[2]
    const style = (probePoint: number): Style => ({
      rapid: false,
      feed: fast,
      tool: block.tool,
      probePoint,
    })
    moves.xy(start, style(0))
    const first = frame.surface(start)
    // Already down on the surface, the firmware stops.
    if (first > from) return true
    moves.z(first, { ...style(0), probing: true })
    moves.z(from, { ...style(0), feed: back })
    const height = first + (words.get("H") ?? Z1.grid.height)
    moves.z(height, style(0))
    const probeAt = (probePoint: number) => {
      moves.z(frame.surface(moves.at), {
        ...style(probePoint),
        feed: slow,
        probing: true,
      })
      moves.z(height, { ...style(probePoint), feed: back })
    }
    probeAt(0)
    G32_GRID.samples({ start, width, depth, columns, rows }).forEach(
      (sample, index) => {
        moves.xy(sample, { ...style(index), feed: travel })
        probeAt(index)
      }
    )
    return true
  }
}

/** The Z1's firmware (1.1.2), as the preview follows how it moves. */
export class Z1Firmware implements FirmwareModel {
  preview(setup: FirmwareSetup): GCodeFirmware {
    return new Z1Preview(setup)
  }

  bedPosition(setup: FirmwareSetup, [x, y, z]: Point3): Point3 {
    const frame = new Z1Frame(setup)
    const [ox, oy, oz] = setup.workOrigin
    const [bedX, bedY] = frame.xy([x, y])
    return [bedX + ox, bedY + oy, frame.z(z) + oz]
  }

  machinePosition(setup: FirmwareSetup, [x, y, z]: Point3): Point3 {
    const frame = new Z1Frame(setup)
    const [ox, oy, oz] = setup.workOrigin
    const [machineX, machineY] = frame.machineXY([x - ox, y - oy])
    return [machineX, machineY, frame.machineZ(z - oz)]
  }
}
