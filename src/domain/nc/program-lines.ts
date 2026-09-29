import { readNcBlock } from "@/machine/contract"
import type { NcBlock, NcWord } from "@/machine/contract"

/** A program as it is read line by line: its lines, and each line's block. */
export type ProgramLines = {
  readonly lines: readonly string[]
  readonly blocks: readonly NcBlock[]
}

export function programLines(text: string): ProgramLines {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  return { lines, blocks: lines.map(readNcBlock) }
}

/** A line with words replaced, each by its text or, for "", removed with the space before it. */
export function editWords(
  line: string,
  edits: ReadonlyArray<{ word: NcWord; text: string }>
): string {
  let result = line
  // From the end, so earlier words keep their positions.
  for (const { word, text } of [...edits].sort(
    (a, b) => b.word.start - a.word.start
  )) {
    if (text) {
      result = result.slice(0, word.start) + text + result.slice(word.end)
      continue
    }
    let start = word.start
    while (start > 0 && result[start - 1] === " ") start--
    let end = word.end
    // A word first on its line takes the space after it instead.
    if (start === 0) while (result[end] === " ") end++
    result = result.slice(0, start) + result.slice(end)
  }
  return result
}

/** The one-based lines whose block holds a word `matches` accepts. */
export function linesWith(
  program: ProgramLines,
  matches: (word: NcWord, block: NcBlock) => boolean
): number[] {
  const found: number[] = []
  program.blocks.forEach((block, index) => {
    if (!block.problem && block.words.some((word) => matches(word, block)))
      found.push(index + 1)
  })
  return found
}

/** Every line with the words `matches` accepts removed from it. */
export function dropWords(
  program: ProgramLines,
  matches: (word: NcWord, block: NcBlock) => boolean
): string[] {
  return program.lines.map((line, index) => {
    const block = program.blocks[index]
    if (block.problem) return line
    const edits = block.words
      .filter((word) => matches(word, block))
      .map((word) => ({ word, text: "" }))
    return edits.length ? editWords(line, edits) : line
  })
}

/** A code as programs write it: "G91.1", "M4". */
export const codeOf = (word: Pick<NcWord, "letter" | "value">) =>
  `${word.letter}${word.value}`

/** Lines as a sentence names them: "line 8", "lines 8, 12 and 3 more". */
export function linesText(lines: readonly number[]): string {
  if (lines.length === 1) return `line ${lines[0]}`
  const shown = lines.slice(0, 3).join(", ")
  const more = lines.length - 3
  if (more > 0) return `lines ${shown} and ${more} more`
  return `lines ${lines.slice(0, -1).join(", ")} and ${lines.at(-1)}`
}
