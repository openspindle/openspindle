import { defineContract } from "@openspindle/rpc"
import { z } from "zod"
import {
  OpenFileRequestSchema,
  OpenFileResultSchema,
  OpenedFilesSchema,
  SaveFileRequestSchema,
  SaveFileResultSchema,
} from "./files"
import { diagnosticsEvents, diagnosticsMethods } from "./diagnostics"
import { pcbMethods } from "./pcb"
import { MenuCommandSchema } from "./menu"
import { modelMethods } from "./models"
import { simulatorMethods } from "./simulator"
import { storageMethods } from "./storage"
import { windowMethods } from "./window"
import { fusionEvents, fusionMethods } from "./fusion"

/** Everything the Electron main process serves to the renderer; the machine has its own process. */
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
    ...pcbMethods,
    ...storageMethods,
    ...modelMethods,
    ...windowMethods,
    ...diagnosticsMethods,
    ...fusionMethods,
    ...simulatorMethods,
  },
  events: {
    ...diagnosticsEvents,
    ...fusionEvents,
    "menu.command": { params: z.undefined(), data: MenuCommandSchema },
    /** Files the system asked the app to open, as it opened them. */
    "files.opened": { params: z.undefined(), data: OpenedFilesSchema },
  },
})
export type HostContract = typeof hostContract
