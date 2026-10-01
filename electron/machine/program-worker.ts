import { Worker } from "node:worker_threads"
import type { PrepareResult } from "../../src/machine/contract/index.ts"
import type { ProgramPreparer } from "../../src/machine/core/ports.ts"

/** The thread's own entry, built beside the machine process's (electron.vite.config.ts). */
const THREAD = new URL("./program-thread.js", import.meta.url)

export type ProgramRequest = {
  readonly id: number
  readonly firmware: string
  readonly source: string
}

export type ProgramReply =
  | { readonly id: number; readonly result: PrepareResult }
  | { readonly id: number; readonly error: string }

type Pending = {
  readonly resolve: (result: PrepareResult) => void
  readonly reject: (error: Error) => void
}

/** An idle thread ends, releasing what its last program held on to. */
const IDLE_MS = 60_000

/**
 * Prepares programs on a worker thread, away from the machine process's loop, which polls the
 * machine and carries Stop. The thread starts on first use and ends after a minute without work;
 * a thread that fails fails what it was preparing, and the next program starts another.
 */
export class ProgramWorker implements ProgramPreparer {
  private worker: Worker | null = null
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private idle: NodeJS.Timeout | null = null

  prepare(firmware: string, source: string): Promise<PrepareResult> {
    const worker = this.thread()
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      const request: ProgramRequest = { id, firmware, source }
      worker.postMessage(request)
    })
  }

  dispose() {
    if (this.worker)
      this.end(this.worker, new Error("Preparing programs has ended."))
  }

  private thread(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(THREAD, { name: "Program preparation" })
    worker.on("message", (reply: ProgramReply) => {
      const pending = this.pending.get(reply.id)
      if (!pending) return
      this.pending.delete(reply.id)
      if ("result" in reply) pending.resolve(reply.result)
      else pending.reject(new Error(reply.error))
      if (!this.pending.size)
        this.idle = setTimeout(
          () => this.end(worker, new Error("The program thread was idle.")),
          IDLE_MS
        )
    })
    worker.on("error", (error) => this.end(worker, error))
    worker.on("exit", (code) =>
      this.end(
        worker,
        new Error(`Preparing the program stopped (exit code ${code}).`)
      )
    )
    this.worker = worker
    return worker
  }

  /** Ends the thread; what it was still preparing fails with `error`. */
  private end(worker: Worker, error: Error) {
    if (this.worker !== worker) return
    this.worker = null
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    void worker.terminate()
  }
}
