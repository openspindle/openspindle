import { TransferError } from "../adapter.ts"
import type {
  InboundFrame,
  OutboundFrame,
  TransferProtocol,
} from "../adapter.ts"
import { FILE_BLOCK_BYTES, FRAME_TYPES } from "./codec.ts"

type Stage =
  | "upload-md5"
  | "upload-data"
  | "readback-md5"
  | "readback-view"
  | "readback-data"
  | "done"

const decoder = new TextDecoder()
const encoder = new TextEncoder()
const COMPLETION = encoder.encode("ok\r\n")

const isCompletion = (frame: InboundFrame) =>
  frame.type === FRAME_TYPES.fileEnd &&
  (frame.payload.length === 0 ||
    (frame.payload.length === COMPLETION.length &&
      frame.payload.every((byte, index) => byte === COMPLETION[index])))

const u32 = (value: number) => {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value)
  return bytes
}
const readU32 = (bytes: Uint8Array, offset = 0) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset
  )
const readU16 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
    offset
  )

const equalBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index])

/** A stock Z1 may advertise a placeholder checksum; full readback stays mandatory. */
export function advertisedMd5(payload: Uint8Array): string | null {
  const text = decoder.decode(payload)
  if (
    text.length > 128 ||
    [...text].some((character) => {
      const code = character.charCodeAt(0)
      return code > 126 || (code < 32 && ![9, 10, 13].includes(code))
    })
  )
    throw new TransferError("Invalid uploaded-file checksum response.")
  const digest = text.trim().toLowerCase()
  return /^[a-f0-9]{32}$/.test(digest) && digest !== "0".repeat(32)
    ? digest
    : null
}

/**
 * Upload (B0 upload, B1 MD5, device-driven B2/B3 requests, B4 end) then a full
 * readback (B0 download, B1, B2 view, B3 blocks, B4). Data is never retried.
 */
export class MakeraTransfer implements TransferProtocol {
  private step: Stage = "upload-md5"
  uploadedBytes = 0
  verifiedBytes = 0
  private readonly blocks: number
  private challenged = false
  private lastUpload = 0
  private readbackBlocks = 0
  private readbackSequence = 0
  private endAcknowledgementPending = false
  private cancelled = false
  private readonly bytes: Uint8Array
  private readonly md5: string
  /** The digest as data, like the blocks: it is not a command. */
  private readonly md5Frame: OutboundFrame
  private readonly path: string

  constructor(bytes: Uint8Array, md5: string, path: string) {
    this.bytes = bytes
    this.md5 = md5
    this.md5Frame = { type: FRAME_TYPES.fileMd5, payload: encoder.encode(md5) }
    this.path = path
    this.blocks = Math.ceil(bytes.length / FILE_BLOCK_BYTES)
  }

  get totalBytes() {
    return this.bytes.length
  }

  get stage(): TransferProtocol["stage"] {
    if (this.step === "done") return "done"
    return this.step.startsWith("upload") ? "upload" : "readback"
  }

  /** The device answers the readback's B4 with its own; until then it has the file open. */
  get finished() {
    return this.step === "done" && !this.endAcknowledgementPending
  }

  start(): OutboundFrame[] {
    return [
      { type: FRAME_TYPES.fileStart, payload: `upload ${this.path}\n` },
      this.md5Frame,
    ]
  }

  /** Idempotent: the cancel frame is sent at most once. */
  cancel(): OutboundFrame[] {
    if (this.step === "done" || this.cancelled) return []
    this.cancelled = true
    return [{ type: FRAME_TYPES.fileCancel, payload: new Uint8Array(0) }]
  }

