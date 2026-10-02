/**
 * The firmware's own routines as the simulator runs them: ATCHandler fills a script queue and
 * its main loop echoes each line to every connection before running it, so its replies (probe
 * contacts, the G32 report and height map) reach the host even from a played file. Values are
 * those of a Z1 Pro configuration and the replies follow Makera Studio's logs of one.
 */

type Xyz = [number, number, number]

/**
 * One script line: echoed, then what running it prints. Where it moves the machine
 * (`output` sets `mpos`), the simulator queues the move: G0 at the seek rate, G38 at its F.
 */
export type Step = {
  /** The script line as the firmware echoes it; null for output without one. */
  readonly echo: string | null
  /** The script line it runs, which a routine that runs its lines unechoed leaves out of `echo`. */
  readonly runs?: string
  /** Printed after the echo, "ok" included; evaluated when the step runs. */
  readonly output: (machine: AutomationMachine) => string[]
  /** How long it takes besides its move, at the machine's speed. */
  readonly ms: number
  /** Holds the queue until the tool change is confirmed (M490.1). */
  readonly waitsForTool?: number
}

/**
 * ATCHandler's tool lengths: where the last tool measured at the sensor met it, where the
 * reference tool did (the one work Z was last set with), and the offset between them.
 */
export type ToolLengths = {
  measured: number | null
  reference: number | null
  offset: number
}

/** What the scripts read and change on the simulated machine. */
export type AutomationMachine = {
  mpos: Xyz
  offset: Xyz
  tool: number
  readonly lengths: ToolLengths
  /** What the probe meets going down at machine X Y. */
  readonly surfaceAt: (x: number, y: number) => number
}

/** set_ref_tool_mz: setting work Z makes the measured tool the reference, with no offset. */
export function setReference(lengths: ToolLengths) {
  lengths.reference = lengths.measured
  lengths.offset = 0
}

/** A work position on an axis in machine coordinates (wcs2mcs): with the tool offset in Z. */
export const machineOf = (
  machine: Pick<AutomationMachine, "offset" | "lengths">,
  axis: number,
  value: number
) => value + machine.offset[axis] + (axis === 2 ? machine.lengths.offset : 0)

export const CLEARANCE_Z = -3
const SAFE_Z = -20
const TOOLRACK_Z = -108
const FAST = 500
const SLOW = 100
const RETRACT = 1
/**
 * The machine Z at which the probe meets stock until the app sends its plate's bed: a 1 mm PCB
 * on the MDF bed (bed Z 1.02).
 */
export const DEFAULT_SURFACE_Z = -82.35

/** What the probe meets going down where it is. */
const surfaceUnder = (machine: AutomationMachine) =>
  machine.surfaceAt(machine.mpos[0], machine.mpos[1])

/** The tool sensor's contact for a tool of that number. */
export function sensorZ(tool: number) {
  if (tool === 0) return -76.5
  // A Z1 Pro measured its 3D probe (T9999) at -67.174 (2026-09-28): 9.4 mm longer, as fitted,
  // than the wired probe.
  if (tool === 9999) return -67.17
  return -84.47 + tool * 0.01
}

const f3 = (value: number) => value.toFixed(3)
const f4 = (value: number) => value.toFixed(4)

/** A smooth, tilted surface: height above the grid's first point, in mm. */
export const surfaceHeight = (x: number, y: number) =>
  0.02 * Math.sin(x / 13) - 0.015 * Math.cos(y / 9) + 0.015 + 0.0025 * y

const say = (echo: string, ms: number, then: string[] = []): Step => ({
  echo,
  output: () => [...then, "ok"],
  ms,
})

/** A straight probe move down to a contact at `z`, reported as the firmware's [PRB] line. */
function touch(
  echo: string,
  ms: number,
  z: (machine: AutomationMachine) => number
): Step {
  return {
    echo,
    ms,
    output: (machine) => {
      machine.mpos[2] = z(machine)
      const [x, y] = machine.mpos
      return [`[PRB:${f3(x)},${f3(y)},${f3(machine.mpos[2])}:1]`, "ok"]
    },
  }
}

type Target = { x?: number; y?: number; z?: number }

