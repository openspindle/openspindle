import type { Handlers } from "@openspindle/rpc"
import type { HostContract } from "../../../src/platform/contract/host-contract"
import type { FileService } from "../services/file-service"
import type { FusionService } from "../services/fusion-service"
import type { MenuBus } from "../services/menu-bus"
import type { OpenedFileBus } from "../services/opened-files"
import type { ModelStore } from "../../../src/persistence/models/model-library"
import type { KeptWorkspace } from "../services/kept-workspace"
import type { StorageService } from "../services/storage-service"
import type { UnsavedChanges } from "../services/unsaved-changes"
import type { PcbService } from "../pcb/service"
import type { Diagnostics } from "../diagnostics/diagnostics"
import type { SimulatorService } from "../simulator/simulator-service"

export type HostServices = {
  readonly files: FileService
  readonly fusion: FusionService
  readonly menu: MenuBus
  readonly openedFiles: OpenedFileBus
  readonly storage: StorageService
  readonly models: ModelStore
  readonly pcb: PcbService
  readonly unsaved: UnsavedChanges
  readonly keptWorkspace: KeptWorkspace
  readonly diagnostics: Diagnostics
  readonly simulator: SimulatorService
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
      "pcb.status": () => services.pcb.status(),
      "pcb.chooseExecutable": () => services.pcb.chooseExecutable(),
      "pcb.setExecutable": ({ executable }) =>
        services.pcb.setExecutable(executable),
      "pcb.generate": (request, { signal }) =>
        services.pcb.generate(request, signal),
      "simulator.status": () => services.simulator.status(),
      "simulator.update": (patch) => services.simulator.update(patch),
    },
    events: {
      "fusion.changed": (_params, emit) => fusion.subscribe(emit),
      "menu.command": (_params, emit) => menu.subscribe(emit),
      "files.opened": (_params, emit) => openedFiles.subscribe(emit),
      "diagnostics.mainError": (_params, emit) =>
        diagnostics.reports.subscribe(emit),
    },
  }
}
