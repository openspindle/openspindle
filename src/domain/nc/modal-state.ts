import type { NcBlock, NcWord } from "@/machine/contract"

/** M codes an S word may share a block with and still be the spindle speed. */
const SPEED_M_CODES: ReadonlySet<number> = new Set([3, 4, 5, 6, 7, 8, 9, 30])
const WORK_OFFSETS: readonly number[] = [
  54, 55, 56, 57, 58, 59, 59.1, 59.2, 59.3,
]
const AXES = ["X", "Y", "Z"] as const

/**
 * What a program has set and where its tool is before one of its lines: the modes a line
 * split off into an operation of its own must set again, and the position arcs start from.
 * Null for what the program has not set; a position axis is NaN until a move places it.
 */
export type ModalState = {
  units: 20 | 21 | null
  distance: 90 | 91 | null
  plane: 17 | 18 | 19 | null
  workOffset: number | null
  motion: 0 | 1 | 2 | 3 | null
  feed: number | null
  selectedTool: number | null
  activeTool: number | null
  spindleSpeed: number | null
  spindleOn: boolean
  /** Arc centres given as positions (G90.1) rather than offsets from the arc's start. */
  absoluteCentres: boolean
  /** In the program's units and work coordinates. */
  position: [number, number, number]
}

export const initialModalState = (): ModalState => ({
  units: null,
  distance: null,
  plane: null,
  workOffset: null,
  motion: null,
  feed: null,
  selectedTool: null,
  activeTool: null,
  spindleSpeed: null,
  spindleOn: false,
  absoluteCentres: false,
  position: [NaN, NaN, NaN],
})

const valueOf = (words: readonly NcWord[], letter: string) =>
  words.find((word) => word.letter === letter)?.value

/** The state after a block: its modes, tool, spindle and feed, and where its move ends. */
export function nextModalState(state: ModalState, block: NcBlock): ModalState {
  if (block.problem || !block.words.length || block.message !== null)
    return state
  const next: ModalState = { ...state, position: [...state.position] }
  const { words } = block
  const gCodes = words
    .filter((word) => word.letter === "G")
    .map((word) => word.value)
  const mCodes = words
    .filter((word) => word.letter === "M")
    .map((word) => word.value)
  for (const g of gCodes) {
    if (g === 0 || g === 1 || g === 2 || g === 3) next.motion = g
    else if (g === 17 || g === 18 || g === 19) next.plane = g
    else if (g === 20 && next.units !== 20) {
      next.position = next.position.map(
        (axis) => axis / 25.4
      ) as ModalState["position"]
      next.units = 20
    } else if (g === 21 && next.units === 20) {
      next.position = next.position.map(
        (axis) => axis * 25.4
      ) as ModalState["position"]
      next.units = 21
    } else if (g === 21) next.units = 21
    else if (g === 90 || g === 91) next.distance = g
    else if (g === 90.1) next.absoluteCentres = true
    else if (g === 91.1) next.absoluteCentres = false
    else if (WORK_OFFSETS.includes(g)) {
      next.workOffset = g
      // Another coordinate system places the tool elsewhere in it.
      if (g !== state.workOffset) next.position = [NaN, NaN, NaN]
    }
  }
  const tool = valueOf(words, "T")
  if (tool !== undefined) next.selectedTool = tool
  const feed = valueOf(words, "F")
  if (feed !== undefined) next.feed = feed
  // A dwell's S is how long it waits, as the firmware that reads S there takes it.
  const speed = valueOf(words, "S")
  if (
    speed !== undefined &&
    !gCodes.includes(4) &&
    mCodes.every((m) => SPEED_M_CODES.has(m))
  )
    next.spindleSpeed = speed
  for (const m of mCodes) {
    if (m === 3 || m === 4) next.spindleOn = true
    else if (m === 5 || m === 2 || m === 30) next.spindleOn = false
    else if (m === 6) next.activeTool = next.selectedTool
  }
  // Moves that leave the work coordinates, or reset them, leave the position unknown.
  const leaves = gCodes.some((g) =>
    [28, 30, 53, 92, 10].includes(Math.trunc(g))
  )
  const moves =
    !gCodes.some((g) => g === 4) &&
    AXES.some((axis) => valueOf(words, axis) !== undefined)
  AXES.forEach((axis, index) => {
    const value = valueOf(words, axis)
    if (value === undefined) return
    if (leaves) next.position[index] = NaN
    else if (moves)
      next.position[index] =
        next.distance === 91 ? next.position[index] + value : value
  })
  return next
}
