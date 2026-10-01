import { readNcBlock } from "@/machine/contract"
import type { NcBlock } from "@/machine/contract"
import { camLabel } from "@/domain/nc/cam-markers"
import type { GCodeProgram } from "@/domain/nc/gcode"
import type { FixtureKit } from "../fixtures/fixture-kit"
import { isProbeSlot } from "../tools/tool-table"

export type SectionKind =
  | "tool-change"
  | "probe"
  | "touch-off"
  | "scan"
  | "toolpath"
  | "setup"
  | "end"
  | "metadata"
  | "pause"
  | "message"

export interface ProgramSection {
  /**
   * Stable within its range: kind, name and occurrence, independent of line numbers. A tool
   * change is keyed by its tool's own number (see `keyTool`), not by where a table put it.
   */
  key: string
  kind: SectionKind
  name: string
  /** Active tool after M6; T preselection alone does not change it. */
  tool: number | null
  /** Inclusive one-based lines of the program. Compound blocks may share a line. */
  startLine: number
  endLine: number
  /** Half-open indices into program.segments. */
  segmentStart: number
  segmentEnd: number
}

type Heading = { name: string }
const validBlock = (block: NcBlock) => !block.problem

const toolChangeName = (tool: number | null) =>
  tool === null ? "Tool change" : `Change to T${tool}`

const AXIS_LETTERS = ["X", "Y", "Z", "A", "B", "C", "I", "J", "K", "R"]

/**
 * A machine-coordinate move of Z alone (`G53 G0 Z…`), such as the clearance retract compiling
 * adds: a lift to the machine's clearance, which makes no section and cuts nothing.
 */
export const machineRetract = (block: Pick<NcBlock, "words">) =>
  block.words.some((word) => word.letter === "G" && word.value === 53) &&
  block.words.every(
    (word) => !AXIS_LETTERS.includes(word.letter) || word.letter === "Z"
  )

/** M400 alone in its block: it waits for the moves before it and changes nothing. */
const isWait = (block: NcBlock) =>
  block.words.length === 1 &&
  block.words[0].letter === "M" &&
  block.words[0].value === 400

/** What sections read of a machine's NC through its kit: its probing and its CAM's markers. */
export type SectionMachine = Pick<FixtureKit, "probing" | "camMarkers">

/** What a comment on a line of its own says; null for a line that is not one. */
const commentText = (line: string) =>
  /^\s*;\s*(.*?)\s*$/.exec(line)?.[1] ??
  /^\s*\(\s*(.*?)\s*\)\s*$/.exec(line)?.[1] ??
  null

/** Comments about the program or its tools rather than headings of its toolpaths. */
const NOT_HEADINGS =
  /(?:thumbnail|preview|verified|warning|stock|created|material setup|manual nc|tool change|collet|paused|feedrate|diameter)/i

/** Conservative CAM headings, not arbitrary comments, tool descriptions or thumbnails. */
function commentHeading(line: string): Heading | null {
  if (line.length > 200) return null
  const text = camLabel(commentText(line) ?? undefined)
  if (!text || NOT_HEADINGS.test(text)) return null
  const explicit =
    /^(?:begin\s+)?(?:operation|toolpath|strategy)\s*[:=]\s*(.+)$/i.exec(text)
  if (explicit) return { name: explicit[1].trim() }
  if (
    /^(?:(?:2d|3d)\s+)?(?:adaptive|contour|pocket|profile|facing|face|bore|drill(?:ing)?|engraving|engrave|trace|parallel|scallop|roughing|finishing|rest machining|[\w-]+(?:\s+[\w-]+){0,2}\s+mounting holes)(?:\b|(?=\d))/i.test(
      text
    )
  )
    return { name: text }
  return null
}

/** A tool's description in a comment: "T1  Spiral O Metal 3.175*12mm". */
const describesTool = (line: string) => /^T\d/i.test(commentText(line) ?? "")

/**
 * A heading by where it stands, as Fusion 360's posts start each operation with its name,
 * whatever the name is: a comment on a line of its own, not among other comments, with the
 * operation's code after it (or the description of the tool it changes to first). After a
 * blank line; after other code only when the operation's tool change follows, as a comment
 * between two blocks is more often an instruction, such as a tool to remove. It names
 * something: not a tool's description, a marker, a separator or the program itself, which the
 * first line names.
 */
function standingHeading(
  lines: readonly string[],
  blocks: readonly NcBlock[],
  index: number
): Heading | null {
  if (index === 0 || lines[index].length > 200) return null
  const text = camLabel(commentText(lines[index]) ?? undefined)
  if (
    !text ||
    text.length > 80 ||
    !/[a-z]/i.test(text) ||
    /^(?:T\d|@)/i.test(text) ||
    NOT_HEADINGS.test(text)
  )
    return null
  const previous = lines[index - 1]
  if (commentText(previous) !== null) return null
  let next = index + 1
  while (
    next < lines.length &&
    (!lines[next].trim() || describesTool(lines[next]))
  )
    next++
  if (next >= lines.length || commentText(lines[next]) !== null) return null
  const changesTool = blocks[next].words.some(
    (word) => word.letter === "M" && word.value === 6
  )
  return previous.trim() && !changesTool ? null : { name: text }
}

