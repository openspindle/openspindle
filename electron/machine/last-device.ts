import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { ConnectTargetSchema } from "../../src/machine/contract/index.ts"
import type {
  ConnectTarget,
  ConnectedDevice,
} from "../../src/machine/contract/index.ts"
import { log } from "./log.ts"
import { writeFileAtomic } from "../main/services/atomic-write.ts"

/** Read whatever version wrote the file; only whether `device` itself still parses matters. */
const StoredSchema = z.object({
  device: ConnectTargetSchema,
})

const same = (a: ConnectTarget, b: ConnectTarget) =>
  a.host === b.host && a.port === b.port && a.name === b.name

/** The device the app last connected to, in the app's data folder, so a launch can try it again. */
export class LastDevice {
  private readonly file: string
  private remembered: ConnectTarget | null = null
  private writes: Promise<void> = Promise.resolve()

  constructor(userData: string) {
    this.file = path.join(userData, "last-device.json")
  }

  /** Null when no device was connected yet, or the record is unreadable. */
  async read(): Promise<ConnectTarget | null> {
    try {
      const stored = StoredSchema.safeParse(
        JSON.parse(await readFile(this.file, "utf8"))
      )
      if (!stored.success) return null
      this.remembered = stored.data.device
      return stored.data.device
    } catch {
      return null
    }
  }

  /** Records a connected device; the file is written only when it is another device. */
  remember(device: ConnectedDevice) {
    const target: ConnectTarget = {
      host: device.host,
      port: device.port,
      name: device.name,
    }
    if (this.remembered && same(this.remembered, target)) return
    this.remembered = target
    const contents = `${JSON.stringify({ version: 1, device: target }, null, 2)}\n`
    this.writes = this.writes
      .then(() => writeFileAtomic(this.file, contents))
      .catch((error: unknown) => {
        log.error("The last used device was not recorded", error)
      })
  }
}
