import type { Peer } from "@openspindle/rpc"
import type { HostContract } from "./contract/host-contract"
import type { PluginHost } from "./host"

/**
 * The desktop registry over the app's host connection. Main looks up every plugin's record
 * itself, so machine and companion calls always run under the grants reviewed at install.
 */
export function electronPlugins(peer: Peer<HostContract>): PluginHost {
  return {
    list: () => peer.call("plugins.list", undefined),
    subscribe: (listener) =>
      peer.subscribe("plugins.changed", undefined, listener),
    prepareInstall: (request) => peer.call("plugins.prepareInstall", request),
    prepareUpdate: (pluginId) =>
      peer.call("plugins.prepareUpdate", { pluginId }),
    confirmInstall: (reviewId) =>
      peer.call("plugins.confirmInstall", { reviewId }),
    discardInstall: async (reviewId) => {
      await peer.call("plugins.discardInstall", { reviewId })
    },
    setEnabled: (pluginId, enabled) =>
      peer.call("plugins.setEnabled", { pluginId, enabled }),
    remove: async (pluginId) => {
      await peer.call("plugins.remove", { pluginId })
    },
    setSetting: (pluginId, settingId, value) =>
      peer.call("plugins.setSetting", { pluginId, settingId, value }),
    chooseSetting: (pluginId, settingId) =>
      peer.call("plugins.chooseSetting", { pluginId, settingId }),
    readBundle: (pluginId) => peer.call("plugins.readBundle", { pluginId }),
    renderProgram: (pluginId, programId, values) =>
      peer.call("plugins.renderProgram", { pluginId, programId, values }),
    companions: {
      logs: (pluginId) => peer.call("plugins.companion.logs", { pluginId }),
      restart: (pluginId) =>
        peer.call("plugins.companion.restart", { pluginId }),
      setup: (pluginId) => peer.call("plugins.companion.setup", { pluginId }),
    },
    services: {
      machineSnapshot: (pluginId) =>
        peer.call("plugins.machine.snapshot", { pluginId }),
      readAnchors: (pluginId, signal) =>
        peer.call("plugins.machine.readAnchors", { pluginId }, { signal }),
      readHeightMap: (pluginId, signal) =>
        peer.call("plugins.machine.readHeightMap", { pluginId }, { signal }),
      machineAccessory: (pluginId, request) =>
        peer.call("plugins.machine.accessory", { pluginId, ...request }),
      subscribeMachine: (pluginId, listener) =>
        peer.subscribe("plugins.machine.changed", { pluginId }, listener),
      companionCall: (pluginId, request, signal) =>
        peer.call(
          "plugins.companion.call",
          { pluginId, ...request },
          { signal }
        ),
      companionStatus: (pluginId) =>
        peer.call("plugins.companion.status", { pluginId }),
      companionSetup: (pluginId, signal) =>
        peer.call("plugins.companion.setup", { pluginId }, { signal }),
      subscribeCompanion: (pluginId, listener) =>
        peer.subscribe("plugins.companion.events", { pluginId }, listener),
    },
  }
}
