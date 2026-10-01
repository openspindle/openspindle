import { useId } from "react"
import { toast } from "sonner"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import type { Option } from "@/components/option-select"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Hint } from "@/components/workspace/hint"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import type { ProbingOperation } from "@/domain/operations/kinds"
import type { Plate } from "@/domain/plate/plate"
import {
  runsWith,
  strategiesFor,
  strategyBlocked,
} from "@/domain/probing/strategies"
import type { MachineProbing, TaskStrategy } from "@/domain/probing/strategy"
import { formatToolNumber } from "@/domain/tools/format"
import { probeProfile } from "@/domain/tools/tool"
import type { Tool } from "@/domain/tools/tool"
import { boundTools } from "@/domain/tools/tool-table"
import type { WorkspaceCommand } from "@/domain/workspace/workspace"
import {
  probeNumber,
  profileText,
  sharedReplacement,
  sharedReplacementText,
  strandedBy,
  strandedText,
} from "@/features/probing/probe-tools"

const ROW = "grid grid-cols-2 items-center gap-3"

/** A probe the Probe select lists, with what choosing it replaces for other operations. */
type ProbeOption = Option<string> & { replaces?: string }

/** A probe's ball, its diameter, as 3D probing takes it: "Ø 3 mm ball". */
const ballText = ({ diameter }: Tool) =>
  diameter === null
    ? "No ball diameter"
    : `Ø ${formatToolNumber(diameter, "millimeters")} mm ball`

/**
 * A probing operation's probe and strategy, each changeable among those that go with the other:
 * the library probes its strategy runs with on the machine (`runsWith`), and the strategies of
 * its task that run with its probe. A strategy keeps the operation's parameters, which its own
 * ranges then check. A probe goes in the number the machine's firmware needs it in, replacing
 * what the plate's table holds there for every operation that uses it, as assigning a tool does;
 * a probe that would replace another operation's says so while the pointer rests on it.
 */
export function ProbingChoiceFields({
  plate,
  operation,
  machine,
  strategy,
}: {
  plate: Plate
  operation: ProbingOperation
  machine: MachineProbing
  strategy: TaskStrategy
}) {
  const id = useId()
  const workspace = useWorkspaceStore()
  const library = useWorkspace((state) => state.tools)
  const { source } = operation
  const target = { plateId: plate.id, operationId: operation.id }
  const toolId = boundTools(plate, operation).get(source.probe) ?? null
  const tool = library.find((item) => item.id === toolId)
  const profile = tool ? probeProfile(tool) : null

  const probes = library.filter((item) => {
    const itemProfile = probeProfile(item)
    return itemProfile !== null && runsWith(strategy, itemProfile, machine)
  })
  // The bound tool stays listed when the strategy cannot run with it, so the select names it.
  const probeOptions: ProbeOption[] = [
    ...(tool && probes.includes(tool)
      ? []
      : [
          {
            value: toolId ?? "",
            label:
              tool?.name ?? (toolId ? "Missing from the library" : "No probe"),
            disabled: true,
          },
        ]),
    ...probes.map((item) => {
      const replaced = sharedReplacement(plate, operation, item, machine)
      const stranded =
        replaced &&
        strandedText(
          strandedBy(plate, replaced.entry.number, item, machine, operation.id)
        )
      return {
        value: item.id,
        label: item.name,
        replaces:
          replaced &&
          [
            sharedReplacementText(replaced, library),
            ...(stranded ? [`${stranded}.`] : []),
          ].join(" "),
      }
    }),
  ]
  const runs = profile
    ? strategiesFor(machine, profile).filter(
        (item) => item.task === source.task
      )
    : []
  const strategies = runs.includes(strategy) ? runs : [strategy, ...runs]
  const strategyOptions: Option<string>[] = strategies.map((item) => {
    const reason =
      item === strategy ? null : strategyBlocked(item, plate, machine)
    return reason === null
      ? { value: item.id, label: item.label }
      : { value: item.id, label: item.label, disabled: true, reason }
  })
  const probeHint = [
    `T${source.probe}`,
    ...(profile ? [profileText(profile)] : []),
    ...(tool && source.task === "origin" ? [ballText(tool)] : []),
  ].join(" · ")

  const dispatch = (commands: WorkspaceCommand[]) => {
    const result = workspace.dispatch({ type: "batch", commands })
    if (!result.ok) toast.error(result.error)
  }
  const changeProbe = (nextId: string) => {
    const next = probes.find((item) => item.id === nextId)
    const nextProfile = next && probeProfile(next)
    if (!next || !nextProfile || next === tool) return
    const number = probeNumber(operation, nextProfile, machine)
    dispatch([
      ...(number === source.probe
        ? []
        : [
            {
              type: "operation.source" as const,
              ...target,
              source: { ...source, probe: number },
              expectedRevision: operation.revision,
            },
          ]),
      {
        type: "operation.tools",
        ...target,
        tools: new Map([[number, next.id]]),
      },
    ])
  }
  const changeStrategy = (nextId: string) => {
    const next = strategies.find((item) => item.id === nextId)
    if (!next || next === strategy) return
    dispatch([
      {
        type: "operation.source",
        ...target,
        source: { ...source, strategy: next.id },
        expectedRevision: operation.revision,
      },
      // A name that is still the strategy's follows it.
      ...(operation.name === strategy.label
        ? [{ type: "operation.rename" as const, ...target, name: next.label }]
        : []),
    ])
  }

  return (
    <FieldGroup className="gap-3">
      <Field orientation="horizontal" className={ROW}>
        <FieldLabel htmlFor={`${id}-probe`}>
          <Hint text={probeHint}>Probe</Hint>
        </FieldLabel>
        {/* OptionSelect's options carry no note of what choosing them changes. */}
        <Select
          items={probeOptions}
          value={toolId ?? ""}
          onValueChange={(next) => {
            if (next !== null) changeProbe(next)
          }}
        >
          <SelectTrigger
            id={`${id}-probe`}
            className="w-full min-w-0"
            aria-description={probeHint}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {probeOptions.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  title={option.replaces}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field orientation="horizontal" className={ROW}>
        <FieldLabel htmlFor={`${id}-strategy`}>
          <Hint text={strategy.description}>Strategy</Hint>
        </FieldLabel>
        <OptionSelect
          id={`${id}-strategy`}
          className="w-full min-w-0"
          aria-description={strategy.description}
          options={strategyOptions}
          value={strategy.id}
          onValueChange={changeStrategy}
        />
      </Field>
    </FieldGroup>
  )
}
