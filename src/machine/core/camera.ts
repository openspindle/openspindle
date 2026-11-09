import type {
  CameraConnection,
  CameraConnector,
  Clock,
  TimerHandle,
} from "./ports.ts"

const MAX_FRAME_BYTES = 4 * 1024 * 1024
const CONNECT_TIMEOUT_MS = 8000
const FRAME_TIMEOUT_MS = 15000

type CameraStatus = "connecting" | "live" | "paused" | "error"

export type CameraEvent =
  | {
      readonly kind: "status"
      readonly status: CameraStatus
    }
  | {
      readonly kind: "frame"
      readonly jpeg: Uint8Array
      readonly receivedAt: number
    }

type Feed = {
  readonly url: string
  readonly listeners: Set<(event: CameraEvent) => void>
  connection: CameraConnection | null
  timer: TimerHandle | null
  status: CameraStatus
  generation: number
}

const isJpeg = (bytes: Uint8Array) =>
  bytes.length >= 4 &&
  bytes[0] === 0xff &&
  bytes[1] === 0xd8 &&
  bytes[bytes.length - 2] === 0xff &&
  bytes[bytes.length - 1] === 0xd9

/**
 * The Z1 camera: a WebSocket that streams one JPEG per binary message after
 * "start_stream". One connection per URL, shared by every subscriber.
 */
export class CameraFeed {
  private readonly feeds = new Map<string, Feed>()
  private readonly connector: CameraConnector
  private readonly clock: Clock
  private pauses = 0

  constructor(connector: CameraConnector, clock: Clock) {
    this.connector = connector
    this.clock = clock
  }

  subscribe(url: string, listener: (event: CameraEvent) => void): () => void {
    let feed = this.feeds.get(url)
    if (!feed) {
      feed = {
        url,
        listeners: new Set(),
        connection: null,
        timer: null,
        status: this.pauses ? "paused" : "connecting",
        generation: 0,
      }
      this.feeds.set(url, feed)
      if (!this.pauses) this.open(feed)
    }
    feed.listeners.add(listener)
    listener({ kind: "status", status: feed.status })
    const current = feed
    return () => {
      current.listeners.delete(listener)
      if (!current.listeners.size) this.close(current)
    }
  }

  /** Free the device's bandwidth without losing the viewers' subscriptions. */
  pause(): () => void {
    this.pauses++
    if (this.pauses === 1) {
      for (const feed of this.feeds.values()) {
        if (feed.status === "error") continue
        this.disconnect(feed)
        feed.status = "paused"
        this.emit(feed, { kind: "status", status: "paused" })
      }
    }
    let released = false
    return () => {
      if (released) return
      released = true
      this.pauses--
      if (this.pauses) return
      for (const feed of this.feeds.values()) {
        if (feed.status !== "paused") continue
        feed.status = "connecting"
        this.emit(feed, { kind: "status", status: "connecting" })
        this.open(feed)
      }
    }
  }

  dispose() {
    for (const feed of [...this.feeds.values()]) this.close(feed)
  }

  private emit(feed: Feed, event: CameraEvent) {
    for (const listener of [...feed.listeners]) listener(event)
  }

  private arm(feed: Feed, milliseconds: number) {
    this.clock.clearTimeout(feed.timer)
    feed.timer = this.clock.setTimeout(() => this.fail(feed), milliseconds)
  }

  private open(feed: Feed) {
    const generation = ++feed.generation
    const current = () =>
      this.feeds.get(feed.url) === feed && feed.generation === generation
    this.arm(feed, CONNECT_TIMEOUT_MS)
    try {
      feed.connection = this.connector.open(feed.url, {
        open: () => {
          if (current()) feed.connection?.send("start_stream")
        },
        binary: (data) => {
          if (!current()) return
          if (data.length > MAX_FRAME_BYTES || !isJpeg(data)) {
            this.fail(feed)
            return
          }
          this.arm(feed, FRAME_TIMEOUT_MS)
          if (feed.status !== "live") {
            feed.status = "live"
            this.emit(feed, { kind: "status", status: "live" })
          }
          this.emit(feed, {
            kind: "frame",
            jpeg: data,
            receivedAt: this.clock.now(),
          })
        },
        closed: () => {
          if (current()) this.fail(feed)
        },
      })
    } catch {
      this.fail(feed)
    }
  }

  /** The feed stays failed until every subscriber leaves; a new subscription retries. */
  private fail(feed: Feed) {
    if (this.feeds.get(feed.url) !== feed || feed.status === "error") return
    feed.status = "error"
    this.disconnect(feed)
    this.emit(feed, { kind: "status", status: "error" })
  }

  private close(feed: Feed) {
    if (this.feeds.get(feed.url) === feed) this.feeds.delete(feed.url)
    this.disconnect(feed)
  }

  private disconnect(feed: Feed) {
    this.clock.clearTimeout(feed.timer)
    feed.timer = null
    feed.generation++
    const connection = feed.connection
    feed.connection = null
    connection?.close()
  }
}
