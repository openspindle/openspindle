import type { Handlers } from "@openspindle/rpc"
import type { MachineGateway } from "../../src/machine/core/gateway.ts"
import { formatTrace } from "../../src/machine/core/protocol-trace.ts"
import type { MachineContract } from "../../src/platform/contract/machine-rpc"
import { machine } from "./machine-errors.ts"

/** Maps every machine-contract method and event onto a principal's gateway. */
export function createMachineHandlers(
  gateway: MachineGateway
): Handlers<MachineContract> {
  return {
    methods: {
      "machine.beginSimulatedJog": (input) =>
        machine(() => gateway.beginSimulatedJog(input)),
      "machine.sampleSimulatedJog": (input) =>
        machine(() => gateway.sampleSimulatedJog(input)),
      "machine.actionSimulatedJog": (input) =>
        machine(() => gateway.actionSimulatedJog(input)),
      "machine.endSimulatedJog": (input) =>
        machine(() => gateway.endSimulatedJog(input)),
      "machine.snapshot": () => machine(() => gateway.snapshot()),
      "machine.discover": () => machine(() => gateway.discover()),
      "machine.connect": (request) => machine(() => gateway.connect(request)),
      "machine.disconnect": (request) =>
        machine(() => gateway.disconnect(request)),
      "machine.execute": (command, { signal }) =>
        machine(() => gateway.execute(command, signal)),
      "machine.simulateBed": (bed) => machine(() => gateway.simulateBed(bed)),
      "machine.sendConsoleLine": ({ line }) =>
        machine(() => gateway.sendConsoleLine(line)),
      "machine.stop": () => machine(() => gateway.stop()),
      "machine.reset": () => machine(() => gateway.reset()),
      "machine.prepare": (input) => machine(() => gateway.prepare(input)),
      "machine.run": (request) => machine(() => gateway.run(request)),
      "machine.dismissJob": () => machine(() => gateway.dismissJob()),
      "machine.readAnchors": (_params, { signal }) =>
        machine(() => gateway.readAnchors(signal)),
      "machine.writeAnchors": (request) =>
        machine(() => gateway.writeAnchors(request)),
      "machine.readConfiguration": (_params, { signal }) =>
        machine(() => gateway.readConfiguration(signal)),
      "machine.writeConfiguration": (request) =>
        machine(() => gateway.writeConfiguration(request)),
      "machine.readHeightMap": (_params, { signal }) =>
        machine(() => gateway.readHeightMap(signal)),
      "machine.readSwitches": () => machine(() => gateway.readSwitches()),
      "machine.protocolTrace": () => formatTrace(gateway.protocolTrace()),
    },
    events: {
      "machine.changed": (_params, emit) => gateway.subscribe(emit),
      "machine.camera": (_params, emit) => gateway.watchCamera(emit),
      "machine.console": (_params, emit) => gateway.watchConsole(emit),
    },
  }
}
