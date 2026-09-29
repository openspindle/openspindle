import { useEffect } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { isPluginUsable } from "@/platform/contract/plugin-rpc"
import type {
  InstallRequest,
  PluginSummary,
} from "@/platform/contract/plugin-rpc"
import { useHost } from "@/platform/host-context"
import { pluginKeys } from "@/platform/plugins"

/** Plugin management runs one change at a time. */
const scope = { id: "plugins" }

/** Refreshes the installed list after a change; the host's change event usually wins. */
function useRefresh() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: pluginKeys.installed })
}

/** Downloads or reads a plugin and stages its review; nothing is installed yet. */
export function usePrepareInstall() {
  const plugins = useHost().plugins
  return useMutation({
    mutationKey: ["plugins", "prepare"],
    scope,
    mutationFn: (request: InstallRequest) => plugins.prepareInstall(request),
  })
}

/** Reads an installed plugin's source again (the repository's latest commit, or its folder). */
export function usePrepareUpdate() {
  const plugins = useHost().plugins
  return useMutation({
    mutationKey: ["plugins", "prepare"],
    scope,
    mutationFn: (pluginId: string) => plugins.prepareUpdate(pluginId),
    onError: (error) => toast.error(error.message),
  })
}

/** Installs exactly what was reviewed. */
export function useConfirmInstall() {
  const plugins = useHost().plugins
  const refresh = useRefresh()
  return useMutation({
    mutationKey: ["plugins", "install"],
    scope,
    mutationFn: (reviewId: string) => plugins.confirmInstall(reviewId),
    onSuccess: (plugin) =>
      toast.success(`${plugin.manifest.name} ${plugin.version} is installed.`),
    onSettled: refresh,
  })
}

/** Drops a staged review; failures only mean it expired already. */
export function useDiscardInstall() {
  const plugins = useHost().plugins
  return useMutation({
    mutationFn: (reviewId: string) => plugins.discardInstall(reviewId),
  })
}

export function useSetPluginEnabled() {
  const plugins = useHost().plugins
  const refresh = useRefresh()
  return useMutation({
    scope,
    mutationFn: ({
      pluginId,
      enabled,
    }: {
      pluginId: string
      enabled: boolean
    }) => plugins.setEnabled(pluginId, enabled),
    onError: (error) => toast.error(error.message),
    onSettled: refresh,
  })
}

export function useRemovePlugin() {
  const plugins = useHost().plugins
  const refresh = useRefresh()
  return useMutation({
    scope,
    mutationFn: (pluginId: string) => plugins.remove(pluginId),
    onError: (error) => toast.error(error.message),
    onSettled: refresh,
  })
}

/** Checks and stores one of a plugin's settings; its companion restarts with it. */
export function useSetPluginSetting() {
  const plugins = useHost().plugins
  const refresh = useRefresh()
  return useMutation({
    scope,
    mutationFn: ({
      pluginId,
      settingId,
      value,
    }: {
      pluginId: string
      settingId: string
      value: string | null
    }) => plugins.setSetting(pluginId, settingId, value),
    onSettled: refresh,
  })
}

/** Chooses a setting's program in a native dialog, then stores it as useSetPluginSetting does. */
export function useChoosePluginSetting() {
  const plugins = useHost().plugins
  const refresh = useRefresh()
  return useMutation({
    scope,
    mutationFn: ({
      pluginId,
      settingId,
    }: {
      pluginId: string
      settingId: string
    }) => plugins.chooseSetting(pluginId, settingId),
    onSettled: refresh,
  })
}

export function useRestartCompanion() {
  const companions = useHost().plugins.companions
  return useMutation({
    mutationFn: (pluginId: string) => companions.restart(pluginId),
    onError: (error) => toast.error(error.message),
  })
}

/** Runs the companion's own setup, such as installing its dependencies. */
export function useCompanionSetup() {
  const companions = useHost().plugins.companions
  return useMutation({
    mutationFn: (pluginId: string) => companions.setup(pluginId),
    onSuccess: (health) => {
      if (health.status === "ready") toast.success("The companion is ready.")
      else if (health.message) toast.warning(health.message)
    },
    onError: (error) => toast.error(error.message),
  })
}

/**
 * Holds an enabled plugin's companion while its card shows, as an open view does: an on-view
 * companion starts, so the card shows what it reports. Its status arrives with the plugin
 * list.
 */
export function useHoldCompanion(plugin: PluginSummary) {
  const services = useHost().plugins.services
  const holds = isPluginUsable(plugin) && plugin.companion !== null
  useEffect(() => {
    if (!holds) return
    return services.subscribeCompanion(plugin.id, () => undefined)
  }, [services, plugin.id, holds])
}

/** The companion's recent log lines (lifecycle, its own logs, stderr). */
export function useCompanionLogs(pluginId: string, enabled: boolean) {
  const companions = useHost().plugins.companions
  return useQuery({
    queryKey: pluginKeys.companionLogs(pluginId),
    queryFn: () => companions.logs(pluginId),
    enabled,
  })
}
