import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { useFixtureLibraryStore } from "@/app/fixtures/fixture-context"
import { profilePlacement } from "@/app/fixtures/fixture-library-store"
import { isEmptyPlaceholder, keptSetup } from "@/app/workspace/defaults"
import { describeProblems, readPlates } from "@/app/workspace/import-files"
import type { TransferableOperation } from "@/app/workspace/import-files"
import type {
  ImportContext,
  PlatePlacement,
} from "@/app/workspace/import-program"
import {
  selectedPlate,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import type { PlateSetup } from "@/domain/plate/plate"
import { plural } from "@/domain/primitives"
import { createDefaultStockLibrary } from "@/domain/stock/catalog"

/** Workspace changes that must not interleave (imports, opening and saving projects). */
export const WORKSPACE_MUTATION = ["workspace"] as const
export const workspaceScope = { id: "workspace" }

/** The bed set up on an empty plate, for the plate that replaces it. */
const bedOf = (setup: PlateSetup): PlatePlacement => ({
  fixtures: structuredClone(setup.fixtures),
  deviceId: setup.deviceId,
  anchors: setup.anchors ? structuredClone(setup.anchors) : null,
})

/**
 * What new plates start from: the library, the default stock, and the bed of the empty plate
 * they replace (the plate a new project starts with) or else the selected fixture profile.
 * Once stock is set up on the empty plate, they keep its whole setup (`keptSetup`).
 */
export function useImportContext(): () => ImportContext {
  const workspace = useWorkspaceStore()
  const fixtures = useFixtureLibraryStore()
  return () => {
    const state = workspace.state
    const selected = selectedPlate(state)
    const empty = selected && isEmptyPlaceholder(selected) ? selected : null
    return {
      tools: state.tools,
      stock:
        state.stocks.find((stock) => stock.id === state.defaultStockId) ??
        state.stocks.at(0) ??
        createDefaultStockLibrary()[0],
      placement: empty ? bedOf(empty.setup) : profilePlacement(fixtures.state),
      setup: empty ? keptSetup(empty) : undefined,
    }
  }
}

/** Imports NC files as new plates and selects the first. */
export function useImportPlates() {
  const workspace = useWorkspaceStore()
  const context = useImportContext()
  return useMutation({
    mutationKey: [...WORKSPACE_MUTATION, "import"],
    scope: workspaceScope,
    mutationFn: (files: readonly File[]) => readPlates(files, context()),
    onSuccess: ({ plates, problems }) => {
      if (plates.length) {
        const added = workspace.dispatch({
          type: "plates.add",
          plates,
          select: true,
        })
        if (!added.ok) {
          toast.error(added.error)
          return
        }
        toast.success(`Imported ${plural(plates.length, "program")}.`, {
          description: problems.length ? describeProblems(problems) : undefined,
        })
        return
      }
      if (problems.length) toast.error(describeProblems(problems))
    },
    onError: (error) => toast.error(error.message),
  })
}

/** Adds operations to a plate in one change: a refusal, such as the 100-operation limit, adds none. */
export function addOperations(
  dispatch: ReturnType<typeof useWorkspaceStore>["dispatch"],
  plateId: string,
  operations: readonly TransferableOperation[]
): string | null {
  if (!operations.length) return null
  const result = dispatch({
    type: "batch",
    commands: operations.map(({ operation, preferredTools }) => ({
      type: "operation.add" as const,
      plateId,
      operation,
      preferredTools,
    })),
  })
  return result.ok ? null : result.error
}
