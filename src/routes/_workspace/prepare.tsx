import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { PreparePage } from "@/features/prepare/prepare-page"

/** Inspector panels of the Prepare section. */
export const PREPARE_PANELS = ["setup", "stock", "tools", "fixtures"] as const

/** UI selection only; the selected plate lives in the workspace (it is shared and persisted). */
const PrepareSearchSchema = z.object({
  /** The operation shown in the inspector; the plate inspector when absent. */
  operation: z.string().min(1).max(200).optional().catch(undefined),
  panel: z.enum(PREPARE_PANELS).optional().catch(undefined),
})
export type PrepareSearch = z.infer<typeof PrepareSearchSchema>

export const Route = createFileRoute("/_workspace/prepare")({
  validateSearch: PrepareSearchSchema,
  component: PreparePage,
})
