import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs"
import { appendFile, readFile, rename } from "node:fs/promises"
import path from "node:path"
import {
  DEFAULT_DIAGNOSTICS_SETTINGS,
  errorText,
  recordsLevel,
} from "../../../src/platform/contract/diagnostics"
import type { LogLevel } from "../../../src/platform/contract/diagnostics"

/** Past this size the log rolls over to the earlier file, so it keeps 4 to 8 MB. */
const MAX_BYTES = 4 * 1024 * 1024
const CURRENT = "openspindle.log"
const EARLIER = "openspindle.1.log"
/** Records wait this long to be written together, errors not at all. */
const WRITE_DELAY_MS = 200

export type LogSource = "main" | "renderer" | "machine"

/** A record as the log writes it. */
export type WrittenRecord = {
  readonly level: LogLevel
  readonly source: LogSource
  /** The message and, on the lines after it, its detail. */
  readonly text: string
  readonly time: number
}

const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT"

/**
 * The app's log: one text file in the system's log folder, written by the main process for
 * itself, the renderer and the machine process, one record per line (continuation lines indented). Records
 * below the chosen level are left out. Until the log is opened, records wait in memory.
 */
export class AppLog {
  private level: LogLevel = DEFAULT_DIAGNOSTICS_SETTINGS.logLevel
  private directory: string | null = null
  private echo = false
  private pending: string[] = []
  private size = 0
  private timer: NodeJS.Timeout | null = null
  /** Writes run one after another, in order. */
  private writes: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<(record: WrittenRecord) => void>()

  open(directory: string, level: LogLevel, options: { echo: boolean }) {
    this.level = level
    this.echo = options.echo
    try {
      mkdirSync(directory, { recursive: true })
      this.directory = directory
      this.size = this.currentSize()
      if (this.size > MAX_BYTES) this.rollOverSync()
    } catch (error) {
      console.error("The log could not be opened:", error)
      this.directory = null
    }
    this.schedule(0)
  }

  setLevel(level: LogLevel) {
    this.level = level
  }

  /** Each record the log writes, as it writes it. */
  subscribe(listener: (record: WrittenRecord) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  error(message: string, detail?: unknown) {
    this.write("error", "main", message, detail)
  }
  warn(message: string, detail?: unknown) {
    this.write("warn", "main", message, detail)
  }
  info(message: string, detail?: unknown) {
    this.write("info", "main", message, detail)
  }
  debug(message: string, detail?: unknown) {
    this.write("debug", "main", message, detail)
  }

  write(
    level: LogLevel,
    source: LogSource,
    message: string,
    detail?: unknown,
    time = Date.now()
  ) {
    if (!recordsLevel(this.level, level)) return
    const text =
      detail === undefined ? message : `${message}: ${errorText(detail)}`
    const line = `${new Date(time).toISOString()} ${level.toUpperCase().padEnd(5)} ${source.padEnd(8)} ${text.replace(/\r?\n/g, "\n    ")}\n`
    if (this.echo) process.stdout.write(line)
    this.pending.push(line)
    this.schedule(level === "error" ? 0 : WRITE_DELAY_MS)
    for (const listener of this.listeners)
      listener({ level, source, text, time })
  }

  /** Writes what is waiting at once, for a quit or an error that may end the process. */
  flushSync() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.directory || !this.pending.length) return
    const chunk = this.take()
    const bytes = Buffer.byteLength(chunk)
    if (this.size + bytes > MAX_BYTES) this.rollOverSync()
    try {
      appendFileSync(path.join(this.directory, CURRENT), chunk)
      this.size += bytes
    } catch {
      // The log never takes the app down with it.
    }
  }

  /** The earlier and the current file, or their last `maxBytes`, starting at a whole line. */
  async read(maxBytes = Infinity): Promise<string> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.flush()
    await this.settled()
    if (!this.directory) return ""
    const parts = await Promise.all(
      [EARLIER, CURRENT].map((name) =>
        readFile(path.join(this.directory ?? "", name)).catch(
          (error: unknown) => {
            if (missing(error)) return Buffer.alloc(0)
            throw error
          }
        )
      )
    )
    const all = Buffer.concat(parts)
    if (all.byteLength <= maxBytes) return all.toString("utf8")
    const tail = all.subarray(all.byteLength - maxBytes).toString("utf8")
    return tail.slice(tail.indexOf("\n") + 1)
  }

  /** Settles once everything recorded so far is written. */
  private async settled() {
    let last: Promise<void> | null = null
    while (last !== this.writes) {
      last = this.writes
      await last
    }
  }

  private schedule(delay: number) {
    if (!this.directory || !this.pending.length) return
    if (this.timer && delay > 0) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, delay)
  }

  private flush() {
    const directory = this.directory
    if (!directory || !this.pending.length) return
    const chunk = this.take()
    this.writes = this.writes.then(async () => {
      const bytes = Buffer.byteLength(chunk)
      if (this.size + bytes > MAX_BYTES) await this.rollOver(directory)
      try {
        await appendFile(path.join(directory, CURRENT), chunk)
        this.size += bytes
      } catch {
        // The log never takes the app down with it.
      }
    })
  }

  private take(): string {
    const chunk = this.pending.join("")
    this.pending = []
    return chunk
  }

  private currentSize(): number {
    try {
      return statSync(path.join(this.directory ?? "", CURRENT)).size
    } catch {
      return 0
    }
  }

  /** Past MAX_BYTES the current file becomes the earlier one; failing that, it grows on. */
  private async rollOver(directory: string) {
    this.size = 0
    await rename(
      path.join(directory, CURRENT),
      path.join(directory, EARLIER)
    ).catch(() => undefined)
  }

  private rollOverSync() {
    this.size = 0
    if (!this.directory) return
    try {
      renameSync(
        path.join(this.directory, CURRENT),
        path.join(this.directory, EARLIER)
      )
    } catch {
      // It grows on.
    }
  }
}

/** The one log of the app. */
export const log = new AppLog()
