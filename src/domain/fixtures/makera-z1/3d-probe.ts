import type { ProbeTool } from "../../probing/probe"
import { PROBE_3D_TOOL } from "../../tools/tool-table"
import { M480_ROUTINES } from "./3d-probe/routines"

/**
 * The Makera 3D Probe on the Z1, which the firmware knows by its own tool number: it finds
 * corners and centres with the firmware's 3D probing routines.
 */
export const THREE_D_PROBE: ProbeTool = {
  slot: PROBE_3D_TOOL,
  name: "3D probe",
  capabilities: { origin: M480_ROUTINES },
}