function move(echo: string, ms: number, target: Target, work: boolean): Step {
  return {
    echo,
    ms,
    output: (machine: AutomationMachine) => {
      for (const [index, value] of [target.x, target.y, target.z].entries())
        if (value !== undefined)
          machine.mpos[index] = work ? machineOf(machine, index, value) : value
      return ["ok"]
    },
  }
}

const rise = (by: number, ms: number): Step => ({
  echo: `G91 G0 Z${f3(by)}`,
  ms,
  output: (machine) => {
    machine.mpos[2] += by
    return ["ok"]
  },
})

const setTool = (tool: number, ms: number): Step => ({
  echo: `M493.2 T${tool}`,
  ms,
  output: (machine) => {
    machine.tool = tool
    return ["ok"]
  },
})

/** fill_cali_scripts: the tool's length at the tool sensor, the probe's checked after. */
function calibrate(tool: number, sensor: [number, number], ms: number): Step[] {
  const probe = tool === 0
  return [
    ...(probe ? [say("M494.1", ms)] : []),
    say("M497.3", ms),
    move(`G53 G0 Z${f3(CLEARANCE_Z)}`, ms, { z: CLEARANCE_Z }, false),
    move(
      `G53 G0 X${f3(sensor[0])} Y${f3(sensor[1])}`,
      ms,
      { x: sensor[0], y: sensor[1] },
      false
    ),
    touch(`G38.6 Z${f3(TOOLRACK_Z)} F${f3(FAST)}`, ms, () => sensorZ(tool)),
    rise(RETRACT, ms),
    touch(`G38.6 Z${f3(-1 - RETRACT)} F${f3(SLOW)}`, ms, () => sensorZ(tool)),
    {
      // set_tool_offset: the contact just made, from the reference once there is one.
      echo: "M493.1",
      ms,
      output: (machine) => {
        const { lengths } = machine
        lengths.measured = machine.mpos[2]
        if (lengths.reference !== null)
          lengths.offset = lengths.measured - lengths.reference
        return ["ok"]
      },
    },
    move(`G53 G0 Z${f3(SAFE_Z)}`, ms, { z: SAFE_Z }, false),
    ...(probe ? [say("M492.3", ms * 4), say("M494.2", ms)] : []),
  ]
}

/**
 * A tool change by hand (fill_change_scripts, fill_cali_scripts): to the change `position`,
 * wait for the confirmation, no tool, measure the new one at the sensor, then set it. A
 * program's M6 then rises to the clearance and goes back over `returnTo`, where it began
 * (ATCHandler, unechoed).
 */
export function changeTool(
  tool: number,
  position: [number, number],
  sensor: [number, number],
  ms: number,
  returnTo?: [number, number]
): Step[] {
  return [
    move(`G53 G0 Z${f3(CLEARANCE_Z)}`, ms, { z: CLEARANCE_Z }, false),
    move(
      `G53 G0 X${f3(position[0])} Y${f3(position[1])}`,
      ms,
      { x: position[0], y: position[1] },
      false
    ),
    say("M497.2", ms),
    { ...say("M490.1", ms), waitsForTool: tool },
    setTool(-1, ms),
    ...calibrate(tool, sensor, ms),
    setTool(tool, ms),
    say(tool === 9999 ? "M494.1" : "M494.2", ms),
    ...(returnTo
      ? [
          {
            echo: null,
            ms,
            output: (machine: AutomationMachine) => {
              machine.mpos[2] = CLEARANCE_Z
              return []
            },
          },
          {
            echo: null,
            ms,
            output: (machine: AutomationMachine) => {
              machine.mpos[0] = returnTo[0]
              machine.mpos[1] = returnTo[1]
              return []
            },
          },
        ]
      : []),
  ]
}

/** fill_zprobe_scripts: over X Y (work), fast and slow touches, work Z0 at the contact. */
export function probeZ(x: number, y: number, ms: number): Step[] {
  return [
    say("M497.5", ms),
    say("M494.1", ms),
    move(`G53 G0 Z${f3(CLEARANCE_Z)}`, ms, { z: CLEARANCE_Z }, false),
    move(`G90 G0 X${f3(x)} Y${f3(y)}`, ms, { x, y }, true),
    touch(`G38.2 Z${f3(TOOLRACK_Z)} F${f3(FAST)}`, ms, surfaceUnder),
    rise(RETRACT, ms),
    touch(`G38.2 Z${f3(-1 - RETRACT)} F${f3(SLOW)}`, ms, surfaceUnder),
    {
      echo: "G10 L20 P0 Z0.000",
      ms,
      output: (machine) => {
        setReference(machine.lengths)
        machine.offset[2] = machine.mpos[2]
        return ["ok"]
      },
    },
    rise(RETRACT, ms),
    say("M494.2", ms),
  ]
}

