import { readdir } from "node:fs/promises"
import path from "node:path"
import { dialog } from "electron"
import type { BrowserWindow, OpenDialogOptions } from "electron"
import { RpcError } from "@openspindle/rpc"
import {
  PROCESS_PLUGIN_LIMITS,
  isMachineCapability,
  renderProgram,
} from "@openspindle/plugin-core"
import type {
  InstalledPluginRecord,
  PluginFetch,
  ProcessParameterValues,
} from "@openspindle/plugin-core"
import { nodePlatform } from "@openspindle/plugin-sdk/node"
import type { MachineController } from "../../../src/machine/core/controller.ts"
import { MachineGateway } from "../../../src/machine/core/gateway.ts"
import { pluginSummary } from "../../../src/platform/contract/plugin-rpc"
import type {
  PluginBundle,
  PluginSummary,
} from "../../../src/platform/contract/plugin-rpc"
import { log } from "../diagnostics/log"
import { CompanionManager } from "./companions"
import { PluginInstaller } from "./installer"
import { PluginRegistry } from "./registry"
import { checkedSetting, declaredSetting } from "./settings"

const VIEW_BUNDLE_BYTES = 4 * 1024 * 1024
const VIEW_STYLES_BYTES = 1024 * 1024

export type PluginPlatformOptions = {
  readonly userData: string
  readonly temp: string
  /** The plugins that come with the app, one package folder each, named by plugin ID. */
  readonly bundled: string
  readonly machine: MachineController
  readonly window: () => BrowserWindow | null
  readonly fetch: PluginFetch
}

/**
 * The desktop plugin platform: installed packages, the install pipeline and companion
 * processes. Every plugin-scoped request is checked against the plugin's record here.
 */
export class PluginPlatform {
  readonly registry: PluginRegistry
  readonly installer: PluginInstaller
  readonly companions: CompanionManager | null
  /** The installed plugins are read, and those that come with the app installed. */
  readonly ready: Promise<void>
  private readonly listeners = new Set<() => void>()
  private dialogOpen = false

  constructor(private readonly options: PluginPlatformOptions) {
    const platform = nodePlatform()
    this.registry = new PluginRegistry(path.join(options.userData, "plugins"))
    this.installer = new PluginInstaller({
      registry: this.registry,
      fetch: options.fetch,
      chooseFolder: () => this.chooseFolder(),
      // The running companion must not outlive the files it was started from.
      beforeCommit: (pluginId) =>
        this.companions?.stop(pluginId, "Stopped for an update.") ??
        Promise.resolve(),
      platform,
    })
    this.companions = platform
      ? new CompanionManager({
          registry: this.registry,
          platform,
          dataRoot: path.join(options.userData, "plugin-data"),
          tmpRoot: path.join(options.temp, "openspindle-plugins"),
          gateway: (record) => this.gateway(record),
          onStatus: () => this.changed(),
        })
      : null
    this.registry.subscribe(() => this.changed())
    this.ready = this.registry.ready.then(() => this.installBundled())
    // Every caller awaits `ready` and reports its failure, which the registry logged.
    this.ready.catch(() => undefined)
  }

  /** A plugin's machine principal: its own grants, re-checked by the gateway. */
  gateway(record: InstalledPluginRecord): MachineGateway {
    return new MachineGateway(this.options.machine, {
      kind: "plugin",
      pluginId: record.id,
      grants: new Set(record.grants.filter(isMachineCapability)),
    })
  }

  requireCompanions(): CompanionManager {
    if (!this.companions)
      throw new RpcError(
        "UNAVAILABLE",
        "Plugin companions are not supported on this computer."
      )
    return this.companions
  }

  summaries(): PluginSummary[] {
    return this.registry
      .list()
      .map((record) =>
        pluginSummary(record, this.companions?.statusOf(record) ?? null)
      )
  }

