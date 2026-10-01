import { z } from "zod"
import { kitForPlate } from "@/domain/fixtures/catalog"
import { kindOf, resolveOperation } from "@/domain/operations/kinds"
import type { Operation } from "@/domain/operations/operation"
import type { Plate } from "@/domain/plate/plate"
import { fail, ok } from "@/domain/primitives"
import type { Result } from "@/domain/primitives"
import type { Tool } from "@/domain/tools/tool"
import { describePath, readOptimistically } from "../optimistic-read"
import { isJsonObject } from "../upgrade/json"
import { upgradePlate, withNotices } from "../upgrade/plate"
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
 * What a file documents of the project as saved, which opening an earlier one may have changed:
 * the NC it attaches to each procedural instruction (it documents the NC when saved, and newer
 * versions may generate it differently), and the names of operations upgrading renamed, both
 * by instruction id.
 */
type Saved = {
  readonly nc: ReadonlyMap<string, string>
  readonly names: ReadonlyMap<string, string>
}

/**
 * An operation's instruction: the exact NC it contributes (stored, or derived from its
 * parameters and the project's tool library `tools` for procedural kinds), or a pending entry
 * until it has NC. Opening a file documents the project as the file saved it (`saved`).
 */
function instruction(
  plate: Plate,
  operation: Operation,
  tools: readonly Tool[],
  saved?: Saved
): StepNcInstruction {
  const id = `${plate.id}/${operation.id}`
  const name = saved?.names.get(id) ?? operation.name
  if (saved && kindOf(operation).generated) {
    const nc = saved.nc.get(id)
    return nc === undefined
      ? { kind: "pending", id, name }
      : { kind: "source", id, name, nc }
  }
  const resolved = resolveOperation(operation, plate, {
    kit: kitForPlate(plate),
    tools,
  })
  if (!resolved.ok) return { kind: "pending", id, name }
  return { kind: "source", id, name, nc: resolved.value.nc }
}

/** One workplan per plate and one instruction per operation, in order. */
function projectArchive(
  document: ProjectDocument,
  saved?: Saved
): StepNcArchive {
  return {
    name: document.name,
    workplans: document.plates.map((plate) => ({
      id: plate.id,
      name: plate.name,
      instructions: plate.operations.map((operation) =>
        instruction(plate, operation, document.tools, saved)
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
 * An earlier project's plates in the current format: upgraded (`upgradePlate`, with the
 * project's tool library), each with the notices that brings, and the names of the operations
 * it renamed as saved, by instruction id. What it still does not recognize (such as format 4's
 * travel Z) is left for reading to leave out and report, rather than rewritten field by field.
 */
function withUpgradedPlates(payload: Record<string, unknown>): {
  readonly payload: Record<string, unknown>
  readonly savedNames: ReadonlyMap<string, string>
} {
  const library = Array.isArray(payload.tools) ? payload.tools : []
  const savedNames = new Map<string, string>()
  if (!Array.isArray(payload.plates)) return { payload, savedNames }
  const plates = payload.plates.map((item: unknown) => {
    if (!isJsonObject(item)) return item
    const { plate, notices, savedNames: names } = upgradePlate(item, library)
    for (const [operationId, name] of names)
      savedNames.set(`${String(item.id)}/${operationId}`, name)
    return notices.length && Array.isArray(plate.notices)
      ? { ...plate, notices: withNotices(plate.notices, notices) }
      : plate
  })
  return { payload: { ...payload, plates }, savedNames }
}

/**
 * Projects of this version and the earlier ones from format 4 are read; `saved` is the NC the file attaches
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
  // Rule settings move to different paths, and probing operations take their current shape:
  // read the converted fields optimistically there.
  const { payload: current, savedNames } =
    schemaVersion < PROJECT_SCHEMA_VERSION
      ? withUpgradedPlates(currentPayload(payload as Record<string, unknown>))
      : { payload, savedNames: new Map<string, string>() }
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
    archive: projectArchive(read.data, { nc: saved, names: savedNames }),
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
