import { useState } from "react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field"
import { ToolCard } from "@/components/workspace/tool-card"
import { targetPlate } from "@/app/workspace/defaults"
import { selectedPlate, useWorkspace } from "@/app/workspace/workspace-context"
import { DEFAULT_KIT, kitForPlate } from "@/domain/fixtures/catalog"
import type { FixtureKit } from "@/domain/fixtures/fixture-kit"
import type { Plate } from "@/domain/plate/plate"
import {
  newProbingOperation,
  strategiesFor,
  strategyBlocked,
} from "@/domain/probing/strategies"
import type { MachineProbing, TaskStrategy } from "@/domain/probing/strategy"
import { isProbe, probeProfile } from "@/domain/tools/tool"
import type { ProbeProfile, Tool } from "@/domain/tools/tool"
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
import { SourceItem, Unavailable } from "./source-item"
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
 * A new probing operation for the plate it goes to. Where the plate's table holds another tool in
 * the number the machine needs the probe in, adding puts the probe there instead.
 */
function probingOperation(
  plate: Plate,
  tool: Tool,
  strategy: TaskStrategy,
  machine: MachineProbing
): AddedOperation {
  const added = newProbingOperation(plate, tool, strategy, machine)
  const replaced = replacedEntry(plate, tool, machine)
  return replaced
    ? { ...added, assignedTools: new Map([[replaced.number, tool.id]]) }
    : added
}

/** Why the machine cannot probe with a library probe; null when some strategy runs with it. */
function probeReason(
  profile: ProbeProfile | null,
  kit: FixtureKit,
  machine: MachineProbing
): string | null {
  if (!profile) return "Say what it touches in the tool library."
  if (!strategiesFor(machine, profile).length)
    return `The ${kit.name} has no probing for it.`
  return null
}

/**
 * A library probe as the picker shows it: what it senses and carries and the tool it would
 * replace in the plate's table, and the number the table holds it in. Without `onSelect`, it only
 * shows.
 */
function ProbeChoice({
  tool,
  plate,
  kit,
  machine,
  library,
  onSelect,
}: {
  tool: Tool
  plate: Plate
  kit: FixtureKit
  machine: MachineProbing
  library: readonly Tool[]
  onSelect?: () => void
}) {
  const profile = probeProfile(tool)
  const reason = probeReason(profile, kit, machine)
  const held = heldEntry(plate, tool)
  const replaced = reason === null && replacedEntry(plate, tool, machine)
  const stranded =
    replaced && strandedText(strandedBy(plate, replaced.number, tool, machine))
  const senses = profile ? profileText(profile) : "Profile unknown"
  return (
    <Unavailable label={tool.name} reason={reason}>
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
        disabled={reason !== null}
        onClick={onSelect}
      />
    </Unavailable>
  )
}

/**
 * Probing's two steps: a probe of the tool library, then one of the strategies it runs on the
 * machine of the plate the operation goes to, generic ones first, then the firmware's. Choosing a
 * strategy adds its operation with that probe and selects it. `onBack` leads out of the first
 * step, such as back to Add operation's sources.
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
  const [probeId, setProbeId] = useState<string | null>(null)
  // The plate adding puts the operation on: its machine, and what its table holds.
  const plate = targetPlate(selected, context(), false)
  const kit = kitForPlate(plate)
  const machine = kit.probing
  if (!machine)
    return <FieldDescription>The {kit.name} has no probing.</FieldDescription>
  const probe = library.find((tool) => tool.id === probeId)
  const profile = probe && probeProfile(probe)
  const choice = { plate, kit, machine, library }

  if (!probe || !profile) {
    const probes = library.filter(isProbe)
    return (
      <div className="flex flex-col gap-4">
        {onBack && (
          <Button variant="ghost" className="self-start" onClick={onBack}>
            <ArrowLeft />
            All sources
          </Button>
        )}
        <FieldSet>
          <FieldLegend>Probe</FieldLegend>
          {probes.map((tool) => (
            <ProbeChoice
              key={tool.id}
              tool={tool}
              {...choice}
              onSelect={() => setProbeId(tool.id)}
            />
          ))}
          {!probes.length && (
            <FieldDescription>The tool library has no probe.</FieldDescription>
          )}
          <Button
            variant="link"
            className="self-start px-0"
            onClick={() => openDialog({ kind: "tools" })}
          >
            Tool library
          </Button>
        </FieldSet>
      </div>
    )
  }

  const strategies = strategiesFor(machine, profile)
  const firmware = (strategy: TaskStrategy) =>
    machine.strategies.includes(strategy)
  const strategyItem = (strategy: TaskStrategy) => {
    const Icon = probingIcon({ task: strategy.task, strategy: strategy.id })
    return (
      <SourceItem
        key={strategy.id}
        icon={<Icon />}
        title={strategy.label}
        description={strategy.description}
        reason={strategyBlocked(strategy, plate, machine)}
        onSelect={() => {
          if (
            add((target) => probingOperation(target, probe, strategy, machine))
          )
            onAdded()
        }}
      />
    )
  }
  const generic = strategies.filter((strategy) => !firmware(strategy))
  const firmwares = strategies.filter(firmware)
  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="ghost"
        className="self-start"
        onClick={() => setProbeId(null)}
      >
        <ArrowLeft />
        All probes
      </Button>
      <ProbeChoice tool={probe} {...choice} />
      {generic.length > 0 && (
        <FieldSet>
          <FieldLegend>Generic</FieldLegend>
          {generic.map(strategyItem)}
        </FieldSet>
      )}
      {firmwares.length > 0 && (
        <FieldSet>
          <FieldLegend>{kit.name} firmware</FieldLegend>
          {firmwares.map(strategyItem)}
        </FieldSet>
      )}
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
