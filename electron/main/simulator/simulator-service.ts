import { readFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import {
  DEFAULT_SIMULATOR_SETTINGS,
  SimulatorSettingsSchema,
} from "../../../src/platform/contract/simulator"
import type {
  SimulatorSettings,
  SimulatorStatus,
} from "../../../src/platform/contract/simulator"
import {
  DEFAULT_SIMULATOR_OPTIONS,
  serveSimulator,
} from "../../../tools/z1-simulator/server.ts"
import type { SimulatorServer } from "../../../tools/z1-simulator/server.ts"
import { log } from "../diagnostics/log"
import { writeFileAtomic } from "../services/atomic-write"

/** Next to the Z1's own 2222, where `npm run sim:z1` listens unless told otherwise. */
const PORT = 2223
const HOST = "127.0.0.1"
const NAME = "Z1 Simulator"

/** A setting that is missing or unreadable follows the default; the others stay. */
const StoredSchema = z.object({
  enabled: SimulatorSettingsSchema.shape.enabled.optional().catch(undefined),
  speed: SimulatorSettingsSchema.shape.speed.optional().catch(undefined),
})

/** Why listening failed, in words: a taken port is the usual reason. */
function listenFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  if ((error as NodeJS.ErrnoException).code === "EADDRINUSE")
    return "another program listens there"
  return error.message
}

/** The settings a patch or the stored file sets. */
function chosenIn({
  enabled,
  speed,
}: Partial<SimulatorSettings>): Partial<SimulatorSettings> {
  return {
    ...(enabled === undefined ? {} : { enabled }),
    ...(speed === undefined ? {} : { speed }),
  }
}

/**
 * The simulated Z1 the app runs, so the simulator is there without `npm run sim:z1`: on the
 * loopback address, announced for discovery like a machine, without a camera stream (the app
 * draws what its camera would see). simulator.json in the app's data folder keeps the settings
 * the user changed.
 */
export class SimulatorService {
  private readonly file: string
  private chosen: Partial<SimulatorSettings>
  private writes: Promise<void> = Promise.resolve()
  private server: SimulatorServer | null = null
  /** Starting or stopping: the next change waits for it. */
  private changing: Promise<void> = Promise.resolve()
  private error: string | null = null

  constructor(userData: string) {
    this.file = path.join(userData, "simulator.json")
    this.chosen = this.readSync()
  }

  get settings(): SimulatorSettings {
    return { ...DEFAULT_SIMULATOR_SETTINGS, ...this.chosen }
  }

  /** Once it has started or stopped as the settings last said. */
  async status(): Promise<SimulatorStatus> {
    await this.changing
    return this.snapshot()
  }

  private snapshot(): SimulatorStatus {
    return {
      settings: this.settings,
      host: HOST,
      port: PORT,
      running: this.server !== null,
      error: this.error,
    }
  }

  /** At launch: runs it when enabled. */
  start(): Promise<SimulatorStatus> {
    return this.apply()
  }

  async update(patch: Partial<SimulatorSettings>): Promise<SimulatorStatus> {
    const previous = this.chosen
    const next = { ...previous, ...chosenIn(patch) }
    this.chosen = next
    const contents = `${JSON.stringify({ version: 1, ...next }, null, 2)}\n`
    const write = this.writes.then(() => writeFileAtomic(this.file, contents))
    this.writes = write.catch(() => undefined)
    try {
      await write
    } catch (error) {
      if (this.chosen === next) this.chosen = previous
      throw error
    }
    return this.apply()
  }

  dispose() {
    this.server?.close()
    this.server = null
  }

  /** Starts or stops it to follow the settings, and gives it their speed. */
  private apply(): Promise<SimulatorStatus> {
    this.changing = this.changing.then(async () => {
      const { enabled, speed } = this.settings
      if (!enabled) {
        if (this.server) log.info("Z1 simulator stopped")
        this.dispose()
        this.error = null
        return
      }
      if (this.server) {
        this.server.device.speed = speed
        return
      }
      try {
        this.server = await serveSimulator({
          name: NAME,
          port: PORT,
          options: { ...DEFAULT_SIMULATOR_OPTIONS, speed },
          log: (message) => log.debug(`Z1 simulator: ${message}`),
        })
        this.error = null
        log.info(`Z1 simulator listening on ${HOST}:${PORT}`)
      } catch (error) {
        this.error = `It could not listen on ${HOST}:${PORT}: ${listenFailure(error)}.`
        log.warn("Z1 simulator could not start", error)
      }
    })
    return this.changing.then(() => this.snapshot())
  }

  private readSync(): Partial<SimulatorSettings> {
    try {
      const stored = StoredSchema.safeParse(
        JSON.parse(readFileSync(this.file, "utf8"))
      )
      if (stored.success) return chosenIn(stored.data)
    } catch {
      // Missing or unreadable: the defaults.
    }
    return {}
  }
}
