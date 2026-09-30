/*
 * How machine Z places a tool's tip on the bed: each tool meets the tool setter at a machine Z
 * of its own, and the setter's top is at one bed Z. Nominal values from a Z1 Pro's Makera Studio
 * log (2026-09-22): the wired probe met the setter at machine Z -76.54, and 5.23 mm lower the
 * stock at anchor 1, taken for a 1.6 mm PCB on the MDF bed (bed Z 7.6). Every tool is taken to
 * meet the setter where the probe did.
 *
 * Nothing imported, so the Z1 simulator can use it as it is.
 */

/** The bed Z of the tool setter's top. */
export const SETTER_TOP = 12.83
/** The machine Z at which a tool meets the tool setter. */
export const SETTER_Z = -76.54
/** A tool on the setter touches it within this distance of its centre. */
export const SETTER_RADIUS = 5

/** The bed Z of a tool's tip at machine Z `machineZ`. */
export const tipBedZ = (machineZ: number) => machineZ - SETTER_Z + SETTER_TOP

/** The machine Z at which a tool's tip is at bed Z `z`. */
export const tipMachineZ = (z: number) => z - SETTER_TOP + SETTER_Z
