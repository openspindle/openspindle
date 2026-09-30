import type {
  AutoZHeightParams,
  AutoZHeightSpecs,
} from "../../auto-z-height/params"
import type { ProbingStrategy } from "../strategy"

const pending = (): never => {
  throw new Error("Surface touch is not written yet.")
}

/**
 * OpenSpindle's own touch-off: a fast G38.2 touch below the start, a back-off, a slow touch, then
 * work Z0 at the contact (G10 L20) and up to the clearance. Placeholder until it is written.
 */
export const SURFACE_TOUCH: ProbingStrategy<
  "touch-off",
  AutoZHeightParams,
  AutoZHeightSpecs
> = {
  id: "surface-touch",
  task: "touch-off",
  label: "Surface touch",
  description: "Touch the stock top with the probe and set work Z there.",
  accepts: pending,
  parameters: pending,
  defaults: pending,
  generate: pending,
}
