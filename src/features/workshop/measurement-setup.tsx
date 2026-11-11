import { useState } from "react"
import { useSelector } from "@tanstack/react-store"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import { HeightMapFacts } from "@/components/workspace/height-map-grid"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { machineToBed } from "@/domain/anchors/stored-anchors"
import type { Plate, PlateSetup } from "@/domain/plate/plate"
import type { InspectionFeature } from "@/domain/probing/metrology"
import { jobSessionStore } from "@/features/job/job-session"
import type { JobSession } from "@/features/job/job-session"
import { AppDialog } from "@/features/shell/app-dialog"

function frameIssue(
  session: JobSession,
  target: Plate | undefined
): string | null {
  if (!target) return "Choose a target plate."
  const anchors = session.plate.setup.anchors
  if (
    !session.device ||
    !anchors ||
    anchors.source !== "firmware-config" ||
    anchors.deviceId !== session.device.id
  )
    return "This Run has no device-matched anchors read from the machine. Read anchors and run the inspection again."
  if (
    target.setup.deviceId !== session.device.id ||
    target.setup.anchors?.deviceId !== session.device.id
  )
    return "The target belongs to another device or has unconfirmed anchors."
  if (JSON.stringify(target.setup.anchors) !== JSON.stringify(anchors))
    return "The target's anchor snapshot differs from the frozen Run. Review its alignment before repeating the measurement."
  return null
}

export function MeasurementSetup({
  session,
  feature,
  onClose,
}: {
  session: JobSession
  feature: InspectionFeature
  onClose: () => void
}) {
  const workspace = useWorkspaceStore()
  const plates = useWorkspace((state) => state.plates)
  const liveSession = useSelector(jobSessionStore)
  const [target, setTarget] = useState<Plate | undefined>(() =>
    plates.find((plate) => plate.id === session.plate.id)
  )
  const [mode, setMode] = useState("origin")
  const [acknowledged, setAcknowledged] = useState(false)
  const issue = frameIssue(session, target)
  const anchors = session.plate.setup.anchors
  const result = feature.result
  let patch: Partial<PlateSetup> | null = null
  const canStock =
    feature.routine === "boss-center" &&
    !!result &&
    result.size[0] !== null &&
    result.size[1] !== null &&
    feature.bounds.every((bound) => bound !== null) &&
    !!target?.setup.stock
  if (!issue && anchors && target && feature.status === "complete" && result) {
    const convert = machineToBed(anchors)
    if (mode === "origin" && result.origin.some((value) => value !== null)) {
      const machine = anchors.anchors[0].machinePosition
      const xy = convert([
        result.origin[0] ?? target.setup.workOrigin[0] + machine[0],
        result.origin[1] ?? target.setup.workOrigin[1] + machine[1],
      ])
      patch = { workOrigin: [xy[0], xy[1], target.setup.workOrigin[2]] }
    }
    if (mode === "stock" && canStock && target.setup.stock) {
      const xy = convert([feature.bounds[0]![0], feature.bounds[1]![0]])
      patch = {
        stock: {
          ...target.setup.stock,
          width: result.size[0],
          depth: result.size[1],
        },
        stockAnchor: [xy[0], xy[1], target.setup.stockAnchor[2]],
      }
    }
  }
  if (patch && anchors && session.device) {
    const point = patch.workOrigin ?? patch.stockAnchor!
    patch = {
      ...patch,
      lastMeasurement: {
        runId: session.runId,
        operationId: feature.operationId,
        deviceId: session.device.id,
        source: session.device.source,
        mode: mode === "stock" ? "stock" : "origin",
        anchors,
        appliedAt: Date.now(),
        bedXY: [point[0], point[1]],
        stockSize: patch.stock ? [patch.stock.width, patch.stock.depth] : null,
      },
    }
  }
  const stale =
    !target ||
    plates.find((plate) => plate.id === target.id) !== target ||
    liveSession?.runId !== session.runId
  const simulation = session.device?.source === "simulator"
  const disabled = !patch || !!issue || stale || (simulation && !acknowledged)
  return (
    <AppDialog
      title="Use measurement in setup"
      width="wide"
      onClose={onClose}
      footer={
        <Button
          disabled={disabled}
          onClick={() => {
            if (
              disabled ||
              !patch ||
              workspace.state.plates.find((plate) => plate.id === target.id) !==
                target ||
              frameIssue(session, target)
            )
              return
            const applied = workspace.dispatch({
              type: "plate.setup",
              plateId: target.id,
              patch,
            })
            if (!applied.ok) toast.error(applied.error)
            else {
              toast.success("Measured XY applied to the project setup.")
              onClose()
            }
          }}
        >
          Apply previewed XY to setup
        </Button>
      }
    >
      <FieldGroup>
        <FieldDescription>
          {feature.name} · {simulation ? "Simulated" : "Machine"} measurements
          from frozen Run {session.label}. This updates project data only.
          Absolute Z, stock height and rotation cannot be established from these
          results.
        </FieldDescription>
        <Field>
          <FieldLabel>Target plate</FieldLabel>
          <OptionSelect
            value={target?.id ?? ""}
            options={plates.map((plate, index) => ({
              value: plate.id,
              label: plate.name || `Plate ${index + 1}`,
            }))}
            onValueChange={(id) => {
              setTarget(plates.find((plate) => plate.id === id))
              setAcknowledged(false)
            }}
          />
        </Field>
        <Field>
          <FieldLabel>Proposed change</FieldLabel>
          <OptionSelect
            value={mode}
            options={[
              {
                value: "origin",
                label: "Use measured corner / center as work XY",
              },
              {
                value: "stock",
                label: "Use Boss spans and sides as stock XY",
                disabled: !canStock,
              },
            ]}
            onValueChange={(value) => {
              setMode(value)
              setAcknowledged(false)
            }}
          />
        </Field>
        {patch && target && (
          <HeightMapFacts
            facts={[
              {
                label: "Work XY · bed mm",
                value: `${target.setup.workOrigin.slice(0, 2).join(" / ")} → ${(patch.workOrigin ?? target.setup.workOrigin).slice(0, 2).join(" / ")}`,
              },
              {
                label: "Stock corner XY · bed mm",
                value: `${target.setup.stockAnchor.slice(0, 2).join(" / ")} → ${(patch.stockAnchor ?? target.setup.stockAnchor).slice(0, 2).join(" / ")}`,
              },
              {
                label: "Stock width / depth · mm",
                value: `${target.setup.stock?.width ?? "—"} / ${target.setup.stock?.depth ?? "—"} → ${patch.stock?.width ?? target.setup.stock?.width ?? "—"} / ${patch.stock?.depth ?? target.setup.stock?.depth ?? "—"}`,
              },
            ]}
          />
        )}
        {issue && <FieldDescription>{issue}</FieldDescription>}
        {stale && (
          <FieldDescription>
            The target or Run changed. Choose the target again or reopen this
            proposal.
          </FieldDescription>
        )}
        {simulation && (
          <Field orientation="horizontal">
            <Checkbox
              id="measurement-simulation"
              checked={acknowledged}
              onCheckedChange={(value) => setAcknowledged(value === true)}
            />
            <FieldLabel htmlFor="measurement-simulation">
              I understand this applies synthetic simulator data to my project.
            </FieldLabel>
          </Field>
        )}
      </FieldGroup>
    </AppDialog>
  )
}
