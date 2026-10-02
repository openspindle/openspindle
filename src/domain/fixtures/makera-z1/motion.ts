/*
 * How the Z1 moves, as its firmware (1.1.2) plans it: the limits `src/configZ1.default` sets and
 * Robot.cpp, Planner.cpp and Conveyor.cpp fall back on, and the blocks that stop it between
 * moves (Robot.cpp, PWMSpindleControl.cpp, Player.cpp).
 *
 * Only relative imports, so the Z1 simulator can use it as it is.
 */
import type {
  MachineLimits,
  MotionModel,
  MotionStop,
  NcWordLike,
} from "../../motion/limits.ts"

/** The Z1's limits where its configuration is not read: those of `configZ1.default`. */
export const Z1_DEFAULT_LIMITS: MachineLimits = {
  key: "makera-z1:defaults",
  /** `default_seek_rate`; Robot.cpp's own default is 3000. */
  seek: 2000,
  feed: 1000,
  /** `alpha/beta/gamma_max_rate`: the Cartesian 4000/4000/2000 never bind. */
  axisRate: [1200, 1200, 600],
  pathRate: null,
  /** The motors' own accelerations and `z_acceleration` are unset. */
  acceleration: 150,
  axisAcceleration: [null, null, null],
  junctionDeviation: 0.01,
  zJunctionDeviation: null,
  minimumSpeed: 0,
  queueSize: 32,
  queueDelay: 0.1,
  /** Robot.cpp's defaults: lines in 5 mm blocks, arcs by their chord error alone. */
  lineSegment: 5,
  arcSegment: 0,
  arcError: 0.002,
  /** `spindle.delay_on_s` and `spindle.delay_off_s`. */
  spindleDelay: { on: 8, off: 4 },
}

/** M480 with a subcode: the firmware's 3D probing routines. */
const probesOrigin = (code: number) => Math.trunc(code) === 480 && code !== 480

/** The value of a block's last word of a letter; undefined without one. */
function wordValue(words: readonly NcWordLike[], letter: string) {
  let value: number | undefined
  for (const word of words) if (word.letter === letter) value = word.value
  return value
}

/**
 * What a block makes the Z1 do between moves. G4 dwells P seconds (`grbl_mode` is on) and S
 * more. M3 and M4 from off and M5 from on dwell the spindle's delay. These, M400, the program
 * pauses (M0, M1, M600), the routines (M6, M495, M480.x, G28, G32) and the program's end empty
 * the queue first. G10, G53 and M220 do not stop it.
 */
function z1Stop(
  words: readonly NcWordLike[],
  spindleOn: boolean,
  limits: MachineLimits
): MotionStop | null {
  let drain = false
  let dwell = 0
  let wait: MotionStop["wait"] = null
  let spindle: boolean | null = null
  let on = spindleOn
  for (const { letter, value: code } of words) {
    if (letter === "G") {
      if (code === 4) {
        drain = true
        dwell += (wordValue(words, "P") ?? 0) + (wordValue(words, "S") ?? 0)
      } else if (code === 28 || code === 32) drain = true
    } else if (letter === "M") {
      if (code === 3 || code === 4) {
        drain = true
        if (!on) dwell += limits.spindleDelay.on
        on = spindle = true
      } else if (code === 5) {
        if (on) {
          drain = true
          dwell += limits.spindleDelay.off
        }
        on = spindle = false
      } else if (code === 0 || code === 1 || code === 600) {
        drain = true
        wait = "pause"
      } else if (code === 2 || code === 30) {
        drain = true
        on = spindle = false
      } else if (
        code === 6 ||
        code === 400 ||
        code === 495 ||
        probesOrigin(code)
      )
        drain = true
    }
  }
  if (!drain && spindle === null) return null
  return { drain, dwell, wait, spindle }
}

/** How the Z1 moves: by its default limits, whatever its configuration sets. */
export const Z1_MOTION: MotionModel = {
  defaults: Z1_DEFAULT_LIMITS,
  limits: () => Z1_DEFAULT_LIMITS,
  stop: z1Stop,
}
