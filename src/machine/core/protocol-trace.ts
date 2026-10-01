import type { ConsoleEntry, ConsoleTone } from "../contract/index.ts"
import { FAILURE_LINES } from "../firmware/adapter.ts"
import type { FirmwareEvent, OutboundFrame } from "../firmware/adapter.ts"
import type { Clock } from "./ports.ts"

export type TraceDirection = "sent" | "received" | "note"

export type TraceEntry = {
  readonly at: number
  readonly direction: TraceDirection
  readonly text: string
}

/** How the console shows an entry: its tone, and its own text when that differs. */
export type Shown = { readonly tone: ConsoleTone; readonly text?: string }

/** About an hour and a half of idle polling, or half an hour of a job's faster polling. */
const CAPACITY = 20_000
const TEXT_LIMIT = 240
/** Polling stays out of the console, so this lasts much longer than the trace. */
const CONSOLE_CAPACITY = 1000
const CONSOLE_TEXT_LIMIT = 1000

const MARKS: Record<TraceDirection, string> = {
  sent: "→",
  received: "←",
  note: "•",
}

const frameType = (type: number) => `0x${type.toString(16).padStart(2, "0")}`

const clip = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit)}…` : text

/** Control characters in caret notation (the halt byte reads ^X), trailing line breaks dropped. */
const readable = (text: string) =>
  [...text.trimEnd()]
    .map((character) => {
      const code = character.charCodeAt(0)
      if (code === 9 || (code >= 32 && code !== 127)) return character
      return code === 127 ? "^?" : `^${String.fromCharCode(code + 64)}`
    })
    .join("")

/** Text frames as sent; binary frames (file transfer blocks) by type and size only. */
export function describeOutbound(frame: OutboundFrame): string {
  if (typeof frame.payload === "string") return frame.payload
  return `frame ${frameType(frame.type)} · ${frame.payload.byteLength} bytes`
}

export function describeInbound(event: FirmwareEvent): string {
  switch (event.kind) {
    case "status":
    case "diagnostics":
      return event.raw
    case "identity":
      return `identity · ${event.identity.model}${event.identity.atc ? " · ATC" : ""}${event.state ? ` · ${event.state}` : ""}`
    case "line":
      return `${event.line.text} [${event.line.kind}]`
    case "config-line":
      return `config · ${event.text}`
    case "config-error":
      return "config · error"
    case "transfer":
      return `frame ${frameType(event.frame.type)} · ${event.frame.payload.byteLength} bytes`
  }
}

/** Replies as the console shows them; status reports and transfer frames stay in the trace. */
export function consoleReply(event: FirmwareEvent): Shown | undefined {
  switch (event.kind) {
    case "line": {
      const { kind, text } = event.line
      if (kind === "ack") return { tone: "quiet", text }
      return { tone: FAILURE_LINES.has(kind) ? "failure" : "plain", text }
    }
    case "identity":
    case "config-line":
      return { tone: "plain" }
    case "config-error":
      return { tone: "failure" }
    case "status":
    case "diagnostics":
    case "transfer":
      return undefined
  }
}

/** Oldest first; the oldest entry drops out once it is full. */
class Ring<TEntry> {
  private readonly items: TEntry[] = []
  private oldest = 0
  private readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
  }

  push(entry: TEntry) {
    if (this.items.length < this.capacity) {
      this.items.push(entry)
      return
    }
    this.items[this.oldest] = entry
    this.oldest = (this.oldest + 1) % this.capacity
  }

  list(): TEntry[] {
    return [
      ...this.items.slice(this.oldest),
      ...this.items.slice(0, this.oldest),
    ]
  }
}

/**
 * The recent exchange with the device, for diagnosing firmware behaviour on real hardware:
 * a bounded ring of text in which the oldest entries drop out. Program contents never enter
 * it (transfer blocks are summarised), so exporting it shares only the protocol.
 *
 * The part people read is also kept as the console, followed live: commands, replies and
 * notes, without status polling and transfer blocks.
 */
export class ProtocolTrace {
  private readonly ring = new Ring<TraceEntry>(CAPACITY)
  private readonly console = new Ring<ConsoleEntry>(CONSOLE_CAPACITY)
  private sequence = 0
  private readonly watchers = new Set<(entries: ConsoleEntry[]) => void>()
  private pending: ConsoleEntry[] = []
  private readonly clock: Clock

  constructor(clock: Clock) {
    this.clock = clock
  }

  /** Notes always show in the console too; sent and received entries only when `shown`. */
  record(direction: TraceDirection, text: string, shown?: Shown) {
    const at = this.clock.now()
    this.ring.push({ at, direction, text: clip(text, TEXT_LIMIT) })
    if (!shown && direction !== "note") return
    this.show({
      sequence: this.sequence++,
      at,
      direction,
      text: clip(readable(shown?.text ?? text), CONSOLE_TEXT_LIMIT),
      tone: shown?.tone ?? "plain",
    })
  }

  /** Oldest first. */
  entries(): TraceEntry[] {
    return this.ring.list()
  }

  /** The console so far at once, then new entries in batches as they are recorded. */
  watchConsole(listener: (entries: ConsoleEntry[]) => void): () => void {
    this.watchers.add(listener)
    listener(this.console.list())
    return () => {
      this.watchers.delete(listener)
    }
  }

  /** A burst of replies (one received chunk) reaches watchers as one batch. */
  private show(entry: ConsoleEntry) {
    this.console.push(entry)
    if (!this.watchers.size) return
    this.pending.push(entry)
    if (this.pending.length > 1) return
    queueMicrotask(() => {
      const batch = this.pending
      this.pending = []
      for (const watcher of [...this.watchers]) watcher(batch)
    })
  }
}

/** One line per entry: time, direction and text, with control characters escaped. */
export function formatTrace(entries: readonly TraceEntry[]): string {
  const lines = entries.map(
    (entry) =>
      `${new Date(entry.at).toISOString()} ${MARKS[entry.direction]} ${JSON.stringify(entry.text).slice(1, -1)}`
  )
  return `${lines.join("\n")}\n`
}
