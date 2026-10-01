import { kitForPlate } from "@/domain/fixtures/catalog"
import { kindOf } from "@/domain/operations/kinds"
import { operationPluginId } from "@/domain/operations/operation"
import type { Operation } from "@/domain/operations/operation"
import type { Plate } from "@/domain/plate/plate"
import { probingLabel } from "@/features/probing/strategy-stand-ins"
import type { PluginSummary } from "@/platform/contract/plugin-rpc"
import { useInstalledPlugins } from "@/platform/plugins"

/**
 * What kind of operation this is: a probing operation goes by its strategy on the plate's
 * machine, a plugin's operations and programs by the plugin's name while it is installed, the
 * others by their kind's label.
 */
export function operationKindLabel(
  operation: Operation,
  plate: Plate,
  plugins: readonly PluginSummary[] | undefined
): string {
  const { source } = operation
  if (source.kind === "probing")
    return probingLabel(source, kitForPlate(plate).probing)
  const pluginId = operationPluginId(operation)
  const plugin = plugins?.find((item) => item.id === pluginId)
  return plugin?.manifest.name ?? kindOf(operation).label
}

/** `operationKindLabel` among the installed plugins. */
export function useOperationKindLabel(
  operation: Operation,
  plate: Plate
): string {
  return operationKindLabel(operation, plate, useInstalledPlugins().data)
}
