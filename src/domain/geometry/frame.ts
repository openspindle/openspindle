/**
 * Positions and the coordinate systems they are in. The machine's own coordinates (G53), the
 * bed's (from the work area's front-left corner, on the bed's top), a plate's work coordinates
 * (from its work origin), and coordinates relative to where the probe starts, which only the
 * operator knows.
 */
export type Frame = "machine" | "bed" | "work" | "probe"

declare const frame: unique symbol

/**
 * Marks a value as being in one frame. The mark is optional, so a plain tuple, such as a literal
 * or a parsed document's, takes the frame of wherever it enters; a value marked with one frame
 * never passes for another.
 */
export type InFrame<TFrame extends Frame> = { readonly [frame]?: TFrame }

/** X and Y in millimetres, in frame `TFrame`. */
export type XY<TFrame extends Frame = Frame> = readonly [x: number, y: number] &
  InFrame<TFrame>

/** X, Y and Z in millimetres, in frame `TFrame`. */
export type XYZ<TFrame extends Frame = Frame> = readonly [
  x: number,
  y: number,
  z: number,
] &
  InFrame<TFrame>

/**
 * X and Y without a frame: a displacement or an extent (a grid's size, an anchor offset), or,
 * of whole numbers, a count per axis (a grid's points).
 */
export type Vec2 = readonly [x: number, y: number]

/** Takes positions from one frame to another. */
export type Transform<TFrom extends Frame, TTo extends Frame> = (
  point: XY<TFrom>
) => XY<TTo>

/** A point moved by a displacement, in the same frame. */
export const plus = <TFrame extends Frame>(
  point: XY<TFrame>,
  delta: Vec2
): XY<TFrame> => [point[0] + delta[0], point[1] + delta[1]]

/** The frames whose origins are `offset` apart: a position in `TFrom` plus it is in `TTo`. */
export const translation =
  <TFrom extends Frame, TTo extends Frame>(
    offset: Vec2
  ): Transform<TFrom, TTo> =>
  ([x, y]) => [x + offset[0], y + offset[1]]
