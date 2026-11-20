import { AsyncDebouncer } from "@tanstack/pacer"
import { Store } from "@tanstack/react-store"
import type { BackupResult } from "@/platform/contract/storage"
import type { LoadIssue, Repository } from "./repository"

const SAVE_DELAY_MS = 600

export type DocumentState<TValue> = {
  /**
   * `loading` until the stored data is restored; `blocked` writes nothing until the user
   * resolves the load issues.
   */
  readonly phase: "loading" | "ready" | "blocked"
  /** What consumers hydrate from; null starts from defaults. */
  readonly value: TValue | null
  /** Changes whenever `value` is replaced, so consumers know to hydrate again. */
  readonly generation: number
  readonly issues: readonly LoadIssue[]
  /** Nothing usable could be restored (the data is unreadable or from a newer version). */
  readonly unreadable: boolean
  /** Written by a newer Spinnvill: only saving a copy, clearing or quitting is safe. */
  readonly newer: boolean
  readonly saveError: string | null
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

/**
 * A repository plus its lifecycle: load once, save debounced (and never while blocked),
 * and let the user release blocked data by accepting what was restored or clearing it.
 * Both keep a backup of the original. Accepting also writes the latest change made while
 * the document was blocked; clearing discards it.
 */
export class PersistedDocument<TValue> {
  readonly state: Store<DocumentState<TValue>>
  readonly repository: Repository<TValue>
  private readonly saver: AsyncDebouncer<(value: TValue) => Promise<void>>
  private loading: Promise<void> | null = null
  /** The latest value saved while blocked; accepting writes it. */
  private held: { readonly value: TValue } | null = null

  constructor(repository: Repository<TValue>) {
    this.repository = repository
    this.state = new Store<DocumentState<TValue>>({
      phase: "loading",
      value: null,
      generation: 0,
      issues: [],
      unreadable: false,
      newer: false,
      saveError: null,
    })
    this.saver = new AsyncDebouncer((value: TValue) => this.write(value), {
      wait: SAVE_DELAY_MS,
      onError: (error) => this.patch({ saveError: message(error) }),
    })
  }

  /** Restores the stored data once; later calls wait for that same load. */
  load(): Promise<void> {
    this.loading ??= this.restore()
    return this.loading
  }

  private async restore(): Promise<void> {
    const outcome = await this.repository.load()
    switch (outcome.status) {
      case "empty":
        this.replace({ phase: "ready", value: null, issues: [] })
        return
      case "loaded":
        this.replace({
          phase: outcome.issues.length ? "blocked" : "ready",
          value: outcome.value,
          issues: outcome.issues,
        })
        return
      case "failed":
        this.replace({
          phase: "blocked",
          value: null,
          issues: outcome.issues,
          unreadable: true,
        })
        return
      case "newer":
        this.replace({
          phase: "blocked",
          value: null,
          issues: outcome.issues,
          unreadable: true,
          newer: true,
        })
    }
  }

  /**
   * Debounced. While blocked the value is only held, so the stored data is never overwritten
   * before the user decides; while loading it is ignored (the restored data replaces it).
   */
  save(value: TValue) {
    switch (this.state.state.phase) {
      case "ready":
        void this.saver.maybeExecute(value)
        return
      case "blocked":
        this.held = { value }
        return
      case "loading":
        return
    }
  }

  /** Writes a pending save now (page hide, quit). */
  async flush(): Promise<void> {
    await this.saver.flush()
  }

  /**
   * Continues with what was restored; the original is backed up first. What was restored, or a
   * change made while blocked, is written now, so the stored data no longer holds what was left
   * out and the same issues do not return at the next launch.
   */
  async accept(): Promise<BackupResult> {
    const backup = await this.repository.backup()
    this.patch({ phase: "ready", issues: [] })
    const value = this.held?.value ?? this.state.state.value
    this.held = null
    if (value !== null) this.save(value)
    return backup
  }

  /** Backs up and removes the stored document, then starts from defaults. */
  async clear(): Promise<BackupResult> {
    this.saver.cancel()
    const backup = await this.repository.clear()
    this.replace({ phase: "ready", value: null, issues: [] })
    return backup
  }

  raw(): Promise<string | null> {
    return this.repository.raw()
  }

  private async write(value: TValue) {
    await this.repository.save(value)
    if (this.state.state.saveError) this.patch({ saveError: null })
  }

  private patch(partial: Partial<DocumentState<TValue>>) {
    this.state.setState((previous) => ({ ...previous, ...partial }))
  }

  /** A new value for consumers to hydrate from; a change held while blocked is obsolete. */
  private replace(
    next: Pick<DocumentState<TValue>, "phase" | "value" | "issues"> &
      Partial<Pick<DocumentState<TValue>, "unreadable" | "newer">>
  ) {
    this.held = null
    this.state.setState((previous) => ({
      ...previous,
      unreadable: false,
      newer: false,
      saveError: null,
      ...next,
      generation: previous.generation + 1,
    }))
  }
}
