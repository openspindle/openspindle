import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
  stat,
} from "node:fs/promises"
import { join } from "node:path"
import type { ChildProcess } from "node:child_process"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { CAMERA_IDS, TimelapseManifestSchema } from "../camera-contract.ts"
import type { CameraId, TimelapseManifest } from "../camera-contract.ts"
import type { CameraFrame } from "./webcam.ts"

const GLOBAL_LIMIT = 1024 ** 3
const CAMERA_LIMIT = 128 * 1024 ** 2
async function atomic(path: string, contents: string | Uint8Array) {
  await writeFile(path + ".tmp", contents)
  await rename(path + ".tmp", path)
}
/** One non-overlapping capture pass; camera failure or disk latency never queues frames. */
export class Timelapses {
  private bytes = 0
  private busy = false
  private exporting = false
  private encoder: ChildProcess | null = null
  cancelExport() {
    this.encoder?.kill("SIGKILL")
  }
  private records = new Map<string, TimelapseManifest>()
  constructor(
    private readonly root: string,
    private readonly ffmpeg: string,
    private readonly warning: (message: string) => void
  ) {}
  private directory(jobId: string, cameraId: CameraId) {
    return join(
      this.root,
      "job-history",
      z.uuid().parse(jobId),
      "timelapse",
      cameraId
    )
  }
  async recover() {
    try {
      await this.recoverArchive()
    } catch (error) {
      this.bytes = GLOBAL_LIMIT
      this.warning(
        `Timelapse storage recovery failed; recording disabled until restart: ${error instanceof Error ? error.message : "storage failure"}`
      )
    }
  }
  private async recoverArchive() {
    for (const name of await readdir(this.root)) {
      if (/^timelapse-export-[a-f0-9-]{36}\.mp4$/.test(name))
        await rm(join(this.root, name), { force: true })
    }
    for (const entry of await readdir(join(this.root, "job-history")).catch(
      () => []
    )) {
      if (!z.uuid().safeParse(entry).success) continue
      for (const id of CAMERA_IDS) {
        const record = await this.read(entry, id)
        if (!record) continue
        for (const name of await readdir(this.directory(entry, id))) {
          if (/^frame-\d{6}\.jpg(?:\.tmp)?$/.test(name))
            this.bytes += (
              await stat(join(this.directory(entry, id), name))
            ).size
        }
        if (record.endedAt === null) {
          record.endedAt = Date.now()
          record.stopReason = "Host restarted; recording interrupted."
          await atomic(
            join(this.directory(entry, id), "manifest.json"),
            JSON.stringify(record)
          )
        }
      }
    }
  }
  async read(jobId: string, id: CameraId): Promise<TimelapseManifest | null> {
    try {
      const record = TimelapseManifestSchema.parse(
        JSON.parse(
          await readFile(
            join(this.directory(jobId, id), "manifest.json"),
            "utf8"
          )
        )
      )
      if (record.jobId !== jobId || record.cameraId !== id)
        throw new Error("Timelapse manifest identity mismatch.")
      return record
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      throw error
    }
  }
  async capture(
    jobId: string,
    id: CameraId,
    frame: CameraFrame,
    intervalSeconds: number
  ) {
    if (this.busy) return
    const key = jobId + ":" + id
    let record = this.records.get(key)
    if (!record) {
      // Only archive runs owned by this host, never preview selections or external jobs.
      try {
        await stat(
          join(this.root, "job-history", z.uuid().parse(jobId), "record.json")
        )
      } catch {
        return
      }
      record = (await this.read(jobId, id)) ?? {
        version: 1,
        jobId,
        cameraId: id,
        endedAt: null,
        stopReason: null,
        frames: [],
        bytes: 0,
      }
      this.records.set(key, record)
    }
    const previous = record.frames.at(-1)
    const now = Date.now()
    if (
      record.endedAt !== null ||
      now - frame.at > 15000 ||
      frame.at > now ||
      (previous &&
        (frame.at <= previous.at ||
          now - previous.capturedAt < intervalSeconds * 1000))
    )
      return
    this.busy = true
    try {
      const directory = this.directory(jobId, id)
      await mkdir(directory, { recursive: true })
      if (
        record.frames.length >= 3600 ||
        record.bytes + frame.jpeg.length > CAMERA_LIMIT ||
        this.bytes + frame.jpeg.length > GLOBAL_LIMIT
      ) {
        record.endedAt = now
        record.stopReason = "Recording storage/frame limit reached."
      } else {
        await atomic(
          join(
            directory,
            `frame-${String(record.frames.length).padStart(6, "0")}.jpg`
          ),
          frame.jpeg
        )
        record.frames.push({ at: frame.at, capturedAt: now, intervalSeconds })
        record.bytes += frame.jpeg.length
        this.bytes += frame.jpeg.length
      }
      await atomic(
        join(this.directory(jobId, id), "manifest.json"),
        JSON.stringify(record)
      )
    } catch (error) {
      record.endedAt = now
      record.stopReason = "Recording storage failed."
      this.warning(
        `Timelapse: ${error instanceof Error ? error.message : "storage failure"}`
      )
    } finally {
      this.busy = false
    }
  }
  async finishExcept(jobId: string | null) {
    for (const record of this.records.values()) {
      if (record.jobId === jobId || record.endedAt !== null) continue
      record.endedAt = Date.now()
      record.stopReason = "Job ended or connection outcome changed."
      await atomic(
        join(this.directory(record.jobId, record.cameraId), "manifest.json"),
        JSON.stringify(record)
      )
    }
    // Bound retained metadata when the service handles many jobs.
    for (const [key, record] of this.records)
      if (record.jobId !== jobId) this.records.delete(key)
  }
  async frame(jobId: string, id: CameraId, index: number) {
    const record = await this.read(jobId, id)
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      !record ||
      index >= record.frames.length
    )
      throw new Error("Timelapse frame unavailable.")
    return readFile(
      join(
        this.directory(jobId, id),
        `frame-${String(index).padStart(6, "0")}.jpg`
      )
    )
  }
  async export(
    jobId: string,
    id: CameraId,
    signal: AbortSignal
  ): Promise<{ file: string; cleanup: () => Promise<void> }> {
    if (this.exporting)
      throw new Error("Another timelapse export is in progress.")
    this.exporting = true
    const file = join(this.root, `timelapse-export-${randomUUID()}.mp4`)
    try {
      const record = await this.read(jobId, id)
      if (!record?.frames.length)
        throw new Error("No timelapse frames are available for this camera.")
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          this.ffmpeg,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-framerate",
            "24",
            "-start_number",
            "0",
            "-i",
            join(this.directory(jobId, id), "frame-%06d.jpg"),
            "-frames:v",
            String(record.frames.length),
            "-vf",
            "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-threads",
            "1",
            "-maxrate",
            "4M",
            "-bufsize",
            "8M",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-an",
            "-y",
            file,
          ],
          { stdio: "ignore" }
        )
        this.encoder = child
        let expired = false
        const stop = () => {
          expired = true
          child.kill("SIGKILL")
        }
        const timer = setTimeout(stop, 180000)
        signal.addEventListener("abort", stop, { once: true })
        if (signal.aborted) stop()
        const cleanup = () => {
          this.encoder = null
          clearTimeout(timer)
          signal.removeEventListener("abort", stop)
        }
        child.on("error", () => {
          cleanup()
          reject(new Error("Could not start ffmpeg for MP4 export."))
        })
        child.on("close", (code) => {
          cleanup()
          if (expired || code !== 0)
            reject(
              new Error(
                "Timelapse export failed or was cancelled. Check ffmpeg/libx264 availability."
              )
            )
          else resolve()
        })
      })
      return {
        file,
        cleanup: async () => {
          await rm(file, { force: true })
          this.exporting = false
        },
      }
    } catch (error) {
      await rm(file, { force: true })
      this.exporting = false
      throw error
    }
  }
}
