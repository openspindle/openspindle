import { z } from "zod"
import { kindOf, resolveOperation } from "@/domain/operations/kinds"
import type { Operation } from "@/domain/operations/operation"
import type { Plate } from "@/domain/plate/plate"
import { fail, ok } from "@/domain/primitives"
import type { Result } from "@/domain/primitives"
import { describePath, readOptimistically } from "../optimistic-read"
import { PROJECT_SCHEMA_VERSION, ProjectDocumentSchema } from "./document"
import type { ProjectDocument } from "./document"
import { retainedSourceField, upgradeWorkspaceSources } from "./upgrade"
import { ruleSettingsFromDesignRules } from "./rule-settings"
import { decodeStepNc, encodeStepNc } from "./step-nc"
import type {
  RestoredPayload,
  StepNcArchive,
  StepNcInstruction,
} from "./step-nc"

export type OpenedProject = {
  readonly document: ProjectDocument
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

/** The oldest format that can be upgraded on opening. */
const MINIMUM_SCHEMA_VERSION = 4

/** Earlier projects keep their rule settings, converting named design rules when needed. */
function currentPayload(payload: Record<string, unknown>) {
  const { designRules, ...data } = payload
  return {
    ...data,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    ruleSettings: Object.hasOwn(data, "ruleSettings")
      ? data.ruleSettings
      : ruleSettingsFromDesignRules(designRules),
  }
}

/**
 * Projects of this version and compatible earlier versions are read; `saved` is the NC the file attaches
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
  if (schemaVersion < MINIMUM_SCHEMA_VERSION)
    throw new Error(
      `This project was saved by an earlier version of OpenSpindle (project format ${schemaVersion}), which this version cannot open.`
    )
  // Rule settings move to different paths: read the converted fields optimistically there.
  const current =
    schemaVersion < PROJECT_SCHEMA_VERSION
      ? currentPayload(payload as Record<string, unknown>)
      : payload
  const schema =
    schemaVersion < PROJECT_SCHEMA_VERSION
      ? z.preprocess((value) => {
          const { plugins: _plugins, ...data } = value as Record<
            string,
            unknown
          >
          return upgradeWorkspaceSources(data)
        }, ProjectDocumentSchema)
      : ProjectDocumentSchema
  const read = readOptimistically(schema, current)
  if (!read.success)
    throw new Error(
      `The project data is invalid: ${z.prettifyError(read.error)}`
    )
  return {
    value: {
      document: read.data,
      leftOut: read.leftOut
        .filter((path) => {
          if (
            schemaVersion === PROJECT_SCHEMA_VERSION ||
            path[0] !== "plates" ||
            typeof path[1] !== "number"
          )
            return true
          return !retainedSourceField(
            read.data.plates[path[1]]?.operations ?? [],
            path.slice(2)
          )
        })
        .map((path) => describePath(current, path)),
    },
    archive: projectArchive(read.data, saved),
  }
}

/**
 * Reads a STEP-NC project. Never throws: an unreadable, invalid, over-limit, earlier or newer
 * project is a failure with a user-facing message. Data this version does not recognize is left
 * out of the document and listed in `leftOut`.
 */
export function decodeProject(text: string): Result<OpenedProject> {
  try {
    const { document, leftOut } = decodeStepNc(text, readPayload)
    return ok({
      document,
      leftOut,
    })
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "The project could not be read."
    )
  }
}
