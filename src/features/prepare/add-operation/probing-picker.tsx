import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field"
import { targetPlate } from "@/app/workspace/defaults"
import { selectedPlate, useWorkspace } from "@/app/workspace/workspace-context"
import { DEFAULT_KIT, kitForPlate } from "@/domain/fixtures/catalog"
import type { Plate } from "@/domain/plate/plate"
import {
  PROBING_STRATEGIES,
  newProbingOperation,
  strategyBlocked,
  strategyUnsupported,
} from "@/domain/probing/strategies"
import type { MachineProbing, ProbingStrategy } from "@/domain/probing/strategy"
import { isProbe } from "@/domain/tools/tool"
import type { Tool } from "@/domain/tools/tool"
import { probingIcon } from "@/features/prepare/operation-icon"
import {
  defaultProbe,
  entryText,
  replacedEntry,
  strandedBy,
  strandedText,
  strategyProbes,
} from "@/features/probing/probe-tools"
import { AppDialog } from "@/features/shell/app-dialog"
import { useImportContext } from "@/features/shell/use-import"
import { SourceItem } from "./source-item"
import { useAddOperation } from "./use-add-operation"
import type { AddedOperation } from "./use-add-operation"

/** What Probing adds, as the toolbar and Add operation offer it. */
export const PROBING_DESCRIPTION =
  "Probe the top surface, map heights, trace the outline or find the work origin with a probe."

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
 * How Probing offers a strategy for the plate: the probe it adds the operation with
 * (`defaultProbe`), and what that probe replaces in the plate's table, if anything; or why it
 * cannot be picked: the machine does not support it, it cannot run on the plate, or no probe of
 * the tool library can perform it.
 */
function strategyOffer(
  strategy: ProbingStrategy,
  plate: Plate,
  machine: MachineProbing,
  library: readonly Tool[]
): { tool: Tool; replaces: string | null } | { reason: string } {
  const reason =
    strategyUnsupported(strategy, machine) ??
    strategyBlocked(strategy, plate, machine)
  if (reason !== null) return { reason }
  const tool = defaultProbe(strategy, plate, library, machine)
  if (!tool) {
    // Where every probe it runs with is refused, the first says why.
    const refused = strategyProbes(strategy, library, machine).at(0)?.refused
    return { reason: refused ?? "The tool library has no probe for this." }
  }
  const replaced = replacedEntry(plate, tool, machine)
  if (!replaced) return { tool, replaces: null }
  const stranded = strandedText(
    strandedBy(plate, replaced.number, tool, machine)
  )
  return {
    tool,
    replaces: [
      `Uses ${tool.name}, which replaces ${entryText(replaced, library)}.`,
      ...(stranded ? [`${stranded}.`] : []),
    ].join(" "),
  }
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
 * Probing's strategies, what the operation is to do, in their order: those the plate's machine
 * cannot do there, or no library probe can, unavailable with why. Choosing one adds its operation
 * with the probe `defaultProbe` picks, saying so where that probe replaces another tool in the
 * plate's table, and selects it; the inspector's Probe changes the probe. `onBack` leads out,
 * such as back to Add operation's sources.
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
  // The plate adding puts the operation on: its machine, and what its table holds.
  const plate = targetPlate(selected, context(), false)
  const kit = kitForPlate(plate)
  const machine = kit.probing
  if (!machine)
    return <FieldDescription>The {kit.name} has no probing.</FieldDescription>

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
        {PROBING_STRATEGIES.map((strategy) => {
          const Icon = probingIcon(strategy)
          const offer = strategyOffer(strategy, plate, machine, library)
          return (
            <SourceItem
              key={strategy.id}
              icon={<Icon />}
              title={strategy.label}
              description={strategy.description}
              note={"tool" in offer ? offer.replaces : null}
              reason={"reason" in offer ? offer.reason : null}
              onSelect={() => {
                if (
                  "tool" in offer &&
                  add((target) =>
                    probingOperation(target, offer.tool, strategy, machine)
                  )
                )
                  onAdded()
              }}
            />
          )
        })}
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
