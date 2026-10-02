/*
 * The index and time spaces a motion plan is read in, branded so that the compiler tells them
 * apart: a line, a move and a time are each a number, of different things.
 */

export type Brand<T, TBrand extends string> = T & {
  readonly __brand: TBrand
}
/** Compiled program line (= prepared, 1:1), 1-based; 0 = none. */
export type SourceLine = Brand<number, "SourceLine">
/** plan.program.segments[i]; never a CompiledPlate.program index. */
export type MoveIndex = Brand<number, "MoveIndex">
/** Plan clock: from the first move, 100 % override, timed dwells included, user waits excluded. */
export type PlanSeconds = Brand<number, "PlanSeconds">
export const sourceLine = (value: number) => value as SourceLine
export const moveIndex = (value: number) => value as MoveIndex
export const planSeconds = (value: number) => value as PlanSeconds
export type Vec3 = [number, number, number]
/** Moves [first, end). */
export type MoveRange = { readonly first: MoveIndex; readonly end: MoveIndex }
/** A point along a move, as a fraction of its length. */
export type MovePoint = { readonly move: MoveIndex; readonly fraction: number }