  summary(pluginId: string): PluginSummary {
    const summary = this.summaries().find((item) => item.id === pluginId)
    if (!summary)
      throw new RpcError("NOT_FOUND", "This plugin is not installed.")
    return summary
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async confirmInstall(reviewId: string): Promise<PluginSummary> {
    await this.ready
    const record = await this.installer.confirm(reviewId)
    return this.summary(record.id)
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<PluginSummary> {
    await this.ready
    // Locked for the whole sequence: a start beginning between the stop and the record
    // actually flipping to disabled would otherwise bring the companion right back.
    if (!enabled)
      await this.registry.withLock(pluginId, async () => {
        await this.companions?.stop(pluginId, "Stopped: disabled.")
        await this.registry.setEnabled(pluginId, enabled)
      })
    else await this.registry.setEnabled(pluginId, enabled)
    return this.summary(pluginId)
  }

  async remove(pluginId: string): Promise<void> {
    await this.ready
    const record = this.registry.require(pluginId)
    if (record.source.kind === "bundled")
      throw new RpcError(
        "INVALID_PARAMS",
        `${record.manifest.name} comes with OpenSpindle. Disable it instead.`
      )
    await this.uninstall(pluginId)
  }

  /**
   * Stores one of the plugin's settings once checked, or clears it (null). An enabled
   * companion restarts with it, so its health reflects the new value.
   */
  async setSetting(
    pluginId: string,
    settingId: string,
    value: string | null
  ): Promise<PluginSummary> {
    await this.ready
    const record = this.registry.require(pluginId)
    const setting = declaredSetting(record, settingId)
    await this.registry.setSetting(
      pluginId,
      settingId,
      value === null ? null : await checkedSetting(setting, value)
    )
    if (record.enabled && record.manifest.companion)
      // A companion that cannot start says why in its status.
      await this.companions?.restart(pluginId).catch(() => undefined)
    return this.summary(pluginId)
  }

  /** Asks for a setting's program with a native dialog, then stores it; null when cancelled. */
  async chooseSetting(
    pluginId: string,
    settingId: string
  ): Promise<PluginSummary | null> {
    await this.ready
    const record = this.registry.require(pluginId)
    const setting = declaredSetting(record, settingId)
    const current = record.settings[settingId]
    const file = await this.openDialog({
      title: `Choose ${setting.label}`,
      buttonLabel: "Choose",
      // A link (such as Homebrew's) stays the path, as it does when typed.
      properties: ["openFile", "showHiddenFiles", "noResolveAliases"],
      ...(current === undefined ? {} : { defaultPath: current }),
    })
    return file === null ? null : this.setSetting(pluginId, settingId, file)
  }

  /** The view bundle a frame receives as text, verified against the inventory. */
  async readBundle(pluginId: string): Promise<PluginBundle> {
    await this.ready
    const record = this.registry.requireEnabled(pluginId)
    const ui = record.manifest.ui
    if (!ui)
      throw new RpcError("NOT_FOUND", `${record.manifest.name} has no views.`)
    const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
    const script = decode(
      await this.registry.readVerified(record, ui.entry, VIEW_BUNDLE_BYTES)
    )
    const styles = ui.styles
      ? decode(
          await this.registry.readVerified(record, ui.styles, VIEW_STYLES_BYTES)
        )
      : null
    return {
      plugin: {
        id: record.id,
        name: record.manifest.name,
        version: record.version,
        grants: record.grants,
        companion: !!record.manifest.companion,
      },
      views: ui.views,
      script,
      styles,
    }
  }

  /** Generates a template program from the installed, verified template file. */
  async renderProgram(
    pluginId: string,
    programId: string,
    values: ProcessParameterValues
  ): Promise<{ name: string; source: string }> {
    await this.ready
    const record = this.registry.requireEnabled(pluginId)
    const program = record.manifest.programs.find(
      (item) => item.id === programId
    )
    if (!program)
      throw new RpcError("NOT_FOUND", "This plugin has no such program.")
    const template = new TextDecoder().decode(
      await this.registry.readVerified(
        record,
        program.file,
        PROCESS_PLUGIN_LIMITS.sourceBytes
      )
    )
    return renderProgram(program, template, values)
  }

  /** Stops companions synchronously; the app is quitting. */
  dispose() {
    this.companions?.killAll()
    void this.installer.dispose()
  }

  private changed() {
    for (const listener of this.listeners) listener()
  }

  /** Stops and forgets the companion, then removes the package. */
  private async uninstall(pluginId: string) {
    // See setEnabled: locked so a start cannot land between forgetting the companion and
    // the record actually being removed.
    await this.registry.withLock(pluginId, async () => {
      await this.companions?.forget(pluginId)
      await this.registry.remove(pluginId)
    })
  }

  /**
   * Installs the plugins that come with the app, or brings them up to date, and removes
   * those it no longer comes with. One that fails to install is logged and kept as it was
   * (its folder is named by its ID); the others and the installed plugins are unaffected.
   */
  private async installBundled() {
    let folders: string[]
    try {
      folders = (await readdir(this.options.bundled, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch (error) {
      log.error(
        "The plugins that come with OpenSpindle could not be read",
        error
      )
      return
    }
    const shipped = new Set<string>()
    for (const folder of folders)
      shipped.add(
        await this.installer
          .installBundled(path.join(this.options.bundled, folder))
          .catch((error: unknown) => {
            log.error(
              `The ${folder} plugin that comes with OpenSpindle could not be installed`,
              error
            )
            return folder
          })
      )
    for (const record of this.registry.list())
      if (record.source.kind === "bundled" && !shipped.has(record.id))
        await this.uninstall(record.id).catch((error: unknown) => {
          log.error(
            `The retired ${record.id} plugin could not be removed`,
            error
          )
        })
  }

  /** One native dialog at a time; null when the user cancels. */
  private async openDialog(options: OpenDialogOptions): Promise<string | null> {
    if (this.dialogOpen) throw new RpcError("BUSY", "A dialog is already open.")
    this.dialogOpen = true
    try {
      const window = this.options.window()
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths.at(0) ?? null)
    } finally {
      this.dialogOpen = false
    }
  }

  private chooseFolder(): Promise<string | null> {
    return this.openDialog({
      title: "Choose a plugin folder (development)",
      buttonLabel: "Install",
      properties: ["openDirectory"],
    })
  }
}
