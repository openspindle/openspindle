import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { useFixtureLibraryStore } from "@/app/fixtures/fixture-context"
import { projectPlacement } from "@/app/fixtures/plate-profile"
import {
  isEmptyPlaceholder,
  keptSetup,
  targetPlate,
} from "@/app/workspace/defaults"
import { describeProblems } from "@/app/workspace/import-files"
import type { TransferableOperation } from "@/app/workspace/import-files"
import {
  AS_IS,
  asksAbout,
  describedPlate,
  planImport,
  plannedOperations,
  programName,
  updatedNc,
} from "@/app/workspace/import-plan"
import type {
  ImportPlan,
  ImportTarget,
  ProgramAnswer,
} from "@/app/workspace/import-plan"
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
import type {
  WorkspaceCommand,
  WorkspaceState,
} from "@/domain/workspace/workspace"
import { DEFAULT_KIT, kitForPlate } from "@/domain/fixtures/catalog"
import type { FixtureKit } from "@/domain/fixtures/fixture-kit"
import { clearSectionSelection } from "@/features/prepare/selection"
import { openDialog } from "./dialogs"
import { createDefaultStockLibrary } from "@/domain/stock/catalog"

/** Workspace changes that must not interleave (imports, opening and saving projects). */
export const WORKSPACE_MUTATION = ["workspace"] as const
export const workspaceScope = { id: "workspace" }

/** The bed set up on an empty plate, for the plate that replaces it. */
const bedOf = (setup: PlateSetup): PlatePlacement => ({
  fixtures: structuredClone(setup.fixtures),
  deviceId: setup.deviceId,
  bedSetupId: setup.bedSetupId,
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
      placement: empty
        ? bedOf(empty.setup)
        : projectPlacement(state, fixtures.state),
      fixtureProfiles: fixtures.state.profiles,
      fixtureDefinitions: fixtures.state.definitions,
      setup: empty ? keptSetup(empty) : undefined,
    }
  }
}

/** What an import added, in a sentence: "Added 2 operations." */
function importedText(operations: number, plates: number): string {
  if (!plates) return `Added ${plural(operations, "operation")}.`
  if (!operations) return `Imported ${plural(plates, "plate")}.`
  return `Added ${plural(operations, "operation")} and imported ${plural(plates, "plate")}.`
}

/** Where imported programs go, and how each is imported, in the order of the plan's programs. */
export type ImportAnswers = {
  /** The plate they go to; null for a new plate. */
  readonly plateId: string | null
  readonly programs: readonly ProgramAnswer[]
}

/** The machine imported programs are read for: the selected plate's. */
export function importKit(state: WorkspaceState): FixtureKit {
  const plate = selectedPlate(state)
  return plate ? kitForPlate(plate) : DEFAULT_KIT
}

/**
 * Updates an operation from its program as it comes again (a plan whose target is the
 * operation): its NC replaced by the program's, with the issues resolved as before and as
 * answered now, and where it came from kept up to date. Its name and tools stay.
 */
function useApplyUpdate() {
  const workspace = useWorkspaceStore()
  return (
    plan: ImportPlan,
    target: Extract<ImportTarget, { kind: "operation" }>,
    answers: ImportAnswers
  ) => {
    // A program the update could not use leaves only the problem with it.
    const program = plan.programs.at(0)
    const plate = workspace.state.plates.find(
      (item) => item.id === target.plateId
    )
    const operation = plate?.operations.find(
      (item) => item.id === target.operationId
    )
    if (!plate || !operation || operation.source.kind !== "file") {
      toast.error("The operation to update no longer exists.")
      return
    }
    if (!program) {
      toast.error(describeProblems(plan.problems))
      return
    }
    const resolutions = {
      ...target.resolutions,
      ...(answers.programs.at(0) ?? AS_IS).resolutions,
    }
    const nc = updatedNc(program, resolutions, target.part, kitForPlate(plate))
    if (!nc.ok) {
      toast.error(nc.error)
      return
    }
    const result = workspace.dispatch({
      type: "operation.source",
      plateId: plate.id,
      operationId: operation.id,
      source: {
        ...operation.source,
        nc: nc.value,
        origin: program.origin
          ? { ...program.origin, part: target.part, resolutions }
          : operation.source.origin,
      },
      expectedRevision: operation.revision,
    })
    if (!result.ok) toast.error(result.error)
    else if (nc.value === operation.source.nc)
      toast.success(`${operation.name} is up to date.`)
    else toast.success(`Updated ${operation.name}.`)
  }
}

