import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { useFixtureLibraryStore } from "@/app/fixtures/fixture-context"
import { projectPlacement } from "@/app/fixtures/plate-profile"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { kitForSetup } from "@/domain/fixtures/catalog"
import type { Operation } from "@/domain/operations/operation"
import { createPlate, createPlateSetup } from "@/domain/plate/plate"
import {
  newProbingOperation,
  runsWith,
  strategyById,
  strategyUnsupported,
} from "@/domain/probing/strategies"
import { probeProfile } from "@/domain/tools/tool"
import type { WorkspaceCommand } from "@/domain/workspace/workspace"

/**
 * Probing an anchor with the 3D probe: a plate, "Probe anchor", on the shown profile's default
 * bed setup, holding one Inside corner operation with the first library probe that can perform
 * it on its machine, which finds the corner front-left from where the probe is, as at Anchor 1
 * (the L-bracket's inner corner), opened on the Job tab to run. Its result there keeps what it
 * found as an anchor (`SaveAsAnchor`). `reason` says why it cannot, such as a library without a
 * 3D probe; null when it can.
 */
export function useProbeAnchor(): { reason: string | null; run: () => void } {
  const workspace = useWorkspaceStore()
  const fixtures = useFixtureLibraryStore()
  const navigate = useNavigate()
  const library = useWorkspace((state) => state.tools)
  const placement = projectPlacement(workspace.state, fixtures.state)
  const kit = kitForSetup(placement)
  const machine = kit.probing
  const strategy = strategyById("inside-corner")
  const probe =
    machine && strategy
      ? library.find((tool) => {
          const profile = probeProfile(tool)
          return profile !== null && runsWith(strategy, profile, machine)
        })
      : undefined
  let reason: string | null = `The ${kit.name} has no probing.`
  if (machine && strategy)
    reason =
      strategyUnsupported(strategy, machine) ??
      (probe ? null : "The tool library has no 3D probe.")
  return {
    reason,
    run: () => {
      if (!machine || !probe || !strategy) return
      const plate = {
        ...createPlate(
          createPlateSetup({
            stock: null,
            stockSource: "assigned",
            ...placement,
          })
        ),
        name: "Probe anchor",
      }
      const added = newProbingOperation(plate, probe, strategy, machine)
      const { source } = added.operation
      const operation: Operation =
        source.kind === "probing" && source.task === "origin"
          ? {
              ...added.operation,
              source: {
                ...source,
                params: {
                  ...source.params,
                  corner: "front-left",
                  placement: { kind: "probe-position" },
                },
              },
            }
          : added.operation
      const keep = workspace.state.plates
        .filter((item) => item.example)
        .map((item): WorkspaceCommand => ({
          type: "plate.keep",
          plateId: item.id,
        }))
      const result = workspace.dispatch({
        type: "batch",
        commands: [
          ...keep,
          { type: "plates.add", plates: [plate], select: true },
          {
            type: "operation.add",
            plateId: plate.id,
            operation,
            preferredTools: added.preferredTools,
          },
        ],
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      void navigate({ to: "/job" })
    },
  }
}
