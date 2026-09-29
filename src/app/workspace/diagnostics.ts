import { compilePlate } from "@/domain/compile/compile"
import { stockDepthWarnings } from "@/domain/compile/stock-depth"
import { error, operationSubject, warning } from "@/domain/diagnostics"
import type { Diagnostic } from "@/domain/diagnostics"
import { validateOperations } from "@/domain/operations/kinds"
import { operationPluginId } from "@/domain/operations/operation"
import type { Plate } from "@/domain/plate/plate"
import { toolDiagnostics } from "@/domain/tools/tool-table"
import type { Tool } from "@/domain/tools/tool"
import type { PluginSummary } from "@/platform/contract/plugin-rpc"

export type DiagnosticContext = {
  readonly tools: readonly Tool[]
  /** Null while the installed plugins load: nothing is reported about plugins yet. */
  readonly plugins: readonly PluginSummary[] | null
}

/** IDs of plugins that operations on these plates come from but that are not installed. */
export function missingPluginIds(
  plates: readonly Plate[],
  plugins: readonly PluginSummary[]
): string[] {
  const installed = new Set(plugins.map((plugin) => plugin.id))
  const missing = new Set<string>()
  for (const plate of plates)
    for (const operation of plate.operations) {
      const pluginId = operationPluginId(operation)
      if (pluginId !== null && !installed.has(pluginId)) missing.add(pluginId)
    }
  return [...missing]
}

/** Template operations whose plugin changed or disappeared must be updated or reinstalled. */
function pluginDiagnostics(
  plate: Plate,
  plugins: readonly PluginSummary[]
): Diagnostic[] {
  return plate.operations.flatMap((operation): Diagnostic[] => {
    const source = operation.source
    if (source.kind !== "template" && source.kind !== "plugin") return []
    const plugin = plugins.find((item) => item.id === source.pluginId)
    if (!plugin)
      return [
        warning(
          "plugin-missing",
          `"${operation.name}" comes from ${source.pluginId}, which is not installed.`,
          {
            subject: operationSubject(operation.id),
            fix: { kind: "install-plugin", pluginId: source.pluginId },
          }
        ),
      ]
    if (
      source.kind === "template" &&
      plugin.enabled &&
      plugin.version !== source.version
    )
      return [
        error(
          "operation-stale",
          `Update "${operation.name}": ${plugin.manifest.name} changed.`,
          {
            subject: operationSubject(operation.id),
            fix: { kind: "update-operation", operationId: operation.id },
          }
        ),
      ]
    return []
  })
}

/** Each plate's latest diagnostics, with the context they were gathered in. */
const gathered = new WeakMap<
  Plate,
  DiagnosticContext & { readonly diagnostics: readonly Diagnostic[] }
>()

/**
 * Everything that blocks or qualifies Run and export for a plate, in one list. A plate without
 * operations is not a problem to report: Run and export refuse it on their own. Kept per plate
 * object while the tools and plugins stay the same, so unchanged plates gather nothing again.
 */
export function plateDiagnostics(
  plate: Plate,
  context: DiagnosticContext
): readonly Diagnostic[] {
  const saved = gathered.get(plate)
  if (saved?.tools === context.tools && saved.plugins === context.plugins)
    return saved.diagnostics
  const compiled = compilePlate(plate)
  const found = [
    ...compiled.diagnostics,
    ...validateOperations(plate),
    ...stockDepthWarnings(plate, compiled),
    ...toolDiagnostics(plate, context.tools),
  ]
  const diagnostics = context.plugins
    ? [...found, ...pluginDiagnostics(plate, context.plugins)]
    : found
  gathered.set(plate, {
    tools: context.tools,
    plugins: context.plugins,
    diagnostics,
  })
  return diagnostics
}
