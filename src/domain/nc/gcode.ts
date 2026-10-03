/**
 * Geometry-only NC preview. This module never sends commands to a machine.
 *
 * Coordinates and feed rates are normalized to millimetres and mm/min. Work
 * coordinates start at (0, 0, 0); machine position/offsets are not inferred, unless
 * a machine's firmware (`GCodeFirmware`) places the codes it reads its own way:
 * machine coordinates, probing and tool changes. Blocks it cannot follow are left
 * out, so the preview is not a machining verification or collision check. Lines that
 * cannot run as written (`readNcBlock`) are left out too, and reported (`unreadable`).
 */
import { readNcBlock } from "@/machine/contract"
import type { NcBlockProblem } from "@/machine/contract"

export type Point3 = [number, number, number]

/**
 * The tools a machine's firmware reports (`T:`): the one it takes to be in the spindle, -1 for
 * none, and the one a tool change asks for.
 */
export type ToolStatus = { readonly tool: number; readonly target: number }

export interface GCodeSegment {
  start: Point3
  end: Point3
  rapid: boolean
  /**
   * Rate in mm/min: the last F, else 3000 for a rapid and 600 for a feed move, or as a firmware
   * keeps its rates (`GCodeFirmware.rates`), times a program's override (M220), which probing
   * moves do not take.
   */
  feed: number
  /** One-based source line, including blank lines and comments. */
  line: number
  tool: number
  spindle: number
  /** A probing move: it ends where the probe, or a tool on a tool setter, touches. */
  probing?: true
  /** The sample of a probe grid the move belongs to, from 0 in the order they are probed. */
  probePoint?: number
  /**
   * A move of a routine the machine's firmware runs for its block (`GCodeFirmware.run`): a tool
   * change's, probing's or the firmware's automation's, rather than the block's own move, which
   * a firmware may only place in machine coordinates (G53).
   */
  routine?: true
  /** A chord of an arc (G2, G3), which the preview draws the arc with. */
  arc?: true
  /** A G53 block's own move, which the firmware places in machine coordinates. */
  machine?: true
  /**
   * Whose default rate it moves at, where the program set none: its firmware's seek rate or
   * feed (`GCodeFirmware.rates`), which a machine's configuration may set otherwise.
   */
  defaultRate?: "seek" | "feed"
  /**
   * The tools its firmware reports while it moves (`ToolStatus`), from the firmware's status
   * (`GCodeFirmware.initialStatus`). Absent, the tool reported is the move's own and the one
   * asked for unknown.
   */
  statusTool?: number
  statusTarget?: number
  /** The machine waits for the user after it: for a tool change, at the position it waits at. */
  wait?: "tool"
  /**
   * For a routine's move made in work coordinates the routine set itself (a 3D probe's descent
   * and searches beside the stock after it touched the top), the work offset it is made in
   * (`FirmwareMove.workOffset`).
   */
  workOffset?: Point3
}

/** A move a machine's firmware makes for a block, in the program's work coordinates. */
export type FirmwareMove = {
  readonly end: Point3
  readonly rapid: boolean
  /**
   * mm/min, for timing. Absent, it moves at the rate in effect: a rapid at the seek rate, times
   * `seekScale`, and any other move at the feed.
   */
  readonly feed?: number
  /** For a rapid without a feed, its share of the seek rate, as an override sets it. */
  readonly seekScale?: number
  readonly probing?: true
  readonly probePoint?: number
  /** The tool in the spindle; the active tool when absent. */
  readonly tool?: number
  /** What the firmware reports while it moves; its status before the block when absent. */
  readonly status?: ToolStatus
  /** The machine waits for the user after it. */
  readonly wait?: "tool"
  /**
   * The work offset it is made in, for a move the firmware makes in work coordinates its routine
   * set during the block (a touch of the stock's top sets work Z, which the probe then goes below
   * by a distance): the machine reports where such a move takes the tool from where the touch
   * was, not from the plate's model. Absent, it is placed by machine position.
   */
  readonly workOffset?: Point3
}

