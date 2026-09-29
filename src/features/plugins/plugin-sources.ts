import { CircuitBoard, Crosshair, Grid2X2, Route, Wrench } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type {
  ProcessProgram,
  ToolbarIcon,
  ToolbarItem,
  ViewDeclaration,
} from "@openspindle/plugin-core"
import { templatePrograms } from "@/app/workspace/templates"
import { isPluginUsable } from "@/platform/contract/plugin-rpc"
import type { PluginSummary } from "@/platform/contract/plugin-rpc"

/** The icons toolbar items may name; plugins cannot bring images of their own. */
export const TOOLBAR_ICONS: Record<ToolbarIcon, LucideIcon> = {
  probe: Crosshair,
  grid: Grid2X2,
  path: Route,
  tool: Wrench,
  pcb: CircuitBoard,
}

/** What enabled plugins add to Add operation: template programs and importer views. */
export type PluginSource =
  | {
      readonly kind: "program"
      readonly plugin: PluginSummary
      readonly program: ProcessProgram
    }
  | {
      readonly kind: "view"
      readonly plugin: PluginSummary
      readonly view: ViewDeclaration
    }

/** Opens one plugin source directly, from a toolbar item or a menu. */
export type PluginSourceRef =
  | { readonly pluginId: string; readonly programId: string }
  | { readonly pluginId: string; readonly viewId: string }

export const importerViews = (plugin: PluginSummary): ViewDeclaration[] =>
  plugin.manifest.ui?.views.filter(
    (view) => view.slot === "process.importer"
  ) ?? []

export function pluginSources(
  plugins: readonly PluginSummary[]
): PluginSource[] {
  return [
    ...templatePrograms(plugins).map(({ plugin, program }): PluginSource => ({
      kind: "program",
      plugin,
      program,
    })),
    ...plugins.filter(isPluginUsable).flatMap((plugin) =>
      importerViews(plugin).map((view): PluginSource => ({
        kind: "view",
        plugin,
        view,
      }))
    ),
  ]
}

export const sourceKey = (source: PluginSource) =>
  source.kind === "program"
    ? `${source.plugin.id}/program/${source.program.id}`
    : `${source.plugin.id}/view/${source.view.id}`

/** The plugin a source comes from and what it does: its program's description, or the plugin's. */
export const sourceDescription = (source: PluginSource) =>
  `${source.plugin.manifest.name} · ${source.kind === "program" ? source.program.description : source.plugin.manifest.description}`

export function findSource(
  sources: readonly PluginSource[],
  ref: PluginSourceRef
): PluginSource | undefined {
  return sources.find((source) => {
    if (source.plugin.id !== ref.pluginId) return false
    if (source.kind === "program")
      return "programId" in ref && source.program.id === ref.programId
    return "viewId" in ref && source.view.id === ref.viewId
  })
}

/** Toolbar items of enabled plugins whose program or importer view is available. */
export function toolbarItems(
  plugins: readonly PluginSummary[]
): { readonly item: ToolbarItem; readonly source: PluginSource }[] {
  const sources = pluginSources(plugins)
  return plugins.flatMap((plugin) =>
    (plugin.manifest.toolbar ?? []).flatMap((item) => {
      const ref = sourceRef(plugin.id, item)
      const source = ref ? findSource(sources, ref) : undefined
      return source ? [{ item, source }] : []
    })
  )
}

function sourceRef(
  pluginId: string,
  item: ToolbarItem
): PluginSourceRef | null {
  if (item.programId !== undefined)
    return { pluginId, programId: item.programId }
  if (item.viewId !== undefined) return { pluginId, viewId: item.viewId }
  return null
}

/** The reference that reopens a source. */
export const sourceRefOf = (source: PluginSource): PluginSourceRef =>
  source.kind === "program"
    ? { pluginId: source.plugin.id, programId: source.program.id }
    : { pluginId: source.plugin.id, viewId: source.view.id }
