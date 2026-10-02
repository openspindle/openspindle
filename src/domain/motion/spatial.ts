/*
 * Moves near a point in XY: a uniform grid of square cells over a plan's moves, each cell listing
 * the moves that pass through it, and the moves too long to list that way, which every query goes
 * through. Built once, then only read.
 */

/** How wide a cell is, in mm, where the moves' extent allows. */
const CELL_SIZE = 5

/** The most cells a grid has along each axis: wider extents get wider cells. */
const MOST_CELLS_ACROSS = 1024

/** The most cells a move is listed in; a move that would pass through more is oversize. */
const MOST_CELLS_PER_MOVE = 64

/** How far (mm) a move is taken to reach beyond its ends, so that rounding cannot miss a cell. */
const MARGIN = 1e-4

/**
 * A plan's moves by the cells of a grid they pass through in XY. The cells are in rows, from the
 * grid's corner; `starts` holds where each cell's moves begin in `moves` (compressed rows), with
 * one more entry for the end. Each cell's moves, and the oversize moves, are in move order.
 */
export type MoveGrid = {
  readonly x: number
  readonly y: number
  readonly cell: number
  readonly columns: number
  readonly rows: number
  readonly starts: Uint32Array
  readonly moves: Uint32Array
  readonly oversize: Uint32Array
}

/** The first index in [low, high) of `moves` whose move is at or after `move`. */
function firstFrom(
  moves: Uint32Array,
  low: number,
  high: number,
  move: number
) {
  while (low < high) {
    const middle = (low + high) >>> 1
    if (moves[middle] < move) low = middle + 1
    else high = middle
  }
  return low
}

/** The grid's column or row of a coordinate along it, clamped to the grid. */
const indexAlong = (
  value: number,
  start: number,
  cell: number,
  count: number
) => Math.max(0, Math.min(count - 1, Math.floor((value - start) / cell)))

/**
 * Calls `visit` with each cell a move from (x0, y0) to (x1, y1) passes through, row by row
 * within each column it crosses; returns how many there are. Without `visit`, it only counts
 * them.
 */
function cellsOf(
  grid: Omit<MoveGrid, "starts" | "moves" | "oversize">,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit?: (cell: number) => void
) {
  const { x, y, cell, columns, rows } = grid
  const left = Math.min(x0, x1) - MARGIN
  const right = Math.max(x0, x1) + MARGIN
  const first = indexAlong(left, x, cell, columns)
  const last = indexAlong(right, x, cell, columns)
  const dx = x1 - x0
  let count = 0
  for (let column = first; column <= last; column++) {
    // The part of the move within the column, and how far it spans in Y there.
    let bottom = Math.min(y0, y1)
    let top = Math.max(y0, y1)
    if (first !== last && Math.abs(dx) > 0) {
      const from = Math.max(left, x + column * cell)
      const to = Math.min(right, x + (column + 1) * cell)
      const a = y0 + ((from - x0) / dx) * (y1 - y0)
      const b = y0 + ((to - x0) / dx) * (y1 - y0)
      bottom = Math.max(bottom, Math.min(a, b))
      top = Math.min(top, Math.max(a, b))
    }
    const low = indexAlong(bottom - MARGIN, y, cell, rows)
    const high = indexAlong(top + MARGIN, y, cell, rows)
    count += high - low + 1
    if (visit)
      for (let row = low; row <= high; row++) visit(row * columns + column)
  }
  return count
}

/** The grid of a plan's moves (`MoveGrid`), from where each starts and ends (count×3 each). */
export function gridOfMoves(
  from: Float32Array,
  to: Float32Array,
  count: number
): MoveGrid {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let index = 0; index < count * 3; index += 3) {
    minX = Math.min(minX, from[index], to[index])
    maxX = Math.max(maxX, from[index], to[index])
    minY = Math.min(minY, from[index + 1], to[index + 1])
    maxY = Math.max(maxY, from[index + 1], to[index + 1])
  }
  if (!count) minX = minY = maxX = maxY = 0
  const cell = Math.max(
    CELL_SIZE,
    (maxX - minX) / MOST_CELLS_ACROSS,
    (maxY - minY) / MOST_CELLS_ACROSS
  )
  const frame = {
    x: minX - MARGIN,
    y: minY - MARGIN,
    cell,
    columns: Math.floor((maxX - minX + 2 * MARGIN) / cell) + 1,
    rows: Math.floor((maxY - minY + 2 * MARGIN) / cell) + 1,
  }
  const cells = frame.columns * frame.rows
  // Counted first, then listed: each cell's moves where its count puts them.
  const starts = new Uint32Array(cells + 1)
  const listed = new Uint8Array(count)
  let oversize = 0
  for (let move = 0; move < count; move++) {
    const at = move * 3
    const span = cellsOf(frame, from[at], from[at + 1], to[at], to[at + 1])
    if (span > MOST_CELLS_PER_MOVE) {
      oversize++
      continue
    }
    listed[move] = 1
    cellsOf(frame, from[at], from[at + 1], to[at], to[at + 1], (passed) => {
      starts[passed + 1]++
    })
  }
  for (let index = 0; index < cells; index++) starts[index + 1] += starts[index]
  const moves = new Uint32Array(starts[cells])
  const filled = starts.slice(0, cells)
  const long = new Uint32Array(oversize)
  oversize = 0
  for (let move = 0; move < count; move++) {
    const at = move * 3
    if (!listed[move]) {
      long[oversize++] = move
      continue
    }
    cellsOf(frame, from[at], from[at + 1], to[at], to[at + 1], (passed) => {
      moves[filled[passed]++] = move
    })
  }
  return { ...frame, starts, moves, oversize: long }
}

/**
 * Calls `visit` with each move of [first, end) that may pass within `radius` of (x, y) in XY:
 * those listed in a cell the circle reaches, as often as they are listed there, and the oversize
 * ones. Whether one does is the caller's to measure.
 */
export function visitNear(
  grid: MoveGrid,
  x: number,
  y: number,
  radius: number,
  first: number,
  end: number,
  visit: (move: number) => void
) {
  const { cell, columns, rows, starts, moves, oversize } = grid
  const left = indexAlong(x - radius, grid.x, cell, columns)
  const right = indexAlong(x + radius, grid.x, cell, columns)
  const bottom = indexAlong(y - radius, grid.y, cell, rows)
  const top = indexAlong(y + radius, grid.y, cell, rows)
  // Beyond the grid, only oversize moves can pass near.
  const outside =
    x + radius < grid.x ||
    y + radius < grid.y ||
    x - radius > grid.x + columns * cell ||
    y - radius > grid.y + rows * cell
  if (!outside)
    for (let row = bottom; row <= top; row++)
      for (let column = left; column <= right; column++) {
        const at = row * columns + column
        const last = starts[at + 1]
        for (
          let index = firstFrom(moves, starts[at], last, first);
          index < last && moves[index] < end;
          index++
        )
          visit(moves[index])
      }
  for (
    let index = firstFrom(oversize, 0, oversize.length, first);
    index < oversize.length && oversize[index] < end;
    index++
  )
    visit(oversize[index])
}