/** What a machine's firmware does for a block: its moves, and what it leaves set. */
export type FirmwareEffect = {
  readonly moves: readonly FirmwareMove[]
  /** The work offset afterwards, shifting absolute targets as G92 does (G10 L20 sets it). */
  readonly offset?: Point3
  /** Whether it sets work Z, as a touch of the stock's top does, even to the Z it was. */
  readonly setsWorkZ?: true
  /** The tool in the spindle afterwards. */
  readonly tool?: number
  /** The feed afterwards, in mm/min: the firmware reads a claimed block's F its own way. */
  readonly feed?: number
  /** What the firmware reports afterwards (`ToolStatus`). */
  readonly status?: ToolStatus
}

/** A block as a machine's firmware reads it, with the preview's state before it. */
export type FirmwareBlock = {
  readonly line: number
  /**
   * The line as written, for what its numbers cannot tell: a firmware that reads a code's
   * decimals as a whole subcode tells M480.10 from M480.1.
   */
  readonly text: string
  readonly gCodes: readonly number[]
  readonly mCodes: readonly number[]
  /** Its other words, the last of each letter, in program units. */
  readonly words: ReadonlyMap<string, number>
  /** Where the tool is, in the program's work coordinates. */
  readonly position: Point3
  /** Millimetres per program unit. */
  readonly scale: number
  readonly absolute: boolean
  readonly offset: Point3
  /** The motion mode (G0 to G3) the block moves in; null when none is active. */
  readonly motion: number | null
  /** mm/min, as F last set it; null before any. */
  readonly feed: number | null
  /** The tool in the spindle, and the one T last selected. */
  readonly tool: number
  readonly selectedTool: number
}

/**
 * A machine's firmware, as far as the preview follows how it moves: the codes it reads its own
 * way or runs routines for (machine coordinates, probing, tool changes). Without one the
 * preview omits them, as it cannot tell where they go.
 */
export interface GCodeFirmware {
  /** Whether it reads a G or M code (a subcode as its decimals) itself. */
  handles: (letter: "G" | "M", code: number) => boolean
  /** What a block with one of its codes does; null when the preview cannot follow it. */
  run: (block: FirmwareBlock) => FirmwareEffect | null
  /**
   * Its rates, mm/min, where it keeps G0's apart from the feed as Smoothieware does: `seek` for
   * G0, which an F read in G0 mode sets instead of the feed, and `feed` before any F. Moves at
   * either until the program sets it are marked so (`GCodeSegment.defaultRate`).
   */
  readonly rates?: { readonly seek: number; readonly feed: number }
  /**
   * What it reports at the program's start (`ToolStatus`), which its blocks change
   * (`FirmwareEffect.status`); absent, the preview leaves what it reports out.
   */
  readonly initialStatus?: ToolStatus
  /**
   * Where the tool's tip is as the program starts, in its work coordinates, such as where the
   * machine was at Run; absent, at the work origin.
   */
  readonly initialPosition?: Point3
}

/** The lines a program holds that cannot run as written: the first, and how many. */
export type UnreadableLines = {
  readonly line: number
  readonly problem: NcBlockProblem
  readonly count: number
}

/** A work offset a program sets, from a segment on (`GCodeProgram.offsets`). */
export type ProgramOffset = {
  /** The first segment it applies to: the next one after the block that set it. */
  readonly segment: number
  readonly offset: Point3
  /** Its block set work Z, even to the Z it was (`FirmwareEffect.setsWorkZ`, G92 Z). */
  readonly setsWorkZ?: true
}

export interface GCodeProgram {
  name: string
  source: string
  lines: string[]
  lineCount: number
  segments: GCodeSegment[]
  bounds: { min: Point3; max: Point3; size: Point3 }
  tools: number[]
  /** Lines the preview leaves out as they cannot run as written; null when every line can. */
  unreadable: UnreadableLines | null
  /**
   * The work offsets in effect, as G92 and a firmware's blocks set them (`FirmwareEffect.offset`),
   * in segment order: one from the first segment, [0, 0, 0] unless a block before it sets
   * another, then one for each change and for each block that sets work Z. A segment's points
   * less its offset are where they are in the machine's work coordinates.
   */
  offsets: readonly ProgramOffset[]
}

/** A move's feed without an F word before it, in mm/min: a rapid's, and a feed move's. */
const RAPID_FEED = 3_000
const DEFAULT_FEED = 600
/**
 * Programs longer than this are not read: previews stop here and compiling refuses them. It
 * leaves room above stored NC's 10 MiB, about 500,000 lines as Makera CAM writes them.
 */
