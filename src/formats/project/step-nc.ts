import { z } from "zod"
import { utf8ByteLength } from "@/machine/contract"
import { OPERATION_LIMITS } from "@/domain/operations/operation"
import { numberedPlate } from "@/domain/plate/plate"
import { TOOL_COUNT_LIMIT } from "@/domain/tools/tool"
import { FILE_KINDS } from "@/platform/contract/files"
import { decodeBase64Json, encodeBase64Json } from "../base64-json"

/**
 * The OpenSpindle STEP-NC container: an ISO 10303-21 file whose AP238 documentary workplans
 * attach each operation's exact NC text, next to an opaque JSON payload that holds the
 * application data. It knows nothing about the payload; see docs/step-nc-projects.md.
 */
const SCHEMA = "MODEL_BASED_INTEGRATED_MANUFACTURING_SCHEMA"
/** The container profile. Payloads carry their own schema version. */
const PROFILE = "OpenSpindle STEP-NC project archive v1"
const MiB = 1024 * 1024
/** Base64 characters per payload chunk item. */
const CHUNK_CHARACTERS = 65536
/**
 * DATA records of the documentary graph: the fixed project structure, one per payload chunk,
 * two per plate workplan and at most ten per instruction (a pending operation's).
 */
const GRAPH_RECORDS = { fixed: 16, workplan: 2, instruction: 10 } as const

const DATA_LIMITS = {
  /** The complete STEP-NC text, in UTF-8 bytes. */
  fileBytes: FILE_KINDS.project.maxBytes,
  /** The decoded JSON payload, in UTF-8 bytes. */
  snapshotBytes: 100 * MiB,
  plates: 100,
  operationsPerPlate: OPERATION_LIMITS.operationsPerPlate,
  tools: TOOL_COUNT_LIMIT,
  stocks: 1000,
  /** Models its fixtures use, each with its display mesh. */
  models: 64,
  heightMaps: 100,
} as const
const MAX_CHUNKS = Math.ceil(DATA_LIMITS.fileBytes / CHUNK_CHARACTERS)
/** The payload item list (manifest plus chunks) is the largest aggregate of the profile. */
const MAX_AGGREGATE = MAX_CHUNKS + 1
/** The profile nests aggregates two deep; this bounds the parser, not the profile. */
const MAX_NESTING = 12

export const PROJECT_LIMITS = {
  ...DATA_LIMITS,
  /**
   * DATA entity records: the largest graph a project within the limits above produces.
   * Encoding and decoding enforce this one limit, so every file that saves also opens.
   */
  entities:
    GRAPH_RECORDS.fixed +
    MAX_CHUNKS +
    DATA_LIMITS.plates *
      (GRAPH_RECORDS.workplan +
        DATA_LIMITS.operationsPerPlate * GRAPH_RECORDS.instruction),
} as const

const FILE_LIMIT_MESSAGE = `The project exceeds the ${PROJECT_LIMITS.fileBytes / MiB} MB file limit.`
const ENTITY_LIMIT_MESSAGE = `The project exceeds the limit of ${PROJECT_LIMITS.entities.toLocaleString("en-US")} STEP entity records.`
const exceedsFileLimit = (text: string) =>
  utf8ByteLength(text) > PROJECT_LIMITS.fileBytes
const exceedsEntityLimit = (records: number) =>
  records > PROJECT_LIMITS.entities

/** One instruction leaf of a workplan: an operation's exact NC, or an operation without NC yet. */
export type StepNcInstruction =
  | {
      readonly kind: "source"
      /** Prefix of the attached document's identifier. */
      readonly id: string
      readonly name: string
      readonly nc: string
    }
  | { readonly kind: "pending"; readonly id: string; readonly name: string }

/** One plate. A workplan without instructions gets a documentary placeholder. */
export type StepNcWorkplan = {
  readonly id: string
  readonly name: string
  readonly instructions: readonly StepNcInstruction[]
}

/** The documentary part of a project file, derived from its payload. */
export type StepNcArchive = {
  readonly name: string
  readonly workplans: readonly StepNcWorkplan[]
}

/** A decoded payload's value plus the archive it implies, which the file must match exactly. */
export type RestoredPayload<TValue> = {
  readonly value: TValue
  readonly archive: StepNcArchive
}

