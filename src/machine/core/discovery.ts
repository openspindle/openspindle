import type { NetworkDevice } from "../contract/index.ts"
import type { FirmwareAdapter } from "../firmware/adapter.ts"
import { MachineError } from "./errors.ts"
import type { Clock, DatagramListener } from "./ports.ts"

const LISTEN_MS = 3000
const MAX_DEVICES = 128

type DeviceAddress = Pick<NetworkDevice, "host" | "port">
const address = ({ host, port }: DeviceAddress) => `${host}:${port}`

/** Passive announcements only: no broadcast probe and no automatic connection. */
export class DiscoveryService {
  private current: Promise<NetworkDevice[]> | null = null
  /**
   * The latest announcement per host and port, from every listening window so far: devices on
   * one host, such as two simulators, keep their own names.
   */
  private readonly heard = new Map<string, NetworkDevice>()
  private stop: (() => void) | null = null
  private readonly udp: DatagramListener
  private readonly adapter: FirmwareAdapter
  private readonly clock: Clock

  constructor(udp: DatagramListener, adapter: FirmwareAdapter, clock: Clock) {
    this.udp = udp
    this.adapter = adapter
    this.clock = clock
  }

  /** Concurrent callers share one listening window. */
  discover(): Promise<NetworkDevice[]> {
    this.current ??= new Promise<NetworkDevice[]>((resolve, reject) => {
      const found = new Map<string, NetworkDevice>()
      let finished = false
      let timer: ReturnType<Clock["setTimeout"]> | null = null
      const finish = (error?: Error) => {
        if (finished) return
        finished = true
        this.clock.clearTimeout(timer)
        this.stop?.()
        this.stop = null
        this.current = null
        if (error) reject(error)
        else
          resolve(
            [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
          )
      }
      this.stop = this.udp.listen(this.adapter.discovery.port, {
        ready: () => {
          timer = this.clock.setTimeout(() => finish(), LISTEN_MS)
        },
        message: (data, sender) => {
          const device = this.adapter.discovery.parse(data, sender)
          if (!device) return
          const key = address(device)
          if (found.size < MAX_DEVICES) found.set(key, device)
          if (this.heard.size < MAX_DEVICES || this.heard.has(key))
            this.heard.set(key, device)
        },
        error: (message) =>
          finish(
            new MachineError(
              "connection-lost",
              `LAN discovery failed: ${message}`
            )
          ),
      })
    })
    return this.current
  }

  /** The device that announced itself at a host and port, if one was heard. */
  announced(target: DeviceAddress): NetworkDevice | undefined {
    return this.heard.get(address(target))
  }

  /**
   * The name a device at a host and port announces, listening once if it has not been heard
   * yet. Null when nothing announces there (or listening fails): the caller names it by host.
   */
  async nameOf(target: DeviceAddress): Promise<string | null> {
    const known = this.announced(target)
    if (known) return known.name
    try {
      await this.discover()
    } catch {
      return null
    }
    return this.announced(target)?.name ?? null
  }

  dispose() {
    this.stop?.()
    this.stop = null
  }
}
