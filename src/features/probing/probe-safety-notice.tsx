import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  PROBE_SAFETY_GUIDELINES,
  AUTOMATIC_PROBE_SAFETY_GUIDELINES,
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
  if (native)
    message =
      "Review the generated native probing cycle in Job before Run. Stop the spindle, fit the correct probe and verify its input, travel and workholding. Native firmware searches do not provide the bounded guides’ per-contact checks."
  return (
    <Alert variant={native ? "warning" : "default"}>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
