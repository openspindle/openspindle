import { formatMillimetres } from "../../../geometry/millimetres"
import type { AnchorStart } from "../../../probing/placement"

/**
 * Machine Z the Z1 moves in (G53): the firmware stops a move above Z -1, its soft limit, and
 * below `soft_endstop.z_min`, -102 in Makera's Z1 and Z1 Pro configurations.
 */
export { MACHINE_Z } from "../work-envelope"

/**
 * Where probing rises to before it moves in X and Y, as Makera Studio's probing does: the
 * clearance Makera configures (`coordinate.clearance_z`), 2 mm under the soft limit so height
 * compensation cannot lift a G53 move past it.
 */
export const CLEARANCE_Z = -3

/**
 * Ordinary queued moves to an anchored start, a touch point's or a 3D probing routine's: up to
 * the clearance, then over it.
 */
export function anchorTravel({
  anchor,
  source,
  machine,
}: AnchorStart): string[] {
  const provenance =
    source === "factory"
      ? "FACTORY DEFAULT coordinates - verify against the device before Run"
      : "firmware configuration snapshot"
  return [
    `; Probe placement: stored anchor ${JSON.stringify(anchor.id)}; ${provenance}.`,
    "; Rises to the machine's clearance before moving in X and Y; verify homing.",
    `G53 G0 Z${formatMillimetres(CLEARANCE_Z)}`,
    `G53 G0 X${formatMillimetres(machine[0])} Y${formatMillimetres(machine[1])}`,
  ]
}
