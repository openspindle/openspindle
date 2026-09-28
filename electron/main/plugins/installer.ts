import { randomUUID } from "node:crypto"
import { RpcError } from "@openspindle/rpc"
import {
  assertInstallable,
  createInstallReview,
  createInstalledRecord,
  openBundledSource,
  openFolderSource,
  openGitHubSource,
  validatePackage,
} from "@openspindle/plugin-core"
import type {
  InstalledPluginRecord,
  PackageReader,
  Platform,
  PluginFetch,
  ValidatedPackage,
} from "@openspindle/plugin-core"
import { nodeSha256, openNodeFolder } from "@openspindle/plugin-sdk/node"
import type {
  InstallRequest,
  PrepareInstallResult,
} from "../../../src/platform/contract/plugin-rpc"
import type { PluginRegistry, StagedPackage } from "./registry"

const GITHUB_DEADLINE_MS = 120_000
/** Node hosts identify themselves to the GitHub API. */
const GITHUB_HEADERS = {
  "User-Agent": "OpenSpindle-Plugins",
  "X-GitHub-Api-Version": "2022-11-28",
}
const REVIEW_TTL_MS = 10 * 60_000

type PendingReview = {
  readonly staged: StagedPackage
  readonly validated: ValidatedPackage
  readonly timer: ReturnType<typeof setTimeout>
}

export type InstallerOptions = {
  readonly registry: PluginRegistry
  readonly fetch: PluginFetch
  /** A native folder picker; null when the user cancels. */
  readonly chooseFolder: () => Promise<string | null>
  /** Runs before a confirmed package replaces the installed one. */
  readonly beforeCommit: (pluginId: string) => Promise<void>
  readonly platform: Platform | null
}

/**
 * Two-phase installs through the shared plugin-core pipeline: prepare downloads (GitHub,
 * at a pinned commit) or reads (a development folder), validates and stages the package
 * and returns a review; only a confirmed review is recorded and granted. Plugins that come
 * with the app pass the same pipeline without a review.
 */
export class PluginInstaller {
  private readonly reviews = new Map<string, PendingReview>()
  private preparing = false

  constructor(private readonly options: InstallerOptions) {}

  prepare(request: InstallRequest): Promise<PrepareInstallResult> {
    if (request.kind === "github")
      return this.exclusive((signal) =>
        this.open({ kind: "github", repository: request.repository }, signal)
      )
    return this.exclusive(async (signal) => {
      const folder = await this.options.chooseFolder()
      return folder === null
        ? null
        : this.open({ kind: "folder", folder }, signal)
    })
  }

  /** Reads the plugin's source again: the repository's latest commit, or the folder. */
  prepareUpdate(record: InstalledPluginRecord): Promise<PrepareInstallResult> {
    const { source } = record
    if (source.kind === "bundled")
      throw new RpcError(
        "INVALID_PARAMS",
        `${record.manifest.name} comes with OpenSpindle and updates with it.`
      )
    return this.exclusive((signal) =>
      this.open(
        source.kind === "github"
          ? { kind: "github", repository: source.repository }
          : { kind: "folder", folder: source.path },
        signal
      )
    )
  }

  async confirm(reviewId: string): Promise<InstalledPluginRecord> {
    const pending = this.take(reviewId)
    try {
      const { validated } = pending
      const pluginId = validated.manifest.id
      await this.options.registry.ready
      const existing = this.options.registry.get(pluginId)
      assertInstallable(existing, validated.origin)
      // Locked for the whole sequence: a start beginning between stopping the old companion
      // and the new record landing would otherwise start it again from the old files, right
      // as commit() is replacing (or trashing) that version's folder.
      return await this.options.registry.withLock(pluginId, async () => {
        await this.options.beforeCommit(pluginId)
        return this.options.registry.commit(
          pending.staged,
          createInstalledRecord(validated, {
            installedAt: new Date(),
            enabled: existing?.enabled ?? true,
            settings: existing?.settings ?? {},
          })
        )
      })
    } catch (error) {
      await this.options.registry.discard(pending.staged)
      throw error
    }
  }

