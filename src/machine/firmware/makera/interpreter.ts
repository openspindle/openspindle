import { ProtocolError } from "../adapter.ts"
import type { FirmwareEvent, FirmwareInterpreter } from "../adapter.ts"
import { FRAME_TYPES, FrameDecoder, FrameError } from "./codec.ts"
import { classifyLine } from "./lines.ts"
import {
  parseDiagnostics,
  parseModelLine,
  parseModelState,
  parseStatus,
} from "./status.ts"
import type { Diagnostics } from "./status.ts"

/** An unterminated text line longer than this is not a Makera reply. */
const MAX_PENDING_TEXT = 8192

class LineAssembler {
  private readonly decoder = new TextDecoder()
  private pending = ""

  push(payload: Uint8Array): string[] {
    this.pending += this.decoder.decode(payload, { stream: true })
    const lines = this.pending.split("\n")
    this.pending = lines.pop() ?? ""
    if (this.pending.length > MAX_PENDING_TEXT)
      throw new ProtocolError("Device text response exceeded its limit.")
    return lines.map((line) => line.replace(/\r$/, ""))
  }
}

export class MakeraInterpreter implements FirmwareInterpreter {
  private readonly decoder = new FrameDecoder()
  private readonly text = new TextDecoder()
  private readonly normal = new LineAssembler()
  private readonly config = new LineAssembler()
  private diagnostics: Diagnostics | null = null

  push(chunk: Uint8Array, now: number): FirmwareEvent[] {
    let frames
    try {
      frames = this.decoder.push(chunk)
    } catch (error) {
      if (error instanceof FrameError) throw new ProtocolError(error.message)
      throw error
    }
    const events: FirmwareEvent[] = []
    for (const frame of frames) {
      switch (frame.type) {
        case FRAME_TYPES.status: {
          const raw = this.text.decode(frame.payload)
          const parsed = parseStatus(raw, now, this.diagnostics)
          if (parsed === "unsupported")
            throw new ProtocolError("Unsupported device model.")
          if (parsed) events.push({ kind: "status", ...parsed, raw })
          break
        }
        case FRAME_TYPES.diagnostics: {
          const raw = this.text.decode(frame.payload)
          const diagnostics = parseDiagnostics(raw, now)
          if (diagnostics) {
            this.diagnostics = diagnostics
            events.push({ kind: "diagnostics", telemetry: diagnostics, raw })
          }
          break
        }
        case FRAME_TYPES.loadInfo:
          for (const text of this.config.push(frame.payload))
            events.push({ kind: "config-line", text })
          break
        case FRAME_TYPES.loadError:
          events.push({ kind: "config-error" })
          break
        case FRAME_TYPES.normalInfo:
          for (const text of this.normal.push(frame.payload)) {
            const identity = parseModelLine(text)
            if (identity === "unsupported")
              throw new ProtocolError("Unsupported device model.")
            if (identity)
              events.push({
                kind: "identity",
                identity,
                state: parseModelState(text),
              })
            else if (text.trim())
              events.push({ kind: "line", line: classifyLine(text) })
          }
          break
        default:
          if (
            frame.type >= FRAME_TYPES.fileStart &&
            frame.type <= FRAME_TYPES.fileRetry
          )
            events.push({ kind: "transfer", frame })
      }
    }
    return events
  }
}
