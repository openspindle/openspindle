import type { Handlers } from "@openspindle/rpc"
import type { MachineGateway } from "../../../src/machine/core/gateway.ts"
import type { HostContract } from "../../../src/platform/contract/host-contract"
import type { FileService } from "../services/file-service"
import type { FusionService } from "../services/fusion-service"
import type { MenuBus } from "../services/menu-bus"
import type { OpenedFileBus } from "../services/opened-files"
import type { ModelStore } from "../../../src/persistence/models/model-library"
import type { KeptWorkspace } from "../services/kept-workspace"
import type { StorageService } from "../services/storage-service"
import type { UnsavedChanges } from "../services/unsaved-changes"
import type { PluginPlatform } from "../plugins/platform"
import type { Diagnostics } from "../diagnostics/diagnostics"
import { machine } from "./machine-errors"
import { createPluginHandlers } from "./plugin-handlers"

export type HostServices = {
  readonly files: FileService
  readonly fusion: FusionService
  readonly menu: MenuBus
  readonly openedFiles: OpenedFileBus
  readonly machine: MachineGateway
  readonly storage: StorageService
  readonly models: ModelStore
  readonly pluginPlatform: PluginPlatform
  readonly unsaved: UnsavedChanges
  readonly keptWorkspace: KeptWorkspace
  readonly diagnostics: Diagnostics
}

/** Maps every host-contract method and event onto a main-process service. */
export function createHostHandlers(
  services: HostServices
): Handlers<HostContract> {
  const {
    files,
    fusion,
    menu,
    openedFiles,
    storage,
    models,
    unsaved,
    diagnostics,
  } = services
  const gateway = services.machine
  const platform = createPluginHandlers(services.pluginPlatform)
  return {
    methods: {
      "files.open": ({ kind }) => files.open(kind),
      "files.save": (request) => files.save(request),
      "fusion.snapshot": () => fusion.snapshot(),
      "fusion.pair": ({ requestId, code }, { signal }) =>
        fusion.pair(requestId, code, signal),
      "fusion.dismissPairing": ({ requestId }) =>
        fusion.dismissPairing(requestId),
      "fusion.list": (_params, { signal }) => fusion.list(signal),
      "fusion.read": ({ id }, { signal }) => fusion.read(id, signal),
      "fusion.disconnect": () => fusion.disconnect(),
      "machine.snapshot": () => machine(() => gateway.snapshot()),
      "machine.discover": () => machine(() => gateway.discover()),
      "machine.connect": (request) => machine(() => gateway.connect(request)),
      "machine.disconnect": (request) =>
        machine(() => gateway.disconnect(request)),
      "machine.execute": (command) => machine(() => gateway.execute(command)),
      "machine.stop": () => machine(() => gateway.stop()),
      "machine.reset": () => machine(() => gateway.reset()),
      "machine.prepare": (input) => machine(() => gateway.prepare(input)),
      "machine.run": (request) => machine(() => gateway.run(request)),
      "machine.dismissJob": () => machine(() => gateway.dismissJob()),
      "machine.readAnchors": (_params, { signal }) =>
        machine(() => gateway.readAnchors(signal)),
      "machine.writeAnchors": (request) =>
        machine(() => gateway.writeAnchors(request)),
      "machine.readHeightMap": (_params, { signal }) =>
        machine(() => gateway.readHeightMap(signal)),
      "storage.read": ({ key }) => storage.read(key),
      "storage.write": ({ key, value }) => storage.write(key, value),
      "storage.backup": ({ key }) => storage.backup(key),
      "storage.remove": ({ key }) => storage.remove(key),
      "models.list": () => models.list(),
      "models.mesh": ({ id }) => models.mesh(id),
      "models.source": ({ id }) => models.source(id),
      "models.add": (entry) => models.add(entry),
      "models.rename": ({ id, name }) => models.rename(id, name),
      "models.remove": ({ id }) => models.remove(id),
      "window.setEdited": ({ edited, name }) => unsaved.report(edited, name),
      "window.close": () => unsaved.close(),
      "window.keepWorkspace": ({ workspace }) =>
        services.keptWorkspace.keep(workspace),
      "window.keptWorkspace": () => services.keptWorkspace.kept(),
      "diagnostics.status": () => diagnostics.status(),
      "diagnostics.updateSettings": (patch) =>
        diagnostics.updateSettings(patch),
      "diagnostics.log": ({ records }) => diagnostics.record(records),
      "diagnostics.readLog": () => diagnostics.readLog(),
      "diagnostics.exportLog": () => diagnostics.exportLog(files),
      "diagnostics.sendError": ({ eventId }) =>
        diagnostics.reports.send(eventId),
      ...platform.methods,
    },
    events: {
      "fusion.changed": (_params, emit) => fusion.subscribe(emit),
      "machine.changed": (_params, emit) => gateway.subscribe(emit),
      "machine.camera": (_params, emit) => gateway.watchCamera(emit),
      "machine.console": (_params, emit) => gateway.watchConsole(emit),
      "menu.command": (_params, emit) => menu.subscribe(emit),
      "files.opened": (_params, emit) => openedFiles.subscribe(emit),
      "diagnostics.mainError": (_params, emit) =>
        diagnostics.reports.subscribe(emit),
      ...platform.events,
    },
  }
}
