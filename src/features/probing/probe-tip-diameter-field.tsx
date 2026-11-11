import { useId, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { z } from "zod"
import { toast } from "sonner"
import { FieldDescription, FieldGroup } from "@/components/ui/field"
import { ReasonButton } from "@/components/workspace/reason-button"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import { probeProfile } from "@/domain/tools/tool"
import type { Tool } from "@/domain/tools/tool"
import {
  DEFAULT_PROBE_TIP_DIAMETER,
  ProbeTipDiameterSchema,
  withProbeTipDiameter,
} from "@/domain/tools/probe-diameter"
import { isJobActive } from "@/machine/contract"
import { useMachineSnapshot } from "@/platform/machine"
import { ParameterField, probingField } from "./probing-fields"
import { useProbingForm } from "./probing-form"

const SettingsSchema = z.object({ diameter: ProbeTipDiameterSchema })

/** One explicit library edit, reused by every XYZ probe setup screen. */
export function ProbeTipDiameterField({
  tool,
  disabled = false,
}: {
  tool: Tool
  disabled?: boolean
}) {
  if (probeProfile(tool)?.touch !== "xyz") return null
  return (
    <DiameterForm
      key={`${tool.id}:${tool.diameter}`}
      tool={tool}
      disabled={disabled}
    />
  )
}

function DiameterForm({ tool, disabled }: { tool: Tool; disabled: boolean }) {
  const id = useId()
  const workspace = useWorkspaceStore()
  const machine = useMachineSnapshot()
  const [value, setValue] = useState({
    diameter: tool.diameter ?? DEFAULT_PROBE_TIP_DIAMETER,
  })
  const [valid, setValid] = useState(true)
  const form = useProbingForm(value, SettingsSchema, setValue, setValid)
  const busy = disabled || isJobActive(machine.job)
  const save = useMutation({
    mutationFn: async () => {
      if (busy || !valid)
        throw new Error("Finish the run and enter a valid tip diameter first.")
      const live = workspace.state.tools.find((entry) => entry.id === tool.id)
      if (!live || JSON.stringify(live) !== JSON.stringify(tool))
        throw new Error(
          "The probe entry changed. Review its current diameter before saving."
        )
      const changed = withProbeTipDiameter(live, value.diameter)
      const result = workspace.dispatch({
        type: "library.tools",
        tools: workspace.state.tools.map((entry) =>
          entry.id === live.id ? changed : entry
        ),
      })
      if (!result.ok) throw new Error(result.error)
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <FieldGroup className="gap-3">
      <ParameterField
        id={id}
        parameter={{
          label: "Probe tip diameter",
          description:
            "The contact ball or conductive rod diameter used for probing compensation.",
          unit: "mm",
          min: 0.5,
          max: 10,
          step: 0.001,
          default: DEFAULT_PROBE_TIP_DIAMETER,
        }}
        disabled={busy}
        field={probingField(form, "diameter")}
      />
      <ReasonButton
        label="Save tip diameter"
        variant="outline"
        reason={
          busy
            ? "Finish the current run before changing the probe diameter."
            : null
        }
        disabled={!valid || save.isPending || value.diameter === tool.diameter}
        onClick={() => save.mutate()}
      >
        Save tip diameter
      </ReasonButton>
      <FieldDescription>
        Save to use this value in future routines with this probe. A saved
        diameter or calibration is retained; an unknown diameter starts at 2 mm.
      </FieldDescription>
    </FieldGroup>
  )
}