type Reference = { ref: number }
type Value = string | number | null | Reference | Value[]
type Entity = { id: number; name: string; values: Value[] }
const ref = (id: number): Reference => ({ ref: id })
/** An instruction's attached NC document: its id is the instruction's plus this. */
const SOURCE_SUFFIX = "/source"
const isRef = (value: Value): value is Reference =>
  !!value && typeof value === "object" && !Array.isArray(value)

/** A leaf that keeps an otherwise empty workplan's executable sequence non-empty. */
type Placeholder = {
  readonly kind: "empty"
  readonly executable: string
  readonly document: { readonly id: string; readonly name: string }
  readonly description: string
  readonly instruction: string
}
type Leaf = StepNcInstruction | Placeholder

const emptyProject = (name: string): Placeholder => ({
  kind: "empty",
  executable: "Empty project",
  document: { id: "openspindle-project/archive", name },
  description: "Empty OpenSpindle project archive; no NC program.",
  instruction: "Empty OpenSpindle project; no program.",
})

const emptyPlate = (workplan: StepNcWorkplan, number: string): Placeholder => ({
  kind: "empty",
  executable: "Empty plate",
  document: { id: `${workplan.id}/archive`, name: workplan.name || number },
  description: "Empty OpenSpindle plate; no NC program.",
  instruction: "Empty OpenSpindle plate; no program.",
})

/** ISO 10303-21 control octets and Unicode code points, never surrogate code units. */
function quote(value: string) {
  let result = "'",
    start = 0,
    offset = 0
  for (const character of value) {
    const point = character.codePointAt(0)!
    let escape: string | null = null
    if (point >= 0xd800 && point <= 0xdfff)
      throw new Error("Project text contains an unpaired Unicode surrogate.")
    if (character === "'") escape = "''"
    else if (character === "\\") escape = "\\\\"
    else if (point < 32 || point === 127)
      escape = `\\X\\${point.toString(16).padStart(2, "0").toUpperCase()}`
    else if (point > 126)
      escape = `\\X${point > 0xffff ? 4 : 2}\\${point
        .toString(16)
        .padStart(point > 0xffff ? 8 : 4, "0")
        .toUpperCase()}\\X0\\`
    if (escape !== null) {
      result += value.slice(start, offset) + escape
      start = offset + character.length
    }
    offset += character.length
  }
  return result + value.slice(start) + "'"
}
function print(value: Value): string {
  if (value === null) return "$"
  if (typeof value === "string") return quote(value)
  if (typeof value === "number") return `${value}.`
  if (Array.isArray(value)) return `(${value.map(print).join(",")})`
  return `#${value.ref}`
}

