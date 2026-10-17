import { createHash } from "node:crypto"
import {
  FILE_BLOCK_BYTES,
  FRAME_TYPES,
} from "../../src/machine/firmware/makera/codec.ts"
import type { Frame } from "../../src/machine/firmware/makera/codec.ts"

type Send = (type: number, payload?: Uint8Array | string) => void

const u32 = (value: number) => {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value)
  return bytes
}
const readU32 = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)

export type TransferOptions = {
  /** Ask for the MD5 again before the view request (the stock ESP sometimes does). */
  readonly md5Challenge: boolean
  /** Advertise a placeholder instead of the real digest on readback. */
  readonly placeholderMd5: boolean
  /** Flip one byte of the stored file (readback must catch it). */
  readonly corrupt: boolean
  /** Leave the nth request of every readback (1 is its view) unanswered once. */
  readonly loseReadback?: number | null
}

/** The ESP32 cancels a readback that asks for nothing this long (seen on the Z1: ~9 s). */
const READBACK_SILENCE_MS = 9000

type Session =
  | {
      kind: "upload"
      path: string
      md5: string | null
      challenged: boolean
      blocks: number
      next: number
      chunks: Uint8Array[]
    }
  | {
      kind: "download"
      path: string
      data: Uint8Array
      blocks: number
      requests: number
      silence: ReturnType<typeof setTimeout> | null
    }

/** The ESP32 side of the B0–B6 file protocol, as the app's MakeraTransfer expects it. */
export class TransferEndpoint {
  readonly files = new Map<string, Uint8Array>()
  private session: Session | null = null
  private readonly send: Send
  private readonly options: TransferOptions
  private readonly log: (message: string) => void

  constructor(
    send: Send,
    options: TransferOptions,
    log: (message: string) => void
  ) {
    this.send = send
    this.options = options
    this.log = log
  }

  /** Whether a readback request goes unanswered (`loseReadback`); either way the device waits anew. */
  private lost(session: Extract<Session, { kind: "download" }>) {
    session.requests++
    this.awaitRequest(session)
    if (session.requests !== this.options.loseReadback) return false
    this.log(`readback request ${session.requests} left unanswered`)
    return true
  }

  private awaitRequest(session: Extract<Session, { kind: "download" }>) {
    if (session.silence) clearTimeout(session.silence)
    session.silence = setTimeout(() => {
      if (this.session !== session) return
      this.log("readback asked nothing for 9 s: cancelled")
      this.session = null
      this.send(FRAME_TYPES.fileCancel)
    }, READBACK_SILENCE_MS)
  }

  private endDownload() {
    if (this.session?.kind === "download" && this.session.silence)
      clearTimeout(this.session.silence)
  }

  receive(frame: Frame) {
    const text = new TextDecoder().decode(frame.payload)
    switch (frame.type) {
      case FRAME_TYPES.fileStart: {
        const [command, path] = text.trim().split(/\s+/)
        if (command === "upload" && path) {
          this.session = {
            kind: "upload",
            path,
            md5: null,
            challenged: false,
            blocks: 0,
            next: 1,
            chunks: [],
          }
          this.log(`upload ${path}`)
        } else if (command === "download" && path) {
          const data = this.files.get(path)
          if (!data) {
            this.send(FRAME_TYPES.fileCancel)
            return
          }
          this.endDownload()
          this.session = {
            kind: "download",
            path,
            data,
            blocks: Math.ceil(data.length / FILE_BLOCK_BYTES),
            requests: 0,
            silence: null,
          }
          this.awaitRequest(this.session)
          const digest = this.options.placeholderMd5
            ? "0".repeat(32)
            : createHash("md5").update(data).digest("hex")
          this.send(FRAME_TYPES.fileMd5, digest)
        }
        return
      }
      case FRAME_TYPES.fileMd5:
        if (this.session?.kind !== "upload") return
        this.session.md5 = text.trim()
        if (this.options.md5Challenge && !this.session.challenged) {
          this.session.challenged = true
          this.send(FRAME_TYPES.fileMd5)
          return
        }
        this.send(FRAME_TYPES.fileView)
        return
      case FRAME_TYPES.fileView:
        if (this.session?.kind === "upload" && frame.payload.length === 6) {
          this.session.blocks = readU32(frame.payload)
          this.send(FRAME_TYPES.fileData, u32(1))
        } else if (this.session?.kind === "download") {
          if (this.lost(this.session)) return
          const view = new Uint8Array(6)
          new DataView(view.buffer).setUint32(0, this.session.blocks)
          new DataView(view.buffer).setUint16(4, FILE_BLOCK_BYTES)
          this.send(FRAME_TYPES.fileView, view)
        }
        return
      case FRAME_TYPES.fileData:
        if (this.session?.kind === "upload" && frame.payload.length > 4) {
          const session = this.session
          if (readU32(frame.payload) !== session.next) {
            this.send(FRAME_TYPES.fileCancel)
            this.session = null
            return
          }
          session.chunks.push(frame.payload.slice(4))
          session.next++
          if (session.next <= session.blocks) {
            this.send(FRAME_TYPES.fileData, u32(session.next))
            return
          }
          const data = new Uint8Array(
            session.chunks.reduce((total, chunk) => total + chunk.length, 0)
          )
          let offset = 0
          for (const chunk of session.chunks) {
            data.set(chunk, offset)
            offset += chunk.length
          }
          if (this.options.corrupt && data.length) data[data.length - 1] ^= 1
          this.files.set(session.path, data)
          this.log(`stored ${session.path} (${data.length} bytes)`)
          this.session = null
          this.send(FRAME_TYPES.fileEnd, "ok\r\n")
        } else if (
          this.session?.kind === "download" &&
          frame.payload.length === 4
        ) {
          if (this.lost(this.session)) return
          const sequence = readU32(frame.payload)
          const chunk = this.session.data.subarray(
            (sequence - 1) * FILE_BLOCK_BYTES,
            sequence * FILE_BLOCK_BYTES
          )
          const payload = new Uint8Array(4 + chunk.length)
          payload.set(frame.payload)
          payload.set(chunk, 4)
          this.send(FRAME_TYPES.fileData, payload)
        }
        return
      case FRAME_TYPES.fileEnd:
        if (this.session?.kind === "download") {
          this.endDownload()
          this.session = null
          this.send(FRAME_TYPES.fileEnd, "ok\r\n")
        }
        return
      case FRAME_TYPES.fileCancel:
        this.log("transfer cancelled by the app")
        this.endDownload()
        this.session = null
        return
    }
  }
}