/**
 * Imports planned files as answered, in one change: the programs as operations of the plate
 * chosen, or of a new plate in its place when it is the empty one (`targetPlate`, or the plate
 * the plan starts new ones as), which is then on show; plates exported with their setup as
 * plates of their own, selected when no program came along. A refusal, such as the
 * 100-operation limit, adds none of them. A plan that updates an operation replaces its NC
 * instead.
 */
export function useApplyImport() {
  const workspace = useWorkspaceStore()
  const context = useImportContext()
  const applyUpdate = useApplyUpdate()
  return (plan: ImportPlan, answers: ImportAnswers) => {
    const { target } = plan
    if (target.kind === "operation") {
      applyUpdate(plan, target, answers)
      return
    }
    const imports = target.numberedTools
      ? context()
      : { ...context(), numberedTools: false }
    const chosen =
      workspace.state.plates.find((plate) => plate.id === answers.plateId) ??
      null
    // A new plate, or one in place of the empty plate, is set up as the first program describes.
    const setUp = chosen?.example
      ? { ...imports, placement: bedOf(chosen.setup), setup: keptSetup(chosen) }
      : imports
    const into =
      chosen && !chosen.example
        ? chosen
        : (target.newPlate ??
          describedPlate(plan, setUp) ??
          targetPlate(chosen, imports, true))
    const kit = kitForPlate(into)
    const problems = [...plan.problems]
    const operations: TransferableOperation[] = []
    plan.programs.forEach((program, index) => {
      const planned = plannedOperations(
        program,
        answers.programs.at(index) ?? AS_IS,
        imports,
        kit
      )
      if (planned.ok) operations.push(...planned.value)
      else problems.push({ fileName: program.fileName, message: planned.error })
    })
    const commands: WorkspaceCommand[] = []
    let targetId: string | null = null
    if (operations.length) {
      targetId = into.id
      // A plate without a name yet takes the first program's.
      const first = plan.programs.at(0)
      const name = into.name || (first ? programName(first) : "")
      if (into !== chosen)
        commands.push({
          type: "plates.add",
          plates: [{ ...into, name }],
          select: true,
        })
      else if (name !== into.name)
        commands.push({ type: "plate.rename", plateId: into.id, name })
      for (const { operation, preferredTools } of operations)
        commands.push({
          type: "operation.add",
          plateId: into.id,
          operation,
          preferredTools,
        })
    }
    if (plan.plates.length)
      commands.push({
        type: "plates.add",
        plates: [...plan.plates],
        select: !operations.length,
      })
    if (commands.length) {
      const result = workspace.dispatch({ type: "batch", commands })
      if (!result.ok) {
        toast.error(
          problems.length
            ? `${result.error} ${describeProblems(problems)}`
            : result.error
        )
        return
      }
      if (targetId !== null && workspace.state.selectedPlateId !== targetId) {
        workspace.dispatch({ type: "plate.select", plateId: targetId })
        clearSectionSelection()
      }
    }
    if (operations.length || plan.plates.length)
      toast.success(importedText(operations.length, plan.plates.length), {
        description: problems.length ? describeProblems(problems) : undefined,
      })
    else if (problems.length) toast.error(describeProblems(problems))
  }
}

/**
 * Imports a plan: at once when there is nothing to ask, into the selected plate or as the update
 * it is, else once the import questionnaire has asked, which then takes the open dialog's place.
 * Returns whether it imported at once.
 */
export function useImportPlanned() {
  const workspace = useWorkspaceStore()
  const applyImport = useApplyImport()
  return (plan: ImportPlan): boolean => {
    if (plan.programs.some((program) => asksAbout(program, plan.target))) {
      openDialog({ kind: "import", plan })
      return false
    }
    applyImport(plan, {
      plateId: workspace.state.selectedPlateId,
      programs: plan.programs.map(() => AS_IS),
    })
    return true
  }
}

/**
 * Imports NC files, read for the selected plate's machine: into the selected plate as they are,
 * unless there is something to ask first (how to split a program, or what to do about what the
 * machine would not run as written), which the import questionnaire asks.
 */
export function useImportFiles() {
  const workspace = useWorkspaceStore()
  const context = useImportContext()
  const importPlanned = useImportPlanned()
  return useMutation({
    mutationKey: [...WORKSPACE_MUTATION, "import"],
    scope: workspaceScope,
    mutationFn: (files: readonly File[]) =>
      planImport(
        files,
        context(),
        importKit(workspace.state),
        workspace.state.ruleSettings
      ),
    onSuccess: (plan) => {
      importPlanned(plan)
    },
    onError: (error) => toast.error(error.message),
  })
}
