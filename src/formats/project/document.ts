import { z } from "zod"
import { HeightMapSchema } from "@/machine/contract"
import { MODEL_LIMITS, ModelRecordSchema } from "@/domain/models/model"
import type { ModelId } from "@/domain/models/model"
import { PlateSchema } from "@/domain/plate/plate"
import { EntityIdSchema, TextSchema } from "@/domain/primitives"
import { RuleSettingsSchema } from "@/domain/rules/settings"
import type { WorkspaceState } from "@/domain/workspace/workspace"
import { libraryModelId } from "@/domain/fixtures/definitions"
import { validateGlb } from "@/formats/models/glb"
import { TOOL_MODEL_BYTES, isTool } from "@/domain/tools/tool"
import type { Tool } from "@/domain/tools/tool"
import { StockSchema } from "@/domain/stock/stock"
import { PluginReferenceSchema } from "@/domain/workspace/plugin-reference"
import type { PluginReference } from "@/domain/workspace/plugin-reference"
import { fromBase64 } from "../base64-json"
import { upgradeTool } from "../tool-library/upgrade"
import { usedPluginIds } from "./plugin-reference"
import { PROJECT_LIMITS } from "./step-nc"

/** Version 6: the project sets its rules by id (`ruleSettings`), in place of its design rules. */
export const PROJECT_SCHEMA_VERSION = 6

/** The workspace fields a project stores exactly as the workspace holds them. */
type WorkspaceData = Pick<
  WorkspaceState,
  | "plates"
  | "selectedPlateId"
  | "tools"
  | "stocks"
  | "defaultToolId"
  | "defaultStockId"
  | "heightMaps"
  | "ruleSettings"
>

/** A model the project's fixtures use: its record and display mesh (base64), never its uploaded file. */
export const ProjectModelSchema = z.strictObject({
  record: ModelRecordSchema.refine(
    (record) => record.source === null,
    "A project model carries no uploaded file."
  ),
  mesh: z
    .string()
    .max(4 * Math.ceil(MODEL_LIMITS.meshBytes / 3))
    .regex(/^[A-Za-z\d+/]*={0,2}$/, "Invalid model data."),
})
export type ProjectModel = z.infer<typeof ProjectModelSchema>

/**
 * A saved project: the workspace's plates, libraries and selections, references to the
 * plugins its operations use (the plugins themselves are installed, never embedded), and the
 * models its fixtures use.
 */
export type ProjectDocument = WorkspaceData & {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION
  readonly name: WorkspaceState["project"]["name"]
  readonly plugins: readonly PluginReference[]
  readonly models: readonly ProjectModel[]
}

/** The Models library models the plates' fixtures use, each once. */
export function projectModelIds(plates: WorkspaceState["plates"]): ModelId[] {
  return [
    ...new Set(
      plates.flatMap((plate) =>
        plate.setup.fixtures.flatMap(
          (fixture) => libraryModelId(fixture.definition) ?? []
        )
      )
    ),
  ]
}

/**
 * Whether a tool's 3D model, when it is a chosen GLB rather than a bundled path, is one valid,
 * self-contained model within its size limit; checked the same way the tool library's import
 * checks one.
 */
function hasValidModel(tool: Tool): boolean {
  if (!tool.model?.startsWith("data:")) return true
  try {
    validateGlb(
      fromBase64(tool.model.slice(tool.model.indexOf(",") + 1)),
      TOOL_MODEL_BYTES
    )
    return true
  } catch {
    return false
  }
}

/** Tools saved by earlier versions (version 2 and 3 records) are brought up to date. */
const ToolSchema = z.preprocess(
  upgradeTool,
  z
    .custom<Tool>(isTool, "Invalid tool.")
    .refine(hasValidModel, "Its 3D model is unreadable.")
)
/** Library ids are whatever non-empty text their libraries accept. */
const LibraryIdSchema = z.string().min(1)

type Issue = { readonly message: string; readonly path: PropertyKey[] }

const issue = (message: string, ...path: PropertyKey[]): Issue => ({
  message,
  path,
})

function duplicates(
  ids: readonly string[],
  path: string,
  label: string
): Issue[] {
  const seen = new Set<string>()
  const issues: Issue[] = []
  for (const id of ids) {
    if (seen.has(id))
      issues.push(issue(`${label} "${id}" appears more than once.`, path))
    seen.add(id)
  }
  return issues
}

