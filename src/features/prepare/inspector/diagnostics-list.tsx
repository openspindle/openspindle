import { CircleAlert, TriangleAlert, Waypoints } from "lucide-react"
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Toggle } from "@/components/ui/toggle"
import type { KeyedDiagnostic } from "@/domain/diagnostics"
import type { Plate } from "@/domain/plate/plate"
import { MachineActionButton } from "@/features/job/stage-card"
import {
  focusProblem,
  isFocused,
  useProblemFocus,
} from "@/features/viewer/problem-focus"
import { QUICK_FIX_LABELS, useQuickFix, useReadAnchorsFix } from "../quick-fix"

/**
 * Problems and advice for a plate or operation, each with the fix it offers, and Show for those
 * with a place on the bed, which marks them out in the 3D view.
 */
export function DiagnosticsList({
  plate,
  diagnostics,
}: {
  plate: Plate
  diagnostics: readonly KeyedDiagnostic[]
}) {
  const quickFix = useQuickFix()
  const readAnchors = useReadAnchorsFix()
  const focus = useProblemFocus()
  if (!diagnostics.length) return null
  return (
    <div className="flex flex-col gap-2" aria-label="Problems">
      {diagnostics.map(({ key, diagnostic }) => {
        const error = diagnostic.severity === "error"
        const Icon = error ? CircleAlert : TriangleAlert
        const { fix } = diagnostic
        const placed = !!diagnostic.places?.length
        return (
          <Alert key={key} variant={error ? "warning" : "default"}>
            <Icon />
            <AlertDescription>{diagnostic.message}</AlertDescription>
            {(fix || placed) && (
              <AlertAction className="flex items-center gap-1">
                {placed && (
                  <Toggle
                    size="sm"
                    aria-label="Show in the 3D view"
                    pressed={isFocused(focus, plate.id, key)}
                    onPressedChange={(pressed) =>
                      focusProblem(pressed ? { plateId: plate.id, key } : null)
                    }
                  >
                    Show
                  </Toggle>
                )}
                {fix?.kind === "read-anchors" && (
                  <MachineActionButton
                    action={readAnchors}
                    label={QUICK_FIX_LABELS[fix.kind]}
                    pendingLabel="Reading anchors…"
                    variant={error ? "warning" : "outline"}
                    size="xs"
                    icon={<Waypoints data-icon="inline-start" />}
                  />
                )}
                {fix && fix.kind !== "read-anchors" && (
                  <Button
                    variant={error ? "warning" : "outline"}
                    size="xs"
                    onClick={() => quickFix(plate, fix)}
                  >
                    {QUICK_FIX_LABELS[fix.kind]}
                  </Button>
                )}
              </AlertAction>
            )}
          </Alert>
        )
      })}
    </div>
  )
}
