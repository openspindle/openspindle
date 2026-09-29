import type { Stock } from "@/domain/stock/stock"

/**
 * How a program describes one of its tools, as its CAM wrote it: what a library tool for its
 * number must be. Unknown values are null.
 */
export type ProgramTool = {
  readonly number: number
  /** The CAM's name for the tool: "Spiral O Metal 3.175*12mm". */
  readonly name: string | null
  /** Millimetres. */
  readonly diameter: number | null
  readonly fluteLength: number | null
  /** A tool kind as tool libraries name them: "flat end mill". */
  readonly kind: string | null
}

/**
 * The markers a CAM writes in the comments of the programs it makes: where its toolpaths start
 * and what they are called, the stock a program is for and the tools it uses. A machine's kit
 * reads those of the CAM made for its machine.
 */
export interface CamMarkers {
  /**
   * The toolpaths the lines start, by the index of the line that starts each, with its name.
   * Null when the lines mark no toolpath start, and headings in comments name toolpaths instead.
   */
  toolpaths: (lines: readonly string[]) => ReadonlyMap<number, string> | null
  /**
   * The stock the lines describe, on `fallback`'s other properties; null when they describe none,
   * or none that makes a valid stock.
   */
  stock: (
    lines: readonly string[],
    fileName: string,
    fallback: Stock
  ) => Stock | null
  /** The tools the lines describe, by number; null when they describe none this way. */
  tools?: (lines: readonly string[]) => ReadonlyMap<number, ProgramTool> | null
}

/**
 * A toolpath's name from a CAM as sections show it: trimmed, at most 160 characters and without
 * control characters; null otherwise.
 */
export function camLabel(value: string | undefined): string | null {
  const text = value?.trim()
  return text &&
    text.length <= 160 &&
    ![...text].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    )
    ? text
    : null
}
