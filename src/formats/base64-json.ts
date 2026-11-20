import { strToU8 } from "fflate"

/**
 * JSON as UTF-8, then base64, with the byte length and Adler-32 checksum of the UTF-8: how
 * Spinnvill files embed application data in text. Adler-32 detects accidental corruption; it
 * is not a signature.
 */
export type Base64Json = {
  readonly base64: string
  readonly bytes: number
  /** Eight lowercase hexadecimal digits. */
  readonly checksum: string
}

export function adler32(bytes: Uint8Array): string {
  let a = 1
  let b = 0
  for (const byte of bytes) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return (((b << 16) | a) >>> 0).toString(16).padStart(8, "0")
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary)
}

/**
 * Throws on text that is not base64. Indexes the decoded binary string directly rather than
 * `Uint8Array.from(atob(text), ...)`, which visits it through a string iterator and a mapping
 * callback per byte; the loop is the same decode with about a twentieth of the overhead.
 */
export function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Throws `tooLarge` when the UTF-8 JSON exceeds `maxBytes`, before encoding it. */
export function encodeBase64Json(
  value: unknown,
  maxBytes: number,
  tooLarge: string
): Base64Json {
  const bytes = strToU8(JSON.stringify(value))
  if (bytes.length > maxBytes) throw new Error(tooLarge)
  return {
    base64: toBase64(bytes),
    bytes: bytes.length,
    checksum: adler32(bytes),
  }
}

/** The embedded value; throws unless the text, length, checksum and UTF-8 all match. */
export function decodeBase64Json(encoded: Base64Json): unknown {
  if (encoded.base64.length !== Math.ceil(encoded.bytes / 3) * 4)
    throw new Error("The embedded data has the wrong length.")
  const bytes = fromBase64(encoded.base64)
  if (bytes.length !== encoded.bytes || adler32(bytes) !== encoded.checksum)
    throw new Error("The embedded data failed its integrity check.")
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  ) as unknown
}
