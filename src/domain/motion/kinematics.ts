/*
 * A move as Smoothieware's blocks run one (Block.cpp): from its entry speed up to its cruise
 * speed at a constant acceleration, on at that speed, then down to its exit speed. Lengths in
 * millimetres, speeds in mm/s, times in seconds.
 *
 * Nothing imported, so the Z1 simulator can use it as it is.
 */

/**
 * A move's speeds and acceleration. cruise = the peak speed actually reached (≤ nominal); exit =
 * cruise for an instant stop.
 */
export type Trapezoid = {
  readonly length: number
  readonly entry: number
  readonly cruise: number
  readonly exit: number
  readonly accel: number
}

/** How long a move speeds up, cruises and slows down, and how far it goes speeding up and cruising. */
function phases({ length, entry, cruise, exit, accel }: Trapezoid) {
  const speedingUp = cruise > entry && accel > 0 ? (cruise - entry) / accel : 0
  const slowingDown = cruise > exit && accel > 0 ? (cruise - exit) / accel : 0
  const speedUp = ((entry + cruise) / 2) * speedingUp
  const slowDown = ((cruise + exit) / 2) * slowingDown
  const cruised = Math.max(0, length - speedUp - slowDown)
  return {
    speedingUp,
    cruising: cruise > 0 ? cruised / cruise : 0,
    slowingDown,
    speedUp,
    cruised,
  }
}

/** How long a move takes. */
export function trapezoidDuration(move: Trapezoid): number {
  const { speedingUp, cruising, slowingDown } = phases(move)
  return speedingUp + cruising + slowingDown
}

/** How far along a move it is `seconds` after it starts, clamped to [0, length]. */
export function distanceAt(move: Trapezoid, seconds: number): number {
  const { length, entry, cruise, accel } = move
  if (seconds <= 0) return 0
  const { speedingUp, cruising, slowingDown, speedUp, cruised } = phases(move)
  if (seconds < speedingUp)
    return Math.min(length, entry * seconds + (accel * seconds ** 2) / 2)
  const cruisingFor = seconds - speedingUp
  if (cruisingFor < cruising)
    return Math.min(length, speedUp + cruise * cruisingFor)
  const slowing = Math.min(cruisingFor - cruising, slowingDown)
  return Math.min(
    length,
    speedUp + cruised + cruise * slowing - (accel * slowing ** 2) / 2
  )
}

/** How fast a move goes `seconds` after it starts: its entry speed before, its exit speed after. */
export function speedAt(move: Trapezoid, seconds: number): number {
  const { entry, cruise, exit, accel } = move
  if (seconds <= 0) return entry
  const { speedingUp, cruising, slowingDown } = phases(move)
  if (seconds < speedingUp) return entry + accel * seconds
  const cruisingFor = seconds - speedingUp
  if (cruisingFor < cruising) return cruise
  const slowing = cruisingFor - cruising
  return slowing < slowingDown ? cruise - accel * slowing : exit
}

/** How long after a move starts it is `distance` along it, clamped to its length: inverse of `distanceAt`. */
export function secondsAt(move: Trapezoid, distance: number): number {
  const { length, entry, cruise, accel } = move
  const along = Math.min(distance, length)
  if (along <= 0 || cruise <= 0) return 0
  const { speedingUp, cruising, slowingDown, speedUp, cruised } = phases(move)
  // The roots of the motion's quadratics, in forms that stay exact as the acceleration nears 0.
  if (along < speedUp)
    return (2 * along) / (entry + Math.sqrt(entry ** 2 + 2 * accel * along))
  if (along < speedUp + cruised) return speedingUp + (along - speedUp) / cruise
  const slowing = along - speedUp - cruised
  const root = Math.sqrt(Math.max(0, cruise ** 2 - 2 * accel * slowing))
  return (
    speedingUp +
    cruising +
    Math.min(slowingDown, (2 * slowing) / (cruise + root))
  )
}
