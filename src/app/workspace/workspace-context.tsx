import { useMemo } from "react"
import { useSelector } from "@tanstack/react-store"
import { compilePlate } from "@/domain/compile/compile"
import type { CompiledPlate } from "@/domain/compile/compile"
import type { Plate } from "@/domain/plate/plate"
import type { WorkspaceState } from "@/domain/workspace/workspace"
import { useAppStores } from "../stores"
import type { WorkspaceStore } from "./store"

export const useWorkspaceStore = (): WorkspaceStore => useAppStores().workspace

/** Subscribes to a slice of the workspace; components re-render only when it changes. */
export function useWorkspace<TSelected>(
  selector: (state: WorkspaceState) => TSelected
): TSelected {
  return useSelector(useWorkspaceStore().store, selector)
}

export const useDispatch = () => useWorkspaceStore().dispatch

export const selectedPlate = (state: WorkspaceState): Plate | null =>
  state.plates.find((plate) => plate.id === state.selectedPlateId) ??
  state.plates.at(0) ??
  null

export function useSelectedPlate(): Plate | null {
  return useWorkspace(selectedPlate)
}

/** A plate's place in the workspace, from 0, which numbers it ("Plate N"); -1 when absent. */
export const plateIndex = (
  state: WorkspaceState,
  plateId: string | undefined
) => state.plates.findIndex((plate) => plate.id === plateId)

export function usePlateIndex(plateId: string | undefined): number {
  return useWorkspace((state) => plateIndex(state, plateId))
}

/**
 * Compiled program for a plate with the workspace's tool library; cached per plate object by
 * the compiler.
 */
export function useCompiledPlate(plate: Plate | null): CompiledPlate | null {
  const tools = useWorkspace((state) => state.tools)
  return useMemo(
    () => (plate ? compilePlate(plate, tools) : null),
    [plate, tools]
  )
}
