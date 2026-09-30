import { z } from "zod"
import { kindOf, resolveOperation } from "@/domain/operations/kinds"
import type { Operation } from "@/domain/operations/operation"
import type { Plate } from "@/domain/plate/plate"
import { fail, ok } from "@/domain/primitives"
import type { Result } from "@/domain/primitives"
import { describePath, readOptimistically } from "../optimistic-read"
import { PROJECT_SCHEMA_VERSION, ProjectDocumentSchema } from "./document"
import type { ProjectDocument } from "./document"
import { missingPlugins } from "./plugin-reference"
import type { InstalledPluginInfo } from "./plugin-reference"
import { ruleSettingsFromDesignRules } from "./rule-settings"
import type { PluginReference } from "@/domain/workspace/plugin-reference"
import { decodeStepNc, encodeStepNc } from "./step-nc"
import type {
  RestoredPayload,
  StepNcArchive,
  StepNcInstruction,
} from "./step-nc"

export type ProjectOpenContext = {
  /** Installed plugins; referenced plugins that are not among them are reported missing. */
  readonly plugins: readonly InstalledPluginInfo[]
}

export type OpenedProject = {
  readonly document: ProjectDocument
  /** References whose plugin is not installed, to offer installing them. */
  readonly missingPlugins: readonly PluginReference[]
  /** Where the file holds data the document does not keep, such as fields this version does not recognize. */
  readonly leftOut: readonly string[]
}

/** What reading a file's payload makes of it. */
type ReadProject = Pick<OpenedProject, "document" | "leftOut">

/**
 * An operation's instruction: the exact NC it contributes (stored, or derived from its
 * parameters for procedural kinds), or a pending entry until it has NC. Opening a file takes
 * procedural kinds' NC as the file attaches it (`saved`): it documents the NC when saved, and
 * newer versions may generate it differently.
 */
function instruction(
  plate: Plate,
  operation: Operation,
  saved?: ReadonlyMap<string, string>
): StepNcInstruction {
  const id = `${plate.id}/${operation.id}`
  if (saved && kindOf(operation).generated) {
    const nc = saved.get(id)
    return nc === undefined
      ? { kind: "pending", id, name: operation.name }
      : { kind: "source", id, name: operation.name, nc }
  }
  const resolved = resolveOperation(operation, plate)
  if (!resolved.ok) return { kind: "pending", id, name: operation.name }
  return { kind: "source", id, name: operation.name, nc: resolved.value.nc }
}

/** One workplan per plate and one instruction per operation, in order. */
function projectArchive(
  document: ProjectDocument,
  saved?: ReadonlyMap<string, string>
): StepNcArchive {
  return {
    name: document.name,
    workplans: document.plates.map((plate) => ({
      id: plate.id,
      name: plate.name,
      instructions: plate.operations.map((operation) =>
        instruction(plate, operation, saved)
      ),
    })),
  }
}

/**
 * The project as STEP-NC text. The document is validated first, so a project that saves also
 * opens. Throws an Error with a user-facing message when it is invalid or exceeds a limit.
 */
export function encodeProject(document: ProjectDocument): string {
  const parsed = ProjectDocumentSchema.safeParse(document)
  if (!parsed.success)
    throw new Error(
      `Refusing to save an invalid project: ${z.prettifyError(parsed.error)}`
    )
  return encodeStepNc(projectArchive(parsed.data), parsed.data)
}

const VersionSchema = z.looseObject({ schemaVersion: z.int().positive() })

/** The earliest format read; it and the ones after it become the current one on opening. */
const EARLIEST_SCHEMA_VERSION = 4

/**
 * A payload of an earlier format as the current format holds it: formats 4 and 5 saved design
 * rules (`designRules`), which become rule settings; the rest reads as it is.
 */
function currentPayload(payload: Record<string, unknown>) {
  const { designRules, ...rest } = payload
  return {
    ...rest,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    ruleSettings: ruleSettingsFromDesignRules(designRules),
  }
}

/**
 * Projects of this format and the two before it are read; `saved` is the NC the file attaches
 * to each instruction. The document is read optimistically: what the schema upgrades or
 * normalises is taken as it returns it, and data it does not recognize is left out and
 * reported rather than refused.
 */
function readPayload(
  payload: unknown,
  saved: ReadonlyMap<string, string>
): RestoredPayload<ReadProject> {
  const version = VersionSchema.safeParse(payload)
  if (!version.success)
    throw new Error("The project data has no valid format version.")
  const { schemaVersion } = version.data
  if (schemaVersion > PROJECT_SCHEMA_VERSION)
    throw new Error(
      `This project was saved by a newer version of OpenSpindle (project format ${schemaVersion}). Update OpenSpindle to open it.`
    )
  if (schemaVersion < EARLIEST_SCHEMA_VERSION)
    throw new Error(
      `This project was saved by an earlier version of OpenSpindle (project format ${schemaVersion}), which this version cannot open.`
    )
  const current =
    schemaVersion === PROJECT_SCHEMA_VERSION
      ? payload
      : currentPayload(payload as Record<string, unknown>)
  const read = readOptimistically(ProjectDocumentSchema, current)
  if (!read.success)
    throw new Error(
      `The project data is invalid: ${z.prettifyError(read.error)}`
    )
  return {
    value: {
      document: read.data,
      leftOut: read.leftOut.map((path) => describePath(current, path)),
    },
    archive: projectArchive(read.data, saved),
  }
}

/**
 * Reads a STEP-NC project. Never throws: an unreadable, invalid, over-limit, earlier or newer
 * project is a failure with a user-facing message. Data this version does not recognize is left
 * out of the document and listed in `leftOut`.
 */
export function decodeProject(
  text: string,
  context: ProjectOpenContext
): Result<OpenedProject> {
  try {
    const { document, leftOut } = decodeStepNc(text, readPayload)
    return ok({
      document,
      leftOut,
      missingPlugins: missingPlugins(document.plugins, context.plugins),
    })
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "The project could not be read."
    )
  }
}
