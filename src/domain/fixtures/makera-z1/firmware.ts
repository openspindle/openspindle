import type {
  FirmwareBlock,
  FirmwareEffect,
  FirmwareMove,
  GCodeFirmware,
  Point3,
  ToolStatus,
} from "@/domain/nc/gcode"
import { UNKNOWN_TOOL } from "@/domain/motion/types"
import type {
  FirmwareModel,
  FirmwareSetup,
} from "../../firmware/firmware-model"
import { standsUnder } from "../solids"
import type { Solid } from "../solids"
import { PROBE_TOOL } from "../../tools/tool-table"
import { originStartOffset } from "../../probing/tasks/origin/plan"
import type {
  Probe3dCorner,
  Probe3dRoutine,
} from "../../probing/tasks/origin/params"
import { ORIGIN_ROUTINE, distanceSigns, routineOf } from "./3d-probe/blocks"
import { gridSamples } from "./wired-probe/grid"
import { CLEARANCE_Z } from "./wired-probe/travel"
import { SETTER_RADIUS, SETTER_TOP, tipBedZ, tipMachineZ } from "./tool-setter"
import { Z1_MOTION } from "./motion"

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
  /**
   * `default_seek_rate` and `default_feed_rate`: G0, and G1 before any F. A machine's
   * configuration may set others, which its motion limits hold.
   */
  rapid: Z1_MOTION.defaults.seek,
  feed: Z1_MOTION.defaults.feed,
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

/** G0, at the seek rate in effect. */
const RAPID = { rapid: true } as const

type XY = readonly [number, number]
type Style = Omit<FirmwareMove, "end">

/** What the Z1 reports for a tool it holds, as the tool change that asked for it left it. */
const holding = (tool: number): ToolStatus => ({ tool, target: tool })

/** The tool the Z1 reports with none measured in the spindle (M493.2 T-1). */
const NO_TOOL = -1

/** Machine coordinates on a plate's bed, in the preview's coordinates, and what probing meets. */
class Z1Frame {
  private readonly setup: FirmwareSetup
  /** Anchor 1 in machine coordinates, and from there to the bed, whose origin it is. */
  private readonly anchor: XY
  private readonly shift: XY

