import type { SwitchReport, Telemetry } from "@/machine/contract"
import type { FixtureKit } from "../fixtures/fixture-kit"

/**
 * What is known about the connected machine, as diagnosis tests it: its status, the kit it is,
 * and what inspections read of it since it connected.
 */
export type MachineEvidence = {
  /** Its status while fresh; null without. */
  readonly telemetry: Telemetry | null
  /** Why nothing but Stop goes, after a Stop it did not confirm; null otherwise. */
  readonly lockout: string | null
  /** The kit it is; null for a device no kit is for. */
  readonly kit: FixtureKit | null
  /** Its switches as the last inspection on this connection read them; null before one. */
  readonly switches: SwitchReport | null
}
