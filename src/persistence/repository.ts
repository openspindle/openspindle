import { z } from "zod"
import type { BackupResult, StorageKey } from "@/platform/contract/storage"
import type { StoragePort } from "@/platform/host"

/** Something the user should know about stored data; errors block saving until resolved. */
export type LoadIssue = {
  readonly store: StorageKey
  readonly severity: "warning" | "error"
  readonly message: string
}

/** A decoded value plus the items that were dropped along the way. */
export type Decoded<TValue> = {
  readonly value: TValue
  readonly dropped: readonly string[]
}

export type LoadOutcome<TValue> =
  | { readonly status: "empty" }
  /** `issues` lists dropped items; saving would lose them, so it waits for consent. */
  | {
      readonly status: "loaded"
      readonly value: TValue
      readonly issues: readonly LoadIssue[]
    }
  | { readonly status: "failed"; readonly issues: readonly LoadIssue[] }
  /** Written by a newer OpenSpindle; this version must not overwrite it. */
  | { readonly status: "newer"; readonly issues: readonly LoadIssue[] }

export type RepositoryOptions<TValue> = {
  readonly key: StorageKey
  /** Shown in messages: "the workspace", "the fixture library". */
  readonly title: string
  /** The version this store writes; data of a newer one is refused. */
  readonly version: number
  /**
   * Data of earlier versions, from `oldest`, in the current version's shape; absent where only
   * the current version is read.
   */
  readonly upgrade?: {
    readonly oldest: number
    readonly from: (data: unknown, version: number) => unknown
  }
  /** Items that cannot be restored are dropped and named; anything fatal throws. */
  readonly decode: (data: unknown) => Decoded<TValue>
  readonly encode: (value: TValue) => unknown
  /** Structure of encoded data, checked item by item as decoding is: a save that the next load
   * would reject or drop part of is refused. */
  readonly schema: z.ZodType
}

const EnvelopeSchema = z.object({
  version: z.int().positive(),
  data: z.unknown(),
})

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

/**
 * One versioned JSON document in host storage: `{version, data}`, decoded item by item, so
 * one bad item never discards the rest. Data of an earlier version is read only through the
 * store's `upgrade`.
 */
export class Repository<TValue> {
  readonly key: StorageKey
  private readonly storage: StoragePort
  private readonly options: RepositoryOptions<TValue>

  constructor(storage: StoragePort, options: RepositoryOptions<TValue>) {
    this.storage = storage
    this.options = options
    this.key = options.key
  }

  async load(): Promise<LoadOutcome<TValue>> {
    const { title, version } = this.options
    const failed = (text: string): LoadOutcome<TValue> => ({
      status: "failed",
      issues: [{ store: this.key, severity: "error", message: text }],
    })
    let envelope: { version: number; data: unknown }
    try {
      const raw = await this.storage.read(this.key)
      if (raw === null) return { status: "empty" }
      const parsed = EnvelopeSchema.safeParse(JSON.parse(raw))
      if (!parsed.success)
        return failed(`${title} is not in a readable format.`)
      envelope = parsed.data
    } catch (error) {
      return failed(`${title} could not be read: ${message(error)}`)
    }
    if (envelope.version > version)
      return {
        status: "newer",
        issues: [
          {
            store: this.key,
            severity: "error",
            message: `${title} was saved by a newer version of OpenSpindle.`,
          },
        ],
      }
    const { upgrade } = this.options
    if (
      envelope.version < version &&
      (!upgrade || envelope.version < upgrade.oldest)
    )
      return failed(
        `${title} is from an earlier version of OpenSpindle, which this version cannot read.`
      )
    try {
      const data =
        upgrade && envelope.version < version
          ? upgrade.from(envelope.data, envelope.version)
          : envelope.data
      const decoded = this.options.decode(data)
      return {
        status: "loaded",
        value: decoded.value,
        issues: decoded.dropped.map((text) => ({
          store: this.key,
          severity: "warning",
          message: text,
        })),
      }
    } catch (error) {
      return failed(`${title} could not be restored: ${message(error)}`)
    }
  }

  /** Throws instead of writing data that would not load again. */
  async save(value: TValue): Promise<void> {
    const data = this.options.encode(value)
    const checked = this.options.schema.safeParse(data)
    if (!checked.success)
      throw new Error(
        `${this.options.title} was not updated: ${z.prettifyError(checked.error)}`
      )
    await this.storage.write(
      this.key,
      JSON.stringify({ version: this.options.version, data })
    )
  }

  /** The stored text as-is, for "Save a copy". */
  raw(): Promise<string | null> {
    return this.storage.read(this.key)
  }

  /** Backs up, then removes the stored document. */
  async clear(): Promise<BackupResult> {
    const backup = await this.storage.backup(this.key)
    await this.storage.remove(this.key)
    return backup
  }

  backup(): Promise<BackupResult> {
    return this.storage.backup(this.key)
  }
}