/** AP238 documentary workplans preserve source without claiming to reconstruct machining features. */
function documentaryGraph(
  archive: StepNcArchive,
  manifest: string,
  chunks: readonly string[]
): Entity[] {
  const result: Entity[] = []
  const add = (name: string, ...values: Value[]) => {
    const id = result.length + 1
    result.push({ id, name, values })
    return ref(id)
  }
  const app = add(
    "APPLICATION_CONTEXT",
    "Application protocol for the exchange of CNC data"
  )
  add(
    "APPLICATION_PROTOCOL_DEFINITION",
    "international standard",
    SCHEMA.toLowerCase(),
    2020,
    app
  )
  const productContext = add(
    "PRODUCT_CONTEXT",
    "CNC Machining",
    app,
    "manufacturing"
  )
  const definitionContext = add(
    "PRODUCT_DEFINITION_CONTEXT",
    "CNC Machining",
    app,
    "manufacturing"
  )
  const project = add(
    "MACHINING_PROJECT",
    "openspindle-project",
    archive.name,
    null,
    [productContext]
  )
  const formation = add("PRODUCT_DEFINITION_FORMATION", "1", "", project)
  const definition = add(
    "PRODUCT_DEFINITION",
    "",
    "",
    formation,
    definitionContext
  )
  const main = add("MACHINING_WORKPLAN", archive.name, "", "", "")
  const process = add("PRODUCT_DEFINITION_PROCESS", "machining", "", main, "")
  add("PROCESS_PRODUCT_ASSOCIATION", "", "", definition, process)
  const context = add("REPRESENTATION_CONTEXT", "", "units not necessary")
  const property = (owner: Reference, name: string, items: Reference[]) => {
    const attribute = add("ACTION_PROPERTY", name, "", owner)
    const representation = add("REPRESENTATION", name, items, context)
    add("ACTION_PROPERTY_REPRESENTATION", "", "", attribute, representation)
  }
  const payloadItems = [
    add(
      "DESCRIPTIVE_REPRESENTATION_ITEM",
      "openspindle:project:manifest",
      manifest
    ),
  ]
  chunks.forEach((chunk, index) =>
    payloadItems.push(
      add(
        "DESCRIPTIVE_REPRESENTATION_ITEM",
        `openspindle:project:chunk:${String(index).padStart(6, "0")}`,
        chunk
      )
    )
  )
  property(main, "openspindle:project", payloadItems)
  const sourceType = add(
    "DOCUMENT_TYPE",
    "OpenSpindle machine-specific NC source"
  )
  /** The operator instruction and associated document of a leaf, with its properties. */
  const review = (executable: Reference, leaf: Leaf): Reference => {
    switch (leaf.kind) {
      case "pending": {
        const recipe = add(
          "DOCUMENT",
          `${leaf.id}/recipe`,
          leaf.name,
          "Pending operation; configure and generate its preserved recipe in OpenSpindle before execution. No NC source is available.",
          add("DOCUMENT_TYPE", "OpenSpindle pending operation recipe")
        )
        property(executable, "openspindle:operation-state", [
          add("DESCRIPTIVE_REPRESENTATION_ITEM", "state", "pending"),
        ])
        return add(
          "MACHINING_OPERATOR_INSTRUCTION",
          "Configure operation",
          "Configure and generate this operation in OpenSpindle before running or exporting NC.",
          "",
          "",
          [recipe]
        )
      }
      case "source": {
        const source = add(
          "DOCUMENT",
          `${leaf.id}${SOURCE_SUFFIX}`,
          leaf.name,
          "Machine-specific NC source attached to the OpenSpindle instruction; no AP238 motion conversion.",
          sourceType
        )
        property(executable, "openspindle:source", [
          add("DESCRIPTIVE_REPRESENTATION_ITEM", "nc-source", leaf.nc),
        ])
        return add(
          "MACHINING_OPERATOR_INSTRUCTION",
          "Review source",
          "Review the attached NC program in OpenSpindle.",
          "",
          "",
          [source]
        )
      }
      case "empty": {
        const placeholder = add(
          "DOCUMENT",
          leaf.document.id,
          leaf.document.name,
          leaf.description,
          add("DOCUMENT_TYPE", "OpenSpindle project archive")
        )
        return add(
          "MACHINING_OPERATOR_INSTRUCTION",
          "Review source",
          leaf.instruction,
          "",
          "",
          [placeholder]
        )
      }
    }
  }
  const instruction = (parent: Reference, index: number, leaf: Leaf) => {
    const executable = add(
      "MACHINING_PROCESS_EXECUTABLE",
      leaf.kind === "empty" ? leaf.executable : leaf.name,
      "setup instructions",
      "",
      ""
    )
    add(
      "MACHINING_PROCESS_SEQUENCE_RELATIONSHIP",
      "",
      "",
      parent,
      executable,
      index
    )
    add(
      "MACHINING_OPERATOR_INSTRUCTION_RELATIONSHIP",
      "",
      "",
      executable,
      review(executable, leaf),
      1
    )
  }
  archive.workplans.forEach((workplan, index) => {
    // A plate without a name is known by its number alone.
    const number = numberedPlate(index)
    const plan = add(
      "MACHINING_WORKPLAN",
      workplan.name ? `${number}: ${workplan.name}` : number,
      "",
      "",
      ""
    )
    add(
      "MACHINING_PROCESS_SEQUENCE_RELATIONSHIP",
      "",
      "",
      main,
      plan,
      index + 1
    )
    const leaves: readonly Leaf[] = workplan.instructions.length
      ? workplan.instructions
      : [emptyPlate(workplan, number)]
    leaves.forEach((leaf, position) => instruction(plan, position + 1, leaf))
  })
  if (!archive.workplans.length)
    instruction(main, 1, emptyProject(archive.name))
  return result
}

/** The integer year of the protocol definition; every other number is a REAL. */
function record(entity: Entity) {
  const values = entity.values.map((value, index) =>
    entity.name === "APPLICATION_PROTOCOL_DEFINITION" && index === 2
      ? String(value)
      : print(value)
  )
  return `#${entity.id}=${entity.name}(${values.join(",")});`
}

