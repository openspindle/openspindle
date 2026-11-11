import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  PROBE_SAFETY_GUIDELINES,
  AUTOMATIC_PROBE_SAFETY_GUIDELINES,
  UNBOUNDED_PROBE_REASON,
} from "@/machine/contract"

/** The same contact safety instructions accompany every probing entry point. */
export function ProbeSafetyNotice({
  native = false,
  automatic = false,
}: {
  native?: boolean
  automatic?: boolean
}) {
  let message = PROBE_SAFETY_GUIDELINES
  if (automatic) message = AUTOMATIC_PROBE_SAFETY_GUIDELINES
  if (native) message = UNBOUNDED_PROBE_REASON
  return (
    <Alert variant={native ? "warning" : "default"}>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
