import type { AutoScanParams, AutoScanSpecs } from "../../auto-scan/params"
import type { ProbingStrategy } from "../strategy"

const pending = (): never => {
  throw new Error("Outline trace is not written yet.")
}

/**
 * OpenSpindle's own trace of the plate's toolpath bounds with the probe's pointer, at a machine Z
 * clear of the stock. Placeholder until it is written.
 */
export const OUTLINE_TRACE: ProbingStrategy<
  "outline",
  AutoScanParams,
  AutoScanSpecs
> = {
  id: "outline-trace",
  task: "outline",
  label: "Outline trace",
  description: "Trace the edges of the plate's work area before cutting.",
  accepts: pending,
  parameters: pending,
  defaults: pending,
  generate: pending,
}
