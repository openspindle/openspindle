import { dialog } from "electron"
import type { BrowserWindow, OpenDialogOptions } from "electron"
import { constants } from "node:fs"
import { access, readFile, rename, stat } from "node:fs/promises"
import path from "node:path"
import { RpcError } from "@openspindle/rpc"
import { z } from "zod"
import type {
  PcbGeneration,
  PcbGenerationRequest,
  PcbStatus,
} from "../../../src/platform/contract/pcb"
import { log } from "../diagnostics/log"
import { writeFileAtomic } from "../services/atomic-write"
import { InputError, MultipleToolSlotsError, generate } from "./converter.mjs"
import { RuntimeError, SetupNeededError, findRuntime } from "./runtime.mjs"
import type { PcbRuntime } from "./runtime.mjs"

const SettingsSchema = z.object({ executable: z.string().max(4096).nullable() })
const LegacyIndexSchema = z.object({
  version: z.literal(1),
  plugins: z.array(z.unknown()),
})
const LegacyPcbSchema = z.object({
  id: z.literal("pcb"),
  settings: z.object({ pcb2gcode: z.string().max(4096).optional() }),
})
const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error)
const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT"

/** Built-in PCB generation, using the user's installed pcb2gcode and no machine access. */
export class PcbService {
  private executable: string | null = null
  private readonly ready: Promise<void>
  private readonly settingsFile: string
  private verification: Promise<PcbRuntime> | null = null
  private jobs = new AbortController()
  private queue = Promise.resolve()
  private settingsQueue = Promise.resolve()
  private dialogOpen = false

  constructor(
    userData: string,
    private readonly window: () => BrowserWindow | null
  ) {
    this.settingsFile = path.join(userData, "pcb.json")
    this.ready = this.load(userData)
    this.ready.catch((error: unknown) =>
      log.error("PCB settings could not be loaded", error)
    )
  }

  async status(): Promise<PcbStatus> {
    await this.ready
    await this.settingsQueue
    // Checking again also finds an install made while the application was open.
    this.verification = null
    return this.health()
  }

