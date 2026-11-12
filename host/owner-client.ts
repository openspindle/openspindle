import { Worker } from "node:worker_threads"
import {
  disconnectedSnapshot,
  MachineSnapshotSchema,
} from "../src/machine/contract/index.ts"
import type { MachineSnapshot } from "../src/machine/contract/index.ts"

/** HTTP upload/JSON work cannot block the thread that owns Stop and machine polling. */
export class OwnerClient {
  readonly worker: Worker
  snapshot: MachineSnapshot = disconnectedSnapshot()
  camera: { jpeg: Uint8Array; at: number } | null = null
  cameraStatus = "off"
  private sequence = 0
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private ended = false
  constructor(
    settings: {
      data: string
      machineHost?: string
      machinePort?: number
      usbId?: string
      cameraHost?: string
    },
    privateWarning: (message: string) => void
  ) {
    this.worker = new Worker(new URL("./machine-owner.js", import.meta.url), {
      workerData: settings,
    })
    this.worker.on("message", (message) => {
      if (message.kind === "snapshot") {
        const checked = MachineSnapshotSchema.safeParse(message.snapshot)
        if (checked.success) {
          if (checked.data.connection.id !== this.snapshot.connection.id)
            this.camera = null
          this.snapshot = checked.data
        }
        return
      }
      if (message.kind === "frame") {
        this.camera = { jpeg: message.jpeg, at: message.at }
        return
      }
      if (message.kind === "camera-status") {
        this.cameraStatus = message.status
        return
      }
      if (message.kind === "warning") {
        privateWarning(message.message)
        return
      }
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error))
      else pending.resolve(message.result)
    })
    const fail = (message: string) => {
      this.ended = true
      this.snapshot = disconnectedSnapshot()
      this.camera = null
      this.cameraStatus = "error"
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error(message))
      }
      this.pending.clear()
      privateWarning(message)
    }
    this.worker.on("error", (error) => fail(error.message))
    this.worker.on("exit", (code) =>
      fail(
        `Machine owner exited (${code}); physical machine outcome is unknown.`
      )
    )
  }
  call(method: string, input: unknown = undefined): Promise<unknown> {
    if (this.ended)
      return Promise.reject(new Error("Machine owner is unavailable."))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id)
          reject(
            new Error(
              "Machine request timed out; outcome unknown. Do not retry a motion automatically."
            )
          )
        },
        method === "run" ? 86_400_000 : 180000
      )
      this.pending.set(id, { resolve, reject, timer })
      this.worker.postMessage({ id, method, input })
    })
  }
}