const ManifestSchema = z.strictObject({
  encoding: z.literal("base64-json"),
  /** UTF-8 bytes of the payload JSON. */
  bytes: z.int().positive().max(PROJECT_LIMITS.snapshotBytes),
  /** Adler-32 of those bytes. */
  checksum: z.string().regex(/^[0-9a-f]{8}$/),
  chunks: z.int().positive().max(MAX_CHUNKS),
})
type Manifest = z.infer<typeof ManifestSchema>

/** Wraps a JSON payload and the archive's exact NC texts. Throws when a limit is exceeded. */
export function encodeStepNc(archive: StepNcArchive, payload: unknown): string {
  const encoded = encodeBase64Json(
    payload,
    PROJECT_LIMITS.snapshotBytes,
    `The project data exceeds the ${PROJECT_LIMITS.snapshotBytes / MiB} MiB limit.`
  )
  const chunks: string[] = []
  for (let i = 0; i < encoded.base64.length; i += CHUNK_CHARACTERS)
    chunks.push(encoded.base64.slice(i, i + CHUNK_CHARACTERS))
  const manifest: Manifest = {
    encoding: "base64-json",
    bytes: encoded.bytes,
    checksum: encoded.checksum,
    chunks: chunks.length,
  }
  const data = documentaryGraph(archive, JSON.stringify(manifest), chunks)
  if (exceedsEntityLimit(data.length)) throw new Error(ENTITY_LIMIT_MESSAGE)
  const source = [
    "ISO-10303-21;",
    "HEADER;",
    `FILE_DESCRIPTION((${quote(PROFILE)}),'2;1');`,
    `FILE_NAME(${quote(archive.name + ".stpnc")},${quote(new Date().toISOString())},(''),(''),'OpenSpindle','OpenSpindle','');`,
    `FILE_SCHEMA(('${SCHEMA}'));`,
    "ENDSEC;",
    "DATA;",
    ...data.map(record),
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n")
  if (exceedsFileLimit(source)) throw new Error(FILE_LIMIT_MESSAGE)
  return source
}

class Part21Reader {
  offset = 0
  constructor(readonly source: string) {}
  fail(message = "Malformed STEP-NC project."): never {
    throw new Error(`${message} (offset ${this.offset})`)
  }
  whitespace() {
    while (this.offset < this.source.length) {
      const before = this.offset
      while (
        /\s/.test(this.source[this.offset] ?? "") &&
        this.offset < this.source.length
      )
        this.offset++
      if (this.source.startsWith("/*", this.offset)) {
        const end = this.source.indexOf("*/", this.offset + 2)
        if (end < 0) this.fail("Unclosed STEP comment.")
        this.offset = end + 2
      }
      if (before === this.offset) break
    }
  }
  take(token: string) {
    this.whitespace()
    if (!this.source.startsWith(token, this.offset)) return false
    this.offset += token.length
    return true
  }
  expect(token: string) {
    if (!this.take(token)) this.fail(`Expected ${token}.`)
  }
  identifier() {
    this.whitespace()
    const match = /^[A-Z][A-Z0-9_]*/.exec(this.source.slice(this.offset))
    if (!match) this.fail()
    this.offset += match[0].length
    return match[0]
  }
  positiveInteger() {
    this.whitespace()
    const match = /^[1-9]\d*/.exec(this.source.slice(this.offset))
    if (!match) this.fail()
    this.offset += match[0].length
    const value = Number(match[0])
    if (!Number.isSafeInteger(value)) this.fail()
    return value
  }
  string() {
    this.expect("'")
    let result = "",
      start = this.offset
    while (this.offset < this.source.length) {
      const char = this.source[this.offset]
      if (char === "'") {
        result += this.source.slice(start, this.offset)
        this.offset++
        if (this.source[this.offset] !== "'") return result
        result += "'"
        this.offset++
        start = this.offset
      } else if (char === "\\") {
        result += this.source.slice(start, this.offset)
        if (this.source.startsWith("\\\\", this.offset)) {
          result += "\\"
          this.offset += 2
        } else if (this.source.startsWith("\\X\\", this.offset)) {
          const hex = this.source.slice(this.offset + 3, this.offset + 5)
          if (!/^[0-9A-Fa-f]{2}$/.test(hex))
            this.fail("Invalid STEP control escape.")
          result += String.fromCharCode(parseInt(hex, 16))
          this.offset += 5
        } else {
          const kind = this.source.slice(this.offset, this.offset + 4)
          if (kind !== "\\X2\\" && kind !== "\\X4\\")
            this.fail("Unsupported STEP string escape.")
          const end = this.source.indexOf("\\X0\\", this.offset + 4)
          if (end < 0) this.fail("Unclosed STEP string escape.")
          const hex = this.source.slice(this.offset + 4, end)
          const width = kind === "\\X2\\" ? 4 : 8
          if (!hex.length || hex.length % width || !/^[0-9A-Fa-f]+$/.test(hex))
            this.fail()
          for (let i = 0; i < hex.length; i += width) {
            const point = parseInt(hex.slice(i, i + width), 16)
            if (
              point > 0x10ffff ||
              point < 32 ||
              point === 127 ||
              (point >= 0xd800 && point <= 0xdfff)
            )
              this.fail("Invalid STEP Unicode code point.")
            result +=
              width === 4
                ? String.fromCharCode(point)
                : String.fromCodePoint(point)
          }
          this.offset = end + 4
        }
        start = this.offset
      } else {
        if (char.charCodeAt(0) < 32 || char.charCodeAt(0) > 126)
          this.fail("Non-ASCII character outside a STEP escape.")
        this.offset++
      }
    }
    this.fail("Unclosed STEP string.")
  }
  value(depth = 0): Value {
    if (depth > MAX_NESTING) this.fail("STEP nesting exceeds its limit.")
    this.whitespace()
    if (this.source[this.offset] === "'") return this.string()
    if (this.take("$")) return null
    if (this.take("#")) return ref(this.positiveInteger())
    if (this.take("(")) {
      const values: Value[] = []
      if (this.take(")")) return values
      do {
        if (values.length >= MAX_AGGREGATE)
          this.fail("STEP aggregate exceeds its limit.")
        values.push(this.value(depth + 1))
      } while (this.take(","))
      this.expect(")")
      return values
    }
    const match = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?/.exec(
      this.source.slice(this.offset)
    )
    if (!match || !Number.isFinite(Number(match[0]))) this.fail()
    this.offset += match[0].length
    return Number(match[0])
  }
  record() {
    const name = this.identifier()
    const values = this.value()
    if (!Array.isArray(values)) this.fail()
    this.expect(";")
    return { name, values }
  }
}

const StringListSchema = z.array(z.string()).min(1)
/** FILE_DESCRIPTION, FILE_NAME and FILE_SCHEMA, in that order. */
const HeaderSchema = z.tuple([
  z.object({
    name: z.literal("FILE_DESCRIPTION"),
    values: z.tuple([z.tuple([z.literal(PROFILE)]), z.literal("2;1")]),
  }),
  z.object({
    name: z.literal("FILE_NAME"),
    values: z.tuple([
      z.string(),
      z.string(),
      StringListSchema,
      StringListSchema,
      z.string(),
      z.string(),
      z.string(),
    ]),
  }),
  z.object({
    name: z.literal("FILE_SCHEMA"),
    values: z.tuple([z.tuple([z.literal(SCHEMA)])]),
  }),
])

const PayloadItemsSchema = z.array(
  z.object({
    name: z.literal("DESCRIPTIVE_REPRESENTATION_ITEM"),
    values: z.tuple([z.string(), z.string()]),
  })
)

/** The payload's manifest text and base64 chunks, integrity not yet checked. */
function payloadText(data: readonly Entity[]) {
  const byId = new Map(data.map((item) => [item.id, item]))
  const dereference = (value: Value) =>
    isRef(value) ? byId.get(value.ref) : undefined
  const properties = data.filter(
    (item) =>
      item.name === "ACTION_PROPERTY" &&
      item.values[0] === "openspindle:project"
  )
  if (properties.length !== 1)
    throw new Error("STEP-NC project metadata is missing or duplicated.")
  const links = data.filter(
    (item) =>
      item.name === "ACTION_PROPERTY_REPRESENTATION" &&
      dereference(item.values[2]) === properties[0]
  )
  const representation =
    links.length === 1 ? dereference(links[0].values[3]) : undefined
  if (
    representation?.name !== "REPRESENTATION" ||
    !Array.isArray(representation.values[1])
  )
    throw new Error("STEP-NC project metadata is not linked correctly.")
  const parsed = PayloadItemsSchema.safeParse(
    representation.values[1].map(dereference)
  )
  if (!parsed.success) throw new Error("STEP-NC project metadata is malformed.")
  const items = parsed.data.map((item) => item.values)
  if (!items.length || items[0][0] !== "openspindle:project:manifest")
    throw new Error("Missing STEP-NC project manifest.")
  const chunks = items.slice(1).map(([name, chunk], index) => {
    if (
      name !== `openspindle:project:chunk:${String(index).padStart(6, "0")}` ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(chunk) ||
      chunk.length > CHUNK_CHARACTERS
    )
      throw new Error("STEP-NC project chunks are missing or out of order.")
    return chunk
  })
  return { manifest: items[0][1], chunks }
}

function readManifest(text: string, chunks: number): Manifest {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error("STEP-NC project manifest is corrupted.")
  }
  const manifest = ManifestSchema.safeParse(value)
  if (!manifest.success || manifest.data.chunks !== chunks)
    throw new Error("STEP-NC project manifest is invalid.")
  return manifest.data
}

