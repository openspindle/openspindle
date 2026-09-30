/** How far apart two lengths may be and still be the same, mm: a nanometre. */
export const EPSILON = 1e-6

/** Millimetres as NC words carry them: rounded to 6 decimals. */
export const roundMillimetres = (value: number) => Number(value.toFixed(6))

/** Plain decimal millimetres without exponent notation, for NC words and messages. */
export const formatMillimetres = (value: number) =>
  String(roundMillimetres(value))
