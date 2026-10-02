import { useState } from "react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field"
import { ToolCard } from "@/components/workspace/tool-card"
import { targetPlate } from "@/app/workspace/defaults"
import { selectedPlate, useWorkspace } from "@/app/workspace/workspace-context"
import { DEFAULT_KIT, kitForPlate } from "@/domain/fixtures/catalog"
import type { Plate } from "@/domain/plate/plate"
import {
  PROBING_STRATEGIES,
  newProbingOperation,
  runsWith,
  strategyBlocked,
  strategyById,
  strategyRefuses,
  strategyUnsupported,
} from "@/domain/probing/strategies"
import type {
  MachineProbing,
  ProbingStrategy,
  StrategyId,
} from "@/domain/probing/strategy"
import { isProbe, probeProfile } from "@/domain/tools/tool"
import type { Tool } from "@/domain/tools/tool"
import { probingIcon } from "@/features/prepare/operation-icon"
import {
  entryText,
  heldEntry,
  profileText,
  replacedEntry,
  strandedBy,
  strandedText,
} from "@/features/probing/probe-tools"
import { AppDialog } from "@/features/shell/app-dialog"
import { openDialog } from "@/features/shell/dialogs"
import { useImportContext } from "@/features/shell/use-import"
import { SourceItem } from "./source-item"
import { useAddOperation } from "./use-add-operation"
import type { AddedOperation } from "./use-add-operation"

/** What Probing adds, as the toolbar and Add operation offer it. */
export const PROBING_DESCRIPTION =
  "Touch off, map heights, trace the outline or find the work origin with a probe from the tool library."

/**
 * Why Probing cannot add an operation where adding would put it (the selected plate, or a new
 * plate from the default kit): its machine has no probing, or the tool library no probe. Null
 * when it can.
 */
export function useProbingReason(): string | null {
  const library = useWorkspace((state) => state.tools)
  const plate = useWorkspace(selectedPlate)
  const kit = plate ? kitForPlate(plate) : DEFAULT_KIT
  if (!kit.probing) return `The ${kit.name} has no probing.`
  if (!library.some(isProbe)) return "The tool library has no probe."
  return null
}

/**
 * The library probes a strategy runs with on the machine (`runsWith`), each with why it refuses
 * it in the number the probe would go in, such as for its ball; null where it does not.
 */
function strategyProbes(
  strategy: ProbingStrategy,
  library: readonly Tool[],
  machine: MachineProbing
): { tool: Tool; refused: string | null }[] {
  return library.flatMap((tool) => {
    const profile = probeProfile(tool)
    if (!profile || !runsWith(strategy, profile, machine)) return []
    const number = machine.slot(profile) ?? tool.postProcess.number
    return [{ tool, refused: strategyRefuses(strategy, tool, number, machine) }]
  })
}

/**
 * Why a strategy cannot be picked for the plate: the machine does not support it, it cannot run
 * on the plate, or the tool library has no probe that can perform it. Null when it can.
 */
function strategyReason(
  strategy: ProbingStrategy,
  plate: Plate,
  machine: MachineProbing,
  library: readonly Tool[]
): string | null {
  const reason =
    strategyUnsupported(strategy, machine) ??
    strategyBlocked(strategy, plate, machine)
  if (reason !== null) return reason
  const probes = strategyProbes(strategy, library, machine)
  if (!probes.length) return "The tool library has no probe for this."
  // Where every probe it runs with is refused, the first says why.
  return probes.some(({ refused }) => refused === null)
    ? null
    : probes[0].refused
}

/**
 * A new probing operation for the plate it goes to. Where the plate's table holds another tool in
 * the number the machine needs the probe in, adding puts the probe there instead.
 */
function probingOperation(
  plate: Plate,
  tool: Tool,
  strategy: ProbingStrategy,
  machine: MachineProbing
): AddedOperation {
  const added = newProbingOperation(plate, tool, strategy, machine)
  const replaced = replacedEntry(plate, tool, machine)
  return replaced
    ? { ...added, assignedTools: new Map([[replaced.number, tool.id]]) }
    : added
}

/**
 * A library probe as the picker shows it: what it senses and carries and the tool it would
 * replace in the plate's table, and the number the table holds it in.
 */
