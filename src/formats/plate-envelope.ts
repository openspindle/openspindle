import { strToU8 } from "fflate"
import { z } from "zod"
import {
  GroupSchema,
  PlateNameSchema,
  PlateSetupSchema,
  PlateToolSchema,
} from "@/domain/plate/plate"
import { OperationSchema } from "@/domain/operations/operation"
import { adler32, decodeBase64Json, encodeBase64Json } from "./base64-json"

/** Setup and editable operations embedded as leading comments of an exported NC file. */
const MAX_ENVELOPE_BYTES = 32 * 1024 * 1024
const BEGIN =
  /^;@OPENSPINDLE\|BEGIN\|v=(\d+)\|encoding=base64-json\|bytes=(\d+)\|checksum=([a-f0-9]{8})$/
const DATA = ";@OPENSPINDLE|DATA|"
const END = ";@OPENSPINDLE|END"

/** Whether NC text begins as an exported plate does, with its setup in leading comments. */
export const carriesPlate = (source: string) =>
  source.startsWith(";@OPENSPINDLE|")

/**
 * The envelope version exports write: version 3 fixtures name their model's source, since
 * version 4 the wasteboard is one of them, and since version 5 anchored probing travels at the
 * height the machine's probe travels at.
 */
export const PLATE_ENVELOPE_VERSION = 5

/** The version read besides the current one, which it becomes on import. */
export const PREVIOUS_PLATE_ENVELOPE_VERSION = 4

/** The exported plate: everything needed to restore editable operations exactly. */
export const PlateEnvelopeSchema = z.object({
  schemaVersion: z.literal(PLATE_ENVELOPE_VERSION),
  name: PlateNameSchema,
  setup: PlateSetupSchema,
  tools: z.array(PlateToolSchema).max(100),
  operations: z.array(OperationSchema).max(100),
  groups: z.array(GroupSchema).max(500),
  /** Checksum of the NC body; a mismatch means the body was edited after export. */
  bodyChecksum: z.string().regex(/^[a-f0-9]{8}$/),
})
export type PlateEnvelope = z.infer<typeof PlateEnvelopeSchema>

export type EnvelopeRead =
  | { readonly version: null; readonly body: string }
  | {
      readonly version: number
      readonly payload: unknown
      readonly body: string
    }

/** Reads our exact leading comment block; any other text is the body, byte for byte. */
export function readEnvelope(source: string): EnvelopeRead {
  if (!carriesPlate(source)) return { version: null, body: source }
  const firstEnd = source.indexOf("\n")
  const header = (firstEnd < 0 ? source : source.slice(0, firstEnd)).replace(
    /\r$/,
    ""
  )
  const match = BEGIN.exec(header)
  if (!match || Number(match[2]) > MAX_ENVELOPE_BYTES)
    throw new Error("Unsupported or invalid OpenSpindle setup definition.")
  let cursor = firstEnd + 1
  let encoded = ""
  let complete = false
  // A file that ends before END leaves the loop with the definition incomplete.
  while (cursor > 0 && cursor < source.length) {
    const end = source.indexOf("\n", cursor)
    const line = source
      .slice(cursor, end < 0 ? undefined : end)
      .replace(/\r$/, "")
    cursor = end < 0 ? source.length : end + 1
    if (line === END) {
      complete = true
      break
    }
    if (
      !line.startsWith(DATA) ||
      !/^[A-Za-z0-9+/=]{1,120}$/.test(line.slice(DATA.length))
    )
      throw new Error("Invalid OpenSpindle setup data.")
    encoded += line.slice(DATA.length)
    if (encoded.length > Math.ceil(MAX_ENVELOPE_BYTES / 3) * 4)
      throw new Error("OpenSpindle setup data exceeds its limit.")
  }
  if (!complete) throw new Error("Incomplete OpenSpindle setup definition.")
  let payload: unknown
  try {
    payload = decodeBase64Json({
      base64: encoded,
      bytes: Number(match[2]),
      checksum: match[3],
    })
  } catch {
    throw new Error("OpenSpindle setup data is corrupted.")
  }
  return { version: Number(match[1]), payload, body: source.slice(cursor) }
}

/** Prefixes a body with an envelope; the body itself is never changed. */
export function writeEnvelope(
  body: string,
  version: number,
  payload: unknown
): string {
  const encoded = encodeBase64Json(
    payload,
    MAX_ENVELOPE_BYTES,
    "Plate settings and editable operations exceed the 32 MiB limit."
  )
  const newline = body.includes("\r\n") ? "\r\n" : "\n"
  const lines = [
    `;@OPENSPINDLE|BEGIN|v=${version}|encoding=base64-json|bytes=${encoded.bytes}|checksum=${encoded.checksum}`,
  ]
  for (let offset = 0; offset < encoded.base64.length; offset += 120)
    lines.push(`${DATA}${encoded.base64.slice(offset, offset + 120)}`)
  lines.push(END)
  return lines.join(newline) + newline + body
}

export const bodyChecksum = (body: string) => adler32(strToU8(body))
