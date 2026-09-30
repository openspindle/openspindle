import type { RuleFixes } from "@/machine/contract"
import { operationSubject } from "../diagnostics"
import type { QuickFix } from "../diagnostics"
import type {
  InstalledPlugin,
  OperationRuleSubject,
  StageRule,
} from "../rules/stages"
import { operationPluginId } from "./operation"

/** The gates of an operation from a plugin: once one fails, the later ones do not apply to it. */
export const PLUGIN_CHAIN = "plugin"

/**
 * The plugin an operation comes from, as installed: undefined when it is not installed; null for
 * an operation that does not come from one, or while the installed plugins load.
 */
function pluginOf({
  operation,
  plugins,
}: OperationRuleSubject): InstalledPlugin | undefined | null {
  const pluginId = operationPluginId(operation)
  if (pluginId === null || !plugins) return null
  return plugins.find((plugin) => plugin.id === pluginId)
}

/** The installed plugin a failing operation comes from, as messages name it. */
const pluginName = (subject: OperationRuleSubject) =>
  pluginOf(subject)?.name ?? ""

/** What an operation's failure offers when its plugin cannot serve it: installing the plugin. */
const installPlugin: RuleFixes<OperationRuleSubject, QuickFix> = {
  offer: ({ first }) => [
    {
      kind: "install-plugin",
      pluginId: operationPluginId(first.operation) ?? "",
    },
  ],
}

const pluginMissing: StageRule<"operation"> = {
  id: "plugin-missing",
  stage: "operation",
  label: "Plugin installed",
  description:
    "An operation from a plugin needs that plugin installed, which updates and generates it.",
  severity: "warning",
  configurable: false,
  chain: PLUGIN_CHAIN,
  test: (subject) => pluginOf(subject) !== undefined,
  explain: ({ first }) => ({
    problem: `"${first.operation.name}" comes from ${operationPluginId(first.operation) ?? ""}, which is not installed.`,
    about: operationSubject(first.operation.id),
  }),
  fixes: installPlugin,
}

const pluginIncompatible: StageRule<"operation"> = {
  id: "plugin-incompatible",
  stage: "operation",
  label: "Plugin compatible",
  description:
    "A plugin that cannot run in this OpenSpindle leaves its operations as they are until it is updated.",
  severity: "warning",
  configurable: false,
  chain: PLUGIN_CHAIN,
  test: (subject) => !pluginOf(subject)?.incompatible,
  explain: ({ first }) => ({
    problem: `"${first.operation.name}" comes from ${pluginName(first)}, which does not work with this version of OpenSpindle.`,
    about: operationSubject(first.operation.id),
  }),
  fixes: installPlugin,
}

const operationStale: StageRule<"operation"> = {
  id: "operation-stale",
  stage: "operation",
  label: "Plugin program current",
  description:
    "A plugin program must be updated once its plugin changes, so that it runs what the plugin now makes.",
  severity: "error",
  configurable: false,
  chain: PLUGIN_CHAIN,
  test: (subject) => {
    const { source } = subject.operation
    const plugin = pluginOf(subject)
    return (
      source.kind !== "template" ||
      !plugin?.usable ||
      plugin.version === source.version
    )
  },
  explain: ({ first }) => ({
    problem: `Update "${first.operation.name}": ${pluginName(first)} changed.`,
    about: operationSubject(first.operation.id),
  }),
  fixes: {
    offer: ({ first }) => [
      { kind: "update-operation", operationId: first.operation.id },
    ],
  },
}

/**
 * What an operation from a plugin needs: its plugin installed and compatible, and, for a plugin
 * program, the version of the plugin that made it. Nothing is reported while the installed
 * plugins load.
 */
export const PLUGIN_RULES: readonly StageRule<"operation">[] = [
  pluginMissing,
  pluginIncompatible,
  operationStale,
]
