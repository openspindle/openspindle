import { useEffect, useId, useState } from "react"
import { ArrowLeftRight, Check, Play, Wrench } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Field, FieldLabel } from "@/components/ui/field"
import type {
  AvailabilityKey,
  ConnectedDevice,
  MachineCommand,
  MachineFeatures,
  Telemetry,
} from "@/machine/contract"
import {
  useSelectedPlate,
  useWorkspace,
} from "@/app/workspace/workspace-context"
import type { Plate } from "@/domain/plate/plate"
import type { Tool } from "@/domain/tools/tool"
import { OptionSelect } from "@/components/option-select"
import { Hint } from "@/components/workspace/hint"
import { ReasonButton } from "@/components/workspace/reason-button"
import { toolText } from "./device-format"
import { ControlCard } from "./device-control-card"

const TOOL_HINT =
  "Set records the tool as the one in the spindle without measuring it, so the tool offset stays: for a bit you installed and set work Z with by hand. Change runs the machine's tool change: it waits for the tool to be installed, then measures it on the tool setter."

/**
 * The tools to set or change to: none, the selected plate's table by number and name, and the
 * one the machine holds where the table does not have it.
 */
function toolOptions(
  plate: Plate | null,
  library: readonly Tool[],
  held: number | null
) {
  const entries = (plate?.tools ?? [])
    .flatMap(({ number, toolId }) =>
      number === null ? [] : [{ number, toolId }]
    )
    .sort((a, b) => a.number - b.number)
  const options = [
    { value: -1, label: "None" },
    ...entries.map(({ number, toolId }) => {
      const tool = library.find(({ id }) => id === toolId)
      return {
        value: number,
        label: tool ? `T${number} · ${tool.name}` : `T${number}`,
      }
    }),
  ]
  if (held !== null && !options.some(({ value }) => value === held))
    options.push({ value: held, label: toolText(held) })
  return options
}

/**
 * The tool the machine holds, and a tool to set it to without measuring or change to with the
 * machine's tool change, which waits for Tool installed.
 */
export function DeviceToolCard({
  device,
  features,
  telemetry,
  pending,
  reason,
  execute,
  change,
}: {
  device: ConnectedDevice | null
  features: MachineFeatures | null
  telemetry: Telemetry | null
  pending: boolean
  reason: (key: AvailabilityKey, action?: MachineCommand) => string | null
  execute: (action: MachineCommand) => void
  /** Changes to a tool with the machine's tool change, also to the one it holds. */
  change: (tool: number) => void
}) {
  const fieldId = useId()
  const [choice, setChoice] = useState<number | null>(null)
  useEffect(() => {
    setChoice(null)
  }, [device?.host, device?.port])
  const plate = useSelectedPlate()
  const library = useWorkspace((state) => state.tools)
  const held = telemetry?.tool ?? null
  const options = toolOptions(plate, library, held)
  const label = (tool: number) =>
    options.find(({ value }) => value === tool)?.label ?? toolText(tool)
  const tool = choice ?? held ?? -1
  const setTool: MachineCommand = { type: "setTool", tool }
  const changeTool: MachineCommand = {
    type: "changeTool",
    tool: Math.max(tool, 0),
  }
  return (
    <ControlCard
      title="Tool"
      icon={<Wrench size={16} />}
      action={
        <Badge variant="secondary" className="max-w-56 truncate">
          {held === null ? "—" : label(held)}
        </Badge>
      }
    >
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          execute(setTool)
        }}
      >
        <Field className="min-w-0 flex-1">
          <FieldLabel htmlFor={`${fieldId}-tool`}>
            <Hint text={TOOL_HINT}>Tool</Hint>
          </FieldLabel>
          <OptionSelect
            id={`${fieldId}-tool`}
            aria-label="Tool to set or change to"
            className="w-full"
            options={options}
            value={tool}
            disabled={!device}
            onValueChange={setChoice}
          />
        </Field>
        <ReasonButton
          label="Set tool"
          type="submit"
          variant="outline"
          reason={
            reason("setTool", setTool) ??
            (tool === held ? `The machine holds ${label(tool)}.` : null)
          }
          disabled={pending}
        >
          <Check />
          Set
        </ReasonButton>
        <ReasonButton
          label="Change tool"
          type="button"
          variant="outline"
          reason={
            reason("changeTool", changeTool) ??
            (tool < 0 ? "Choose the tool to change to." : null)
          }
          disabled={pending}
          onClick={() => change(tool)}
        >
          <ArrowLeftRight />
          Change
        </ReasonButton>
      </form>
      {telemetry?.state === "Tool" && !features?.atc && (
        <ReasonButton
          label="Tool installed"
          variant="default"
          size="sm"
          className="self-start"
          reason={reason("confirmToolChange")}
          disabled={pending}
          onClick={() => execute({ type: "confirmToolChange" })}
        >
          <Play />
          {telemetry.requestedTool === null || telemetry.requestedTool < 0
            ? "Tool installed"
            : `${toolText(telemetry.requestedTool)} installed`}
        </ReasonButton>
      )}
    </ControlCard>
  )
}