/**
 * The NC the file attaches to each instruction, by instruction id: the writer adds an
 * instruction's source document and then its nc-source item. The graph check that follows
 * refuses anything this reads wrongly.
 */
function attachedSources(entities: readonly Entity[]): Map<string, string> {
  const sources = new Map<string, string>()
  entities.forEach((entity, index) => {
    const [documentId] = entity.values
    const next = entities.at(index + 1)
    const nc = next?.values.at(1)
    if (
      entity.name === "DOCUMENT" &&
      typeof documentId === "string" &&
      documentId.endsWith(SOURCE_SUFFIX) &&
      next?.name === "DESCRIPTIVE_REPRESENTATION_ITEM" &&
      next.values[0] === "nc-source" &&
      typeof nc === "string"
    )
      sources.set(documentId.slice(0, -SOURCE_SUFFIX.length), nc)
  })
  return sources
}

/**
 * Opens a container: checks the profile, limits and payload integrity, lets `restore` validate
 * the payload and describe its archive (with the NC the file attaches to each instruction),
 * then requires the file's graph to be exactly that archive's. Throws an Error with a
 * user-facing message when anything differs.
 */
export function decodeStepNc<TValue>(
  contents: string,
  restore: (
    payload: unknown,
    attached: ReadonlyMap<string, string>
  ) => RestoredPayload<TValue>
): TValue {
  if (exceedsFileLimit(contents)) throw new Error(FILE_LIMIT_MESSAGE)
  const reader = new Part21Reader(contents.replace(/^\uFEFF/, ""))
  reader.expect("ISO-10303-21;")
  reader.expect("HEADER;")
  const header = [reader.record(), reader.record(), reader.record()]
  if (!HeaderSchema.safeParse(header).success)
    throw new Error(
      "This is not an OpenSpindle STEP-NC project. General CAD STEP and third-party STEP-NC import are not supported."
    )
  reader.expect("ENDSEC;")
  reader.expect("DATA;")
  const data: Entity[] = []
  const ids = new Set<number>()
  while (!reader.take("ENDSEC;")) {
    if (exceedsEntityLimit(data.length + 1)) reader.fail(ENTITY_LIMIT_MESSAGE)
    reader.expect("#")
    const id = reader.positiveInteger()
    reader.expect("=")
    if (ids.has(id)) reader.fail("Duplicate STEP entity identifier.")
    ids.add(id)
    data.push({ id, ...reader.record() })
  }
  reader.expect("END-ISO-10303-21;")
  reader.whitespace()
  if (reader.offset !== reader.source.length)
    reader.fail("Unexpected data after the STEP-NC project.")
  const text = payloadText(data)
  const manifest = readManifest(text.manifest, text.chunks.length)
  let payload: unknown
  try {
    payload = decodeBase64Json({
      base64: text.chunks.join(""),
      bytes: manifest.bytes,
      checksum: manifest.checksum,
    })
  } catch {
    throw new Error("STEP-NC project data is corrupted.")
  }
  const ordered = [...data].sort((a, b) => a.id - b.id)
  const restored = restore(payload, attachedSources(ordered))
  // This profile accepts only its documented graph. No unrecognised executable is silently ignored.
  const expected = documentaryGraph(
    restored.archive,
    text.manifest,
    text.chunks
  )
  if (
    ordered.length !== expected.length ||
    ordered.some(
      (entity, index) =>
        JSON.stringify(entity) !== JSON.stringify(expected[index])
    )
  )
    throw new Error(
      "The STEP-NC structure or NC source differs from the saved OpenSpindle project metadata."
    )
  return restored.value
}
