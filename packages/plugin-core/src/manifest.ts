import { z } from "zod"
import { CapabilitySchema } from "./capabilities.ts"
import { fail } from "./errors.ts"
import { PATH_EXTENSIONS, packagePathSchema, pathKey } from "./paths.ts"
import { PROCESS_PLUGIN_LIMITS, ProcessProgramsSchema } from "./templates.ts"
import type { ProcessProgram } from "./templates.ts"
import {
  identifierSchema,
  isUnique,
  listSchema,
  parseWith,
  pluginTextBytes,
  strictSchema,
  textSchema,
  unionError,
} from "./text.ts"

/**
 * The plugin API this host implements. Plugins declare what they target, and only this
 * version and revision are accepted: installed plugins that target another stay installed
 * but serve nothing until they are updated (`apiIncompatibility`).
 */
export const PLUGIN_API = { version: 2, revision: 4 } as const

export const MANIFEST_FILE = "openspindle-plugin.json"

/** Operating system and architecture, as `${process.platform}-${process.arch}`. */
export const PLATFORMS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
] as const
export const PlatformSchema = z.enum(PLATFORMS, {
  error: `Platforms must be one of ${PLATFORMS.join(", ")}.`,
})
export type Platform = z.infer<typeof PlatformSchema>

export const isPlatform = (value: string): value is Platform =>
  (PLATFORMS as readonly string[]).includes(value)

export const PluginIdSchema = identifierSchema("Plugin ID")

export const VersionSchema = textSchema("Version", 48).refine(
  (version) => /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version),
  "Plugin version must use major.minor.patch format."
)

export const TOOLBAR_ICONS = ["probe", "grid", "path", "tool", "pcb"] as const
export type ToolbarIcon = (typeof TOOLBAR_ICONS)[number]

function checkToolbar(
  toolbar: readonly { id: string; programId?: string; viewId?: string }[],
  programs: readonly ProcessProgram[],
  viewIds: readonly string[],
  context: z.RefinementCtx
) {
  if (!isUnique(toolbar.map((item) => item.id)))
    context.addIssue({
      code: "custom",
      message: "Toolbar item IDs must be unique.",
      path: ["toolbar"],
    })
  for (const item of toolbar) {
    if (
      item.programId !== undefined &&
      !programs.some((program) => program.id === item.programId)
    )
      context.addIssue({
        code: "custom",
        message: "Toolbar items must reference a program in this plugin.",
        path: ["toolbar"],
      })
    if (item.viewId !== undefined && !viewIds.includes(item.viewId))
      context.addIssue({
        code: "custom",
        message: "Toolbar items must reference a view in this plugin.",
        path: ["toolbar"],
      })
  }
}

function checkSize(manifest: unknown, context: z.RefinementCtx) {
  if (
    pluginTextBytes(JSON.stringify(manifest)) >
    PROCESS_PLUGIN_LIMITS.manifestBytes
  )
    context.addIssue({
      code: "custom",
      message: "Plugin manifest exceeds 64 KB.",
    })
}

export const VIEW_SLOTS = ["process.importer", "operation.editor"] as const
export const ViewSlotSchema = z.enum(VIEW_SLOTS, {
  error: "View slots must be process.importer or operation.editor.",
})
export type ViewSlot = z.infer<typeof ViewSlotSchema>

export const ViewDeclarationSchema = strictSchema("View", {
  id: identifierSchema("View ID"),
  slot: ViewSlotSchema,
  title: textSchema("View title", 80),
})
export type ViewDeclaration = z.infer<typeof ViewDeclarationSchema>

const ViewsSchema = strictSchema("Plugin UI", {
  entry: packagePathSchema(
    "UI entry",
    PATH_EXTENSIONS.script,
    "UI entries must be relative .js or .mjs paths without traversal or URL characters."
  ),
  styles: packagePathSchema(
    "UI styles",
    PATH_EXTENSIONS.styles,
    "UI styles must be a relative .css path without traversal or URL characters."
  ).optional(),
  views: listSchema(ViewDeclarationSchema, "Views", 8)
    .min(1, "Declare at least one view.")
    .refine(
      (views) => isUnique(views.map((view) => view.id)),
      "View IDs must be unique."
    ),
})

const ToolbarItemSchema = strictSchema("Toolbar item", {
  id: identifierSchema("Toolbar item ID"),
  label: textSchema("Toolbar label", 80),
  icon: z.enum(TOOLBAR_ICONS, {
    error: `Toolbar icons must be ${TOOLBAR_ICONS.join(", ")}.`,
  }),
  programId: identifierSchema("Toolbar program ID").optional(),
  viewId: identifierSchema("Toolbar view ID").optional(),
}).refine(
  (item) => (item.programId === undefined) !== (item.viewId === undefined),
  "A toolbar item opens either one program or one view."
)
export type ToolbarItem = z.infer<typeof ToolbarItemSchema>