export const MAX_PROGRAM_LINES = 1_000_000
/** One line can tessellate into many arc segments; the preview stops at this many. */
const MAX_SEGMENTS = 1_000_000
const EPSILON = 1e-7

const length = (a: Point3, b: Point3) =>
  Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])

function arcSweep(startAngle: number, endAngle: number, clockwise: boolean) {
  let sweep = endAngle - startAngle
  if (clockwise) {
    while (sweep >= -EPSILON) sweep -= Math.PI * 2
  } else {
    while (sweep <= EPSILON) sweep += Math.PI * 2
  }
  return sweep
}

/**
 * The planes arcs turn in (G17, G18, G19): the two axes an arc turns through, the axis along
 * its normal, which it moves along as a helix, and the words that offset its centre along the
 * first two. Turning from the first axis to the second is counterclockwise seen from the normal's
 * positive end, as RS-274 has it: in G18 that is Z to X, which the Z1 firmware follows by
 * reversing its X-to-Z arcs.
 */
export const ARC_PLANES = {
  17: { axes: [0, 1, 2], centre: ["I", "J"] },
  18: { axes: [2, 0, 1], centre: ["K", "I"] },
  19: { axes: [1, 2, 0], centre: ["J", "K"] },
} as const
export type ArcPlane = (typeof ARC_PLANES)[keyof typeof ARC_PLANES]

/**
 * The centre of an arc given by its radius, in its plane's two axes: of the two circles through
 * both ends, the one on which the arc turns the short way, or the long way for a negative
 * radius. Null when the ends are one point or further apart than the diameter.
 */
export function radiusArcCentre(
  start: Point3,
  end: Point3,
  signedRadius: number,
  clockwise: boolean,
  plane: ArcPlane
): [number, number] | null {
  const [u, v] = plane.axes
  const radius = Math.abs(signedRadius)
  const du = end[u] - start[u]
  const dv = end[v] - start[v]
  const chord = Math.hypot(du, dv)
  if (chord < EPSILON || radius < chord / 2 - EPSILON) return null
  const height = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4))
  const midU = (start[u] + end[u]) / 2
  const midV = (start[v] + end[v]) / 2
  const candidates = [1, -1].map((side) => {
    const cu = midU - (side * height * dv) / chord
    const cv = midV + (side * height * du) / chord
    const sweep = arcSweep(
      Math.atan2(start[v] - cv, start[u] - cu),
      Math.atan2(end[v] - cv, end[u] - cu),
      clockwise
    )
    return { cu, cv, sweep }
  })
  const center = candidates.find((candidate) =>
    signedRadius >= 0
      ? Math.abs(candidate.sweep) <= Math.PI + EPSILON
      : Math.abs(candidate.sweep) >= Math.PI - EPSILON
  )
  // A chord far below the radius rounds both sweeps to a full turn.
  return center ? [center.cu, center.cv] : null
}

/**
 * Tessellate an arc in its plane, with helical interpolation along the plane's normal. Null for
 * an invalid arc, which is omitted: both R and centre offsets, neither, a radius its endpoints
 * cannot share, or a full circle by R.
 */
