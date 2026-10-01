import { z } from "zod"
import { HeightMapSchema } from "@/machine/contract"
import { PlateSchema } from "@/domain/plate/plate"
import { EntityIdSchema, TextSchema } from "@/domain/primitives"
import { RuleSettingsSchema } from "@/domain/rules/settings"
import { libraryOf } from "@/domain/workspace/library"
import type { WorkspaceState } from "@/domain/workspace/workspace"
import { ruleSettingsFromDesignRules } from "@/formats/project/rule-settings"
import { PROJECT_LIMITS } from "@/formats/project/step-nc"
import { upgradeWorkspaceSources } from "@/formats/project/upgrade"
import { KEPT_WORKSPACE_MAX_LENGTH } from "@/platform/contract/window"
import type { WindowHost } from "@/platform/host"
import { log } from "@/app/errors/log"
import {
  hasUnsavedChanges,
  markProjectEdited,
  markProjectSaved,
} from "./project-session"
import type { WorkspaceStore } from "./store"

/** What a page kept, with rule settings: the design rules a page before them kept become them. */
function withRuleSettings(kept: unknown): unknown {
  if (
    typeof kept !== "object" ||
    kept === null ||
    "ruleSettings" in kept ||
    !("designRules" in kept)
  )
    return kept
  const { designRules, ...rest } = kept
  return { ...rest, ruleSettings: ruleSettingsFromDesignRules(designRules) }
}

/**
 * What a page keeps of the workspace for the next: its project, and whether that had unsaved
 * changes. The tool and stock libraries are not part of it: the app keeps them on its own. After
 * a code change the next page reads it with its own schemas, and starts a new project when they
 * refuse it.
 */
const KeptSchema = z.preprocess(
  withRuleSettings,
  z.object({
    plates: z.array(PlateSchema).max(PROJECT_LIMITS.plates),
    selectedPlateId: EntityIdSchema.nullable(),
    heightMaps: z
      .record(z.string(), HeightMapSchema)
      .refine(
        (maps) => Object.keys(maps).length <= PROJECT_LIMITS.heightMaps,
        "Too many height maps."
      ),
    // A page before design rules kept none: its project sets no rule.
    ruleSettings: RuleSettingsSchema.default(() => ({})),
    project: z.object({
      name: TextSchema,
      fileName: z.string().min(1).max(1000),
    }),
    unsaved: z.boolean(),
  })
)

const keptOf = (state: WorkspaceState) => ({
  plates: state.plates,
  selectedPlateId: state.selectedPlateId,
  heightMaps: state.heightMaps,
  ruleSettings: state.ruleSettings,
  project: state.project,
  unsaved: hasUnsavedChanges(state),
})

/**
 * Replaces the new project with the workspace the page before this one kept. False when it
 * does not read, and the new project stays.
 */
function restore(workspace: WorkspaceStore, text: string): boolean {
  let data: unknown = null
  try {
    data = JSON.parse(text)
  } catch {
    // Read as nothing, which the schema refuses.
  }
  const read = KeptSchema.safeParse(upgradeWorkspaceSources(data))
  if (!read.success) {
    log.warn(
      `The workspace kept across the reload does not read, so a new project starts.\n${z.prettifyError(read.error)}`
    )
    return false
  }
  const { unsaved, selectedPlateId, ...kept } = read.data
  const selected = kept.plates.some((plate) => plate.id === selectedPlateId)
  workspace.dispatch({
    type: "workspace.replace",
    state: {
      ...libraryOf(workspace.state),
      ...kept,
      selectedPlateId: selected
        ? selectedPlateId
        : (kept.plates[0]?.id ?? null),
    },
  })
  if (unsaved) markProjectEdited()
  else markProjectSaved(workspace.state)
  return true
}

/**
 * Keeps the workspace across reloads of the window's page (⌘R, or the dev server's after a
 * code change): restores what the page before this one kept, then keeps the workspace as this
 * page goes away. The main process holds it in memory only, so a new launch starts afresh.
 */
export async function keepWorkspaceAcrossReloads(
  workspace: WorkspaceStore,
  host: WindowHost
) {
  // An older main process has no kept workspace to give; the page starts as it always did.
  const kept = await host.keptWorkspace().catch(() => null)
  let restored = false
  if (kept !== null) {
    try {
      restored = restore(workspace, kept)
    } catch (error) {
      log.warn("The workspace kept across the reload was not restored", error)
    }
  }
  const fresh = workspace.state
  // Only from here: a reload before now leaves what the page before kept for the next one.
  window.addEventListener("pagehide", () => {
    // Code that could not read it passes it on untouched, for code fixed by the next reload.
    if (kept !== null && !restored && workspace.state === fresh) {
      host.keepWorkspace(kept)
      return
    }
    let text: string | null = null
    try {
      text = JSON.stringify(keptOf(workspace.state))
    } catch {
      // Longer than a string can be: nothing is kept.
    }
    host.keepWorkspace(
      text !== null && text.length <= KEPT_WORKSPACE_MAX_LENGTH ? text : null
    )
  })
}
