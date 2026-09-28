import { randomUUID } from "node:crypto"
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { log } from "../diagnostics/log"
import { RpcError } from "@openspindle/rpc"
import {
  InstalledPluginRecordSchema,
  inventoryEntry,
  isPackagePath,
} from "@openspindle/plugin-core"
import type {
  InstalledPluginRecord,
  PackageSink,
} from "@openspindle/plugin-core"
import { nodeSha256 } from "@openspindle/plugin-sdk/node"
import { z } from "zod"
import { writeFileAtomic } from "../services/atomic-write"
import { declaredSetting } from "./settings"

const INDEX_FILE = "index.json"
const STAGING = ".staging"
const TRASH = ".trash"

const IndexSchema = z.object({
  version: z.literal(1),
  plugins: z.array(z.unknown()),
})

/** A package being installed: files land here before the review is confirmed. */
export type StagedPackage = {
  readonly directory: string
  readonly sink: PackageSink
}

/**
 * Installed packages under `<root>/<id>/<version>/`, described by `<root>/index.json`.
 * Mutations are serialized; the index is replaced atomically after files are in place.
 */
export class PluginRegistry {
  private readonly records = new Map<string, InstalledPluginRecord>()
  private readonly listeners = new Set<() => void>()
  private queue: Promise<unknown> = Promise.resolve()
  /** Ids currently disabled, replaced or removed by withLock: companion starts wait these out. */
  private readonly locks = new Map<string, Promise<void>>()
  readonly ready: Promise<void>

  constructor(private readonly root: string) {
    this.ready = this.load()
    // Every caller awaits `ready` and reports its failure; this only keeps it observed.
    this.ready.catch((error: unknown) => {
      log.error("Installed plugins could not be loaded", error)
    })
  }

  list(): InstalledPluginRecord[] {
    return [...this.records.values()].sort((a, b) =>
      a.manifest.name.localeCompare(b.manifest.name)
    )
  }

  get(id: string): InstalledPluginRecord | undefined {
    return this.records.get(id)
  }

  require(id: string): InstalledPluginRecord {
    const record = this.records.get(id)
    if (!record)
      throw new RpcError("NOT_FOUND", "This plugin is not installed.")
    return record
  }

  /** Enabled plugins only: disabled ones keep their files but serve nothing. */
  requireEnabled(id: string): InstalledPluginRecord {
    const record = this.require(id)
    if (!record.enabled)
      throw new RpcError("UNAVAILABLE", `${record.manifest.name} is disabled.`)
    return record
  }

  packageDirectory(record: InstalledPluginRecord): string {
    return path.join(this.root, record.id, record.version)
  }

  filePath(record: InstalledPluginRecord, file: string): string {
    if (!isPackagePath(file))
      throw new RpcError("INVALID_PARAMS", `${file} is not a package path.`)
    return path.join(this.packageDirectory(record), ...file.split("/"))
  }

