import {
  ArrowDownToDot,
  ArrowDownToLine,
  Axis3d,
  FileCode2,
  LandPlot,
  Puzzle,
  SquareDashed,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { ToolbarItem } from "@openspindle/plugin-core"
import type { Operation, ProbingSource } from "@/domain/operations/operation"
import { GENERIC_STRATEGIES } from "@/domain/probing/strategies"
import type { ProbingTask } from "@/domain/probing/strategy"
import type { PluginSummary } from "@/platform/contract/plugin-rpc"
import { useInstalledPlugins } from "@/platform/plugins"
import { TOOLBAR_ICONS } from "./plugin-sources"

/** The probing operations' icons by task. */
const PROBING_ICONS: Record<ProbingTask, LucideIcon> = {
  grid: LandPlot,
  "touch-off": ArrowDownToLine,
  outline: SquareDashed,
  origin: Axis3d,
}

/**
 * A probing strategy's icon, wherever it is offered or its operations are listed: its task's,
 * and for a machine's own touch-off, such as the Z1 firmware's Z probe, one apart from Surface
 * touch.
 */
export function probingIcon({
  task,
  strategy,
}: Pick<ProbingSource, "task" | "strategy">): LucideIcon {
  const generic = GENERIC_STRATEGIES.some((item) => item.id === strategy)
  return task === "touch-off" && !generic ? ArrowDownToDot : PROBING_ICONS[task]
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
 * An operation's icon: a program file's, its probing strategy's, or the one its plugin's toolbar
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
    case "probing":
      return probingIcon(source)
  }
}

/** `operationIcon` among the installed plugins. */
export function useOperationIcon(): (operation: Operation) => LucideIcon {
  const plugins = useInstalledPlugins().data
  return (operation) => operationIcon(operation, plugins)
}
