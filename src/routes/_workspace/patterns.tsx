import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { PatternPage } from "@/features/patterns/pattern-page"

const Search = z.object({
  operation: z.string().min(1).max(200).optional().catch(undefined),
})
export const Route = createFileRoute("/_workspace/patterns")({
  validateSearch: Search,
  component: PatternsRoute,
})
function PatternsRoute() {
  const { operation } = Route.useSearch()
  return <PatternPage operationId={operation ?? null} />
}
