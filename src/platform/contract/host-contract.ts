import { defineContract } from "@openspindle/rpc"
import { z } from "zod"
import {
  OpenFileRequestSchema,
  OpenFileResultSchema,
  SaveFileRequestSchema,
  SaveFileResultSchema,
} from "./files"
import { diagnosticsEvents, diagnosticsMethods } from "./diagnostics"
import { pluginEvents, pluginMethods } from "./plugin-rpc"
import { machineEvents, machineMethods } from "./machine-rpc"
import { MenuCommandSchema } from "./menu"
import { modelMethods } from "./models"
import { storageMethods } from "./storage"
import { windowMethods } from "./window"
import { fusionEvents, fusionMethods } from "./fusion"

/** Everything the Electron main process serves to the renderer. */
export const hostContract = defineContract({
  methods: {
    "files.open": {
      params: OpenFileRequestSchema,
      result: OpenFileResultSchema,
      timeoutMs: 0,
    },
    "files.save": {
      params: SaveFileRequestSchema,
      result: SaveFileResultSchema,
      timeoutMs: 0,
    },
    ...pluginMethods,
    ...machineMethods,
    ...storageMethods,
    ...modelMethods,
    ...windowMethods,
    ...diagnosticsMethods,
    ...fusionMethods,
  },
  events: {
    ...machineEvents,
    ...pluginEvents,
    ...diagnosticsEvents,
    ...fusionEvents,
    "menu.command": { params: z.undefined(), data: MenuCommandSchema },
  },
})
export type HostContract = typeof hostContract
