import type { NcWord } from "@/machine/contract"
import type {
  NcBlockEffect,
  NcPolicy,
  NcUnitState,
} from "../../compile/nc-unit"
import { COORDINATE_LIMIT, fail, ok } from "../../primitives"
import type { Result } from "../../primitives"
import { PROBE_3D_TOOL, PROBE_TOOL } from "../../tools/tool-table"
import { ORIGIN_ROUTINE } from "./3d-probe/blocks"
import {
  FIRMWARE_ROUTINE,
  GRID,
  PROBE_SETUP_CODES,
  probeFields,
} from "./wired-probe/blocks"

/**
 * Path control: G61 exact path, G61.1 exact stop and G64 blending. The Z1 firmware has none (it
 * corners by junction deviation, M205), so these blocks change nothing and no operation boundary
 * has to restore them.
 */
const PATH_CONTROL_CODES: readonly number[] = [61, 61.1, 64]

/** M400, which waits until the moves before it are done (Robot.cpp) and changes nothing else. */
const WAIT_FOR_MOVES = 400

/**
 * Switches the firmware turns on and off without moving (its switch modules, configZ1.default):
 * the extend-out port (M851, M852), which runs the external extractor, the work light (M821,
 * M822) and the beeper (M861, M862). CAM programs switch them, each after an M400.
 */
const SWITCH_CODES: readonly number[] = [851, 852, 821, 822, 861, 862]

/** The extend-out port's on code, which may set its PWM duty cycle in percent (S). */
const EXTEND_OUT_ON = 851
const EXTEND_OUT_OFF = 852

/**
 * Whether a block switches the extend-out port, which runs the external extractor, on (M851) or
 * off (M852), as Makera's CAM does around the spindle's start and stop; null for any other.
 */
export function z1VacuumSwitch(
  words: readonly Pick<NcWord, "letter" | "value">[]
): boolean | null {
  for (const word of words)
    if (word.letter === "M") {
      if (word.value === EXTEND_OUT_ON) return true
      if (word.value === EXTEND_OUT_OFF) return false
    }
  return null
}

/** G28, which parks the Z1 rather than homing it. */
const PARK = 28

const FIELDS = "Probe blocks need explicit, unique supported fields."

/** The probe an operation's probing runs with: the 3D probe finds origins, T0 does the rest. */
const probeFor = ({ probing }: NcPolicy) =>
  probing === "origin" ? PROBE_3D_TOOL : PROBE_TOOL

/**
 * The 3D probing routines' subcodes as numbers: M480.1 to M480.9, and M480.10, which reads as
 * M480.1. The firmware reads the digits after the point as a whole number.
 */
const ORIGIN_ROUTINES: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(
  (subcode) => Number(`${ORIGIN_ROUTINE}.${subcode}`)
)

type Reading = Result<NcBlockEffect>

/**
 * A park, as Makera's CAM ends its programs: G28 alone in its block, optionally numbered. The
 * firmware lifts Z to its clearance height, then moves X and Y to its clearance position, both
 * in machine coordinates (ATCHandler).
 */
export const isZ1Park = (words: readonly Pick<NcWord, "letter" | "value">[]) =>
  words.some((word) => word.letter === "G" && word.value === PARK) &&
  words.every(
    (word) =>
      word.letter === "N" || (word.letter === "G" && word.value === PARK)
  )

/**
 * The Z1's own blocks beyond plain three-axis machining, as combining operations reads them: the
 * park its programs may end with, the wired probe's routines, which only its probing operations
 * may run with T0 active, the 3D probe's, which only 3D probing may run with its tool active,
 * path control, which its firmware ignores, waiting for moves to finish, and its switches. Null
 * for any other block.
 */
export function readZ1Block(
  words: readonly NcWord[],
  state: NcUnitState
): Reading | null {
  const gCodes = words.filter((word) => word.letter === "G")
  const mCodes = words.filter((word) => word.letter === "M")
  if (gCodes.some((word) => word.value === PARK)) return park(words)
  if (gCodes.some((word) => word.value === GRID))
    return probeGrid(words, gCodes, state)
  if (gCodes.some((word) => Math.trunc(word.value) === 38))
    return touchProbe(words, gCodes, state)
  if (gCodes.some((word) => word.value === 10))
    return workZ(words, gCodes, state)
  if (mCodes.some((word) => word.value === FIRMWARE_ROUTINE))
    return firmwareProbe(words, gCodes, mCodes, state)
  if (mCodes.some((word) => Math.trunc(word.value) === ORIGIN_ROUTINE))
    return originRoutine(words, gCodes, mCodes, state)
  if (mCodes.some((word) => PROBE_SETUP_CODES.includes(word.value)))
    return probeSetup(words, mCodes, state)
  if (gCodes.some((word) => word.value === 53))
    return probeTravel(words, gCodes, state)
  if (gCodes.some((word) => PATH_CONTROL_CODES.includes(word.value)))
    return pathControl(words, gCodes)
  if (mCodes.some((word) => word.value === WAIT_FOR_MOVES))
    return waitForMoves(words)
  const switched = mCodes.find((word) => SWITCH_CODES.includes(word.value))
  if (switched) return switchBlock(words, mCodes, switched)
  return null
}

