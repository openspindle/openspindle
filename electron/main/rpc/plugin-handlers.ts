import type { Handlers } from "@openspindle/rpc"
import type { PluginRpcContract } from "../../../src/platform/contract/plugin-rpc"
import type { PluginPlatform } from "../plugins/platform"
import { machine, machineRpcError } from "./machine-errors"

/**
 * Serves the plugin fragment of the host contract. The app names the plugin; main looks
 * up its record, so grants always come from what was reviewed at install.
 */
export function createPluginHandlers(
  platform: PluginPlatform
): Handlers<PluginRpcContract> {
  const { registry, installer } = platform
  /** The plugin's machine principal; the gateway refuses what it was not granted. */
  const gateway = async (pluginId: string) => {
    await platform.ready
    return platform.gateway(registry.requireEnabled(pluginId))
  }
  const companions = async () => {
    await platform.ready
    return platform.requireCompanions()
  }
  return {
    methods: {
      "plugins.list": async () => {
        await platform.ready
        return platform.summaries()
      },
      "plugins.prepareInstall": (request) => installer.prepare(request),
      "plugins.prepareUpdate": async ({ pluginId }) => {
        await platform.ready
        return installer.prepareUpdate(registry.require(pluginId))
      },
      "plugins.confirmInstall": ({ reviewId }) =>
        platform.confirmInstall(reviewId),
      "plugins.discardInstall": async ({ reviewId }) => {
        await installer.discard(reviewId)
        return null
      },
      "plugins.setEnabled": ({ pluginId, enabled }) =>
        platform.setEnabled(pluginId, enabled),
      "plugins.remove": async ({ pluginId }) => {
        await platform.remove(pluginId)
        return null
      },
      "plugins.setSetting": ({ pluginId, settingId, value }) =>
        platform.setSetting(pluginId, settingId, value),
      "plugins.chooseSetting": async ({ pluginId, settingId }) => {
        const plugin = await platform.chooseSetting(pluginId, settingId)
        return plugin ? { status: "chosen", plugin } : { status: "canceled" }
      },
      "plugins.readBundle": ({ pluginId }) => platform.readBundle(pluginId),
      "plugins.renderProgram": ({ pluginId, programId, values }) =>
        platform.renderProgram(pluginId, programId, values),
      "plugins.companion.status": async ({ pluginId }) =>
        (await companions()).status(pluginId),
      "plugins.companion.logs": async ({ pluginId }) =>
        (await companions()).logs(pluginId),
      "plugins.companion.setup": async ({ pluginId }, { signal }) =>
        (await companions()).setup(pluginId, signal),
      "plugins.companion.restart": async ({ pluginId }) =>
        (await companions()).restart(pluginId),
      "plugins.companion.call": async (
        { pluginId, method, params },
        { signal }
      ) => (await companions()).invoke(pluginId, method, params, signal),
      "plugins.machine.snapshot": async ({ pluginId }) => {
        const principal = await gateway(pluginId)
        return machine(() => principal.snapshot())
      },
      "plugins.machine.readAnchors": async ({ pluginId }, { signal }) => {
        const principal = await gateway(pluginId)
        return machine(() => principal.readAnchors(signal))
      },
      "plugins.machine.readHeightMap": async ({ pluginId }, { signal }) => {
        const principal = await gateway(pluginId)
        return machine(() => principal.readHeightMap(signal))
      },
      "plugins.machine.accessory": async ({ pluginId, accessory, enabled }) => {
        const principal = await gateway(pluginId)
        return machine(() => principal.execute({ type: accessory, enabled }))
      },
    },
    events: {
      "plugins.changed": (_params, emit) => {
        const publish = () => emit(platform.summaries())
        // A registry that did not load has logged why, and plugins.list reports it.
        void platform.ready.then(publish, () => undefined)
        return platform.subscribe(publish)
      },
      // Subscriptions start synchronously; the app lists plugins (and so waits for the
      // registry) before any view subscribes.
      "plugins.machine.changed": ({ pluginId }, emit) => {
        try {
          return platform
            .gateway(registry.requireEnabled(pluginId))
            .subscribe(emit)
        } catch (error) {
          throw machineRpcError(error)
        }
      },
      "plugins.companion.events": ({ pluginId }, emit) =>
        platform.requireCompanions().hold(pluginId, emit),
    },
  }
}