function arcPoints(
  start: Point3,
  end: Point3,
  clockwise: boolean,
  words: Map<string, number>,
  scale: number,
  plane: ArcPlane
): Point3[] | null {
  const [u, v, w] = plane.axes
  const [offsetU, offsetV] = plane.centre
  let centerU: number
  let centerV: number
  if (words.has("R") && (words.has(offsetU) || words.has(offsetV))) return null
  if (words.has("R")) {
    const center = radiusArcCentre(
      start,
      end,
      words.get("R")! * scale,
      clockwise,
      plane
    )
    if (!center) return null
    ;[centerU, centerV] = center
  } else if (words.has(offsetU) || words.has(offsetV)) {
    centerU = start[u] + (words.get(offsetU) ?? 0) * scale
    centerV = start[v] + (words.get(offsetV) ?? 0) * scale
  } else return null

  const radius = Math.hypot(start[u] - centerU, start[v] - centerV)
  const endRadius = Math.hypot(end[u] - centerU, end[v] - centerV)
  if (
    radius < EPSILON ||
    Math.abs(radius - endRadius) > Math.max(0.02, radius * 0.001)
  )
    return null
  const startAngle = Math.atan2(start[v] - centerV, start[u] - centerU)
  const sweep = arcSweep(
    startAngle,
    Math.atan2(end[v] - centerV, end[u] - centerU),
    clockwise
  )
  // At most 3° per segment, also aiming for <0.5mm chords on ordinary toolpaths.
  const steps = Math.min(
    4_096,
    Math.max(
      2,
      Math.ceil(Math.abs(sweep) / (Math.PI / 60)),
      Math.ceil((Math.abs(sweep) * radius) / 0.5)
    )
  )
  return Array.from({ length: steps }, (_, index): Point3 => {
    if (index === steps - 1) return [...end]
    const fraction = (index + 1) / steps
    const angle = startAngle + sweep * fraction
    const point: Point3 = [0, 0, 0]
    point[u] = centerU + Math.cos(angle) * radius
    point[v] = centerV + Math.sin(angle) * radius
    point[w] = start[w] + (end[w] - start[w]) * fraction
    return point
  })
}

