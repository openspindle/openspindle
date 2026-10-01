import { toast } from "sonner"
import { useFixtureLibraryStore } from "@/app/fixtures/fixture-context"
import { profileAnchors } from "@/app/fixtures/fixture-library-store"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import { operationStart } from "@/domain/design-rules/check"
import { resolvedFileSource } from "@/domain/design-rules/program-rules"
import type { QuickFix } from "@/domain/diagnostics"
import { kitForPlate } from "@/domain/fixtures/catalog"
import type { Plate } from "@/domain/plate/plate"
import { machineId } from "@/machine/contract"
import { openDialog } from "@/features/shell/dialogs"
import { useMachineSnapshot, useReadAnchors } from "@/platform/machine"
import { usePrepareSelection } from "./plate-tree/use-prepare-selection"

export const QUICK_FIX_LABELS: Record<QuickFix["kind"], string> = {
  "assign-tool": "Assign tool",
  "read-anchors": "Read anchors",
  "edit-operation": "Edit",
  "resolve-rule": "Apply",
}

/**
 * The read-anchors fix of a plate as a machine action, gated by availability like the Device
 * tab's Read anchors button, so a double click cannot send two reads. The plate then uses the
 * connected device and its anchors, also when it was set up for another one.
 */
export function useReadAnchorsFix(plateId: string | null) {
  const { availability, connection } = useMachineSnapshot()
  const readAnchors = useReadAnchors()
  const fixtures = useFixtureLibraryStore()
  const workspace = useWorkspaceStore()
  const { device } = connection
  const entry = availability.readAnchors
  return {
    reason: entry.allowed ? null : (entry.reason ?? "Unavailable."),
    pending: readAnchors.isPending,
    run: () =>
      readAnchors.mutate(undefined, {
        onSuccess: (configuration) => {
          if (device && plateId) {
            // Recorded as the device sync records it, with its bed offset, for the plate.
            fixtures.recordDeviceAnchors(device, configuration)
            const deviceId = machineId(device)
            const { profiles } = fixtures.state
            const profile = Object.hasOwn(profiles, deviceId)
              ? profileAnchors(deviceId, profiles[deviceId])
              : null
            if (
              profile?.anchors.source === "firmware-config" &&
              profile.anchors.fetchedAt === configuration.fetchedAt
            )
              workspace.dispatch({
                type: "plate.useDevice",
                plateId,
                deviceId,
                anchors: profile.anchors,
                bedSetups: profile.bedSetups,
              })
          }
          toast.success("Stored anchors updated.")
        },
        onError: (error) => toast.error(error.message),
      }),
  }
}

/** Changes an NC file operation's NC as a program rule of its plate's machine suggests. */
function useResolveRule() {
  const workspace = useWorkspaceStore()
  return (
    plateId: string,
    fix: Extract<QuickFix, { kind: "resolve-rule" }>
  ) => {
    // The operation as it is now, which the fix may have been found in before.
    const plate = workspace.state.plates.find((item) => item.id === plateId)
    const operation = plate?.operations.find(
      (item) => item.id === fix.operationId
    )
    if (!plate || !operation) return
    const kit = kitForPlate(plate)
    const source = resolvedFileSource(
      operation,
      kit,
      fix.rule,
      fix.resolution,
      operationStart(plate, operation.id, kit)
    )
    if (!source) return
    const result = workspace.dispatch({
      type: "operation.source",
      plateId,
      operationId: operation.id,
      source,
      expectedRevision: operation.revision,
    })
    if (!result.ok) toast.error(result.error)
  }
}

/** Carries out the fix a diagnostic offers, other than reading anchors (`useReadAnchorsFix`). */
export function useQuickFix() {
  const selection = usePrepareSelection()
  const resolveRule = useResolveRule()
  return (plate: Plate, fix: QuickFix) => {
    switch (fix.kind) {
      case "assign-tool":
        openDialog({
          kind: "tools",
          assign: { plateId: plate.id, number: fix.toolNumber },
        })
        return
      case "read-anchors":
        // DiagnosticsList renders this fix through useReadAnchorsFix instead.
        return
      case "edit-operation":
        selection.selectOperation(plate.id, fix.operationId)
        return
      case "resolve-rule":
        resolveRule(plate.id, fix)
    }
  }
}
