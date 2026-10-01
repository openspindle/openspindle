import { kindOf } from "@/domain/operations/kinds"
import { operationPluginId } from "@/domain/operations/operation"
import type { Operation } from "@/domain/operations/operation"
import { probingLabel } from "@/domain/probing/strategies"
import type { PluginSummary } from "@/platform/contract/plugin-rpc"
import { useInstalledPlugins } from "@/platform/plugins"

/**
 * What kind of operation this is: a probing operation goes by its strategy, a plugin's operations
 * and programs by the plugin's name while it is installed, the others by their kind's label.
 */
export function operationKindLabel(
  operation: Operation,
  plugins: readonly PluginSummary[] | undefined
): string {
  const { source } = operation
  if (source.kind === "probing") return probingLabel({ source })
  const pluginId = operationPluginId(operation)
  const plugin = plugins?.find((item) => item.id === pluginId)
  return plugin?.manifest.name ?? kindOf(operation).label
}

/** `operationKindLabel` among the installed plugins. */
export function useOperationKindLabel(operation: Operation): string {
  return operationKindLabel(operation, useInstalledPlugins().data)
}