function dangling(
  id: string | null,
  ids: readonly string[],
  path: string,
  label: string
): Issue[] {
  if (id === null || ids.includes(id)) return []
  return [issue(`The ${label} is not in the project.`, path)]
}

/** Ids are unique, selections exist, height maps sit under their device, references are used. */
function consistencyIssues(document: ProjectDocument): Issue[] {
  const plateIds = document.plates.map((plate) => plate.id)
  const toolIds = document.tools.map((tool) => tool.id)
  const stockIds = document.stocks.map((stock) => stock.id)
  const used = new Set(usedPluginIds(document.plates))
  const usedModels = new Set(projectModelIds(document.plates))
  return [
    ...duplicates(plateIds, "plates", "Plate"),
    ...dangling(
      document.selectedPlateId,
      plateIds,
      "selectedPlateId",
      "selected plate"
    ),
    ...duplicates(toolIds, "tools", "Tool"),
    ...dangling(
      document.defaultToolId,
      toolIds,
      "defaultToolId",
      "default tool"
    ),
    ...duplicates(stockIds, "stocks", "Stock"),
    ...dangling(
      document.defaultStockId,
      stockIds,
      "defaultStockId",
      "default stock"
    ),
    ...Object.entries(document.heightMaps)
      .filter(([id, map]) => map.deviceId !== id)
      .map(([id]) =>
        issue("A height map is filed under another device.", "heightMaps", id)
      ),
    ...duplicates(
      document.plugins.map((reference) => reference.id),
      "plugins",
      "Plugin"
    ),
    ...document.plugins
      .filter((reference) => !used.has(reference.id))
      .map((reference) =>
        issue(`No operation uses the plugin "${reference.id}".`, "plugins")
      ),
    ...duplicates(
      document.models.map((model) => model.record.id),
      "models",
      "Model"
    ),
    ...document.models
      .filter((model) => !usedModels.has(model.record.id))
      .map((model) =>
        issue(`No fixture uses the model "${model.record.name}".`, "models")
      ),
  ]
}

/**
 * The project payload. Plates are the domain aggregate itself; the libraries, selections and
 * plugin references must be consistent with each other.
 */
export const ProjectDocumentSchema = z
  .strictObject({
    schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
    name: TextSchema,
    plates: z.array(PlateSchema).max(PROJECT_LIMITS.plates),
    selectedPlateId: EntityIdSchema.nullable(),
    tools: z.array(ToolSchema).max(PROJECT_LIMITS.tools),
    stocks: z.array(StockSchema).max(PROJECT_LIMITS.stocks),
    defaultToolId: LibraryIdSchema.nullable(),
    defaultStockId: LibraryIdSchema.nullable(),
    /** Historic observations, keyed by the device that measured them. */
    heightMaps: z
      .record(z.string(), HeightMapSchema)
      .refine(
        (maps) => Object.keys(maps).length <= PROJECT_LIMITS.heightMaps,
        `A project holds at most ${PROJECT_LIMITS.heightMaps} height maps.`
      ),
    /** How it reports its rules, and their limits; a project saved without them sets none. */
    ruleSettings: RuleSettingsSchema.default(() => ({})),
    plugins: z.array(PluginReferenceSchema).max(PROJECT_LIMITS.plugins),
    models: z.array(ProjectModelSchema).max(PROJECT_LIMITS.models),
  })
  .superRefine((document, context) => {
    for (const found of consistencyIssues(document))
      context.addIssue({ code: "custom", ...found })
  }) satisfies z.ZodType<ProjectDocument>

/**
 * The project a workspace saves; `plugins` usually comes from `referencedPlugins`, `models`
 * are the library models of `projectModelIds` that the library holds.
 */
export function projectDocument(
  state: WorkspaceState,
  plugins: readonly PluginReference[],
  models: readonly ProjectModel[]
): ProjectDocument {
  const {
    plates,
    selectedPlateId,
    tools,
    stocks,
    defaultToolId,
    defaultStockId,
    heightMaps,
    ruleSettings,
  } = state
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: state.project.name,
    plates,
    selectedPlateId,
    tools,
    stocks,
    defaultToolId,
    defaultStockId,
    heightMaps,
    ruleSettings,
    plugins,
    models,
  }
}

/** The workspace an opened project becomes; `fileName` is the file it was opened from. */
export function projectWorkspace(
  document: ProjectDocument,
  fileName: string
): WorkspaceState {
  const {
    schemaVersion: _schemaVersion,
    name,
    plugins,
    models: _models,
    ...data
  } = document
  return { ...data, project: { name, fileName, plugins } }
}
