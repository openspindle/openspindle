import { compilePlate } from "@/domain/compile/compile"
import { operationSubject, toolSubject } from "@/domain/diagnostics"
import type { Diagnostic } from "@/domain/diagnostics"
import { kitForPlate } from "@/domain/fixtures/catalog"
import { operationPluginId } from "@/domain/operations/operation"
import { PLUGIN_CHAIN } from "@/domain/operations/plugin-rules"
import type { Plate } from "@/domain/plate/plate"
import { failureDiagnostic } from "@/domain/rules/diagnostics"
import { rulesOf } from "@/domain/rules/rules"
import type {
  InstalledPlugin,
  OperationRuleSubject,
  StageRule,
} from "@/domain/rules/stages"
import { toolRuleSubjects } from "@/domain/tools/tool-table"
import type { Tool } from "@/domain/tools/tool"
import { runRules } from "@/machine/contract"
import { isPluginUsable } from "@/platform/contract/plugin-rpc"
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

/** The installed plugins as the plugin rules read them, once per list. */
const installed = new WeakMap<
  readonly PluginSummary[],
  readonly InstalledPlugin[]
>()

function installedPlugins(
  plugins: readonly PluginSummary[]
): readonly InstalledPlugin[] {
  let found = installed.get(plugins)
  if (!found) {
    found = plugins.map((plugin) => ({
      id: plugin.id,
      name: plugin.manifest.name,
      version: plugin.version,
      incompatible: plugin.incompatible,
      usable: isPluginUsable(plugin),
    }))
    installed.set(plugins, found)
  }
  return found
}

/** Each plate's latest diagnostics, with the context they were gathered in. */
const gathered = new WeakMap<
  Plate,
  DiagnosticContext & { readonly diagnostics: readonly Diagnostic[] }
>()

/**
 * Everything that blocks or qualifies Run and export for a plate, in one list: what compiling
 * reports, then the operations' advice, the tool table's failures and the plugins' failures. A
 * plate without operations is not a problem to report: Run and export refuse it on their own.
 * Kept per plate object while the tools and plugins stay the same, so unchanged plates gather
 * nothing again.
 */
export function plateDiagnostics(
  plate: Plate,
  context: DiagnosticContext
): readonly Diagnostic[] {
  const saved = gathered.get(plate)
  if (saved?.tools === context.tools && saved.plugins === context.plugins)
    return saved.diagnostics
  const compiled = compilePlate(plate)
  const kit = kitForPlate(plate)
  const plugins = context.plugins && installedPlugins(context.plugins)
  const operations = plate.operations.map(
    (operation): OperationRuleSubject => ({
      operation,
      plate,
      kit,
      compiled,
      plugins,
    })
  )
  const run = { machine: kit.id }
  const operationFailures = (
    rules: readonly StageRule<"operation">[]
  ): Diagnostic[] =>
    runRules(rules, operations, run).map((failure) =>
      failureDiagnostic(failure, operationSubject(failure.first.operation.id))
    )
  const operationRules = rulesOf("operation")
  const diagnostics = [
    ...compiled.diagnostics,
    ...operationFailures(
      operationRules.filter((rule) => rule.chain !== PLUGIN_CHAIN)
    ),
    ...runRules(
      rulesOf("tool"),
      toolRuleSubjects(plate, context.tools),
      run
    ).map((failure) =>
      failureDiagnostic(failure, toolSubject(failure.first.entry.number))
    ),
    ...operationFailures(
      operationRules.filter((rule) => rule.chain === PLUGIN_CHAIN)
    ),
  ]
  gathered.set(plate, {
    tools: context.tools,
    plugins: context.plugins,
    diagnostics,
  })
  return diagnostics
}