export type Grid = {
  width: number
  depth: number
  columns: number
  rows: number
  height: number
}

/** CartGridStrategy::print_bed_level: rows from the far edge down, then the X axis. */
export function heightTable(grid: Grid): string[] {
  const { width, depth, columns, rows } = grid
  const axis = (size: number, count: number) =>
    Array.from({ length: count }, (_, index) => (size * index) / (count - 1))
  const xs = axis(width, columns)
  const ys = axis(depth, rows)
  const first = surfaceHeight(0, 0)
  return [
    ...ys
      .map(
        (y) =>
          `${f4(y).padStart(10)}|${xs.map((x) => `${f4(surfaceHeight(x, y) - first).padStart(10)} `).join("")}`
      )
      .reverse(),
    "-----+-----".repeat(xs.length),
    xs.map((x) => `${f4(x).padStart(10)} `).join(""),
  ]
}

/**
 * fill_autolevel_scripts and CartGridStrategy's rectangular probe: over X Y (work), then G32 R1
 * reports its start, every point it probes (serpentine rows) and the height map.
 */
export function levelGrid(
  x: number,
  y: number,
  grid: Grid,
  ms: number
): Step[] {
  const { width, depth, columns, rows, height } = grid
  const first = surfaceHeight(0, 0)
  /** Where G32 starts, in machine X and Y, which the samples are from. */
  const start: [number, number] = [0, 0]
  const points: Step[] = []
  let maxDeviation = 0
  let lowest = Infinity
  let highest = -Infinity
  for (let row = 0; row < rows; row++)
    for (let step = 0; step < columns; step++) {
      const column = row % 2 ? columns - step - 1 : step
      const dx = (width * column) / (columns - 1)
      const dy = (depth * row) / (rows - 1)
      const z = surfaceHeight(dx, dy) - first
      maxDeviation = Math.max(maxDeviation, Math.abs(z))
      lowest = Math.min(lowest, z)
      highest = Math.max(highest, z)
      points.push({
        echo: null,
        ms: ms * 4,
        output: (machine) => {
          machine.mpos[0] = start[0] + dx
          machine.mpos[1] = start[1] + dy
          return [
            `DEBUG: X${f3(machine.mpos[0])}, Y${f3(machine.mpos[1])}, Z${f3(z)}`,
          ]
        },
      })
    }
  return [
    say("M497.6", ms),
    say("M494.0", ms),
    move(`G90 G0 X${f3(x)} Y${f3(y)}`, ms, { x, y }, true),
    {
      echo: `G32R1X0Y0A${f3(width)}B${f3(depth)}I${columns}J${rows}H${f3(height)}`,
      ms: ms * 4,
      output: (machine) => {
        start[0] = machine.mpos[0]
        start[1] = machine.mpos[1]
        return [
          "Rectangular Grid Probe...",
          "Leveling start, offset by XY",
          `Probe start ht: ${f3(height)} mm, start MCS x,y: ${f3(machine.mpos[0])},${f3(machine.mpos[1])}, rectangular bed width,height in mm: ${f3(width)},${f3(depth)}, grid size: ${columns}x${rows}`,
          `probe at 0,0 is ${f3(0.01)} mm`,
        ]
      },
    },
    ...points,
    {
      echo: null,
      ms,
      output: () => [
        ...heightTable(grid),
        `Max deviation from zero: ${f3(maxDeviation)}`,
        `Max deviation between highest and lowest: ${f3(highest - lowest)}`,
        "Probe completed.",
        "ok",
      ],
    },
  ]
}

/**
 * The features the 3D probing routines find, from where the probe starts: a corner's sides or
 * walls half the distance away, a 16 × 12 mm pocket, which the default 10 mm searches reach, and
 * a boss whose sides lie 6 mm inside the distance. The stock top is the Z probe's.
 */
