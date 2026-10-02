import type { MachineCommand } from "@/machine/contract"

/** What diagnosis reads of the machine for more evidence. */
export type Inspection = "switches"

/**
 * A way to resolve a finding, which a view carries out: a machine command, Reset, Stop, or an
 * inspection that reads more of the machine, after which the findings are tested again.
 */
export type Resolution =
  | {
      readonly kind: "command"
      readonly label: string
      readonly command: MachineCommand
      /** What to do once it went, which the view says then. */
      readonly afterwards?: string
    }
  | { readonly kind: "reset"; readonly label: string }
  | { readonly kind: "stop"; readonly label: string }
  | {
      readonly kind: "inspect"
      readonly label: string
      readonly inspection: Inspection
    }