  /**
   * Installs a plugin that comes with the app, from the app's own files and without a
   * review: it is part of the app. It owns its ID, replacing any other copy of the plugin.
   * An unchanged package is left alone; a changed one (an app update) keeps its enabled
   * state and settings. Resolves with the plugin's ID.
   */
  async installBundled(folder: string): Promise<string> {
    const reader = openBundledSource(await openNodeFolder(folder))
    const options = { platform: this.options.platform, sha256: nodeSha256 }
    const { manifest, digest } = await validatePackage(reader, options)
    await this.options.registry.ready
    const existing = this.options.registry.get(manifest.id)
    if (existing?.source.kind === "bundled" && existing.digest === digest)
      return manifest.id
    const staged = await this.options.registry.stage()
    try {
      const validated = await validatePackage(reader, {
        ...options,
        sink: staged.sink,
      })
      await this.options.registry.withLock(manifest.id, async () => {
        await this.options.beforeCommit(manifest.id)
        await this.options.registry.commit(
          staged,
          createInstalledRecord(validated, {
            installedAt: new Date(),
            enabled: existing?.enabled ?? true,
            settings: existing?.settings ?? {},
          })
        )
      })
      return manifest.id
    } catch (error) {
      await this.options.registry.discard(staged)
      throw error
    }
  }

  async discard(reviewId: string): Promise<void> {
    const pending = this.reviews.get(reviewId)
    if (!pending) return
    await this.options.registry.discard(this.take(reviewId).staged)
  }

  async dispose(): Promise<void> {
    for (const reviewId of [...this.reviews.keys()])
      await this.discard(reviewId)
  }

  private async open(
    source:
      | { readonly kind: "github"; readonly repository: string }
      | { readonly kind: "folder"; readonly folder: string },
    signal: AbortSignal
  ): Promise<PackageReader> {
    if (source.kind === "github")
      return openGitHubSource(source.repository, this.options.fetch, {
        signal,
        headers: GITHUB_HEADERS,
      })
    return openFolderSource(await openNodeFolder(source.folder))
  }

  /**
   * One installation at a time (folder dialogs included), under an overall deadline;
   * the validated package waits in staging for the review.
   */
  private async exclusive(
    open: (signal: AbortSignal) => Promise<PackageReader | null>
  ): Promise<PrepareInstallResult> {
    if (this.preparing)
      throw new RpcError(
        "BUSY",
        "A plugin installation is already in progress."
      )
    this.preparing = true
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), GITHUB_DEADLINE_MS)
    let staged: StagedPackage | null = null
    try {
      const reader = await open(controller.signal)
      if (!reader) return { status: "canceled" }
      staged = await this.options.registry.stage()
      const validated = await validatePackage(reader, {
        platform: this.options.platform,
        sha256: nodeSha256,
        sink: staged.sink,
      })
      await this.options.registry.ready
      const existing = this.options.registry.get(validated.manifest.id)
      assertInstallable(existing, validated.origin)
      const reviewId = randomUUID()
      this.reviews.set(reviewId, {
        staged,
        validated,
        timer: setTimeout(() => void this.discard(reviewId), REVIEW_TTL_MS),
      })
      staged = null
      return {
        status: "review",
        review: createInstallReview(reviewId, validated, existing),
      }
    } finally {
      clearTimeout(deadline)
      this.preparing = false
      if (staged) await this.options.registry.discard(staged)
    }
  }

  private take(reviewId: string): PendingReview {
    const pending = this.reviews.get(reviewId)
    if (!pending)
      throw new RpcError(
        "NOT_FOUND",
        "This installation review expired. Start the installation again."
      )
    clearTimeout(pending.timer)
    this.reviews.delete(reviewId)
    return pending
  }
}
