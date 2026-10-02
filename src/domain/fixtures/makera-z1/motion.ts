/*
 * How the Z1 moves, as its firmware (1.1.2) plans it: the limits its configuration sets, which
 * Robot.cpp, Planner.cpp, Conveyor.cpp and PWMSpindleControl.cpp read, and the blocks that stop
 * it between moves (Robot.cpp, PWMSpindleControl.cpp, Player.cpp).
 *
 * Only relative imports, so the Z1 simulator can use it as it is.
 */
import type {
  MachineLimits,
  MotionModel,
  MotionStop,
  NcWordLike,
} from "../../motion/limits.ts"

/**
 * The motion settings the firmware builds in from `src/configZ1.default` (configZ1Pro.default
 * sets the same) and loads before the machine's own configuration, which overrides them.
 */
const BUILT_IN: ReadonlyMap<string, string> = new Map([
  ["default_feed_rate", "1000"],
  ["default_seek_rate", "2000"],
  ["alpha_max_rate", "1200.0"],
  ["beta_max_rate", "1200.0"],
  ["gamma_max_rate", "600.0"],
  ["acceleration", "150"],
  ["junction_deviation", "0.01"],
  ["spindle.delay_on_s", "8.0"],
  ["spindle.delay_off_s", "4.0"],
])

/** The motors' and axes' configuration names, X Y Z. */
const MOTORS = ["alpha", "beta", "gamma"] as const
const AXES = ["x", "y", "z"] as const
/** Robot.cpp's own axis speed limits, mm/min, which the Z1's configurations leave unset. */
const AXIS_MAX_SPEEDS = [4000, 4000, 2000] as const

/**
 * The settings a configuration file sets, as the firmware reads one (ConfigSource::process_line):
 * a line's first word is its key and its next its value, `#` starts a comment, and of the lines
 * that set a key the last wins.
 */
function settingsOf(content: string): Map<string, string> {
  const settings = new Map<string, string>()
  // A UTF-8 document marker before the first key is not part of it.
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  for (const line of text.split(/\r\n|\n|\r/)) {
    const setting = /^[ \t]*([^\s#]+)[ \t]+([^\s#]+)/.exec(line)
    if (setting) settings.set(setting[1], setting[2])
  }
  return settings
}

/** ConfigValue::as_number: the number a value starts with, of the characters a number has. */
function numberOf(value: string | undefined): number | null {
  if (value === undefined) return null
  const number = /^-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/i.exec(
    value.replace(/[^0-9a-fpx.-]/gi, "")
  )
  return number ? Number(number[0]) : null
}

/** A short digest of a configuration's text, to key the limits of one without a revision. */
function digest(content: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index++)
    hash = Math.imul(hash ^ content.charCodeAt(index), 0x01000193)
  return (hash >>> 0).toString(16).padStart(8, "0")
}

/**
 * The limits a configuration sets over the built-in ones, keyed `key`. An axis goes no faster
 * than its motor's `_max_rate`, its own `_axis_max_speed`, or the steps its motor can take
 * (`base_stepping_frequency` over `_steps_per_mm`, Robot::check_max_actuator_speeds).
 */
function limitsOf(settings: ReadonlyMap<string, string>, key: string) {
  const value = (name: string) =>
    numberOf(settings.get(name)) ?? numberOf(BUILT_IN.get(name))
  /** A setting the firmware uses only when it is more than 0. */
  const positive = (name: string) => {
    const number = value(name)
    return number !== null && number > 0 ? number : null
  }
  const stepping = positive("base_stepping_frequency") ?? 100_000
  const axisRate = MOTORS.map((motor, axis) => {
    const steps = positive(`${motor}_steps_per_mm`)
    return Math.min(
      positive(`${motor}_max_rate`) ?? 3000,
      positive(`${AXES[axis]}_axis_max_speed`) ??
        (value(`${AXES[axis]}_axis_max_speed`) === null
          ? AXIS_MAX_SPEEDS[axis]
          : Infinity),
      steps === null ? Infinity : Math.floor(stepping / steps) * 60
    )
  })
  const axisAcceleration = MOTORS.map(
    (motor) => positive(`${motor}_acceleration`) ?? null
  )
  return {
    key,
    seek: positive("default_seek_rate") ?? 3000,
    feed: positive("default_feed_rate") ?? 1000,
    axisRate: [axisRate[0], axisRate[1], axisRate[2]],
    pathRate: positive("max_speed"),
    acceleration: positive("acceleration") ?? 50,
    axisAcceleration: [
      axisAcceleration[0],
      axisAcceleration[1],
      axisAcceleration[2] ?? positive("z_acceleration"),
    ],
    junctionDeviation: value("junction_deviation") ?? 0.05,
    zJunctionDeviation: value("z_junction_deviation"),
    minimumSpeed: Math.max(0, value("minimum_planner_speed") ?? 0),
    queueSize: Math.max(2, Math.trunc(value("planner_queue_size") ?? 32)),
    queueDelay: Math.max(0, value("queue_delay_time_ms") ?? 100) / 1000,
    lineSegment: Math.max(0, value("mm_per_line_segment") ?? 5),
    arcSegment: Math.max(0, value("mm_per_arc_segment") ?? 0),
    arcError: value("mm_max_arc_error") ?? 0.002,
    // PWMSpindleControl keeps whole seconds; `delay_s` is the older name of the delay on.
    spindleDelay: {
      on: Math.max(
        0,
        Math.trunc(value("spindle.delay_on_s") ?? value("spindle.delay_s") ?? 8)
      ),
      off: Math.max(0, Math.trunc(value("spindle.delay_off_s") ?? 4)),
    },
  } satisfies MachineLimits
}

/**
 * The Z1's limits where its configuration is not read: those its firmware builds in. Its seek
 * rate is `default_seek_rate`'s 2000 (Robot.cpp's own is 3000), the motors' rates bind before the
 * axes' 4000/4000/2000, the motors' own accelerations and `z_acceleration` are unset, lines go in
 * 5 mm blocks and arcs in chords by their error alone.
 */
export const Z1_DEFAULT_LIMITS: MachineLimits = limitsOf(
  new Map(),
  "makera-z1:defaults"
)

/** The limits a Z1's configuration file (`/sd/config.txt`) sets, at its `revision`. */
export function readZ1MotionLimits(
  content: string,
  revision: string
): MachineLimits {
  return limitsOf(settingsOf(content), `makera-z1:config:${revision}`)
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
 * whole seconds more, and drains only when it dwells. M3 and M4, and M5 from on, empty the
 * queue; from off M3 and M4, and M5 from on, then dwell the spindle's delay. These, M400, the
 * program pauses (M0, M1, M600), the routines (M6, M495, M480.x, G28, G32) and the program's end
 * empty the queue first. G10, G53 and M220 do not stop it.
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
        const seconds =
          (wordValue(words, "P") ?? 0) + Math.trunc(wordValue(words, "S") ?? 0)
        if (seconds > 0) {
          drain = true
          dwell += seconds
        }
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

/** How the Z1 moves: by the limits its configuration sets when it was read, else by its built-in ones. */
export const Z1_MOTION: MotionModel = {
  defaults: Z1_DEFAULT_LIMITS,
  limits: (configuration, revision) =>
    configuration === null
      ? Z1_DEFAULT_LIMITS
      : readZ1MotionLimits(configuration, revision ?? digest(configuration)),
  stop: z1Stop,
}
