import { readFile, writeFile, rename } from "node:fs/promises"
import { join } from "node:path"
import type { OwnerClient } from "../owner-client.ts"
import { CAMERA_IDS, CameraSettingsSchema } from "../camera-contract.ts"
import type {
  CameraId,
  CameraState,
  CameraSettings,
  TimelapseSetting,
} from "../camera-contract.ts"
import { isTerminalJobPhase } from "../../src/machine/contract/index.ts"
import { Webcam } from "./webcam.ts"
import { Timelapses } from "./timelapse.ts"

/** Cameras and recording have their own lifecycle, independent of browser clients. */
export class Cameras {
  readonly webcam: Webcam
  readonly timelapses: Timelapses
  private settings: CameraSettings = {
    machine: { enabled: false, intervalSeconds: 10 },
    webcam: { enabled: false, intervalSeconds: 10 },
  }
  private timer: ReturnType<typeof setInterval> | null = null
  private pending: Promise<void> = Promise.resolve()
  private closing = false
  private busy = false
  private changing = false
  constructor(
    private readonly root: string,
    private readonly owner: OwnerClient,
    private readonly warning: (message: string) => void
  ) {
    const ffmpeg = process.env.OPENSPINDLE_FFMPEG ?? "ffmpeg"
    this.webcam = new Webcam(process.env.OPENSPINDLE_WEBCAM_DEVICE, ffmpeg)
    this.timelapses = new Timelapses(root, ffmpeg, warning)
  }
  async initialize() {
    try {
      this.settings = CameraSettingsSchema.parse(
        JSON.parse(await readFile(join(this.root, "cameras.json"), "utf8"))
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.warning(
          "Camera settings could not be loaded; timelapse remains disabled until configured again."
        )
    }
    await this.timelapses.recover()
    this.timer = setInterval(() => {
      if (this.busy || this.closing) return
      this.pending = this.tick().catch((error) =>
        this.warning(
          `Camera recording: ${error instanceof Error ? error.message : "storage failure"}`
        )
      )
    }, 1000)
  }
  states(): CameraState[] {
    return CAMERA_IDS.map((id) => ({
      id,
      name: id === "machine" ? "Makera camera" : "Workshop webcam",
      available:
        id === "machine"
          ? !!this.owner.snapshot.features?.camera
          : !!this.webcam.device,
      status: id === "machine" ? this.owner.cameraStatus : this.webcam.status,
      error: id === "machine" ? null : this.webcam.error,
      timelapse: this.settings[id],
    }))
  }
  frame(id: CameraId) {
    return id === "machine" ? this.owner.camera : this.webcam.frame
  }
  async start(id: CameraId) {
    if (id === "machine") {
      if (!this.owner.snapshot.features?.camera)
        throw new Error(
          "Connect the machine and configure its camera endpoint first."
        )
      await this.owner.call("camera.start")
    } else this.webcam.start()
  }
  async stop(id: CameraId) {
    if (id === "machine") {
      await this.owner.call("camera.stop")
      this.owner.camera = null
      this.owner.cameraStatus = "off"
    } else this.webcam.stop()
  }
  async configure(id: CameraId, setting: TimelapseSetting) {
    if (this.changing)
      throw new Error("Camera settings are being saved; try again.")
    this.changing = true
    try {
      const next = { ...this.settings, [id]: setting }
      await writeFile(join(this.root, "cameras.json.tmp"), JSON.stringify(next))
      await rename(
        join(this.root, "cameras.json.tmp"),
        join(this.root, "cameras.json")
      )
      this.settings = next
    } finally {
      this.changing = false
    }
  }
  private async tick() {
    if (this.busy) return
    this.busy = true
    try {
      const job = this.owner.snapshot.job
      let id: string | null = null
      if (job && !isTerminalJobPhase(job.phase)) id = job.id
      await this.timelapses.finishExcept(id)
      if (!id) return
      for (const camera of CAMERA_IDS) {
        const frame = this.frame(camera),
          setting = this.settings[camera]
        if (setting.enabled && frame)
          await this.timelapses.capture(
            id,
            camera,
            frame,
            setting.intervalSeconds
          )
      }
    } finally {
      this.busy = false
    }
  }
  async close() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.closing = true
    this.webcam.stop()
    this.timelapses.cancelExport()
    await this.pending
    // In-flight disk writes can finish; process restart recovery marks an interrupted recording.
    await this.timelapses.finishExcept(null)
  }
}