const ArgumentSchema = z
  .string()
  .max(1024, "Companion arguments are at most 1024 characters.")
  .refine(
    (argument) => !argument.includes("\0"),
    "Companion arguments cannot contain NUL characters."
  )

const companionLifecycle = {
  args: listSchema(ArgumentSchema, "Companion arguments", 32).default([]),
  /** on-demand: first call starts it; on-view: an open view keeps it running. */
  activation: z
    .enum(["on-demand", "on-view"], {
      error: "Companion activation must be on-demand or on-view.",
    })
    .default("on-demand"),
  idleShutdownSeconds: z
    .int("Idle shutdown must be whole seconds.")
    .min(10, "Idle shutdown must be at least 10 seconds.")
    .max(86_400, "Idle shutdown must be at most one day.")
    .default(300),
}

/** A helper process the app starts and stops; it never initiates machine jobs. */
export const CompanionSchema = z.discriminatedUnion(
  "runtime",
  [
    strictSchema("Companion", {
      runtime: z.literal("node"),
      entry: packagePathSchema(
        "Companion entry",
        PATH_EXTENSIONS.nodeEntry,
        "Node companion entries must be relative .js, .mjs or .cjs paths."
      ),
      ...companionLifecycle,
    }),
    strictSchema("Companion", {
      runtime: z.literal("native"),
      executables: z
        .partialRecord(
          PlatformSchema,
          packagePathSchema(
            "Companion executable",
            null,
            "Companion executables must be relative package paths."
          )
        )
        .refine(
          (executables) => Object.keys(executables).length > 0,
          "Declare a companion executable for at least one platform."
        ),
      ...companionLifecycle,
    }),
  ],
  {
    error: unionError("Companion", "Companion runtime must be node or native."),
  }
)
export type CompanionDeclaration = z.infer<typeof CompanionSchema>

/**
 * A value the user sets on the plugin's card in the plugin manager, which the companion
 * receives. `executable`: a program on this computer, by its full path.
 */
export const SettingSchema = strictSchema("Setting", {
  id: identifierSchema("Setting ID"),
  type: z.literal("executable", {
    error: "Setting type must be executable.",
  }),
  label: textSchema("Setting label", 80),
  description: textSchema("Setting description").optional(),
})
export type SettingDeclaration = z.infer<typeof SettingSchema>

const ManifestShape = strictSchema(
  "Plugin manifest",
  {
    manifestVersion: z.literal(2, {
      error: "Unsupported plugin manifest version.",
    }),
    id: PluginIdSchema,
    name: textSchema("Plugin name", 120),
    version: VersionSchema,
    description: textSchema("Plugin description"),
    apiVersion: z.int("API version must be an integer."),
    apiRevision: z
      .int("API revision must be an integer.")
      .min(0, "API revision must not be negative."),
    permissions: listSchema(CapabilitySchema, "Permissions", 16)
      .refine(isUnique, "Permissions must be unique.")
      .default([]),
    ui: ViewsSchema.optional(),
    programs: ProcessProgramsSchema.default([]),
    toolbar: listSchema(ToolbarItemSchema, "Toolbar items", 16).optional(),
    companion: CompanionSchema.optional(),
    settings: listSchema(SettingSchema, "Settings", 16)
      .refine(
        (settings) => isUnique(settings.map((setting) => setting.id)),
        "Setting IDs must be unique."
      )
      .default([]),
    files: listSchema(
      packagePathSchema(
        "Package file",
        null,
        "Package files must be relative paths without traversal, hidden or reserved names."
      ),
      "Package files",
      1024
    )
      .refine(isUnique, "Package files must be unique.")
      .default([]),
    /** Package files the companion runs, written with execute permission. */
    executables: listSchema(
      packagePathSchema(
        "Executable file",
        null,
        "Executable files must be relative paths without traversal, hidden or reserved names."
      ),
      "Executable files",
      64
    )
      .refine(isUnique, "Executable files must be unique.")
      .default([]),
    platforms: listSchema(PlatformSchema, "Platforms", PLATFORMS.length)
      .min(1, "List at least one platform, or omit platforms.")
      .refine(isUnique, "Platforms must be unique.")
      .optional(),
  },
  "Manifest contains an unsupported field."
)
type ManifestFields = z.infer<typeof ManifestShape>

/**
 * Why this host cannot run a plugin built for the API its manifest targets; null when it can.
 * Only the exact version and revision this host implements are accepted (`PLUGIN_API`).
 */
