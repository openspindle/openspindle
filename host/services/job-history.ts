import { createHash } from "node:crypto"
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import {
  HistoryRecordSchema,
  HistorySummarySchema,
} from "../../src/platform/contract/history.ts"
import type {
  HistoryRecord,
  HistoryStore,
  HistorySummary,
} from "../../src/platform/contract/history.ts"
import { isTerminalJobPhase } from "../../src/machine/contract/index.ts"
import type {
  MachineSnapshot,
  RunRequest,
  PreparedProgram,
} from "../../src/machine/contract/index.ts"
import type { MachineJournal } from "../../src/machine/core/ports.ts"

const StoredSchema = HistoryRecordSchema.omit({
  source: true,
  prepared: true,
  snapshot: true,
})
type Stored = z.infer<typeof StoredSchema>
const validId = (id: string) => z.uuid().parse(id)
async function atomic(path: string, contents: string | Uint8Array) {
  const temp = path + ".tmp"
  await writeFile(temp, contents)
  await rename(temp, path)
}

/** One writer in the machine owner; main/HTTP readers never own live recording. */
export class JobHistory implements HistoryStore, MachineJournal {
  readonly directory: string
  private queue: Promise<unknown> = Promise.resolve()
  private current: Stored | null = null
  private lastAt = 0
  private lastWritten = 0
  private frameAt = 0
  private frameBytes = 0
  private latestFrame: { jpeg: Uint8Array; at: number } | null = null
  private readonly warn: (message: string) => void
  constructor(root: string, warn: (message: string) => void = () => {}) {
    this.directory = join(root, "job-history")
    this.warn = warn
  }
  private file(id: string, name: string) {
    return join(this.directory, validId(id), name)
  }
  private enqueue(work: () => Promise<void>) {
    this.queue = this.queue
      .then(work)
      .catch((error) =>
        this.warn(
          `Job history: ${error instanceof Error ? error.message : "storage error"}`
        )
      )
  }
  idle() {
    return this.queue
  }
  recover() {
    this.enqueue(async () => {
      for (const summary of await this.list()) {
        if (summary.endedAt !== null) continue
        const record = StoredSchema.parse(
          JSON.parse(
            await readFile(this.file(summary.id, "record.json"), "utf8")
          )
        )
        record.summary = {
          ...record.summary,
          phase: "interrupted",
          endedAt: Date.now(),
          notes: [
            ...record.summary.notes,
            "Host restarted; physical machine outcome is unknown.",
          ].slice(-20),
        }
        await atomic(
          this.file(summary.id, "record.json"),
          JSON.stringify(record)
        )
      }
    })
  }
  begin(
    request: RunRequest,
    program: PreparedProgram,
    snapshot: MachineSnapshot
  ) {
    const now = Date.now()
    const record: Stored = {
      summary: {
        id: request.id,
        name: request.name,
        startedAt: now,
        endedAt: null,
        phase: "preparing",
        activeMs: 0,
        pausedMs: 0,
        frames: 0,
        frameTimes: [],
        notes: [
          `NC SHA-256: ${createHash("sha256").update(request.source).digest("hex")}`,
        ],
      },
      events: [],
      machine: JSON.stringify(snapshot),
    }
    this.current = record
    this.lastAt = now
    this.lastWritten = 0
    this.frameAt = 0
    this.frameBytes = 0
    this.latestFrame = null
    this.enqueue(async () => {
      await mkdir(this.directory, { recursive: true })
      const summaries = await this.list()
      if (summaries.length >= 512)
        throw new Error(
          "512 archived jobs reached. Delete older records before recording more jobs."
        )
      let bytes = 0
      for (const summary of summaries)
        for (const name of await readdir(join(this.directory, summary.id))) {
          bytes += (await stat(this.file(summary.id, name))).size
        }
      if (
        bytes +
          Buffer.byteLength(request.source) +
          Buffer.byteLength(program.text) +
          Buffer.byteLength(request.archive ?? "") >
        2 * 1024 ** 3
      )
        throw new Error(
          "Job archive reached its 2 GiB budget. Delete older records to free space."
        )
      await mkdir(join(this.directory, request.id))
      await atomic(this.file(request.id, "source.nc"), request.source)
      await atomic(this.file(request.id, "prepared.nc"), program.text)
      if (request.archive)
        await atomic(this.file(request.id, "snapshot.json"), request.archive)
      await atomic(this.file(request.id, "record.json"), JSON.stringify(record))
    })
  }
  observe(snapshot: MachineSnapshot) {
    const record = this.current,
      job = snapshot.job
    if (!record || !job || record.summary.id !== job.id) return
    const now = Date.now(),
      elapsed = Math.max(0, now - this.lastAt)
    if (record.summary.phase === "running") record.summary.activeMs += elapsed
    if (record.summary.phase === "paused") record.summary.pausedMs += elapsed
    this.lastAt = now
    const changed = record.summary.phase !== job.phase
    record.summary.phase = job.phase
    if (isTerminalJobPhase(job.phase)) {
      record.summary.endedAt = job.endedAt ?? now
      if (["lost", "unverified"].includes(job.phase))
        record.summary.notes.push(
          "Machine outcome is unverified; this record does not establish that motion stopped."
        )
      if (this.latestFrame && now - this.latestFrame.at < 15000)
        this.saveFrame(record, this.latestFrame.jpeg, this.latestFrame.at, true)
      this.current = null
    }
    if (
      changed ||
      now - this.lastWritten >= 5000 ||
      record.summary.endedAt !== null
    ) {
      this.lastWritten = now
      if (record.events.length < 2000)
        record.events.push({
          at: now,
          phase: job.phase,
          line: job.progress?.line ?? null,
        })
      record.machine = JSON.stringify(snapshot)
      const saved = JSON.stringify(record)
      this.enqueue(() =>
        atomic(this.file(record.summary.id, "record.json"), saved)
      )
    }
  }
  frame(jpeg: Uint8Array, at: number): void
  frame(id: string, index: number): Promise<string | null>
  frame(
    input: Uint8Array | string,
    atOrIndex: number
  ): void | Promise<string | null> {
    if (typeof input === "string") return this.readFrame(input, atOrIndex)
    if (
      input.length > 4 * 1024 * 1024 ||
      input[0] !== 255 ||
      input[1] !== 216 ||
      input.at(-2) !== 255 ||
      input.at(-1) !== 217
    )
      return
    if (!this.current) return
    this.latestFrame = { jpeg: input.slice(), at: atOrIndex }
    this.saveFrame(this.current, input, atOrIndex, false)
  }
  private saveFrame(
    record: Stored,
    jpeg: Uint8Array,
    at: number,
    final: boolean
  ) {
    if (
      record.summary.frames >= 120 ||
      this.frameBytes + jpeg.length > 24 * 1024 * 1024 ||
      (!final && at - this.frameAt < 10000) ||
      at === this.frameAt
    )
      return
    const index = record.summary.frames++
    record.summary.frameTimes.push(at)
    this.frameAt = at
    this.frameBytes += jpeg.length
    const bytes = jpeg.slice()
    this.enqueue(async () => {
      await atomic(this.file(record.summary.id, `frame-${index}.jpg`), bytes)
      await atomic(
        this.file(record.summary.id, `frame-${index}.json`),
        JSON.stringify({ receivedAt: at })
      )
    })
  }
  async list(): Promise<HistorySummary[]> {
    let names: string[]
    try {
      names = await readdir(this.directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
    const records: HistorySummary[] = []
    for (const name of names) {
      if (!z.uuid().safeParse(name).success) continue
      try {
        const file = this.file(name, "record.json")
        if ((await stat(file)).size > 5 * 1024 * 1024) continue
        const data = JSON.parse(await readFile(file, "utf8"))
        records.push(HistorySummarySchema.parse(data.summary))
      } catch {
        this.warn("A history record is unreadable.")
      }
    }
    return records.sort((a, b) => b.startedAt - a.startedAt).slice(0, 512)
  }
  async read(id: string): Promise<HistoryRecord> {
    const record = StoredSchema.parse(
      JSON.parse(await readFile(this.file(id, "record.json"), "utf8"))
    )
    let snapshot: string | null = null
    try {
      snapshot = await readFile(this.file(id, "snapshot.json"), "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    return HistoryRecordSchema.parse({
      ...record,
      source: await readFile(this.file(id, "source.nc"), "utf8"),
      prepared: await readFile(this.file(id, "prepared.nc"), "utf8"),
      snapshot,
    })
  }
  private async readFrame(id: string, index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= 120)
      throw new Error("Invalid frame index.")
    try {
      return `data:image/jpeg;base64,${(await readFile(this.file(id, `frame-${index}.jpg`))).toString("base64")}`
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      throw error
    }
  }
  async remove(id: string) {
    const record = await this.read(id)
    if (record.summary.endedAt === null)
      throw new Error("An active run cannot be deleted.")
    await rm(join(this.directory, validId(id)), { recursive: true })
  }
}
