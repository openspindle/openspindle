import {
  NC_BLOCK_PROBLEMS,
  RUN_LIMITS,
  firstToolChange,
  readNcBlock,
} from "../../contract/index.ts"
import type {
  NcBlock,
  NcWord,
  PreparedProgram,
  ProgramChange,
} from "../../contract/index.ts"
import { ProgramError } from "../adapter.ts"
import { makeraParts } from "./parts.ts"

/** The firmware's executable line buffer (Player gcode queue entries are 64 bytes). */
const MAX_EXECUTABLE_LINE = 63
const MAX_REPORTED_CHANGES = 500
const TOO_LARGE = `Run supports NC programs up to ${RUN_LIMITS.programBytes / 1024 ** 2} MiB.`
/** The Z1 has no M0/M1 handler; M600 suspends playback until `resume`. */
export const PROGRAM_PAUSE = "M600"

const LINE_NUMBER = /^N\d+\s*/i
const PROGRAM_STOP = /^M0*[01](?![\d.])/
const BARE_STOP = /^M0*[01]$/

/** The value of a block's first `letter` word, or null without one. */
const wordValue = (block: NcBlock, letter: string) =>
  block.words.find((word) => word.letter === letter)?.value ?? null

const changesTool = (block: NcBlock) =>
  block.words.some((word) => word.letter === "M" && word.value === 6)

const startsSpindle = (word: NcWord) =>
  word.letter === "M" && (word.value === 3 || word.value === 4)

/**
 * M codes an S word may share a line with and still be the spindle speed, as the preview reads
 * it (`parseGCode`); beside any other M code the S is that code's own, such as M223's override.
 */
const SPEED_M_CODES: ReadonlySet<number> = new Set([3, 4, 5, 6, 7, 8, 9, 30])

/**
 * Codes that take a line's S as their own: another M code, or G4, whose S the Z1 dwells for in
 * seconds.
 */
const ownsS = (word: NcWord) =>
  (word.letter === "M" && !SPEED_M_CODES.has(word.value)) ||
  (word.letter === "G" && word.value === 4)

/** Whether a line's S word sets the spindle speed, as on a line of its own, a move or an M3. */
const setsSpindleSpeed = (block: NcBlock) =>
  block.words.some((word) => word.letter === "S") && !block.words.some(ownsS)

/** Where the command at the start of `rest` ends, as the dispatcher splits a line; -1 with it. */
function commandEnd(rest: string): number {
  // As the dispatcher looks, from the command's third character.
  const next = (letters: RegExp, from = 2) => {
    const index = rest.slice(from).search(letters)
    return index === -1 ? -1 : from + index
  }
  if (rest[0] === "M") return next(/[GM]/)
  if (rest[0] === "T" || rest[0] === "S") {
    const m = next(/M/)
    return m === -1 ? next(/[GST]/) : next(/[GMST]/, m + 2)
  }
  return next(next(/S/) !== -1 && next(/M/) !== -1 ? /[GMST]/ : /[GMT]/)
}

/**
 * The commands the firmware's dispatcher runs a line as, one after another (GcodeDispatch.cpp),
 * none for a line it ignores. A line starting with a coordinate or F gets a G in front, and one
 * starting with G then has its first G90, or else G91, moved to the front. A command starting
 * with M ends at the next G or M; with T or S, at the next G, S or T, or when an M follows, at
 * the next G, M, S or T after that M; with G, at the next G, M or T, and at S too when an S and
 * an M follow.
 */
