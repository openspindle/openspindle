import { createDefaultStockLibrary } from "@/domain/stock/catalog"
import { loadStarterTools } from "@/app/tools/tool-catalog-store"
import { defaultDesignRules } from "@/domain/design-rules/rules"
import { createPlate, createPlateSetup } from "@/domain/plate/plate"
import type { Plate, PlateSetup } from "@/domain/plate/plate"
import type { WorkspaceLibrary } from "@/domain/workspace/library"
import type { WorkspaceState } from "@/domain/workspace/workspace"
import { newPlate } from "./import-program"
import type { ImportContext, PlatePlacement } from "./import-program"

export const DEFAULT_PROJECT = {
  name: "OpenSpindle project",
  fileName: "OpenSpindle project.stpnc",
} as const

/**
 * The plate a new project starts with: the bed and its fixtures, without stock or operations.
 * It is a placeholder: the first plate of the user's own replaces it, keeping the bed and
 * fixtures set up on it, and the name given to it (`plates.add`).
 */
export function emptyPlate(placement: PlatePlacement): Plate {
  return {
    ...createPlate(
      createPlateSetup({
        stock: null,
        stockSource: "unspecified",
        ...placement,
      })
    ),
    example: true,
  }
}

/** Whether a plate is the empty placeholder a new project starts with. */
export const isEmptyPlaceholder = (plate: Plate) =>
  plate.example && !plate.operations.length

/**
 * What plates that replace the empty plate keep of it: its whole setup (the stock and where it
 * sits, the work origin, fixtures, device and anchors) once stock is set up there.
 */
export const keptSetup = (empty: Plate): PlateSetup | undefined =>
  empty.setup.stock ? empty.setup : undefined

/**
 * The plate operations start in place of the empty plate, with the setup it keeps
 * (`keptSetup`); adding it takes the empty plate's name along. Without stock there, it is a
 * new plate with the context's stock and placement.
 */
export function replacementPlate(
  empty: Plate,
  context: Pick<ImportContext, "stock" | "placement">
): Plate {
  const setup = keptSetup(empty)
  if (!setup) return newPlate(context)
  return createPlate(structuredClone(setup))
}

/**
 * The plate an operation goes to: the selected plate, else one in place of the empty plate, or a
 * new one. One in place of the empty plate keeps the stock set up there, else starts on the
 * library's default stock, as a new plate does; unless the operation needs no `stock`: then the
 * empty plate's setup stays as it is, and a new plate has none.
 */
export function targetPlate(
  selected: Plate | null | undefined,
  context: ImportContext,
  stock: boolean
): Plate {
  if (selected && !selected.example) return selected
  if (stock)
    return selected ? replacementPlate(selected, context) : newPlate(context)
  return createPlate(
    selected
      ? structuredClone(selected.setup)
      : createPlateSetup({
          stock: null,
          stockSource: "unspecified",
          ...context.placement,
        })
  )
}

/** The catalogs' starter tools and the bundled stock library, until the user has their own. */
export async function loadDefaultLibrary(): Promise<WorkspaceLibrary> {
  // A broken catalog asset must not stop the app; the tool library reports it.
  const tools = await loadStarterTools().catch(() => [])
  const stocks = createDefaultStockLibrary()
  return {
    tools,
    stocks,
    defaultToolId: tools.at(0)?.id ?? null,
    defaultStockId: stocks.at(0)?.id ?? null,
  }
}

/** A new project: no plates yet, on the app's libraries, with the default design rules. */
export function newProject(library: WorkspaceLibrary): WorkspaceState {
  return {
    plates: [],
    selectedPlateId: null,
    ...library,
    project: { ...DEFAULT_PROJECT, plugins: [] },
    heightMaps: {},
    designRules: defaultDesignRules(),
  }
}
