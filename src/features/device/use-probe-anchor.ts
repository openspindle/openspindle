import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { useFixtureLibraryStore } from "@/app/fixtures/fixture-context"
import { profilePlacement } from "@/app/fixtures/fixture-library-store"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { kitForSetup } from "@/domain/fixtures/catalog"
import type { Operation } from "@/domain/operations/operation"
import { createPlate, createPlateSetup } from "@/domain/plate/plate"
import { newProbingOperation, strategiesFor } from "@/domain/probing/strategies"
import { probeProfile } from "@/domain/tools/tool"
import type { WorkspaceCommand } from "@/domain/workspace/workspace"

/**
 * Probing an anchor with the 3D probe: a plate, "Probe anchor", on the shown profile's default
 * bed setup, holding one 3D probing operation of its machine that finds an inside corner
 * front-left from where the probe is, as at Anchor 1 (the L-bracket's inner corner), opened on
 * the Job tab to run. Its result there keeps what it found as an anchor (`SaveAsAnchor`).
 * `reason` says why it cannot, such as a library without a 3D probe; null when it can.
 */
export function useProbeAnchor(): { reason: string | null; run: () => void } {
  const workspace = useWorkspaceStore()
  const fixtures = useFixtureLibraryStore()
  const navigate = useNavigate()
  const library = useWorkspace((state) => state.tools)
  const placement = profilePlacement(fixtures.state)
  const kit = kitForSetup(placement)
  const machine = kit.probing
  const probe = library.find((tool) => probeProfile(tool)?.touch === "xyz")
  const profile = probe ? probeProfile(probe) : null
  const strategy =
    machine && profile
      ? strategiesFor(machine, profile).find(({ task }) => task === "origin")
      : undefined
  let reason: string | null = null
  if (!machine) reason = `The ${kit.name} has no probing.`
  else if (!probe) reason = "The tool library has no 3D probe."
  else if (!strategy) reason = `The ${kit.name} cannot find a corner with it.`
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
                  routine: "inside-corner",
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
