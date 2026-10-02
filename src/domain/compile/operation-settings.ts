import { readNcBlock } from "@/machine/contract"
import type { NcWord } from "@/machine/contract"
import type { GCodeProgram } from "@/domain/nc/gcode"
import type { FixtureKit } from "../fixtures/fixture-kit"
import type { OperationSpan } from "./compile"

/** The lowest and the highest of a set of values. */
export type ValueRange = readonly [number, number]

/**
 * The machine's modes that run the vacuum and the spindle air whenever the spindle runs (the
 * plate's vacuum and air blow assists, or what the machine is set to); null when unknown.
 */
export type SpindleLinked = {
  readonly vacuum: boolean | null
  readonly spindleAir: boolean | null
}

/** What an operation sets the machine to as it runs. */
export type OperationSettings = {
  /** The spindle's speeds while it runs, rpm; null when it does not run. */
  readonly spindle: ValueRange | null
  /**
   * The feeds of its feed moves, mm/min, or of its probing moves when it makes only those, such
   * as a probing operation; null when it makes neither.
   */
  readonly feed: ValueRange | null
  /** Whether the vacuum runs during its moves; null when that depends on an unknown mode. */
  readonly vacuum: boolean | null
  /** Whether the spindle air blows during its moves; null when that depends on an unknown mode. */
  readonly spindleAir: boolean | null
}

const widen = (range: ValueRange | null, value: number): ValueRange =>
  range
    ? [Math.min(range[0], value), Math.max(range[1], value)]
    : [value, value]

const mCode = (words: readonly NcWord[], ...codes: number[]) =>
  words.some((word) => word.letter === "M" && codes.includes(word.value))

/**
 * What each operation of a compiled plate sets, by its id, from the plate's program as its
 * machine moves through it (its firmware's moves too): its spindle speeds and feeds, and
 * whether the vacuum and the spindle air run. The vacuum follows the program from its start,
 * where it is off: the machine's own codes switch it (`FixtureKit.switchesVacuum`), and while
 * its spindle-linked mode is on, every spindle start and stop does. The spindle air blows
 * while the spindle runs with its mode on.
 */
export function operationSettings(
  program: GCodeProgram,
  spans: readonly OperationSpan[],
  kit: FixtureKit | null,
  linked: SpindleLinked
): ReadonlyMap<string, OperationSettings> {
  const { lines, segments } = program
  let vacuum: boolean | null = false
  let applied = 0
  // What the blocks up to `line` (one-based), the block on it too, leave the vacuum.
  const vacuumAt = (line: number): boolean | null => {
    for (; applied < Math.min(line, lines.length); applied++) {
      const text = lines[applied]
      if (!/m/i.test(text)) continue
      const { words, problem } = readNcBlock(text)
      if (problem) continue
      const switched = kit?.switchesVacuum(words) ?? null
      if (switched !== null) vacuum = switched
      else if (linked.vacuum !== false && mCode(words, 3, 4))
        vacuum = linked.vacuum ?? (vacuum || null)
      else if (linked.vacuum !== false && mCode(words, 5))
        vacuum = linked.vacuum === true ? false : vacuum && null
    }
    return vacuum
  }
  const settings = new Map<string, OperationSettings>()
  let index = 0
  for (const span of spans) {
    let spindle: ValueRange | null = null
    let feed: ValueRange | null = null
    let probing: ValueRange | null = null
    let vacuumRuns: boolean | null = false
    for (; index < segments.length; index++) {
      const move = segments[index]
      if (move.line > span.endLine) break
      const runs = vacuumAt(move.line)
      if (move.line < span.startLine) continue
      if (move.spindle > 0) spindle = widen(spindle, move.spindle)
      if (move.probing) probing = widen(probing, move.feed)
      else if (!move.rapid) feed = widen(feed, move.feed)
      if (runs) vacuumRuns = true
      else if (runs === null) vacuumRuns = vacuumRuns || null
    }
    vacuumAt(span.endLine)
    settings.set(span.operationId, {
      spindle,
      feed: feed ?? probing,
      vacuum: vacuumRuns,
      spindleAir: spindle ? linked.spindleAir : false,
    })
  }
  return settings
}