export function parseGCode(
  source: string,
  fileName = "untitled.nc",
  firmware?: GCodeFirmware
): GCodeProgram {
  const lines = source.replace(/\r\n?/g, "\n").split("\n")
  const segments: GCodeSegment[] = []
  const tools = new Set<number>()
  let firstUnreadable: Omit<UnreadableLines, "count"> | null = null
  let unreadableCount = 0
  let position: Point3 = firmware?.initialPosition
    ? [...firmware.initialPosition]
    : [0, 0, 0]
  let offset: Point3 = [0, 0, 0]
  let absolute = true
  let incrementalArcCenters = true
  let scale = 1
  let plane: keyof typeof ARC_PLANES = 17
  let motion: number | null = null
  let feed: number | null = null
  /** G0's rate, where the firmware keeps it apart from the feed. */
  let seek = firmware?.rates?.seek ?? null
  /** Whether the program set G0's rate, which is the firmware's own until it does. */
  let seekSet = false
  let feedOverride = 1
  let selectedTool = 1
  let tool = 1
  let spindle = 0
  let spindleRunning = false
  let stopped = false
  /** What the firmware reports, where the preview follows it. */
  let status = firmware?.initialStatus ?? null
  const offsets: ProgramOffset[] = [{ segment: 0, offset: [0, 0, 0] }]
  /** Whether a move found the preview's segments full, which ends it. */
  const segmentLimit = { reached: false }

  /**
   * A programmed move, or a firmware's with its own feed, tool and status, and what kind: a
   * routine's, a G53 block's own or an arc's chord. A move too short to draw passes a wait it
   * carries on to the move before it.
   */
  const append = (
    end: Point3,
    rapid: boolean,
    line: number,
    made?: FirmwareMove,
    kind?: "routine" | "machine" | "arc"
  ) => {
    if (segments.length >= MAX_SEGMENTS) {
      segmentLimit.reached = true
      return
    }
    if (length(position, end) < EPSILON) {
      position = [...end]
      const before = segments.at(-1)
      if (made?.wait && before) before.wait = made.wait
      return
    }
    let nominalFeed: number
    let defaultRate: GCodeSegment["defaultRate"]
    if (made?.feed !== undefined) nominalFeed = made.feed
    else if (rapid) {
      nominalFeed = (seek ?? feed ?? RAPID_FEED) * (made?.seekScale ?? 1)
      if (firmware?.rates && !seekSet) defaultRate = "seek"
    } else {
      nominalFeed = feed ?? firmware?.rates?.feed ?? DEFAULT_FEED
      if (firmware?.rates && feed === null) defaultRate = "feed"
    }
    const movedBy = made?.tool ?? tool
    const reported = made?.status ?? status
    const segment: GCodeSegment = {
      start: [...position],
      end: [...end],
      rapid,
      // A probe searches at its own feed, whatever the override.
      feed: made?.probing ? nominalFeed : nominalFeed * feedOverride,
      line,
      tool: movedBy,
      spindle: spindleRunning ? spindle : 0,
    }
    if (made?.probing) segment.probing = true
    if (made?.probePoint !== undefined) segment.probePoint = made.probePoint
    if (kind === "routine") segment.routine = true
    else if (kind === "machine") segment.machine = true
    else if (kind === "arc") segment.arc = true
    if (defaultRate) segment.defaultRate = defaultRate
    if (reported) {
      segment.statusTool = reported.tool
      segment.statusTarget = reported.target
    }
    if (made?.wait) segment.wait = made.wait
    if (made?.workOffset) segment.workOffset = [...made.workOffset]
    segments.push(segment)
    tools.add(movedBy)
    position = [...end]
  }

  /** The work offset from the next segment on, and whether its block set work Z. */
  const setOffset = (next: Point3, setsWorkZ: boolean) => {
    const changed = next.some((value, axis) => value !== offset[axis])
    offset = [...next]
    if (!changed && !setsWorkZ) return
    const last = offsets[offsets.length - 1]
    const z = setsWorkZ || (last.segment === segments.length && last.setsWorkZ)
    const entry: ProgramOffset = {
      segment: segments.length,
      offset: [...next],
      ...(z ? { setsWorkZ: true } : {}),
    }
    if (last.segment === segments.length) offsets[offsets.length - 1] = entry
    else offsets.push(entry)
  }

  for (
    let index = 0;
    index < Math.min(lines.length, MAX_PROGRAM_LINES);
    index++
  ) {
    if (stopped || segmentLimit.reached) break
    const line = index + 1
    const block = readNcBlock(lines[index])
    // A line that cannot run is not drawn: the plate reports it instead.
    if (block.problem) {
      firstUnreadable ??= { line, problem: block.problem }
      unreadableCount++
      continue
    }
    if (!block.words.length || block.message !== null) continue
    const words = new Map<string, number>()
    const gCodes: number[] = []
    const mCodes: number[] = []
    for (const { letter, value } of block.words) {
      if (letter === "G") gCodes.push(value)
      else if (letter === "M") mCodes.push(value)
      else words.set(letter, value)
    }
    // Codes the machine's firmware reads its own way leave their block to it.
    const claimed = firmware
      ? [
          ...gCodes.filter((g) => firmware.handles("G", g)),
          ...mCodes.filter((m) => firmware.handles("M", m)),
        ]
      : []
    let omitMotion = false
    let coordinateSet = false
    for (const g of gCodes) {
      if (firmware?.handles("G", g)) continue
      if ([0, 1, 2, 3].includes(g)) motion = g
      else if (g === 17 || g === 18 || g === 19) plane = g
      else if (g === 20) scale = 25.4
      else if (g === 21) scale = 1
      else if (g === 90) absolute = true
      else if (g === 91) absolute = false
      else if (g === 91.1) incrementalArcCenters = true
      else if (g === 90.1) incrementalArcCenters = false
      else if (g === 4) omitMotion = true
      else if (g === 92) {
        coordinateSet = true
        omitMotion = true
      } else if (g === 92.1) {
        setOffset([0, 0, 0], false)
        omitMotion = true
      } else if (g === 80) motion = null
      else if (
        // The work coordinate system the preview is in, path control (how corners blend, not
        // the programmed path), cancelled compensation and feed modes change no path drawn.
        ![54, 61, 61.1, 64, 40, 49, 93, 94, 95].includes(g)
      ) {
        // Anything else is not followed: its block is left out, and a canned cycle's
        // coordinates after it too.
        omitMotion = true
        if (g >= 81 && g <= 89) motion = null
      }
    }
    // Where G0 has its own rate, a block starting with F is G1's, as Smoothieware reads it.
    if (
      seek !== null &&
      !gCodes.length &&
      block.words.find(({ letter }) => letter !== "N")?.letter === "F"
    )
      motion = 1
    // A block the firmware claims has F as the firmware reads it, such as a probing feed.
    if (words.has("F") && !claimed.length) {
      const value = words.get("F")! * scale
      if (value > 0 && Number.isFinite(value)) {
        if (seek !== null && motion === 0) {
          seek = value
          seekSet = true
        } else feed = value
      }
    }
    const sIsOverride = mCodes.some(
      (m) => ![3, 4, 5, 6, 7, 8, 9, 30].includes(m)
    )
    if (words.has("S") && !sIsOverride) spindle = Math.max(0, words.get("S")!)
    if (words.has("T")) selectedTool = words.get("T")!
    for (const m of mCodes) {
      if (firmware?.handles("M", m)) continue
      if (m === 3 || m === 4) spindleRunning = true
      else if (m === 5) spindleRunning = false
      else if (m === 6) {
        tool = selectedTool
        tools.add(tool)
      } else if (m === 2 || m === 30) stopped = true
      else if (m === 220) {
        // A feed override, in percent of the programmed feed.
        const override = words.get("S")
        if (override !== undefined && override > 0)
          feedOverride = override / 100
      }
    }
    if (firmware && claimed.length) {
      const effect = firmware.run({
        line,
        text: lines[index],
        gCodes,
        mCodes,
        words,
        position: [...position],
        scale,
        absolute,
        offset: [...offset],
        motion,
        feed,
        tool,
        selectedTool,
      })
      // A block the preview cannot follow is left out.
      if (!effect) continue
      // In machine coordinates (G53) alone, its moves are its own; any other code runs a routine.
      const own =
        claimed.length === 1 && gCodes.includes(53) && firmware.handles("G", 53)
      for (const made of effect.moves)
        append(made.end, made.rapid, line, made, own ? "machine" : "routine")
      if (effect.offset || effect.setsWorkZ)
        setOffset(effect.offset ?? offset, !!effect.setsWorkZ)
      if (effect.feed !== undefined) feed = effect.feed
      if (effect.tool !== undefined) {
        tool = effect.tool
        tools.add(tool)
      }
      if (effect.status) status = effect.status
      continue
    }
    // Words the preview does not know leave the block out.
    if (
      [...words.keys()].some(
        (word) =>
          ![
            "X",
            "Y",
            "Z",
            "I",
            "J",
            "K",
            "R",
            "F",
            "S",
            "T",
            "N",
            "O",
            "P",
            "L",
            "H",
            "D",
          ].includes(word)
      )
    )
      omitMotion = true
    if (coordinateSet) {
      const next: Point3 = [...offset]
      ;(["X", "Y", "Z"] as const).forEach((axis, axisIndex) => {
        if (words.has(axis))
          next[axisIndex] = position[axisIndex] - words.get(axis)! * scale
      })
      setOffset(next, words.has("Z"))
    }
    const hasAxes = ["X", "Y", "Z"].some((axis) => words.has(axis))
    const hasArc = motion === 2 || motion === 3
    if (
      omitMotion ||
      (!hasAxes &&
        !(hasArc && ["I", "J", "K", "R"].some((axis) => words.has(axis))))
    )
      continue
    // Coordinates without a motion mode are left out.
    if (motion === null) continue
    const target: Point3 = [...position]
    ;(["X", "Y", "Z"] as const).forEach((axis, axisIndex) => {
      if (words.has(axis))
        target[axisIndex] = absolute
          ? words.get(axis)! * scale + offset[axisIndex]
          : position[axisIndex] + words.get(axis)! * scale
    })
    if (!target.every(Number.isFinite)) continue
    if (hasArc) {
      // Only arcs with relative centres are drawn; the tool still ends at the target.
      const points = incrementalArcCenters
        ? arcPoints(
            position,
            target,
            motion === 2,
            words,
            scale,
            ARC_PLANES[plane]
          )
        : null
      if (!points) {
        position = target
        continue
      }
      for (const point of points) append(point, false, line, undefined, "arc")
    } else append(target, motion === 0, line)
  }

  const min: Point3 = [Infinity, Infinity, Infinity]
  const max: Point3 = [-Infinity, -Infinity, -Infinity]
  for (const segment of segments) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], segment.start[axis], segment.end[axis])
      max[axis] = Math.max(max[axis], segment.start[axis], segment.end[axis])
    }
  }
  if (segments.length === 0) {
    min.fill(0)
    max.fill(0)
  }
  return {
    name: fileName,
    source,
    lines,
    lineCount: lines.length,
    segments,
    bounds: {
      min,
      max,
      size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    },
    tools: [...tools].sort((a, b) => a - b),
    unreadable: firstUnreadable && {
      ...firstUnreadable,
      count: unreadableCount,
    },
    offsets,
  }
}