export function apiIncompatibility(
  manifest: Pick<ManifestFields, "apiVersion" | "apiRevision">
): string | null {
  if (manifest.apiVersion !== PLUGIN_API.version)
    return `This plugin targets plugin API ${manifest.apiVersion}; this OpenSpindle supports API ${PLUGIN_API.version}.`
  if (manifest.apiRevision > PLUGIN_API.revision)
    return "This plugin needs a newer version of OpenSpindle."
  if (manifest.apiRevision < PLUGIN_API.revision)
    return "This plugin was built for an earlier version of OpenSpindle."
  return null
}

/** How a manifest's fields fit together, whatever API it targets. */
function checkConsistency(manifest: ManifestFields, context: z.RefinementCtx) {
  if (!manifest.programs.length && !manifest.ui)
    context.addIssue({
      code: "custom",
      message: "A plugin must contain at least one program or a view.",
    })
  if (manifest.companion && !manifest.ui)
    context.addIssue({
      code: "custom",
      message: "A companion is only reachable from the plugin's own views.",
    })
  if (manifest.settings.length && !manifest.companion)
    context.addIssue({
      code: "custom",
      message:
        "Settings reach the plugin's companion, so only a plugin with one can have them.",
      path: ["settings"],
    })
  if (manifest.executables.length && !manifest.companion)
    context.addIssue({
      code: "custom",
      message: "Only a plugin with a companion can ship executable files.",
      path: ["executables"],
    })
  for (const path of manifest.executables)
    if (!manifest.files.includes(path))
      context.addIssue({
        code: "custom",
        message: `${path} is executable, so it must also be listed in files.`,
        path: ["executables"],
      })
  checkToolbar(
    manifest.toolbar ?? [],
    manifest.programs,
    manifest.ui?.views.map((view) => view.id) ?? [],
    context
  )
  checkSize(manifest, context)
}

/** A manifest this host installs: well formed, and built for the API it implements. */
export const ManifestSchema = ManifestShape.superRefine((manifest, context) => {
  const incompatible = apiIncompatibility(manifest)
  if (incompatible) context.addIssue({ code: "custom", message: incompatible })
  checkConsistency(manifest, context)
})
export type Manifest = z.infer<typeof ManifestSchema>

/**
 * A manifest as an installed plugin's record keeps it: well formed, whatever API it targets.
 * An update of the host that changes the API leaves the plugin installed, with its settings,
 * until it is updated too; meanwhile it serves nothing (`apiIncompatibility`).
 */
export const StoredManifestSchema = ManifestShape.superRefine(checkConsistency)

/** Reads a plugin manifest, refusing anything this host does not implement. */
export function parseManifest(value: unknown): Manifest {
  return parseWith(ManifestSchema, value)
}

export type PackageFileRole =
  "template" | "view" | "styles" | "companion" | "asset"

export type DeclaredFile = {
  readonly path: string
  readonly role: PackageFileRole
  /** Written with execute permission: the native companion for this platform. */
  readonly executable: boolean
}

/** The companion program for a platform, or why this plugin cannot run there. */
export function companionEntry(
  manifest: Manifest,
  platform: Platform | null
): string | null {
  const companion = manifest.companion
  if (!companion) return null
  if (companion.runtime === "node") return companion.entry
  const executable = platform ? companion.executables[platform] : undefined
  if (!executable)
    fail(
      `${manifest.name} does not include a companion for this computer${platform ? ` (${platform})` : ""}.`
    )
  return executable
}

/** Refuses plugins limited to other platforms, or with no companion for this one. */
export function assertPlatform(manifest: Manifest, platform: Platform | null) {
  if (
    manifest.platforms &&
    (!platform || !manifest.platforms.includes(platform))
  )
    fail(`${manifest.name} is not available for this computer.`)
  companionEntry(manifest, platform)
}

/** Every file a package consists of besides the manifest, with its role. */
export function declaredFiles(
  manifest: Manifest,
  platform: Platform | null
): DeclaredFile[] {
  const files = new Map<string, DeclaredFile>()
  const add = (path: string, role: PackageFileRole, executable = false) => {
    const key = pathKey(path)
    const existing = files.get(key)
    if (existing && existing.path !== path)
      fail(`${path} and ${existing.path} differ only by letter case.`)
    if (existing && existing.role !== role && role !== "asset")
      fail(`${path} cannot serve two purposes in one package.`)
    if (!existing) files.set(key, { path, role, executable })
  }
  for (const program of manifest.programs) add(program.file, "template")
  if (manifest.ui) {
    add(manifest.ui.entry, "view")
    if (manifest.ui.styles) add(manifest.ui.styles, "styles")
  }
  const companion = companionEntry(manifest, platform)
  if (companion)
    add(companion, "companion", manifest.companion?.runtime === "native")
  for (const path of manifest.files)
    add(path, "asset", manifest.executables.includes(path))
  if (files.has(pathKey(MANIFEST_FILE)))
    fail(`${MANIFEST_FILE} is the manifest and cannot be listed as a file.`)
  return [...files.values()]
}