function firmwareCommands(code: string): string[] {
  let rest = /^[XYZAF]/.test(code) ? `G1 ${code}` : code
  const mode = rest.startsWith("G")
    ? ["G90", "G91"].find((word) => rest.includes(word))
    : undefined
  if (mode) rest = mode + rest.replace(mode, "")
  if (!/^[GMST]/.test(rest)) return []
  const commands: string[] = []
  while (rest) {
    const end = commandEnd(rest)
    const cut = end === -1 ? rest.length : end
    commands.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  return commands
}

/**
 * Whether the command the firmware runs a line's M3 or M4 in has an S word (or it runs none).
 * SpindleControl.cpp sets the speed only from an S of the M3's own: an S on a line of its own or
 * a move (as pcb2gcode writes it) sets none, and a bare M3 runs at the speed set before (10,000
 * rpm after boot).
 */
function spindleGetsSpeed(code: string): boolean {
  const command = firmwareCommands(code)
    .map((each) => readNcBlock(each).words)
    .find((words) => words.some(startsSpindle))
  return !command || command.some((word) => word.letter === "S")
}

/** A line's last S word, as written, without the spaces it may have after its letter. */
function lastSpeed(code: string): string {
  const word = readNcBlock(code)
    .words.filter((each) => each.letter === "S")
    .at(-1)!
  return `S${code.slice(word.start + 1, word.end).trimStart()}`
}

/**
 * The line with the speed `speedCode` set added where the firmware reads it with the line's M3
 * or M4: right after it, or else before it (a command a T word starts ends at the first S after
 * its M code). Null when it reads it in neither place.
 */
function withSpindleSpeed(code: string, speedCode: string): string | null {
  const spindle = readNcBlock(code).words.find(startsSpindle)!
  const speed = lastSpeed(speedCode)
  return (
    [
      `${code.slice(0, spindle.end)} ${speed}${code.slice(spindle.end)}`,
      `${code.slice(0, spindle.start)}${speed} ${code.slice(spindle.start)}`,
    ].find(spindleGetsSpeed) ?? null
  )
}

/** Refuses a line the Z1 cannot run as written when it has one of these problems. */
function refuse(
  block: NcBlock,
  lineNumber: number,
  kinds: readonly NonNullable<NcBlock["problem"]>[],
  because = ""
) {
  if (block.problem && kinds.includes(block.problem))
    throw new ProgramError(
      `Line ${lineNumber} ${NC_BLOCK_PROBLEMS[block.problem]}${because}.`,
      lineNumber
    )
}

function utf8Bytes(source: string, limit: number): number {
  let bytes = 0
  for (const character of source) {
    const point = character.codePointAt(0)!
    if (
      (point < 32 && point !== 9 && point !== 10 && point !== 13) ||
      point === 127 ||
      (point >= 0xd800 && point <= 0xdfff)
    )
      throw new ProgramError(
        "NC source contains an unsupported control character."
      )
    if (point < 0x80) bytes += 1
    else if (point < 0x800) bytes += 2
    else if (point < 0x10000) bytes += 3
    else bytes += 4
    if (bytes > limit) throw new ProgramError(TOO_LARGE)
  }
  return bytes
}

/**
 * Normalizes NC into exactly what the Z1 player executes, one output line per source line
 * so line numbers stay aligned with Preview. Every semantic rewrite is recorded. A program
 * larger than a file the machine takes is sent as parts (`makeraParts`).
 */
export function prepareMakeraProgram(source: string): PreparedProgram {
  utf8Bytes(source, RUN_LIMITS.programBytes)
  const lines = source.replace(/\r\n?/g, "\n").split("\n")
  if (lines.at(-1) === "") lines.pop()
  if (lines.length > RUN_LIMITS.programLines)
    throw new ProgramError(
      `Run supports at most ${RUN_LIMITS.programLines.toLocaleString("en")} source lines.`
    )
  const changes: ProgramChange[] = []
  let changeCount = 0
  const record = (change: ProgramChange) => {
    changeCount++
    if (changes.length < MAX_REPORTED_CHANGES) changes.push(change)
  }
  const pauseLines: number[] = []
  // The tool the last T word selected, for an M6 without one.
  let selectedTool: number | null = null
  // The line that set the spindle speed last, for an M3 or M4 without one.
  let speedCode: string | null = null
  let afterToolChange = false
  const output = lines.map((line, index) => {
    const lineNumber = index + 1
    // The shared lexer: comments stripped, and M117 text kept verbatim, as data.
    const block = readNcBlock(line)
    refuse(block, lineNumber, ["unmatched-comment", "unclosed-comment"])
    let code = block.code
    if (!code) return ""
    if ([...code].some((character) => character.charCodeAt(0) > 126))
      throw new ProgramError(
        `Executable line ${lineNumber} must use ASCII characters.`,
        lineNumber
      )
    refuse(block, lineNumber, ["checksum"], "; export a plain NC file first")
    refuse(block, lineNumber, ["block-delete"], ", which the Z1 firmware skips")
    if (code.length > MAX_EXECUTABLE_LINE)
      throw new ProgramError(
        `Executable line ${lineNumber} exceeds the firmware's ${MAX_EXECUTABLE_LINE}-byte line limit. Shorten the NC block before running.`,
        lineNumber
      )
    // The dispatcher skips numbered blocks, so the number is removed rather than the block.
    if (LINE_NUMBER.test(code)) {
      const after = code.replace(LINE_NUMBER, "")
      record({ line: lineNumber, before: code, after, reason: "line-number" })
      code = after
      if (!code) return ""
    }
    if (block.message !== null) return code
    if (/[a-z]/.test(code)) {
      // Lowercase text is a console command to the firmware, never NC.
      if (block.problem)
        throw new ProgramError(
          `Line ${lineNumber} is not NC; the Z1 firmware would treat it as a console command.`,
          lineNumber
        )
      const after = code.toUpperCase()
      record({ line: lineNumber, before: code, after, reason: "case" })
      code = after
    }
    // Text between words that is not NC would reach the firmware as values it guesses.
    if (block.problem)
      throw new ProgramError(
        `Line ${lineNumber} is not a supported plain NC block.`,
        lineNumber
      )
    // The Z1 stops for a tool change by hand itself, and the firmware ignores M0: a stop
    // written right after the change would be a second one.
    const stopsForToolChange = afterToolChange
    afterToolChange = false
    if (stopsForToolChange && BARE_STOP.test(code)) {
      record({
        line: lineNumber,
        before: code,
        after: "",
        reason: "tool-change-stop",
      })
      return ""
    }
    const tool = wordValue(block, "T")
    if (tool !== null) selectedTool = tool
    if (changesTool(block)) {
      // ATCHandler changes tools only for an M6 with its T word on the same line.
      if (tool === null) {
        if (selectedTool === null)
          throw new ProgramError(
            `Line ${lineNumber} changes tools (M6) without a tool number, which the Z1 ignores. Select the tool with a T word first.`,
            lineNumber
          )
        const after = `${code} T${selectedTool}`
        record({ line: lineNumber, before: code, after, reason: "tool-number" })
        code = after
      }
      afterToolChange = true
    }
    if (setsSpindleSpeed(block)) speedCode = code
    if (
      speedCode !== null &&
      block.words.some(startsSpindle) &&
      !spindleGetsSpeed(code)
    ) {
      const after = withSpindleSpeed(code, speedCode)
      if (after === null)
        throw new ProgramError(
          `Line ${lineNumber} starts the spindle where the Z1 would not read the program's speed with it. Put its M3 or M4 on a line of its own.`,
          lineNumber
        )
      record({ line: lineNumber, before: code, after, reason: "spindle-speed" })
      code = after
    }
    if (PROGRAM_STOP.test(code)) {
      const after = code.replace(PROGRAM_STOP, PROGRAM_PAUSE)
      record({ line: lineNumber, before: code, after, reason: "pause" })
      code = after
    }
    if (/^M0*600(?![\d.])/.test(code)) pauseLines.push(lineNumber)
    if (code.length > MAX_EXECUTABLE_LINE)
      throw new ProgramError(
        `Line ${lineNumber} exceeds the firmware's ${MAX_EXECUTABLE_LINE}-byte line limit after normalization.`,
        lineNumber
      )
    if (!/^[GMTSXYZAFO][\s+\-\d.]/.test(code))
      throw new ProgramError(
        `Line ${lineNumber} is not a supported plain NC block.`,
        lineNumber
      )
    return code
  })
  if (!output.some((line) => line.length > 0))
    throw new ProgramError("The program contains no executable NC blocks.")
  const text = `${output.join("\n")}\n`
  if (text.length > RUN_LIMITS.programBytes) throw new ProgramError(TOO_LARGE)
  return {
    text,
    lineCount: output.length,
    bytes: text.length,
    pauseLines,
    changes,
    changeCount,
    parts: makeraParts(output),
  }
}

/**
 * Whether a prepared program changes tools (M6 with a T word) before it starts the spindle
 * (M3 or M4), which the firmware refuses while no cutting tool is set.
 */
export const changesToolBeforeSpindle = (text: string): boolean =>
  firstToolChange(text) !== null