function ProbeChoice({
  tool,
  plate,
  machine,
  library,
  onSelect,
}: {
  tool: Tool
  plate: Plate
  machine: MachineProbing
  library: readonly Tool[]
  onSelect: () => void
}) {
  const profile = probeProfile(tool)
  const held = heldEntry(plate, tool)
  const replaced = replacedEntry(plate, tool, machine)
  const stranded =
    replaced && strandedText(strandedBy(plate, replaced.number, tool, machine))
  const senses = profile ? profileText(profile) : "Profile unknown"
  return (
    <ToolCard
      tool={tool}
      details={
        replaced
          ? [
              senses,
              `replaces ${entryText(replaced, library)}`,
              ...(stranded ? [stranded] : []),
            ].join(" · ")
          : senses
      }
      slotLabel={held && `In T${held.number}`}
      onClick={onSelect}
    />
  )
}

/** Opens the tool library, where probes are added and described. */
function ToolLibraryLink() {
  return (
    <Button
      variant="link"
      className="self-start px-0"
      onClick={() => openDialog({ kind: "tools" })}
    >
      Tool library
    </Button>
  )
}

/**
 * Probing's two steps: what the operation is to do, one of the strategies in their order, those
 * the plate's machine cannot do there unavailable with why; then a probe of the tool library that
 * can perform it on that machine. Choosing a probe adds the strategy's operation with it and
 * selects it. `onBack` leads out of the first step, such as back to Add operation's sources.
 */
export function ProbingSteps({
  onAdded,
  onBack,
}: {
  onAdded: () => void
  onBack?: () => void
}) {
  const library = useWorkspace((state) => state.tools)
  const selected = useWorkspace(selectedPlate)
  const context = useImportContext()
  const add = useAddOperation({ stock: false })
  const [strategyId, setStrategyId] = useState<StrategyId | null>(null)
  // The plate adding puts the operation on: its machine, and what its table holds.
  const plate = targetPlate(selected, context(), false)
  const kit = kitForPlate(plate)
  const machine = kit.probing
  if (!machine)
    return <FieldDescription>The {kit.name} has no probing.</FieldDescription>
  const strategy = strategyId === null ? null : strategyById(strategyId)

  if (!strategy) {
    return (
      <div className="flex flex-col gap-4">
        {onBack && (
          <Button variant="ghost" className="self-start" onClick={onBack}>
            <ArrowLeft />
            All sources
          </Button>
        )}
        <FieldSet>
          <FieldLegend>Strategy</FieldLegend>
          {PROBING_STRATEGIES.map((item) => {
            const Icon = probingIcon(item)
            return (
              <SourceItem
                key={item.id}
                icon={<Icon />}
                title={item.label}
                description={item.description}
                reason={strategyReason(item, plate, machine, library)}
                onSelect={() => setStrategyId(item.id)}
              />
            )
          })}
          <ToolLibraryLink />
        </FieldSet>
      </div>
    )
  }

  const Icon = probingIcon(strategy)
  const probes = strategyProbes(strategy, library, machine).filter(
    ({ refused }) => refused === null
  )
  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="ghost"
        className="self-start"
        onClick={() => setStrategyId(null)}
      >
        <ArrowLeft />
        All strategies
      </Button>
      <SourceItem
        icon={<Icon />}
        title={strategy.label}
        description={strategy.description}
      />
      <FieldSet>
        <FieldLegend>Probe</FieldLegend>
        {probes.map(({ tool }) => (
          <ProbeChoice
            key={tool.id}
            tool={tool}
            plate={plate}
            machine={machine}
            library={library}
            onSelect={() => {
              if (
                add((target) =>
                  probingOperation(target, tool, strategy, machine)
                )
              )
                onAdded()
            }}
          />
        ))}
        {!probes.length && (
          <FieldDescription>
            The tool library has no probe for this.
          </FieldDescription>
        )}
        <ToolLibraryLink />
      </FieldSet>
    </div>
  )
}

/** Probing from the toolbar: the picker on its own. */
export function ProbingPicker({ onClose }: { onClose: () => void }) {
  return (
    <AppDialog title="Probing" onClose={onClose}>
      <ProbingSteps onAdded={onClose} />
    </AppDialog>
  )
}
