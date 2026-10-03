import { z } from "zod"
import type { Tool } from "@/domain/tools/tool"
import type { Stock } from "@/domain/stock/stock"
import { createOperation } from "@/domain/operations/operation"
import { kitForSetup } from "@/domain/fixtures/catalog"
import type { ProgramTool } from "@/domain/nc/cam-markers"
import { markedStock } from "@/domain/nc/stock-markers"
import { programTools } from "@/domain/nc/tool-comments"
import { fitsWorkArea } from "@/domain/plate/placement"
import { bedSetupDefinitions, deviceBedSetup } from "@/domain/fixtures/profiles"
import type { FixtureDefinition } from "@/domain/fixtures/definitions"
import { fixtureCompatible } from "@/domain/fixtures/compatibility"
import type { FixtureProfiles } from "@/domain/fixtures/profiles"
import {
  createPlate,
  createPlateSetup,
  notice,
  withProgramFixtures,
  withStockPlacement,
} from "@/domain/plate/plate"
import type { Plate, PlateSetup } from "@/domain/plate/plate"
import { fail, newId, ok, plural } from "@/domain/primitives"
import type { Result } from "@/domain/primitives"
import {
  bindTools,
  describedPreferences,
  localTools,
} from "@/domain/tools/tool-table"
import {
  PLATE_ENVELOPE_VERSION,
  OLDEST_PLATE_ENVELOPE_VERSION,
  PlateEnvelopeSchema,
  bodyChecksum,
  readEnvelope,
  upgradeEnvelopePayload,
} from "@/formats/plate-envelope"
import { describePath, readOptimistically } from "@/formats/optimistic-read"
import {
  retainedSourceField,
  upgradePlateSources,
} from "@/formats/project/upgrade"
import { withNotices } from "@/formats/upgrade/plate"

/**
 * Where plates created from plain programs are set up: the selected fixture profile, or the
 * bed of the empty plate they replace.
 */
export type PlatePlacement = Pick<
  PlateSetup,
  "fixtures" | "deviceId" | "anchors" | "bedSetupId"
>

