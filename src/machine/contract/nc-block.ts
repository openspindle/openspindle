/**
 * The NC lexer every reader shares, so the preview, combining operations and preparing a program
 * for Run read a line the same way and refuse the same lines. It reads one line (a block): its
 * comments, in parentheses or from a semicolon to the end of the line; its words, a letter of
 * either case and a number, optionally spaced; M117's display text; a `%` program delimiter; and
 * whether the line can run as written.
 */

/** A word of a block, with where it is in its line. */
export type NcWord = {
  /** Upper case. */
  readonly letter: string
  readonly value: number
  /** The index of its letter in the line, and the index after its last digit. */
  readonly start: number
  readonly end: number
}

/** Why a line cannot run as written. */
export type NcBlockProblem =
  | "unclosed-comment"
  | "unmatched-comment"
  | "checksum"
  | "block-delete"
  | "syntax"
  | "number"

/** Each problem as the end of a sentence about its line: "Line 12 has an unclosed comment". */
export const NC_BLOCK_PROBLEMS: Readonly<Record<NcBlockProblem, string>> = {
  "unclosed-comment": "has an unclosed comment",
  "unmatched-comment": "has an unmatched comment delimiter",
  checksum: "uses a transport checksum",
  "block-delete": "is a block-delete line",
  syntax: "holds text that is not NC words",
  number: "has a number out of range",
}

/** One line of NC, read. */
export type NcBlock = {
  /**
   * The line without its comments, trimmed: what runs. Empty for a blank line, a comment and a
   * `%` delimiter; an M117 line written first on its line is kept whole, its text included.
   */
  readonly code: string
  /** Its words; a message holds only its line number and M117. */
  readonly words: readonly NcWord[]
  /** M117's display text, up to any comment; null for other blocks. */
  readonly message: string | null
  /** Where the line's `%` program delimiter is; null when it is not one. */
  readonly delimiter: number | null
  /** Why the line cannot run as written; null when it can. */
  readonly problem: NcBlockProblem | null
}

const WORD = /([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi
/** M117 after an optional line number: the rest of its line is text to display. */
const MESSAGE = /^(?:[Nn]\d+\s*)?M0*117(?=\s|$)/
const LINE_NUMBER = /^[Nn]\d+/
const CHECKSUM = /\*\s*\d+\s*$/
const COMMENT = /[;()]/
/** Where a comment starts, which ends the display text. */
const COMMENT_START = /[;(]/

const EMPTY: NcBlock = {
  code: "",
  words: [],
  message: null,
  delimiter: null,
  problem: null,
}

/**
 * The line without its comments, and where its characters are in the line: the starts of each
 * run of kept characters, as pairs of their index in the code and in the line. Null runs when no
 * comment was removed.
 */
type Uncommented = { readonly code: string; readonly runs: number[] | null }

function uncommented(line: string): Uncommented | NcBlockProblem {
  if (!COMMENT.test(line)) return { code: line, runs: null }
  const runs: number[] = []
  let code = ""
  let depth = 0
  let kept = -2
  for (let index = 0; index < line.length; index++) {
    const character = line[index]
    if (character === ";" && depth === 0) break
    if (character === "(") depth++
    else if (character === ")") {
      if (!depth) return "unmatched-comment"
      depth--
    } else if (!depth) {
      if (index !== kept + 1) runs.push(code.length, index)
      code += character
      kept = index
    }
  }
  if (depth) return "unclosed-comment"
  return { code, runs }
}

/** Where a character of the code is in the line. */
function inLine(runs: readonly number[] | null, index: number): number {
  if (!runs) return index
  let run = 0
  while (run + 2 < runs.length && runs[run + 2] <= index) run += 2
  return runs[run + 1] + index - runs[run]
}

/** The words of the code and whether text other than words is left between them. */
function readWords(
  code: string,
  runs: readonly number[] | null
): { words: NcWord[]; residue: boolean } {
  const words: NcWord[] = []
  let residue = false
  let next = 0
  for (const match of code.matchAll(WORD)) {
    if (code.slice(next, match.index).trim()) residue = true
    next = match.index + match[0].length
    words.push({
      letter: match[1].toUpperCase(),
      value: Number(match[2]),
      start: inLine(runs, match.index),
      end: inLine(runs, next - 1) + 1,
    })
  }
  if (code.slice(next).trim()) residue = true
  return { words, residue }
}

/** A line of M117, whose text is data, even when it holds NC words or comment delimiters. */
function messageBlock(
  code: string,
  runs: readonly number[] | null,
  offset: number,
  keyword: string
): NcBlock {
  const at = (index: number) => inLine(runs, offset + index)
  const words: NcWord[] = []
  const number = LINE_NUMBER.exec(keyword)
  if (number)
    words.push({
      letter: "N",
      value: Number(number[0].slice(1)),
      start: at(0),
      end: at(number[0].length - 1) + 1,
    })
  words.push({
    letter: "M",
    value: 117,
    start: at(keyword.lastIndexOf("M")),
    end: at(keyword.length - 1) + 1,
  })
  const text = code.slice(keyword.length).trimStart()
  return {
    code,
    words,
    message: text.split(COMMENT_START, 1)[0].trimEnd(),
    delimiter: null,
    problem: CHECKSUM.test(code) ? "checksum" : null,
  }
}

/** Reads one line of NC. */
export function readNcBlock(line: string): NcBlock {
  const whole = line.trim()
  const written = MESSAGE.exec(whole)
  if (written) {
    const indent = line.length - line.trimStart().length
    return messageBlock(whole, null, indent, written[0])
  }
  const read = uncommented(line)
  if (typeof read === "string") return { ...EMPTY, problem: read }
  const { runs } = read
  const code = read.code.trim()
  if (!code) return EMPTY
  const offset = read.code.length - read.code.trimStart().length
  if (code === "%")
    return { ...EMPTY, delimiter: inLine(runs, read.code.indexOf("%")) }
  const problem = (kind: NcBlockProblem): NcBlock => ({
    code,
    words: [],
    message: null,
    delimiter: null,
    problem: kind,
  })
  if (CHECKSUM.test(code)) return problem("checksum")
  if (code.startsWith("/")) return problem("block-delete")
  const message = MESSAGE.exec(code)
  if (message) return messageBlock(code, runs, offset, message[0])
  const { words, residue } = readWords(read.code, runs)
  if (residue) return problem("syntax")
  if (words.some((word) => !Number.isFinite(word.value)))
    return problem("number")
  return { code, words, message: null, delimiter: null, problem: null }
}

/**
 * The tool a program changes to (M6, to its T word or the last one selected) before it starts
 * the spindle (M3 or M4); null when it starts the spindle first or never changes tools.
 */
export function firstToolChange(text: string): number | null {
  let selected: number | null = null
  for (const line of text.split("\n")) {
    const { words, message } = readNcBlock(line)
    if (message !== null) continue
    const m = (code: number) =>
      words.some((word) => word.letter === "M" && word.value === code)
    if (m(3) || m(4)) return null
    const tool = words.find((word) => word.letter === "T")
    if (tool) selected = tool.value
    if (m(6) && selected !== null) return selected
  }
  return null
}