/**
 * A switch alone in its block: it moves nothing and changes nothing an operation reads. The
 * extend-out port's M851 may carry a non-negative S, which the firmware caps at 100 percent.
 */
function switchBlock(
  words: readonly NcWord[],
  mCodes: readonly NcWord[],
  code: NcWord
): Reading {
  const fields = words.filter(
    (word) => word.letter !== "N" && word.letter !== "M"
  )
  const dutyCycle =
    code.value === EXTEND_OUT_ON &&
    fields.length === 1 &&
    fields[0].letter === "S" &&
    fields[0].value >= 0
  if (mCodes.length !== 1 || (fields.length > 0 && !dutyCycle))
    return fail(
      code.value === EXTEND_OUT_ON
        ? "M851 is supported only alone in its block, with an optional non-negative S."
        : `M${code.value} is supported only alone in its block.`
    )
  return ok({})
}

/** M400 alone in its block: the moves before it finish, and nothing changes. */
function waitForMoves(words: readonly NcWord[]): Reading {
  const codes = words.filter((word) => word.letter !== "N")
  if (codes.length !== 1)
    return fail("M400 is supported only alone in its block.")
  return ok({})
}

/** G28 parks only alone in its block, after the program's last move. */
function park(words: readonly NcWord[]): Reading {
  if (!isZ1Park(words))
    return fail(
      "G28 is supported only alone in its block, to park after the program's last move."
    )
  return ok({ park: true })
}

/** A rectangular G32 grid, relative to where the probe is (R1). */
function probeGrid(
  words: readonly NcWord[],
  gCodes: readonly NcWord[],
  { policy, activeTool, spindleRunning, metric, absolute, grids }: NcUnitState
): Reading {
  if (
    policy.probing !== "grid" ||
    activeTool !== PROBE_TOOL ||
    spindleRunning ||
    !metric ||
    !absolute
  )
    return fail(
      "Rectangular probing requires a height-map operation, active T0, a stopped spindle and G21 G90."
    )
  if (gCodes.length !== 1 || grids >= 1)
    return fail(
      "A height-map operation must contain one explicit rectangular G32 grid."
    )
  const values = probeFields(words, [
    "N",
    "G",
    "R",
    "X",
    "Y",
    "A",
    "B",
    "I",
    "J",
    "H",
  ])
  if (!values) return fail(FIELDS)
  const x = values.get("X")
  const y = values.get("Y")
  const width = values.get("A")
  const depth = values.get("B")
  const columns = values.get("I")
  const rows = values.get("J")
  const clearance = values.get("H")
  if (
    values.get("R") !== 1 ||
    x === undefined ||
    y === undefined ||
    width === undefined ||
    depth === undefined ||
    columns === undefined ||
    rows === undefined ||
    ![x, y, width, depth, x + width, y + depth].every(
      (value) => Math.abs(value) <= COORDINATE_LIMIT
    ) ||
    width <= 0 ||
    depth <= 0 ||
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns < 2 ||
    rows < 2 ||
    columns * rows > 10000 ||
    (clearance !== undefined &&
      (clearance <= 0 || clearance > COORDINATE_LIMIT))
  )
    return fail(
      "G32 requires R1, bounded XY, positive AB, integer IJ of at least 2 with at most 10,000 points, and positive optional H."
    )
  return ok({ grid: true })
}