  constructor(setup: FirmwareSetup) {
    this.setup = setup
    const [first] = setup.anchors.anchors
    this.anchor = first.machinePosition
    this.shift = [-this.anchor[0], -this.anchor[1]]
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

  /** The boxes a probe meets on the bed: the stock's, and where the fixtures are solid. */
  private get boxes(): readonly Pick<Solid, "min" | "max">[] {
    const { stock, solids } = this.setup
    return stock ? [stock, ...solids] : solids
  }

  /** A point in the preview's coordinates on the bed. */
  private onBed(point: readonly number[]): Point3 {
    const [ox, oy, oz] = this.setup.workOrigin
    return [point[0] + ox, point[1] + oy, (point[2] ?? Infinity) + oz]
  }

  /**
   * What a tool going straight down at `at` meets: the tool setter, else the highest top under it
   * of the stock, the fixtures and what carries the stock, but for boxes wholly above the tool. A
   * tool already in a box meets its top, above the tool. Without a height, the highest top.
   */
  surface(at: readonly number[]) {
    const [x, y] = at
    const oz = this.setup.workOrigin[2]
    const [setterX, setterY] = this.fromAnchor(Z1.setter)
    if (Math.hypot(x - setterX, y - setterY) <= SETTER_RADIUS)
      return SETTER_TOP - oz
    const bed = this.onBed(at)
    const tops = this.boxes
      .filter((box) => standsUnder(box, bed) && box.min[2] < bed[2])
      .map((box) => box.max[2])
    return Math.max(this.setup.supportZ, ...tops) - oz
  }

  /**
   * Where a ball of `radius` searching along X or Y by `distance` from `at` first comes to a side
   * of the stock or a fixture beside it at its height: its centre the radius short of that side;
   * null when it comes to none.
   */
  sideContact(
    at: Point3,
    axis: 0 | 1,
    distance: number,
    radius: number
  ): number | null {
    const bed = this.onBed(at)
    const across = axis === 0 ? 1 : 0
    const direction = Math.sign(distance)
    const contacts = this.boxes.flatMap((box) => {
      const beside =
        bed[across] >= box.min[across] &&
        bed[across] <= box.max[across] &&
        bed[2] > box.min[2] &&
        bed[2] < box.max[2]
      const contact =
        (direction > 0 ? box.min[axis] : box.max[axis]) - direction * radius
      const travel = (contact - bed[axis]) * direction
      return beside && travel >= 0 && travel <= Math.abs(distance)
        ? [travel]
        : []
    })
    if (!contacts.length) return null
    return at[axis] + direction * Math.min(...contacts)
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
 * it so that the first change always runs), how its routines move and what it reports (`T:`).
 * Until the first change that is a tool the preview cannot tell: Run leaves the tool the machine
 * reports as it was.
 */
class Z1Preview implements GCodeFirmware {
  /** `default_seek_rate`, which an F in G0 mode sets, and `default_feed_rate`. */
  readonly rates = { seek: Z1.rapid, feed: Z1.feed }
  /** Tools the preview cannot tell: the one held, and the one last asked for. */
  readonly initialStatus: ToolStatus = {
    tool: UNKNOWN_TOOL,
    target: UNKNOWN_TOOL,
  }
  readonly initialPosition?: Point3
  private readonly frame: Z1Frame
  private active: number | null = null

  constructor(setup: FirmwareSetup) {
    this.frame = new Z1Frame(setup)
    if (setup.start) this.initialPosition = setup.start
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
    if (block.mCodes.some(runsOrigin)) return this.originProbing(block)
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
    // Its F sets the feed, as any move's does; without one it moves at the feed in effect.
    const given = words.get("F")
    const feed = given && given > 0 ? given * scale : null
    moves.to(
      [target[0], target[1], z],
      block.motion === 0
        ? RAPID
        : { rapid: false, ...(feed === null ? {} : { feed }) }
    )
    return { moves: moves.list, ...(feed === null ? {} : { feed }) }
  }

  /**
   * A G38 search from where the tool is: X, Y and Z are distances, in millimetres whatever the
   * units (ZProbe::probe_XYZ). Straight down it stops where it touches. Whether it searched: in
   * what it would touch already, the firmware halts instead.
   */
  private search(moves: Moves, delta: Point3, style: Style): boolean {
    const [x, y, z] = moves.at
    const end: Point3 = [x + delta[0], y + delta[1], z + delta[2]]
    if (!delta[0] && !delta[1] && delta[2] < 0) {
      const surface = this.frame.surface(moves.at)
      if (surface > z) return false
      end[2] = Math.max(end[2], surface)
    }
    moves.to(end, { ...style, probing: true })
    return true
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
   * A search along X or Y, at the probe's height: it stops where the ball first meets a side of
   * the stock or a fixture (`Z1Frame.sideContact`), or `side`, its radius short of it, when the
   * side is ahead within the search; otherwise it searches its whole distance. Whether it touched
   * a side.
   */
  private sideSearch(
    moves: Moves,
    axis: 0 | 1,
    distance: number,
    side: number | null,
    radius: number,
    style: Style
  ): boolean {
    const from = moves.at[axis]
    const direction = Math.sign(distance)
    const ahead = (contact: number) =>
      (contact - from) * direction >= 0 &&
      (from + distance - contact) * direction >= 0
    const contacts = [
      this.frame.sideContact(moves.at, axis, distance, radius),
      side === null ? null : side - direction * radius,
    ].filter((contact): contact is number => contact !== null && ahead(contact))
    const end: Point3 = [...moves.at]
    end[axis] = contacts.length
      ? from +
        direction * Math.min(...contacts.map((at) => (at - from) * direction))
      : from + distance
    moves.to(end, { ...style, probing: true })
    return contacts.length > 0
  }

  /**
   * M480 (ATCHandler's fill_OutCorner_scripts, fill_InCorner_scripts, fill_InPocket_scripts and
   * fill_OutPocket_scripts): the 3D probe finds a corner or centre from where it is and sets the
   * work origin there. It touches the tops and sides of the stock and the fixtures as the plate
   * places them (`Z1Frame.surface` and `sideContact`). What the plate does not have, such as a
   * pocket, it takes to be where the work origin in effect is, as the plate's work origin belongs
   * on it, when the routine reaches it from where it starts; otherwise where the routine is
   * started for it (`originStartOffset`): half the distances from the start for a corner, under
   * it for a centre.
   */
  private originProbing(block: FirmwareBlock): FirmwareEffect | null {
    const found = routineOf(block.text)
    if (!found) return null
    const { routine, corner } = found
    const { words, position, offset } = block
    const { distance } = Z1.origin
    const reach: [number, number] = [
      words.get("X") ?? distance,
      words.get("Y") ?? distance,
    ]
    const atOrigin = this.originRoutine(block, found, [offset[0], offset[1]])
    if (atOrigin.reached) return atOrigin.effect
    const [x, y] = corner
      ? originStartOffset({ routine, corner, distance: reach })
      : [0, 0]
    return this.originRoutine(block, found, [position[0] - x, position[1] - y])
      .effect
  }

  /**
   * The routine's moves from where the probe is, with what the plate does not have taken at
   * `feature`: a corner's sides through it, a pocket's walls and a boss's sides half the
   * distances either side of it. A side out of reach is searched for the whole distance;
   * `reached` says whether every search touched a side. A probe already in what its first top
   * search would touch halts the machine, and the routine stops there.
   */
  private originRoutine(
    block: FirmwareBlock,
    found: { routine: Probe3dRoutine; corner?: Probe3dCorner },
    feature: XY
  ): { effect: FirmwareEffect; reached: boolean } {
    const { words, tool } = block
    const { ball, distance, depth, descent } = Z1.origin
    const [signX, signY] = distanceSigns(found)
    const radius = (words.get("D") ?? ball) / 2
    const dx = signX * (words.get("X") ?? distance)
    const dy = signY * (words.get("Y") ?? distance)
    const dz = words.get("Z") ?? depth
    const moves = new Moves(block.position)
    const offset: Point3 = [...block.offset]
    const start: Point3 = [...moves.at]
    let reached = true
    /** Whether it touched the top, which sets work Z. */
    const top = { touched: false }
    const { slow, retract } = Z1.touch
    const rapid = { ...RAPID, tool }
    const down = { ...RAPID, seekScale: descent, tool }
    const touch = { rapid: false, feed: slow, tool }
    const again = { rapid: false, feed: slow / 2, tool }
    const axis = (index: 0 | 1, value: number): Point3 => {
      const point: Point3 = [...moves.at]
      point[index] = value
      return point
    }
    const topTouches = () => {
      if (!this.search(moves, [0, 0, Z1.search], touch)) return false
      moves.z(moves.at[2] + retract, rapid)
      this.search(moves, [0, 0, Z1.search], touch)
      offset[2] = moves.at[2]
      top.touched = true
      moves.z(start[2], rapid)
      return true
    }
    const sideSearch = (
      index: 0 | 1,
      reach: number,
      side: number | null,
      style: Style
    ) => {
      const touched = this.sideSearch(moves, index, reach, side, radius, style)
      reached &&= touched
    }
    // Two touches on a side, the retract between and after them, from where the probe is.
    const sideTouches = (
      index: 0 | 1,
      first: number,
      second: number,
      side: (direction: number) => number | null
    ) => {
      sideSearch(index, first, side(first), touch)
      const back = -Math.sign(first) * retract
      moves.to(axis(index, moves.at[index] + back), rapid)
      sideSearch(index, second, side(second), again)
      const contact = moves.at[index]
      moves.to(axis(index, moves.at[index] + back), rapid)
      return contact
    }
    switch (found.routine) {
      case "outside-corner": {
        if (!topTouches()) break
        moves.to(axis(0, start[0] - dx), rapid)
        moves.z(offset[2] - dz, down)
        const x = sideTouches(0, dx, dx, () => feature[0])
        offset[0] = x + Math.sign(dx) * radius
        moves.z(start[2], rapid)
        moves.to(axis(0, start[0]), rapid)
        moves.to(axis(1, start[1] + dy), rapid)
        moves.z(offset[2] - dz, down)
        const y = sideTouches(1, -dy, -dy, () => feature[1])
        offset[1] = y - Math.sign(dy) * radius
        moves.z(start[2], rapid)
        moves.xy([offset[0], offset[1]], rapid)
        break
      }
      case "inside-corner": {
        if (!topTouches()) break
        moves.xy([start[0] + dx, start[1] - dy], rapid)
        moves.z(offset[2] - dz, down)
        const inside = moves.at[0]
        const x = sideTouches(0, -dx, -dx, () => feature[0])
        offset[0] = x - Math.sign(dx) * radius
        moves.to(axis(0, inside), rapid)
        const y = sideTouches(1, dy, dy, () => feature[1])
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
            feature[index] + (Math.sign(direction) * Math.abs(reach)) / 2
          const minus = sideTouches(index, -reach, -reach, wall)
          const plus = sideTouches(index, 2 * reach, reach, wall)
          const middle = (minus + plus) / 2
          moves.to(axis(index, middle), rapid)
          offset[index] = middle
        }
        break
      }
      case "boss-center": {
        if (!topTouches()) break
        for (const [index, reach] of [
          [0, dx],
          [1, dy],
        ] as const) {
          if (!reach) continue
          const side = (direction: number) =>
            feature[index] - (Math.sign(direction) * Math.abs(reach)) / 2
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
    return {
      effect: {
        moves: moves.list,
        offset,
        ...(top.touched ? { setsWorkZ: true } : {}),
      },
      reached,
    }
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
    return { moves: [], offset, ...(words.has("Z") ? { setsWorkZ: true } : {}) }
  }

  /** G28 on the Z1 parks: up to the clearance, then over to its X and Y (ATCHandler). */
  private park(moves: Moves, tool: number) {
    moves.z(this.frame.z(Z1.clearanceZ), { ...RAPID, tool })
    moves.xy(this.frame.xy(Z1.clearance), { ...RAPID, tool })
  }

  /** M6: the manual tool change, then calibrating the new tool; a held tool changes nothing. */
  private change(block: FirmwareBlock, moves: Moves): FirmwareEffect {
    const next = block.selectedTool
    if (next === this.active) return { moves: [], tool: next }
    this.toolChange(moves, block.tool, next, false)
    this.active = next
    return { moves: moves.list, tool: next, status: holding(next) }
  }

  /**
   * `fill_change_scripts` and `fill_cali_scripts`: up to the clearance and over to where the
   * change waits for the user, then with the new tool over the tool setter, a fast touch, back,
   * a slow touch and up to the safe height. Unless the firmware's automation changed it, back up
   * to the clearance and over to where the change began. On the way to the change it reports the
   * tool it held and the one asked for; from the user's confirmation no tool (M493.2 T-1) until
   * calibration has measured the new one (M493.2 T<new>).
   */
  private toolChange(
    moves: Moves,
    from: number,
    to: number,
    automation: boolean
  ) {
    const { frame } = this
    const [x, y] = moves.at
    // Before its first change, the Z1 reports a tool the preview cannot tell.
    const held = this.active ?? UNKNOWN_TOOL
    const asked = { tool: from, status: { tool: held, target: to } }
    moves.z(frame.z(Z1.clearanceZ), { ...RAPID, ...asked })
    moves.xy(frame.fromAnchor(Z1.change), { ...RAPID, ...asked, wait: "tool" })
    const measuring = { tool: to, status: { tool: NO_TOOL, target: to } }
    const style = { ...RAPID, ...measuring }
    moves.z(frame.z(Z1.clearanceZ), style)
    moves.xy(frame.fromAnchor(Z1.setter), style)
    this.touches(moves, measuring)
    moves.z(frame.z(Z1.safeZ), style)
    if (automation) return
    const back = { ...RAPID, tool: to, status: holding(to) }
    moves.z(frame.z(Z1.clearanceZ), back)
    moves.xy([x, y], back)
  }

  /** A fast touch, back off, a slow touch: calibration's and the Z probe's (G38 distances). */
  private touches(moves: Moves, by: Pick<Style, "tool" | "status">) {
    const { fast, slow, retract } = Z1.touch
    this.search(moves, [0, 0, Z1.search], { ...by, rapid: false, feed: fast })
    moves.z(moves.at[2] + retract, { ...by, ...RAPID })
    this.search(moves, [0, 0, -1 - retract], {
      ...by,
      rapid: false,
      feed: slow,
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
    const probes = margin || zProbe || leveling
    if (probes && this.active !== PROBE_TOOL)
      this.toolChange(moves, block.tool, PROBE_TOOL, true)
    if (probes) this.active = PROBE_TOOL
    // With the probe, it reports holding it, as its change left it.
    const by: Pick<Style, "tool" | "status"> = probes
      ? { tool: PROBE_TOOL, status: holding(PROBE_TOOL) }
      : { tool: block.tool }
    const style = { ...RAPID, ...by }
    if (margin) {
      const [left, front] = work(x, y)
      const [right, back] = work(words.get("C")!, words.get("D")!)
      const trace = { rapid: false, feed: Z1.marginFeed, ...by }
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
      this.touches(moves, by)
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
      this.grid({ ...block, words: grid, tool: PROBE_TOOL }, moves, by.status)
    }
    if (words.has("P")) {
      moves.z(clearance, style)
      moves.xy(work(x, y), style)
    }
    return {
      moves: moves.list,
      offset,
      ...(zProbe ? { setsWorkZ: true } : {}),
      ...by,
    }
  }

  /**
   * G32 R1 (CartGridStrategy::doProbe): from the probe's position offset by X and Y, over the
   * grid's start at its height, a fast touch and back, then down to H above that touch. It
   * probes the start once more, then every sample in turn: over it at that height, down to it
   * slowly and back. False for grids the preview does not follow. The firmware reports `status`
   * while it probes, its status before the block when absent.
   */
  private grid(block: FirmwareBlock, moves: Moves, status?: ToolStatus) {
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
      ...(status ? { status } : {}),
    })
    moves.xy(start, style(0))
    const first = frame.surface(moves.at)
    // Already down on the surface, the firmware stops.
    if (first > from) return true
    moves.z(first, { ...style(0), probing: true })
    moves.z(from, { ...style(0), feed: back })
    const height = first + (words.get("H") ?? Z1.grid.height)
    moves.z(height, style(0))
    // Whether it probed: a sample in a fixture taller than the grid's height halts the machine.
    const probeAt = (probePoint: number) => {
      const surface = frame.surface(moves.at)
      if (surface > moves.at[2]) return false
      moves.z(surface, { ...style(probePoint), feed: slow, probing: true })
      moves.z(height, { ...style(probePoint), feed: back })
      return true
    }
    if (!probeAt(0)) return true
    for (const [index, sample] of gridSamples(
      start,
      [width, depth],
      [columns, rows]
    ).entries()) {
      moves.xy(sample, { ...style(index), feed: travel })
      if (!probeAt(index)) break
    }
    return true
  }
}

/** The Z1's firmware (1.1.2), as the preview follows how it moves. */
export class Z1Firmware implements FirmwareModel {
  readonly motion = Z1_MOTION
  /** Homed to each axis's maximum, then back off it by `<axis>_homing_retract_mm` (1 mm). */
  readonly home: Point3 = [-1, -1, -1]

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
