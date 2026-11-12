import { spawn } from "node:child_process"
import type { ChildProcessWithoutNullStreams } from "node:child_process"

export type CameraFrame = { jpeg: Uint8Array; at: number }
const FRAME_LIMIT = 4 * 1024 * 1024
/** Linux V4L2 capture, isolated in ffmpeg, with a bounded JPEG pipe and no shell. */
export class Webcam {
  frame: CameraFrame | null = null
  status = "off"
  error: string | null = null
  private process: ChildProcessWithoutNullStreams | null = null
  constructor(
    readonly device: string | undefined,
    private readonly ffmpeg: string
  ) {
    if (device && !/^\/dev\/(?:video\d+|v4l\/by-id\/[\w.:-]+)$/.test(device))
      throw new Error(
        "Use /dev/videoN or /dev/v4l/by-id/<device> for OPENSPINDLE_WEBCAM_DEVICE."
      )
  }
  start() {
    if (this.process) return
    if (!this.device)
      throw new Error("Configure OPENSPINDLE_WEBCAM_DEVICE on the host first.")
    if (process.platform !== "linux")
      throw new Error("Local webcam capture currently requires Linux V4L2.")
    this.status = "connecting"
    this.error = null
    const child = spawn(
      this.ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-f",
        "v4l2",
        "-framerate",
        "10",
        "-i",
        this.device,
        "-an",
        "-vf",
        "fps=2,scale=640:480:force_original_aspect_ratio=decrease",
        "-threads",
        "1",
        "-c:v",
        "mjpeg",
        "-q:v",
        "5",
        "-f",
        "image2pipe",
        "pipe:1",
      ],
      { stdio: "pipe" }
    )
    this.process = child
    let buffer = Buffer.alloc(0)
    let diagnostic = ""
    let timeout = setTimeout(
      () => fail("No webcam frame arrived within 15 seconds."),
      15000
    )
    const fail = (message: string) => {
      if (this.process !== child) return
      this.stop()
      this.status = "error"
      this.error = message
    }
    child.stdin.end()
    child.stderr.on("data", (chunk: Buffer) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-1000)
    })
    child.stdout.on("data", (chunk: Buffer) => {
      if (this.process !== child) return
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > FRAME_LIMIT) {
        fail("Webcam output exceeded the JPEG buffer limit.")
        return
      }
      while (buffer.length) {
        const start = buffer.indexOf(Buffer.from([0xff, 0xd8]))
        if (start < 0) {
          buffer = buffer.subarray(Math.max(0, buffer.length - 1))
          return
        }
        if (start > 0) buffer = buffer.subarray(start)
        const end = buffer.indexOf(Buffer.from([0xff, 0xd9]), 2)
        if (end < 0) return
        this.frame = {
          jpeg: Buffer.from(buffer.subarray(0, end + 2)),
          at: Date.now(),
        }
        this.status = "live"
        clearTimeout(timeout)
        timeout = setTimeout(
          () => fail("Webcam frames stopped arriving."),
          15000
        )
        buffer = buffer.subarray(end + 2)
      }
    })
    child.on("error", () =>
      fail(
        "Could not start ffmpeg. Install it on the host or configure OPENSPINDLE_FFMPEG."
      )
    )
    child.on("close", () => {
      clearTimeout(timeout)
      fail(
        `Webcam capture ended. Check the device and video permissions. ${diagnostic}`
      )
    })
    child.once("exit", () => clearTimeout(timeout))
  }
  stop() {
    const child = this.process
    this.process = null
    this.frame = null
    this.status = "off"
    this.error = null
    if (!child) return
    child.kill("SIGTERM")
    const expiry = setTimeout(() => child.kill("SIGKILL"), 2000)
    expiry.unref()
    child.once("close", () => clearTimeout(expiry))
  }
}
