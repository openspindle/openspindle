import { CONFIGURATION_MAX_BYTES } from "../../contract/configuration.ts"
import { TransferError } from "../adapter.ts"
import type {
  DownloadProtocol,
  InboundFrame,
  OutboundFrame,
} from "../adapter.ts"
import { FILE_BLOCK_BYTES, FRAME_TYPES } from "./codec.ts"
import { advertisedMd5 } from "./transfer.ts"

export const MAKERA_CONFIGURATION_PATH = "/sd/config.txt"

const VACUUM_DEFAULT_POWER_KEY = "switch.vacuum.default_on_value"

/** Match active keys and their first value token, allowing a preserved UTF-8 document marker. */
function vacuumDefaultPowerSettings(content: string) {
  return Array.from(
    content.matchAll(
      /^\uFEFF?[ \t]*switch\.vacuum\.default_on_value(?=[ \t\r\n]|$)[ \t]*([^ \t\r\n#]*)/gm
    )
  )
}

export function readMakeraVacuumDefaultPower(content: string): number | null {
  const settings = vacuumDefaultPowerSettings(content)
  if (settings.length !== 1) return null
  const value = settings[0][1]
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
    return null
  const percent = Number(value)
  return Number.isFinite(percent) ? percent : null
}

/** Change only the value token; preserve the rest of the file, including its line endings. */
export function withMakeraVacuumDefaultPower(
  content: string,
  percent: number
): string {
  const settings = vacuumDefaultPowerSettings(content)
  if (settings.length > 1)
    throw new Error(
      "The configuration contains duplicate vacuum default settings. Open Firmware configuration and remove the duplicate before saving vacuum power."
    )
  const setting = settings.at(0)
  if (setting) {
    const value = setting[1]
    const start = setting.index + setting[0].length - value.length
    const separator = /[ \t]$/.test(content.slice(0, start)) ? "" : " "
    return (
      content.slice(0, start) +
      (value ? "" : separator) +
      String(percent) +
      content.slice(start + value.length)
    )
  }
  const newline = /\r\n|\n|\r/.exec(content)?.[0] ?? "\n"
  const separator = /[\r\n]$/.test(content) ? "" : newline
  return `${content}${separator}${VACUUM_DEFAULT_POWER_KEY} ${percent}${newline}`
}

type Stage = "start" | "md5" | "view" | "data" | "end" | "done"

const COMPLETION = new TextEncoder().encode("ok\r\n")
const isCompletion = (frame: InboundFrame) =>
  frame.type === FRAME_TYPES.fileEnd &&
  (frame.payload.length === 0 ||
    (frame.payload.length === COMPLETION.length &&
      frame.payload.every((byte, index) => byte === COMPLETION[index])))

/** One read of the saved SD configuration, with no retries or arbitrary file paths. */
export class MakeraConfigurationDownload implements DownloadProtocol {
  private step: Stage = "start"
  private cancelled = false
  private digest: string | null = null
  private blocks = 0
  private blockSize = FILE_BLOCK_BYTES
  private sequence = 0
  private length = 0
  private content = new Uint8Array(0)

  get finished() {
    return this.step === "done"
  }

  get bytes(): Uint8Array {
    if (!this.finished)
      throw new TransferError("The configuration download is not complete.")
    return this.content.slice(0, this.length)
  }

  get md5() {
    return this.digest
  }

  start(): OutboundFrame[] {
    if (this.step !== "start" || this.cancelled)
      throw new TransferError("The configuration download has already started.")
    this.step = "md5"
    return [
      {
        type: FRAME_TYPES.fileStart,
        payload: `download ${MAKERA_CONFIGURATION_PATH}\n`,
      },
    ]
  }

  cancel(): OutboundFrame[] {
    if (this.finished || this.cancelled || this.step === "start") return []
    this.cancelled = true
    return [{ type: FRAME_TYPES.fileCancel, payload: new Uint8Array(0) }]
  }

  receive(frame: InboundFrame): OutboundFrame[] {
    if (this.cancelled)
      throw new TransferError("The configuration download was cancelled.")
    if (frame.type === FRAME_TYPES.fileCancel)
      throw new TransferError(
        "The device cancelled the configuration download."
      )
    if (frame.type === FRAME_TYPES.fileRetry)
      throw new TransferError(
        "The device requested a configuration download retry."
      )
    const data = frame.payload
    const reader = new DataView(data.buffer, data.byteOffset, data.byteLength)
    switch (this.step) {
      case "md5":
        if (frame.type === FRAME_TYPES.fileMd5) {
          this.digest = advertisedMd5(data)
          this.step = "view"
          return [{ type: FRAME_TYPES.fileView, payload: new Uint8Array(0) }]
        }
        break
      case "view":
        if (
          frame.type === FRAME_TYPES.fileView &&
          (data.length === 4 || data.length === 6)
        ) {
          this.blocks = reader.getUint32(0)
          this.blockSize =
            data.length === 6 ? reader.getUint16(4) : FILE_BLOCK_BYTES
          if (
            this.blocks < 1 ||
            this.blockSize < 1 ||
            this.blockSize > FILE_BLOCK_BYTES ||
            (this.blocks - 1) * this.blockSize >= CONFIGURATION_MAX_BYTES
          )
            throw new TransferError("Invalid configuration file size.")
          this.content = new Uint8Array(
            Math.min(this.blocks * this.blockSize, CONFIGURATION_MAX_BYTES)
          )
          this.step = "data"
          return [this.requestBlock()]
        }
        break
      case "data":
        if (
          frame.type === FRAME_TYPES.fileData &&
          data.length > 4 &&
          data.length <= this.blockSize + 4
        ) {
          const chunk = data.subarray(4)
          if (reader.getUint32(0) !== this.sequence)
            throw new TransferError("Unexpected configuration block sequence.")
          if (
            this.length + chunk.length > CONFIGURATION_MAX_BYTES ||
            (this.sequence < this.blocks && chunk.length !== this.blockSize)
          )
            throw new TransferError("Invalid configuration block size.")
          this.content.set(chunk, this.length)
          this.length += chunk.length
          if (this.sequence < this.blocks) return [this.requestBlock()]
          this.step = "end"
          return [{ type: FRAME_TYPES.fileEnd, payload: new Uint8Array(0) }]
        }
        break
      case "end":
        if (isCompletion(frame)) {
          this.step = "done"
          return []
        }
        break
    }
    throw new TransferError("Unexpected configuration download response.")
  }

  private requestBlock(): OutboundFrame {
    const payload = new Uint8Array(4)
    new DataView(payload.buffer).setUint32(0, ++this.sequence)
    return { type: FRAME_TYPES.fileData, payload }
  }
}