/** A straight Z touch. The firmware reads G38.2 distances as relative; G91 must say so. */
function touchProbe(
  words: readonly NcWord[],
  gCodes: readonly NcWord[],
  { policy, activeTool, spindleRunning, metric, absolute }: NcUnitState
): Reading {
  if (
    policy.probing !== "touch-off" ||
    activeTool !== PROBE_TOOL ||
    spindleRunning ||
    !metric ||
    absolute
  )
    return fail(
      "Touch probing requires a touch-off operation, active T0, a stopped spindle and G21 G91."
    )
  const values = probeFields(words, ["N", "G", "Z", "F"])
  if (!values) return fail(FIELDS)
  const z = values.get("Z")
  const feed = values.get("F")
  if (
    gCodes.length !== 1 ||
    gCodes[0].value !== 38.2 ||
    z === undefined ||
    z >= 0 ||
    z < -COORDINATE_LIMIT ||
    feed === undefined ||
    feed <= 0
  )
    return fail(
      "Touches must be G38.2 with a downward Z of at most 10,000 mm and a positive F."
    )
  // Later coordinates must select their motion again rather than continue a probe move.
  return ok({ touch: true, motion: null })
}

/**
 * The firmware's own probing (ATCHandler M495): the rectangular grid with X Y A B I J H, or the
 * Z probe with X Y O F, which sets work Z at the contact and leaves G91. Without F its Z probe is
 * the fourth-axis one and without H it does not level, so neither is accepted.
 */
function firmwareProbe(
  words: readonly NcWord[],
  gCodes: readonly NcWord[],
  mCodes: readonly NcWord[],
  { policy, activeTool, spindleRunning, metric, absolute, grids }: NcUnitState
): Reading {
  const grid = policy.probing === "grid"
  if (
    (!grid && policy.probing !== "touch-off") ||
    activeTool !== PROBE_TOOL ||
    spindleRunning ||
    !metric ||
    !absolute ||
    gCodes.length ||
    mCodes.length !== 1
  )
    return fail(
      "The firmware's probing (M495) requires a height-map or touch-off operation, active T0, a stopped spindle and G21 G90."
    )
  const values = probeFields(
    words,
    grid
      ? ["N", "M", "X", "Y", "A", "B", "I", "J", "H"]
      : ["N", "M", "X", "Y", "O", "F"]
  )
  if (!values) return fail(FIELDS)
  const x = values.get("X")
  const y = values.get("Y")
  const bounded = (...numbers: (number | undefined)[]) =>
    numbers.every(
      (value) => value !== undefined && Math.abs(value) <= COORDINATE_LIMIT
    )
  // Later coordinates must select their motion again rather than continue the firmware's.
  if (!grid) {
    if (!bounded(x, y, values.get("O"), values.get("F")))
      return fail("M495 probes Z at bounded X Y with its O and F offsets.")
    return ok({ touch: true, absolute: false, motion: null })
  }
  const width = values.get("A")
  const depth = values.get("B")
  const columns = values.get("I")
  const rows = values.get("J")
  const clearance = values.get("H")
  if (
    grids >= 1 ||
    !bounded(x, y, width, depth, clearance) ||
    width! <= 0 ||
    depth! <= 0 ||
    clearance! <= 0 ||
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns! < 2 ||
    rows! < 2 ||
    columns! * rows! > 10000
  )
    return fail(
      "M495 levels one grid: bounded XY, positive A B H, integer I J of at least 2 with at most 10,000 points."
    )
  return ok({ grid: true, motion: null })
}

/**
 * The firmware's 3D probing (ATCHandler's M480): D the ball, X and Y the distances, Z the depth,
 * each once. The firmware sets the work origin itself and restores the distance mode after.
 */
function originRoutine(
  words: readonly NcWord[],
  gCodes: readonly NcWord[],
  mCodes: readonly NcWord[],
  { policy, activeTool, spindleRunning, metric, absolute }: NcUnitState
): Reading {
  if (
    policy.probing !== "origin" ||
    activeTool !== PROBE_3D_TOOL ||
    spindleRunning ||
    !metric ||
    !absolute ||
    gCodes.length ||
    mCodes.length !== 1 ||
    !ORIGIN_ROUTINES.includes(mCodes[0].value)
  )
    return fail(
      `The firmware's 3D probing (M480.1 to M480.10) requires a 3D probing operation, active T${PROBE_3D_TOOL}, a stopped spindle and G21 G90.`
    )
  const values = probeFields(words, ["N", "M", "D", "X", "Y", "Z"])
  if (!values) return fail(FIELDS)
  const ball = values.get("D")
  const bounded = (letter: string) => {
    const value = values.get(letter)
    return value === undefined || (value >= 0 && value <= COORDINATE_LIMIT)
  }
  if (ball === undefined || ball <= 0 || !["D", "X", "Y", "Z"].every(bounded))
    return fail(
      "M480 needs its ball diameter D and non-negative, bounded X, Y and Z."
    )
  // Later coordinates must select their motion again rather than continue the firmware's.
  return ok({ touch: true, motion: null })
}

