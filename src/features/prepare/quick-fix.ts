import { toast } from "sonner"
import { useFixtureLibraryStore } from "@/app/fixtures/fixture-context"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import { operationStart } from "@/domain/design-rules/check"
import { resolvedFileSource } from "@/domain/design-rules/program-rules"
import type { QuickFix } from "@/domain/diagnostics"
import { kitForPlate } from "@/domain/fixtures/catalog"
import type { Plate } from "@/domain/plate/plate"
import { machineId } from "@/machine/contract"
import { useTemplateUpdate } from "@/features/plugins/use-template-update"
import { openDialog } from "@/features/shell/dialogs"
import { useMachineSnapshot, useReadAnchors } from "@/platform/machine"
import { useInstalledPlugins } from "@/platform/plugins"
import { usePrepareSelection } from "./plate-tree/use-prepare-selection"

export const QUICK_FIX_LABELS: Record<QuickFix["kind"], string> = {
  "assign-tool": "Assign tool",
  "update-operation": "Update",
  "install-plugin": "Manage plugins",
  "read-anchors": "Read anchors",
  "edit-operation": "Edit",
  "resolve-rule": "Apply",
}

/** Regenerates a template operation from its saved values with the installed plugin version. */
function useUpdateOperation() {
  const workspace = useWorkspaceStore()
  const plugins = useInstalledPlugins().data ?? []
  const update = useTemplateUpdate()
  return (plateId: string, operationId: string) => {
    const operation = workspace.state.plates
      .find((plate) => plate.id === plateId)
      ?.operations.find((item) => item.id === operationId)
    if (operation?.source.kind !== "template") return
    const source = operation.source
    const plugin = plugins.find((item) => item.id === source.pluginId)
    if (plugin?.incompatible) {
      toast.error(`${plugin.manifest.name} cannot run.`, {
        description: plugin.incompatible,
      })
      return
    }
    if (!plugin?.enabled) {
      toast.error(`Enable ${source.pluginId} to update "${operation.name}".`)
      return
    }
    update.mutate({
      plateId,
      operation: { ...operation, source },
      plugin,
      values: source.values,
    })
  }
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
            // Recorded as the device sync records it, with its bed alignment, for the plate.
            fixtures.recordDeviceAnchors(device, configuration)
            const deviceId = machineId(device)
            const { profiles } = fixtures.state
            const anchors = Object.hasOwn(profiles, deviceId)
              ? profiles[deviceId].anchors
              : undefined
            if (
              anchors?.source === "firmware-config" &&
              anchors.fetchedAt === configuration.fetchedAt
            )
              workspace.dispatch({
                type: "plate.useDevice",
                plateId,
                deviceId,
                anchors,
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
  const update = useUpdateOperation()
  const resolveRule = useResolveRule()
  return (plate: Plate, fix: QuickFix) => {
    switch (fix.kind) {
      case "assign-tool":
        openDialog({
          kind: "tools",
          assign: { plateId: plate.id, number: fix.toolNumber },
        })
        return
      case "update-operation":
        update(plate.id, fix.operationId)
        return
      case "install-plugin":
        openDialog({ kind: "plugins" })
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
