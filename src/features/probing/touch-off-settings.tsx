import { useEffect, useId, useMemo, useState } from "react"
import { LocateFixed } from "lucide-react"
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field"
import { Hint } from "@/components/workspace/hint"
import {
  centerTouchOff,
  workAreaMiddle,
} from "@/domain/probing/tasks/touch-off/fit"
import { TouchOffParamsSchema } from "@/domain/probing/tasks/touch-off/params"
import type {
  TouchOffSpecs,
  TouchOffParams,
} from "@/domain/probing/tasks/touch-off/params"
import {
  ParameterField,
  PlacementFields,
  WorkAreaField,
  probingField,
} from "@/features/probing/probing-fields"
import type { ProbingPick } from "@/features/probing/probing-fields"
import {
  fromWorkOrigin,
  useProbingDraft,
  useProbingForm,
} from "@/features/probing/probing-form"
import type {
  ProbingAnchorOption,
  WorkAreaFit,
} from "@/features/probing/probing-form"
import { rangedSchema } from "@/domain/probing/parameters"
import type { SpecReads } from "@/domain/probing/parameters"
import type { AnchorPlacement } from "@/domain/probing/placement"

export type TouchOffSettingsProps = {
  value: TouchOffParams
  /** The touch-off's parameters on the machine's probe: defaults, ranges and descriptions. */
  parameters: TouchOffSpecs
  /** The parameters the operation's strategy reads; the others are left out of the form. */
  reads: SpecReads<TouchOffSpecs>
  /** Stored anchors of the plate's device that the touch point can be relative to. */
  anchors: readonly ProbingAnchorOption[]
  /** Where the plate cuts, or its stock without machining: Center touches its middle. */
  workArea: WorkAreaFit
  /** Receives complete, valid parameters as soon as an edit makes them valid. */
  onChange: (value: TouchOffParams) => void
  /** Picking its start in the 3D view; null where it cannot be picked. */
  pick?: ProbingPick | null
  disabled?: boolean
}

/** Where Center touches, or why there is nothing to center on. */
function centerDescription({ result, origin, anchors }: WorkAreaFit) {
  if (!result.ok) return result.reason
  const [x, y] = fromWorkOrigin(workAreaMiddle(result.area), origin)
  const middle =
    result.covers === "cuts"
      ? `The middle of the cuts is X ${x} Y ${y} from the work origin.`
      : `The plate has no machining operations; the middle of its stock is X ${x} Y ${y} from the work origin.`
  if (anchors.length)
    return `${middle} Center touches there, relative to a stored anchor.`
  return `${middle} Without stored anchors, position the probe there before Run.`
}

/** Why Center is unavailable; null when it can place the touch point. */
function centerReason({ result, anchors }: WorkAreaFit) {
  if (!result.ok) return result.reason
  if (!anchors.length)
    return "Centering needs the stored anchors of the plate's device."
  return null
}

/**
 * Parameters of a touch-off probing operation. Edits apply as soon as the parameters are
 * valid; invalid input stays in the form with its errors and is never passed on.
 */
export function TouchOffSettings({
  value,
  parameters,
  reads,
  anchors,
  workArea,
  onChange,
  pick = null,
  disabled = false,
}: TouchOffSettingsProps) {
  const draft = useProbingDraft(value, onChange)
  return (
    <TouchOffForm
      key={draft.key}
      value={value}
      parameters={parameters}
      reads={reads}
      anchors={anchors}
      workArea={workArea}
      pick={pick}
      disabled={disabled}
      onChange={draft.onChange}
    />
  )
}

function TouchOffForm({
  value,
  parameters,
  reads,
  anchors,
  workArea,
  onChange,
  pick,
  disabled,
}: Required<TouchOffSettingsProps>) {
  const id = useId()
  // Only what the strategy reads is held to its range: a probe travel it does not read stays as
  // stored, whatever it is.
  const schema = useMemo(
    () =>
      reads.probeTravel
        ? rangedSchema(TouchOffParamsSchema, parameters)
        : rangedSchema(TouchOffParamsSchema, {
            clearance: parameters.clearance,
          }),
    [parameters, reads.probeTravel]
  )
  // Switching back from the probe position restores the anchor settings.
  const [lastAnchor, setLastAnchor] = useState<AnchorPlacement | null>(null)
  const form = useProbingForm(value, schema, onChange)
  // A probe travel the strategy stops reading takes back its last valid value, as the form passes
  // on only valid parameters: a hidden error would hold back every later edit.
  useEffect(() => {
    if (
      !reads.probeTravel &&
      form.getFieldValue("probeTravel") !== value.probeTravel
    )
      form.setFieldValue("probeTravel", value.probeTravel, {
        dontRunListeners: true,
      })
  }, [reads.probeTravel])

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>
          <Hint text="The probed surface becomes work Z0, and the plate's work origin stays on the stock top.">
            Touch-off
          </Hint>
        </FieldLegend>
        <FieldGroup className="gap-3">
          {reads.probeTravel && (
            <ParameterField
              id={`${id}-probeTravel`}
              parameter={parameters.probeTravel}
              field={probingField(form, "probeTravel")}
              disabled={disabled}
            />
          )}
          <ParameterField
            id={`${id}-clearance`}
            parameter={parameters.clearance}
            field={probingField(form, "clearance")}
            disabled={disabled}
          />
        </FieldGroup>
      </FieldSet>
      <PlacementFields
        placement={probingField(form, "placement")}
        anchors={anchors}
        lastAnchor={lastAnchor}
        setLastAnchor={setLastAnchor}
        pick={pick}
        disabled={disabled}
        action={(placement, setPlacement) => (
          <WorkAreaField
            description={centerDescription(workArea)}
            action="Center"
            icon={<LocateFixed data-icon="inline-start" />}
            reason={centerReason(workArea)}
            disabled={disabled}
            onApply={() => {
              if (!workArea.result.ok) return
              const next = centerTouchOff(
                workArea.result.area,
                workArea.anchors,
                placement,
                lastAnchor
              )
              if (next) setPlacement(next)
            }}
          />
        )}
      />
    </FieldGroup>
  )
}