  setExecutable(executable: string | null): Promise<PcbStatus> {
    const next = this.settingsQueue.then(async () => {
      await this.ready
      const chosen = executable?.trim() || null
      if (chosen) await this.checkExecutable(chosen)
      await writeFileAtomic(
        this.settingsFile,
        JSON.stringify({ executable: chosen }, null, 2)
      )
      this.jobs.abort()
      this.jobs = new AbortController()
      this.executable = chosen
      this.verification = null
      return this.health()
    })
    this.settingsQueue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  async chooseExecutable(): Promise<PcbStatus> {
    if (this.dialogOpen)
      throw new RpcError("BUSY", "A PCB file dialog is already open.")
    this.dialogOpen = true
    try {
      const options: OpenDialogOptions = {
        title: "Choose pcb2gcode",
        properties: ["openFile", "showHiddenFiles"],
      }
      const window = this.window()
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      const executable = result.filePaths[0]
      if (result.canceled || !executable) return this.status()
      return await this.setExecutable(executable)
    } finally {
      this.dialogOpen = false
    }
  }

  async generate(
    request: PcbGenerationRequest,
    requestSignal: AbortSignal
  ): Promise<PcbGeneration> {
    await this.ready
    await this.settingsQueue
    const signal = AbortSignal.any([requestSignal, this.jobs.signal])
    const started = Date.now()
    try {
      const result = await this.exclusive(signal, async () => {
        const { executable } = await this.runtime()
        return generate(request, { executable, signal })
      })
      log.info(
        `Generated ${result.programs.map((program) => program.name).join(", ")} in ${Date.now() - started} ms.`
      )
      return {
        schemaVersion: 1,
        programs: result.programs,
        warnings: result.warnings,
      }
    } catch (error) {
      if (signal.aborted)
        throw new RpcError("CANCELLED", "Generation cancelled.")
      log.warn(`PCB generation failed: ${describe(error)}`)
      if (error instanceof MultipleToolSlotsError)
        throw new RpcError("INVALID_PARAMS", error.message, {
          reason: "multiple-tool-slots",
          slots: error.slots,
        })
      if (error instanceof InputError)
        throw new RpcError("INVALID_PARAMS", error.message)
      if (error instanceof RuntimeError) {
        this.verification = null
        throw new RpcError("UNAVAILABLE", error.message)
      }
      throw error
    }
  }

  /** No pcb2gcode process may outlive the app. */
  dispose() {
    this.jobs.abort()
  }

  /** Finish a settings write before the app quits. */
  async idle(): Promise<void> {
    await this.ready.catch(() => undefined)
    await this.settingsQueue
  }

  private runtime(): Promise<PcbRuntime> {
    if (this.verification) return this.verification
    const verification = findRuntime(this.executable, {
      signal: this.jobs.signal,
    }).catch((error: unknown) => {
      if (this.verification === verification) this.verification = null
      throw error
    })
    this.verification = verification
    return verification
  }

  private async health(): Promise<PcbStatus> {
    try {
      const { executable, version, found } = await this.runtime()
      return {
        executable: this.executable,
        status: "ready",
        message: (found
          ? `pcb2gcode ${version} at ${executable}, found automatically`
          : `pcb2gcode ${version}`
        ).slice(0, 2000),
      }
    } catch (error) {
      return {
        executable: this.executable,
        status: error instanceof SetupNeededError ? "needs-setup" : "degraded",
        message: describe(error).slice(0, 2000),
      }
    }
  }

  /** One converter at a time; a cancelled waiting request promptly leaves the queue. */
  private async exclusive<T>(
    signal: AbortSignal,
    run: () => Promise<T>
  ): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = new Promise<void>((resolve) => {
      release = resolve
    })
    let abort!: () => void
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new RpcError("CANCELLED", "Generation cancelled."))
      if (signal.aborted) abort()
      else signal.addEventListener("abort", abort, { once: true })
    })
    try {
      await Promise.race([previous, cancelled])
      if (signal.aborted)
        throw new RpcError("CANCELLED", "Generation cancelled.")
      return await run()
    } finally {
      signal.removeEventListener("abort", abort)
      void previous.then(release)
    }
  }

  private async checkExecutable(executable: string): Promise<void> {
    if (!path.isAbsolute(executable))
      throw new RpcError("INVALID_PARAMS", "Enter the full path of pcb2gcode.")
    const info = await stat(executable).catch(() => null)
    if (!info?.isFile())
      throw new RpcError(
        "INVALID_PARAMS",
        `There is no program at ${executable}.`
      )
    try {
      await access(executable, constants.X_OK)
    } catch {
      throw new RpcError(
        "INVALID_PARAMS",
        `${executable} is not a program you can run.`
      )
    }
  }

  private async load(userData: string): Promise<void> {
    try {
      this.executable = SettingsSchema.parse(
        JSON.parse(await readFile(this.settingsFile, "utf8"))
      ).executable
      return
    } catch (error) {
      if (!missing(error)) {
        const recovery = path.join(userData, `pcb-invalid-${Date.now()}.json`)
        await rename(this.settingsFile, recovery)
        log.warn(
          `PCB settings could not be loaded. Using automatic detection; the original settings are kept at ${recovery}.`,
          error
        )
        return
      }
    }
    // Preserve a program chosen for PCB before it became a built-in feature.
    try {
      const index = LegacyIndexSchema.parse(
        JSON.parse(
          await readFile(path.join(userData, "plugins", "index.json"), "utf8")
        )
      )
      for (const entry of index.plugins) {
        const parsed = LegacyPcbSchema.safeParse(entry)
        if (!parsed.success) continue
        this.executable = parsed.data.settings.pcb2gcode ?? null
        await writeFileAtomic(
          this.settingsFile,
          JSON.stringify({ executable: this.executable }, null, 2)
        )
        break
      }
    } catch (error) {
      if (!missing(error))
        log.warn("Previous PCB settings could not be migrated", error)
    }
  }
}