  /** Reads an installed file and checks it against the inventory taken at install. */
  async readVerified(
    record: InstalledPluginRecord,
    file: string,
    maxBytes: number
  ): Promise<Uint8Array> {
    const entry = inventoryEntry(record.inventory, file)
    if (entry.bytes > maxBytes)
      throw new RpcError("LIMIT_EXCEEDED", `${file} is too large.`)
    const bytes = await readFile(this.filePath(record, file)).catch(() => {
      throw new RpcError(
        "FAILED",
        `${record.manifest.name} is missing ${file}. Reinstall the plugin.`
      )
    })
    if (
      bytes.byteLength !== entry.bytes ||
      (await nodeSha256(bytes)) !== entry.sha256
    )
      throw new RpcError(
        "FAILED",
        `${record.manifest.name} was changed after it was installed. Reinstall the plugin.`
      )
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** A fresh staging folder whose sink writes package files beneath it. */
  async stage(): Promise<StagedPackage> {
    await this.ready
    const directory = path.join(this.root, STAGING, randomUUID())
    await mkdir(directory, { recursive: true })
    return {
      directory,
      sink: {
        async write(file) {
          const target = path.join(directory, ...file.path.split("/"))
          await mkdir(path.dirname(target), { recursive: true })
          await writeFile(target, file.bytes, { flag: "wx", mode: 0o644 })
          if (file.executable) await chmod(target, 0o755)
        },
      },
    }
  }

  async discard(staged: StagedPackage): Promise<void> {
    await rm(staged.directory, { recursive: true, force: true })
  }

  /**
   * Moves staged files into place, then records them; the previous version is removed. A
   * reinstall of the version already on disk shares its folder with the staged one: that
   * folder is set aside rather than deleted outright, restored if the move fails, and only
   * cleared once the new files are in place and the index names them.
   */
  commit(
    staged: StagedPackage,
    record: InstalledPluginRecord
  ): Promise<InstalledPluginRecord> {
    return this.mutate(async () => {
      const previous = this.records.get(record.id)
      const target = this.packageDirectory(record)
      const backup = (await exists(target)) ? await this.setAside(target) : null
      try {
        await mkdir(path.dirname(target), { recursive: true })
        await rename(staged.directory, target)
      } catch (error) {
        if (backup) await rename(backup, target).catch(() => undefined)
        throw error
      }
      const plugins = [...this.records.values()].filter(
        (item) => item.id !== record.id
      )
      plugins.push(record)
      await this.writeIndex(plugins)
      this.records.set(record.id, record)
      if (backup) await rm(backup, { recursive: true, force: true })
      if (previous && previous.version !== record.version)
        await this.trash(this.packageDirectory(previous))
      return record
    })
  }

  /** Waits out any disable, replace or removal in progress for `id`. */
  async whenUnlocked(id: string): Promise<void> {
    const current = this.locks.get(id)
    if (current) await current
  }

  /**
   * Runs `run` with `id` locked: a companion start beginning while it runs waits for it to
   * finish first (see whenUnlocked), so it can never start from a version folder that
   * disabling, replacing or removing the plugin is about to change underneath it. The lock
   * is recorded before `run` starts, so a start checking it meanwhile always sees it.
   */
  withLock<T>(id: string, run: () => Promise<T>): Promise<T> {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    this.locks.set(id, gate)
    return run().finally(() => {
      if (this.locks.get(id) === gate) this.locks.delete(id)
      release()
    })
  }

  setEnabled(id: string, enabled: boolean): Promise<InstalledPluginRecord> {
    return this.mutate(async () => {
      const record = { ...this.require(id), enabled }
      this.records.set(id, record)
      await this.writeIndex()
      return record
    })
  }

  /**
   * Sets the value of one of the plugin's settings, or clears it (null). The setting is
   * checked against the record this replaces, which an update may have changed meanwhile.
   */
  setSetting(
    id: string,
    settingId: string,
    value: string | null
  ): Promise<InstalledPluginRecord> {
    return this.mutate(async () => {
      const current = this.require(id)
      declaredSetting(current, settingId)
      const settings = Object.fromEntries(
        Object.entries(current.settings).filter(([key]) => key !== settingId)
      )
      if (value !== null) settings[settingId] = value
      const record = { ...current, settings }
      this.records.set(id, record)
      await this.writeIndex()
      return record
    })
  }

  remove(id: string): Promise<void> {
    return this.mutate(async () => {
      this.require(id)
      this.records.delete(id)
      await this.writeIndex()
      await this.trash(path.join(this.root, id))
    })
  }

  private mutate<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      await this.ready
      const result = await run()
      for (const listener of this.listeners) listener()
      return result
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  /**
   * Writes `records` (the current ones by default), so commit() can write the new record in
   * before `this.records` reflects it: memory only takes it on once the index names it too.
   */
  private async writeIndex(records?: readonly InstalledPluginRecord[]) {
    await mkdir(this.root, { recursive: true })
    await writeFileAtomic(
      path.join(this.root, INDEX_FILE),
      `${JSON.stringify(
        { version: 1, plugins: records ?? [...this.records.values()] },
        null,
        2
      )}\n`
    )
  }

  /** Renames first so a half-deleted folder never looks installed. */
  private async trash(directory: string) {
    const bin = path.join(this.root, TRASH)
    await mkdir(bin, { recursive: true })
    const target = path.join(bin, randomUUID())
    await rename(directory, target).catch(() => undefined)
    await rm(target, { recursive: true, force: true })
  }

  /**
   * Renames a folder into the trash bin without deleting it yet: commit() can still restore
   * it if moving the new package in fails, and only deletes it once that succeeds.
   */
  private async setAside(directory: string): Promise<string> {
    const bin = path.join(this.root, TRASH)
    await mkdir(bin, { recursive: true })
    const target = path.join(bin, randomUUID())
    await rename(directory, target)
    return target
  }

  /** Reads the index, dropping unreadable records, and clears leftovers of interrupted work. */
  private async load() {
    let raw: string | null = null
    try {
      raw = await readFile(path.join(this.root, INDEX_FILE), "utf8")
    } catch {
      raw = null
    }
    let indexTrusted = true
    if (raw !== null) {
      const index = IndexSchema.safeParse(safeJson(raw))
      if (!index.success) {
        indexTrusted = false
        log.error("The plugin index is unreadable; it was set aside")
        await rename(
          path.join(this.root, INDEX_FILE),
          path.join(this.root, `${INDEX_FILE}.unreadable-${Date.now()}`)
        ).catch(() => undefined)
      } else
        for (const item of index.data.plugins) {
          const record = InstalledPluginRecordSchema.safeParse(item)
          if (record.success) this.records.set(record.data.id, record.data)
          else log.error("Dropped an unreadable installed plugin record")
        }
    }
    await rm(path.join(this.root, STAGING), { recursive: true, force: true })
    await rm(path.join(this.root, TRASH), { recursive: true, force: true })
    // An unreadable index means what is actually installed is unknown, so leftover package
    // folders must be kept as they are: removeUnlisted would otherwise read this empty map
    // and delete every one of them.
    if (indexTrusted) await this.removeUnlisted()
  }

  private async removeUnlisted() {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(
      () => []
    )
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const record = this.records.get(entry.name)
      if (!record) {
        await rm(path.join(this.root, entry.name), {
          recursive: true,
          force: true,
        })
        continue
      }
      const versions = await readdir(path.join(this.root, entry.name)).catch(
        () => []
      )
      for (const version of versions)
        if (version !== record.version)
          await rm(path.join(this.root, entry.name, version), {
            recursive: true,
            force: true,
          })
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false
  )
}