  receive(frame: InboundFrame): OutboundFrame[] {
    if (frame.type === FRAME_TYPES.fileCancel)
      throw new TransferError("The device cancelled the file transfer.")
    if (frame.type === FRAME_TYPES.fileRetry)
      throw new TransferError(
        "The device requested a file retry. Run stopped without retrying."
      )
    const data = frame.payload
    switch (this.step) {
      case "upload-md5":
        if (
          frame.type === FRAME_TYPES.fileMd5 &&
          data.length === 0 &&
          !this.challenged
        ) {
          this.challenged = true
          return [this.md5Frame]
        }
        if (frame.type === FRAME_TYPES.fileView && data.length <= 6) {
          this.step = "upload-data"
          const view = new Uint8Array(6)
          const writer = new DataView(view.buffer)
          writer.setUint32(0, this.blocks)
          writer.setUint16(4, FILE_BLOCK_BYTES)
          return [{ type: FRAME_TYPES.fileView, payload: view }]
        }
        break
      case "upload-data":
        if (frame.type === FRAME_TYPES.fileData && data.length === 4) {
          const sequence = readU32(data)
          if (sequence !== this.lastUpload + 1 || sequence > this.blocks)
            throw new TransferError("Unexpected upload block sequence.")
          this.uploadedBytes = Math.min(
            this.lastUpload * FILE_BLOCK_BYTES,
            this.bytes.length
          )
          this.lastUpload = sequence
          const chunk = this.bytes.subarray(
            (sequence - 1) * FILE_BLOCK_BYTES,
            sequence * FILE_BLOCK_BYTES
          )
          const payload = new Uint8Array(4 + chunk.length)
          payload.set(data)
          payload.set(chunk, 4)
          return [{ type: FRAME_TYPES.fileData, payload }]
        }
        if (isCompletion(frame) && this.lastUpload === this.blocks) {
          this.step = "readback-md5"
          this.uploadedBytes = this.bytes.length
          return [
            { type: FRAME_TYPES.fileStart, payload: `download ${this.path}\n` },
          ]
        }
        break
      case "readback-md5":
        if (frame.type === FRAME_TYPES.fileMd5) {
          const advertised = advertisedMd5(data)
          if (advertised !== null && advertised !== this.md5)
            throw new TransferError("Uploaded file checksum does not match.")
          this.step = "readback-view"
          return [{ type: FRAME_TYPES.fileView, payload: new Uint8Array(0) }]
        }
        break
      case "readback-view":
        if (
          frame.type === FRAME_TYPES.fileView &&
          (data.length === 4 || data.length === 6)
        ) {
          this.readbackBlocks = readU32(data)
          if (
            this.readbackBlocks < 1 ||
            this.readbackBlocks > this.bytes.length ||
            (data.length === 6 &&
              (readU16(data, 4) < 1 || readU16(data, 4) > FILE_BLOCK_BYTES))
          )
            throw new TransferError("Invalid file verification size.")
          this.step = "readback-data"
          return [this.requestReadbackBlock()]
        }
        break
      case "readback-data":
        if (
          frame.type === FRAME_TYPES.fileData &&
          data.length > 4 &&
          data.length <= FILE_BLOCK_BYTES + 4
        ) {
          const content = data.subarray(4)
          const expected = this.bytes.subarray(
            this.verifiedBytes,
            this.verifiedBytes + content.length
          )
          if (
            readU32(data) !== this.readbackSequence ||
            !equalBytes(content, expected)
          )
            throw new TransferError(
              "Uploaded file readback differs from the selected program."
            )
          this.verifiedBytes += content.length
          if (this.readbackSequence < this.readbackBlocks)
            return [this.requestReadbackBlock()]
          if (this.verifiedBytes !== this.bytes.length)
            throw new TransferError("Uploaded file readback is incomplete.")
          this.step = "done"
          this.endAcknowledgementPending = true
          return [{ type: FRAME_TYPES.fileEnd, payload: new Uint8Array(0) }]
        }
        break
      case "done":
        if (this.endAcknowledgementPending && isCompletion(frame)) {
          this.endAcknowledgementPending = false
          return []
        }
        break
    }
    throw new TransferError("Unexpected file transfer response.")
  }

  private requestReadbackBlock(): OutboundFrame {
    this.readbackSequence++
    return { type: FRAME_TYPES.fileData, payload: u32(this.readbackSequence) }
  }
}