/** Work Z of the active coordinate system at the touched surface. */
function workZ(
  words: readonly NcWord[],
  gCodes: readonly NcWord[],
  { policy, activeTool, touches, metric, absolute }: NcUnitState
): Reading {
  if (
    policy.probing !== "touch-off" ||
    activeTool !== PROBE_TOOL ||
    !touches ||
    !metric ||
    !absolute
  )
    return fail(
      "Setting work Z requires a touch-off operation that has touched the surface with active T0, and G21 G90."
    )
  const values = probeFields(words, ["N", "G", "L", "P", "Z"])
  if (!values) return fail(FIELDS)
  const z = values.get("Z")
  if (
    gCodes.length !== 1 ||
    values.get("L") !== 20 ||
    values.get("P") !== 0 ||
    z === undefined ||
    Math.abs(z) > COORDINATE_LIMIT
  )
    return fail("Work Z is set only as G10 L20 P0 with a bounded Z.")
  return ok({})
}

/** The probe's indicator (M494), and clearing height compensation (M370) before anchored travel. */
function probeSetup(
  words: readonly NcWord[],
  mCodes: readonly NcWord[],
  { policy, activeTool }: NcUnitState
): Reading {
  if (
    policy.probing === "none" ||
    activeTool !== probeFor(policy) ||
    mCodes.length !== 1
  )
    return fail(
      "Probe setup commands are supported only in probing operations with their probe active."
    )
  if (!probeFields(words, ["N", "M"])) return fail(FIELDS)
  if (mCodes[0].value === 370 && !policy.anchoredProbing)
    return fail(
      "Clearing height compensation is supported only for explicit anchored probe placement."
    )
  return ok({})
}

/**
 * The probe's travel in machine coordinates, to a stored anchor or its trace height; an
 * outline's trace also follows edges there, along `G53 G1 X Y F` with a feed of its own.
 */
function probeTravel(
  words: readonly NcWord[],
  gCodes: readonly NcWord[],
  { policy, activeTool, metric, absolute }: NcUnitState
): Reading {
  const traced = policy.probing === "outline" && gCodes[1]?.value === 1
  if (
    policy.probing === "none" ||
    activeTool !== probeFor(policy) ||
    !metric ||
    !absolute ||
    gCodes.length !== 2 ||
    gCodes[0].value !== 53 ||
    (gCodes[1].value !== 0 && !traced)
  )
    return fail(
      "Machine-coordinate probe travel requires the operation's probe active, G21 G90 and an explicit G53 G0 block (G53 G1 only in an outline trace)."
    )
  if (traced) {
    const values = probeFields(words, ["N", "G", "X", "Y", "F"])
    const feed = values?.get("F")
    const xy = ["X", "Y"].flatMap((axis) => {
      const value = values?.get(axis)
      return value === undefined ? [] : [value]
    })
    if (
      !values ||
      feed === undefined ||
      feed <= 0 ||
      !xy.length ||
      xy.some((value) => Math.abs(value) > COORDINATE_LIMIT)
    )
      return fail(
        "An outline's machine-coordinate trace needs bounded X and Y and a positive F in each G53 G1 block."
      )
    return ok({ motion: 1 })
  }
  const values = probeFields(words, ["N", "G", "X", "Y", "Z"])
  if (!values) return fail(FIELDS)
  const axes = ["X", "Y", "Z"].flatMap((axis) => {
    const value = values.get(axis)
    return value === undefined ? [] : [value]
  })
  if (!axes.length || axes.some((value) => Math.abs(value) > COORDINATE_LIMIT))
    return fail(
      "Machine-coordinate probe travel needs bounded XYZ coordinates."
    )
  return ok({ motion: 0 })
}

/** Path control alone in its block: G61, G61.1 or G64 with optional P and Q tolerances. */
function pathControl(
  words: readonly NcWord[],
  gCodes: readonly NcWord[]
): Reading {
  const fields = words.filter((word) => word.letter !== "G")
  const tolerances = fields.filter((word) => word.letter !== "N")
  if (
    gCodes.length !== 1 ||
    new Set(fields.map((word) => word.letter)).size < fields.length ||
    tolerances.some(
      (word) =>
        !["P", "Q"].includes(word.letter) ||
        word.value < 0 ||
        gCodes[0].value !== 64
    )
  )
    return fail(
      "Path control must be G61, G61.1 or G64 with optional non-negative P and Q, alone in its block."
    )
  return ok({})
}