/**
 * Ordered sections of a program (or of one line range of it). The toolpath markers of the
 * machine's CAM have priority; named CAM comments, headings standing as Fusion 360's posts
 * write them, and actual M6 blocks provide fallback boundaries. The machine's probing names its
 * grids and touch-offs (`MachineProbing.sections`). Rapids stay with their path except
 * preparation moves immediately before a tool change. No section is inferred from individual
 * retracts, layers or feed changes.
 *
 * `keyTool` gives the number a tool change's key uses for a tool the program selects: a
 * compiled plate rewrites T words through its tool table, and keys follow the operation's own
 * numbers so renumbering the table does not change them. Names show the program's number.
 */
export function buildProgramSections(
  program: GCodeProgram,
  machine: SectionMachine,
  range: { startLine: number; endLine: number } = {
    startLine: 1,
    endLine: program.lines.length,
  },
  keyTool: (tool: number) => number = (tool) => tool
): ProgramSection[] {
  const { segments } = program
  const first = Math.max(1, range.startLine)
  const last = Math.min(program.lines.length, range.endLine)
  const lines = program.lines.slice(first - 1, last)
  if (!lines.some((line) => line.trim())) return []
  const absolute = (index: number) => first + index
  const probing = machine.probing?.sections
  const touchOff = (block: NcBlock, tool: number | null = null) =>
    probing?.touchOff(block, tool) ?? null
  const probesGrid = (block: NcBlock) => probing?.probesGrid(block) ?? false
  // Without its CAM's toolpath markers, headings in comments name the toolpaths.
  const toolpaths = machine.camMarkers?.toolpaths(lines) ?? null
  const blocks = lines.map(readNcBlock)
  const lowerSegment = (line: number) => {
    let low = 0
    let high = segments.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (segments[middle].line < line) low = middle + 1
      else high = middle
    }
    return low
  }
  const rangeSegmentStart = lowerSegment(first)
  const rangeSegmentEnd = lowerSegment(last + 1)
  const metadataOnly =
    rangeSegmentEnd === rangeSegmentStart &&
    !blocks.some(
      (block) =>
        validBlock(block) &&
        block.words.some(
          (word) =>
            (word.letter === "G" && [0, 1, 2, 3].includes(word.value)) ||
            (word.letter === "M" && word.value === 6)
        )
    ) &&
    !blocks.some(
      (block) =>
        validBlock(block) && (touchOff(block) !== null || probesGrid(block))
    )
  const sections: ProgramSection[] = []
  const keyCounts = new Map<string, number>()
  let selectedTool: number | null = null
  let activeTool: number | null = null
  let heading: Heading | null = null
  let startLine = first
  let pathCount = 0
  let ended = false
  /** The touch-off being read: from its first touch to the last block that continues it. */
  let touching: { start: number; end: number; name: string } | null = null
  const push = (
    kind: SectionKind,
    name: string,
    from: number,
    to: number,
    tool: number | null,
    segmentStart = lowerSegment(from),
    segmentEnd = lowerSegment(to + 1),
    keyName = name
  ) => {
    if (from > to) return
    const key = `${kind}:${keyName}`
    const keyCount = (keyCounts.get(key) ?? 0) + 1
    keyCounts.set(key, keyCount)
    sections.push({
      key: `${key}#${keyCount}`,
      kind,
      name,
      tool,
      startLine: from,
      endLine: to,
      segmentStart,
      segmentEnd,
    })
  }
  const flush = (
    endLine: number,
    beforeToolChange = false,
    force?: "end" | "metadata"
  ) => {
    if (endLine < startLine) return
    const span = lines.slice(startLine - first, endLine - first + 1)
    if (!span.some((line) => line.trim())) {
      startLine = endLine + 1
      return
    }
    const segmentStart = lowerSegment(startLine)
    const segmentEnd = lowerSegment(endLine + 1)
    const hasSegments = segmentEnd > segmentStart
    const hasCut = segments
      .slice(segmentStart, segmentEnd)
      .some((segment) => !segment.rapid)
    const spanBlocks = blocks.slice(startLine - first, endLine - first + 1)
    const hasCode = spanBlocks.some((block) => block.code)
    // A retract to the machine's clearance moves nothing that makes a section.
    const omittedMotion = spanBlocks.some(
      (block) =>
        validBlock(block) &&
        !machineRetract(block) &&
        block.words.some(
          (word) => word.letter === "G" && [0, 1, 2, 3].includes(word.value)
        ) &&
        block.words.some((word) => AXIS_LETTERS.includes(word.letter))
    )
    let kind: SectionKind = "metadata"
    if (force) kind = force
    else if (metadataOnly) kind = "metadata"
    else if ((hasSegments || omittedMotion) && !(beforeToolChange && !hasCut))
      // Feed moves with a probe (T0, or the 3D probe's slot) trace; they never cut.
      kind = isProbeSlot(activeTool) && hasCut ? "scan" : "toolpath"
    else if (hasCode || heading) kind = "setup"
    let name: string
    if (kind === "toolpath") name = heading?.name ?? `Toolpath ${++pathCount}`
    else if (kind === "scan") name = "Probe scan"
    else if (kind === "end") name = "Program end"
    else if (kind === "metadata") name = "Program notes"
    else if (heading) name = `Prepare ${heading.name}`
    else name = "Program setup"
    push(
      kind,
      name,
      startLine,
      endLine,
      kind === "metadata" ? null : activeTool,
      segmentStart,
      segmentEnd
    )
    startLine = endLine + 1
  }
  const closeTouchOff = () => {
    if (!touching) return
    const { start, end, name } = touching
    touching = null
    push("touch-off", name, start, end, activeTool)
    startLine = end + 1
  }
  for (const [index, text] of lines.entries()) {
    const line = absolute(index)
    const block = blocks[index]
    if (ended) continue
    let named: Heading | null = null
    if (toolpaths) {
      const name = toolpaths.get(index)
      if (name !== undefined) named = { name }
    } else named = commentHeading(text) ?? standingHeading(lines, blocks, index)
    if (named) {
      closeTouchOff()
      flush(line - 1)
      heading = named
      startLine = line
    }
    if (!validBlock(block)) continue
    if (touching) {
      // Comments neither extend a touch-off nor end it.
      if (!block.words.length) continue
      if (probing?.continuesTouchOff(block)) {
        touching.end = line
        continue
      }
      closeTouchOff()
    }
    const touchName = touchOff(block, activeTool)
    if (touchName !== null) {
      // A wait for the moves before it (M400), with nothing but comments since the last
      // section, is the touch's own start.
      const before = blocks.slice(startLine - first, line - first)
      const waits =
        before.some(isWait) &&
        before.every((item) => !item.words.length || isWait(item))
      if (!waits) flush(line - 1)
      touching = { start: waits ? startLine : line, end: line, name: touchName }
      continue
    }
    if (block.message !== null) {
      flush(line - 1)
      const message = block.message.trim()
      const name =
        message.length > 160
          ? `${message.slice(0, 157)}…`
          : message || "Message"
      const segmentStart = lowerSegment(line)
      push("message", name, line, line, activeTool, segmentStart, segmentStart)
      startLine = line + 1
      continue
    }
    const selection = block.words
      .filter((word) => word.letter === "T")
      .at(-1)?.value
    if (selection !== undefined) selectedTool = selection
    const changes = block.words.filter(
      (word) => word.letter === "M" && word.value === 6
    )
    if (changes.length) {
      flush(line - 1, true)
      activeTool = selectedTool
      const segmentStart = lowerSegment(line)
      const ownTool = activeTool === null ? null : keyTool(activeTool)
      for (const _change of changes)
        push(
          "tool-change",
          toolChangeName(activeTool),
          line,
          line,
          activeTool,
          segmentStart,
          segmentStart,
          toolChangeName(ownTool)
        )
      // A compound M6 + motion block belongs to both the event and the path.
      startLine = lowerSegment(line + 1) > segmentStart ? line : line + 1
    }
    if (probesGrid(block)) {
      flush(line - 1)
      const segmentStart = lowerSegment(line)
      push(
        "probe",
        "Height map probing",
        line,
        line,
        activeTool,
        segmentStart,
        segmentStart
      )
      startLine = line + 1
    }
    const pauses = block.words.filter(
      (word) => word.letter === "M" && (word.value === 0 || word.value === 1)
    )
    if (pauses.length) {
      const hasMotion = lowerSegment(line + 1) > lowerSegment(line)
      flush(hasMotion ? line : line - 1)
      const segmentStart = lowerSegment(line + 1)
      for (const pause of pauses)
        push(
          "pause",
          pause.value === 0 ? "Pause (M0)" : "Optional pause (M1)",
          line,
          line,
          activeTool,
          segmentStart,
          segmentStart
        )
      startLine = line + 1
    }
    if (
      block.words.some(
        (word) => word.letter === "M" && (word.value === 2 || word.value === 30)
      )
    ) {
      const hasMotion = lowerSegment(line + 1) > lowerSegment(line)
      flush(hasMotion ? line : line - 1)
      const segmentStart = lowerSegment(line + 1)
      push(
        "end",
        "Program end",
        line,
        line,
        activeTool,
        segmentStart,
        segmentStart
      )
      startLine = line + 1
      ended = true
    }
  }
  closeTouchOff()
  flush(last, false, ended ? "metadata" : undefined)
  return sections
}