export type ImportContext = {
  readonly tools: readonly Tool[]
  /**
   * Whether a tool number the program does not describe takes the library tool with that
   * post-processor number; tools it describes take the one the description fits either way.
   * Fusion 360's numbers do not identify cutters in the library.
   */
  readonly numberedTools?: boolean
  /**
   * What the whole program says of its tools, for a part split off it: the header of a post
   * describes the tools its later parts use.
   */
  readonly describedTools?: ReadonlyMap<number, ProgramTool>
  /** Base for stock described by markers; files without markers get none. */
  readonly stock: Stock
  readonly placement?: PlatePlacement
  /**
   * Bed setups provide placement overrides for compatible shared fixture definitions.
   */
  readonly fixtureProfiles?: FixtureProfiles
  readonly fixtureDefinitions?: readonly FixtureDefinition[]
  /** The setup plain programs keep of the empty plate they replace (see `keptSetup`). */
  readonly setup?: PlateSetup
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const EDITED_AFTER_EXPORT =
  "The program was edited after export: its setup was kept, but it was imported as a single program instead of its editable operations."

/** How many of an envelope's left-out fields a notice names before it just counts the rest. */
const NAMED_LEFT_OUT_FIELDS = 5

/** One notice for an envelope whose embedded setup carried fields this version does not use. */
function leftOutNotice(leftOut: readonly string[]): string {
  const named = leftOut.slice(0, NAMED_LEFT_OUT_FIELDS)
  const more = leftOut.length - named.length
  const list =
    more > 0 ? `${named.join(", ")}, and ${more} more` : named.join(", ")
  const verb = leftOut.length === 1 ? "was" : "were"
  return `${plural(leftOut.length, "field")} of its embedded setup ${verb} left out, which this version of OpenSpindle does not use: ${list}.`
}

/** An empty plate for generated operations: the context's stock, on the selected profile. */
export function newPlate(
  context: Pick<ImportContext, "stock" | "placement">
): Plate {
  return createPlate(
    createPlateSetup({
      stock: context.stock,
      stockSource: "assigned",
      ...context.placement,
    })
  )
}

/**
 * A plate holding one file operation, named after the file, bound to the plate's tool table:
 * each of the program's tool numbers holds the library tool the program describes for it
 * (`describedPreferences`), as its CAM wrote it.
 */
function filePlate(
  name: string,
  nc: string,
  setup: PlateSetup,
  library: readonly Tool[],
  numbered = true,
  described = programTools(nc, kitForSetup(setup).camMarkers)
): Plate {
  const operation = createOperation(name, { kind: "file", nc, park: true })
  const plate = createPlate(setup, [operation])
  const locals = localTools(nc)
  return bindTools(plate, operation, locals, {
    preferred: describedPreferences(locals, library, described, numbered),
    library,
  }).plate
}

/**
 * Builds a plate from an NC file: a plain program, or an export with its setup and editable
 * operations. A plain program keeps the setup made on the empty plate it replaces, if any, else
 * gets the stock its markers describe, where they put it. An export whose NC body was edited
 * keeps its setup and becomes a single program, with a notice. Exports of earlier versions from
 * 4 open as the current one; other versions are refused.
 */
export function importProgram(
  fileName: string,
  text: string,
  context: ImportContext
): Result<Plate> {
  let envelope
  try {
    envelope = readEnvelope(text)
  } catch (error) {
    return fail(message(error))
  }
  if (envelope.version === null) {
    // What was set up on the empty plate wins over the stock the program describes.
    if (context.setup)
      return ok(
        filePlate(
          fileName,
          text,
          structuredClone(context.setup),
          context.tools,
          context.numberedTools,
          context.describedTools
        )
      )
    // The stock OpenSpindle's markers describe, where they put it, else the stock its CAM's
    // markers describe; one its machine's work area cannot hold stays unspecified.
    const kit = kitForSetup({
      deviceId: context.placement?.deviceId ?? null,
      fixtures: context.placement?.fixtures ?? [],
    })
    const lines = text.split(/\r\n?|\n/)
    const marked = markedStock(lines, fileName, context.stock)
    const described =
      marked?.stock ??
      kit.camMarkers?.stock(lines, fileName, context.stock) ??
      null
    const stock =
      described && fitsWorkArea(described, kit.workArea) ? described : null
    const setup = createPlateSetup({
      stock,
      stockSource: stock ? "source" : "unspecified",
      ...context.placement,
    })
    // Where the markers put the stock, with the fixtures they say hold it, as the plate's
    // device's bed setup defines them.
    const bed = context.fixtureProfiles
      ? deviceBedSetup(
          context.fixtureProfiles,
          setup.deviceId,
          setup.bedSetupId
        )
      : null
    const held = marked
      ? withProgramFixtures(
          withStockPlacement(setup, marked.placement, {
            workArea: kit.workArea,
            workAreaOrigin: kit.workAreaOrigin,
            tableTop: kit.tableTop,
            anchors: kit.factoryAnchors(setup.deviceId),
          }),
          marked.fixtures,
          bed
            ? bedSetupDefinitions(
                context.fixtureDefinitions ?? [],
                bed.bedSetup,
                setup.deviceId
              )
            : (context.fixtureDefinitions ?? []).filter((definition) =>
                fixtureCompatible(definition, setup.deviceId)
              ),
          bed && { device: bed.device, bedSetup: bed.bedSetup.name }
        )
      : { setup, notices: [] }
    const plate = filePlate(
      fileName,
      text,
      held.setup,
      context.tools,
      context.numberedTools,
      context.describedTools
    )
    return ok({
      ...plate,
      notices: [...plate.notices, ...held.notices.map(notice)],
    })
  }
  if (envelope.version > PLATE_ENVELOPE_VERSION)
    return fail("It was exported by a newer version of OpenSpindle.")
  if (envelope.version < OLDEST_PLATE_ENVELOPE_VERSION)
    return fail(
      "It was exported by an earlier version of OpenSpindle, which this version cannot read."
    )
  // An earlier version's payload has its probing operations upgraded before reading it
  // optimistically. Its other sources are read upgraded through the schema, so fields that
  // leaves out are reported too.
  const upgraded =
    envelope.version < PLATE_ENVELOPE_VERSION
      ? upgradeEnvelopePayload(envelope.payload, context.tools)
      : { payload: envelope.payload, notices: [] }
  const rawPayload = upgraded.payload
  const schema =
    envelope.version < PLATE_ENVELOPE_VERSION
      ? z.preprocess(upgradePlateSources, PlateEnvelopeSchema)
      : PlateEnvelopeSchema
  const read = readOptimistically(schema, rawPayload)
  if (!read.success)
    return fail(`Its embedded setup is invalid: ${z.prettifyError(read.error)}`)
  const exported = read.data
  const leftOut = read.leftOut
    .filter(
      (path) =>
        envelope.version === PLATE_ENVELOPE_VERSION ||
        !retainedSourceField(exported.operations, path)
    )
    .map((path) => describePath(rawPayload, path))
  const leftOutNotices = leftOut.length ? [notice(leftOutNotice(leftOut))] : []
  if (bodyChecksum(envelope.body) !== exported.bodyChecksum) {
    const plate = filePlate(
      fileName,
      envelope.body,
      exported.setup,
      context.tools
    )
    return ok({
      ...plate,
      name: exported.name,
      notices: [...leftOutNotices, notice(EDITED_AFTER_EXPORT)],
    })
  }
  return ok({
    id: newId(),
    name: exported.name,
    setup: exported.setup,
    tools: exported.tools,
    operations: exported.operations,
    groups: exported.groups,
    notices: withNotices(leftOutNotices, upgraded.notices),
    example: false,
  })
}