const POCKET = { halfX: 8, halfY: 6 }
const BOSS_INSET = 6

/** A routine's value as the firmware reads it, or its default. */
const value = (code: string, letter: string, fallback: number) => {
  const match = new RegExp(`${letter}([+-]?(?:\\d+\\.?\\d*|\\.\\d+))`).exec(
    code.replace(/^M\S+/, "")
  )
  return match ? Number(match[1]) : fallback
}

/** The firmware's signs for the X and Y distances, by M480 subcode. */
const SIGNS: Record<number, [number, number]> = {
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

/**
 * M480 (ATCHandler's fill_OutCorner_scripts and the others): the 3D probe finds a corner or a
 * centre from `start` and sets the work origin there. The outside corners' scripts are queued
 * and echoed after M497.5; the other routines run theirs at once, unechoed, so only their
 * contacts and replies reach the host.
 */
export function originRoutine(code: string, start: Xyz, ms: number): Step[] {
  const subcode = Number(/^M0*480\.(\d+)/.exec(code)?.[1] ?? 0)
  if (!Object.hasOwn(SIGNS, subcode)) return []
  const signs = SIGNS[subcode]
  const queued = subcode <= 4
  const radius = value(code, "D", 2) / 2
  const dx = signs[0] * value(code, "X", 20)
  const dy = signs[1] * value(code, "Y", 20)
  const dz = value(code, "Z", 2)
  const [sx, sy, sz] = start
  const steps: Step[] = []
  const line = (
    echo: string,
    output: (machine: AutomationMachine) => string[]
  ) =>
    steps.push({
      echo: queued ? echo : null,
      runs: echo,
      ms,
      output: (machine) => [...output(machine), "ok"],
    })
  const at = (
    machine: AutomationMachine,
    x?: number,
    y?: number,
    z?: number
  ) => {
    if (x !== undefined) machine.mpos[0] = x
    if (y !== undefined) machine.mpos[1] = y
    if (z !== undefined) machine.mpos[2] = z
    return []
  }
  const report = (machine: AutomationMachine) => {
    const [x, y, z] = machine.mpos
    return [`[PRB:${f3(x)},${f3(y)},${f3(z)}:1]`]
  }
  const workZ = (machine: AutomationMachine) => machineOf(machine, 2, -dz)
  /** Down beside a side at a tenth of the speed, as the firmware comes down (M220 S10). */
  const descend = (over?: (machine: AutomationMachine) => void) => {
    line("M220S10", () => [])
    line(`G90 G0 Z${f3(-dz)}`, (machine) => {
      over?.(machine)
      return at(machine, undefined, undefined, workZ(machine))
    })
    line("M220S100", () => [])
  }
  line("M494.1", () => [])
  line("M497.5", () => [])
  // The top, twice, then back up to the height the routine started at; a pocket has none.
  if (subcode !== 9) {
    for (const pass of [0, 1]) {
      line(`G38.2 Z${f3(TOOLRACK_Z)} F${f3(SLOW)}`, (machine) => {
        at(machine, undefined, undefined, surfaceUnder(machine))
        return report(machine)
      })
      line("G10 L20 P0 Z0", (machine) => {
        setReference(machine.lengths)
        machine.offset[2] = machine.mpos[2]
        return []
      })
      if (!pass)
        line(`G91 G0 Z${f3(RETRACT)}`, (machine) =>
          at(machine, undefined, undefined, surfaceUnder(machine) + RETRACT)
        )
    }
    line(`G53 G0 Z${f3(sz)}`, (machine) =>
      at(machine, undefined, undefined, sz)
    )
  }
  /**
   * Two touches on a side, found `side` along `axis` (0 or 1), searching `distance` towards
   * `direction`, each followed by a retract, after the work origin a corner sets at the second.
   */
  const touches = (
    axis: 0 | 1,
    side: number,
    direction: number,
    distance: number,
    zero: number | null
  ) => {
    const letter = axis ? "Y" : "X"
    const contact = side - direction * radius
    const retract = () =>
      line(`G91 G0 ${letter}${f3(-direction * RETRACT)}`, (machine) => {
        machine.mpos[axis] = contact - direction * RETRACT
        return []
      })
    for (const [pass, feed] of [
      [0, SLOW],
      [1, SLOW / 2],
    ] as const) {
      line(
        `G38.2 ${letter}${f3(direction * distance)} F${f3(feed)}`,
        (machine) => {
          machine.mpos[axis] = contact
          return report(machine)
        }
      )
      if (!pass) retract()
    }
    if (zero !== null)
      line(`G10 L20 P0 ${letter}${f3(zero)}`, (machine) => {
        machine.offset[axis] = contact - zero
        return []
      })
    retract()
    return contact
  }
  if (subcode <= 8) {
    const inside = subcode >= 5
    // Outside, the sides are half the distance back from the start; inside, the walls are.
    const sideX = sx + (inside ? dx / 2 : -dx / 2)
    const sideY = sy + (inside ? -dy / 2 : dy / 2)
    const outX = inside ? sx + dx : sx - dx
    const outY = inside ? sy - dy : sy
    line(
      `G91 G0 X${f3(outX - sx)}${inside ? ` Y${f3(outY - sy)}` : ""}`,
      (machine) => at(machine, outX, outY)
    )
    descend()
    const towardX = inside ? -Math.sign(dx) : Math.sign(dx)
    touches(
      0,
      sideX,
      towardX,
      Math.abs(dx),
      inside ? Math.sign(dx) * radius : -Math.sign(dx) * radius
    )
    if (!inside) {
      line(`G53 G0 Z${f3(sz)}`, (machine) =>
        at(machine, undefined, undefined, sz)
      )
      line(`G53 G0 X${f3(sx)}`, (machine) => at(machine, sx))
      line(`G91 G0 Y${f3(dy)}`, (machine) => at(machine, undefined, sy + dy))
      descend()
    } else line(`G53 G0 X${f3(outX)}`, (machine) => at(machine, outX))
    const towardY = inside ? Math.sign(dy) : -Math.sign(dy)
    touches(
      1,
      sideY,
      towardY,
      Math.abs(dy),
      inside ? -Math.sign(dy) * radius : Math.sign(dy) * radius
    )
    line(`G53 G0 Z${f3(sz)}`, (machine) =>
      at(machine, undefined, undefined, sz)
    )
    line("G90 G0 X0.0Y0.0", (machine) =>
      at(machine, machine.offset[0], machine.offset[1])
    )
    return steps
  }
  // A pocket's walls, or a boss's sides, either side of the start in X, then in Y.
  for (const [axis, reach, half] of [
    [
      0,
      dx,
      subcode === 9 ? POCKET.halfX : Math.max(3, Math.abs(dx) - BOSS_INSET),
    ],
    [
      1,
      dy,
      subcode === 9 ? POCKET.halfY : Math.max(3, Math.abs(dy) - BOSS_INSET),
    ],
  ] as const) {
    if (!reach) continue
    const middle = start[axis]
    const letter = axis ? "Y" : "X"
    const distance = Math.abs(reach)
    if (subcode === 10) {
      line(`G91 G0 ${letter}${f3(-reach)}`, (machine) => {
        machine.mpos[axis] = middle - reach
        return []
      })
      descend()
    }
    const minus = touches(
      axis,
      middle - half,
      subcode === 9 ? -1 : 1,
      distance,
      null
    )
    if (subcode === 10) {
      line(`G53 G0 Z${f3(sz)}`, (machine) =>
        at(machine, undefined, undefined, sz)
      )
      descend((machine) => {
        machine.mpos[axis] = middle + half + radius + 4
      })
    }
    const plus = touches(
      axis,
      middle + half,
      subcode === 9 ? 1 : -1,
      distance,
      null
    )
    if (subcode === 10)
      line(`G53 G0 Z${f3(sz)}`, (machine) =>
        at(machine, undefined, undefined, sz)
      )
    const centre = (minus + plus) / 2
    line(`G53 G0 ${letter}${f3(centre)}`, (machine) => {
      machine.mpos[axis] = centre
      return []
    })
    line(`G10 L20 P0 ${letter}0`, (machine) => {
      machine.offset[axis] = centre
      return []
    })
  }
  return steps
}
