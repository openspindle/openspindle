import {
  ArrowDownToLine,
  Axis3d,
  FileCode2,
  LandPlot,
  Puzzle,
  SquareDashed,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { ToolbarItem } from "@openspindle/plugin-core"
import type { ProbingSourceKind } from "@/domain/operations/kinds"
import type { Operation } from "@/domain/operations/operation"
import type { PluginSummary } from "@/platform/contract/plugin-rpc"
import { useInstalledPlugins } from "@/platform/plugins"
import { TOOLBAR_ICONS } from "./plugin-sources"

/** The probing operations' icons, wherever they are offered or listed. */
export const PROBING_ICONS: Record<ProbingSourceKind, LucideIcon> = {
  "auto-level": LandPlot,
  "auto-z-height": ArrowDownToLine,
  "auto-scan": SquareDashed,
  "probe-3d": Axis3d,
}

/** The icon of the plugin's toolbar item for what made an operation; the plugin icon without one. */
function pluginIcon(
  plugins: readonly PluginSummary[] | undefined,
  pluginId: string,
  made: (item: ToolbarItem) => boolean
): LucideIcon {
  const item = plugins
    ?.find((plugin) => plugin.id === pluginId)
    ?.manifest.toolbar?.find(made)
  return item ? TOOLBAR_ICONS[item.icon] : Puzzle
}

/**
 * An operation's icon: a program file's, its probing kind's, or the one its plugin's toolbar
 * gives the template program or importer that made it.
 */
export function operationIcon(
  operation: Operation,
  plugins: readonly PluginSummary[] | undefined
): LucideIcon {
  const { source } = operation
  switch (source.kind) {
    case "file":
      return FileCode2
    case "template":
      return pluginIcon(
        plugins,
        source.pluginId,
        (item) => item.programId === source.programId
      )
    case "plugin":
      return pluginIcon(
        plugins,
        source.pluginId,
        (item) => item.viewId !== undefined
      )
    default:
      return PROBING_ICONS[source.kind]
  }
}

/** `operationIcon` among the installed plugins. */
export function useOperationIcon(): (operation: Operation) => LucideIcon {
  const plugins = useInstalledPlugins().data
  return (operation) => operationIcon(operation, plugins)
}
