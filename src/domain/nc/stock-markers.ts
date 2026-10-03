import { hasControlCharacter } from "@/machine/contract"
import {
  FIXTURE_LIMIT,
  FIXTURE_NAME_LIMIT,
} from "@/domain/fixtures/definitions"
import { COORDINATE_LIMIT, EntityIdSchema } from "@/domain/primitives"
import type { Point3 } from "@/domain/primitives"
import { UNSPECIFIED_STOCK_NAME, isStock } from "@/domain/stock/stock"
import type { Stock } from "@/domain/stock/stock"

/** Where a program puts its stock, as its markers describe it, in millimetres. */
export type StockPlacement = {
  /** The work origin, the program's zero, from the stock's front-left bottom corner. */
  readonly workOrigin: Point3 | null
  /** The stock's front-left bottom corner: its X and Y from a stored anchor (its id). */
  readonly anchor: {
    readonly id: string
    readonly offset: readonly [number, number]
  } | null
}

/** A fixture a program's stock is held by, by its name, and its box beside the stock's. */
export type MarkedFixture = {
  readonly name: string
  /** Its box's front-left bottom corner from the stock's front-left bottom corner. */
  readonly corner: Point3
  /** Its box's size along X, Y and Z. */
  readonly size: Point3
}

/** The stock a program describes, where it puts it, and the fixtures that hold it. */
export type MarkedStock = {
  readonly stock: Stock
  readonly placement: StockPlacement
  readonly fixtures: readonly MarkedFixture[]
}

const PREFIX = ";@OPENSPINDLE|"

/** OpenSpindle's markers (`;@OPENSPINDLE|TYPE|key=value|…`) by their type, in program order. */
function markers(
  lines: readonly string[]
): ReadonlyMap<string, readonly Readonly<Record<string, string>>[]> {
  const found = new Map<string, Record<string, string>[]>()
  for (const line of lines) {
    const text = line.trim()
    if (
      !text.startsWith(";@") ||
      text.length > 4096 ||
      text.slice(0, PREFIX.length).toUpperCase() !== PREFIX
    )
      continue
    const [type, ...entries] = text.slice(PREFIX.length).split("|")
    const values: Record<string, string> = {}
    for (const entry of entries) {
      const equals = entry.indexOf("=")
      if (equals > 0) values[entry.slice(0, equals)] = entry.slice(equals + 1)
    }
    const key = type.toUpperCase()
    found.set(key, [...(found.get(key) ?? []), values])
  }
  return found
}

/** A marker's value as a coordinate; null when it is not one. */
function coordinate(value: string | undefined): number | null {
  if (!value?.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) && Math.abs(number) <= COORDINATE_LIMIT
    ? number
    : null
}

function workOrigin(values?: Readonly<Record<string, string>>): Point3 | null {
  if (!values) return null
  const [x, y, z] = [values.x, values.y, values.z].map(coordinate)
  return x === null || y === null || z === null ? null : [x, y, z]
}

function anchor(
  values?: Readonly<Record<string, string>>
): StockPlacement["anchor"] {
  if (!values) return null
  const id = values.relative_to
  const x = coordinate(values.x)
  const y = coordinate(values.y)
  return EntityIdSchema.safeParse(id).success && x !== null && y !== null
    ? { id, offset: [x, y] }
    : null
}

function fixture(
  values: Readonly<Partial<Record<string, string>>>
): MarkedFixture | null {
  const name = values.name?.trim() ?? ""
  const corner = [values.x, values.y, values.z].map(coordinate)
  const size = [values.width, values.depth, values.height].map(coordinate)
  if (
    !name ||
    name.length > FIXTURE_NAME_LIMIT ||
    hasControlCharacter(name) ||
    corner.some((value) => value === null) ||
    size.some((value) => value === null || value <= 0)
  )
    return null
  return { name, corner: corner as Point3, size: size as Point3 }
}

/**
 * The stock a program describes in OpenSpindle's markers, as the Makera Z1 post for Fusion 360
 * writes them, in millimetres, on `fallback`'s other properties:
 * - `;@OPENSPINDLE|STOCK|width=…|depth=…|height=…`, its size along X, Y and Z;
 * - `;@OPENSPINDLE|WORK_ORIGIN|x=…|y=…|z=…`, the program's zero from its front-left bottom corner;
 * - `;@OPENSPINDLE|STOCK_ANCHOR|relative_to=…|x=…|y=…`, that corner's X and Y from a stored anchor;
 * - `;@OPENSPINDLE|FIXTURE|name=…|x=…|y=…|z=…|width=…|depth=…|height=…`, one for each fixture
 *   holding it: its name, its box's front-left bottom corner from that corner, and its size.
 *
 * Null without a stock marker, or with one that does not make a valid stock. A work origin,
 * anchor or fixture marker that does not read as one is left out.
 */
export function markedStock(
  lines: readonly string[],
  fileName: string,
  fallback: Stock
): MarkedStock | null {
  const found = markers(lines)
  const size = found.get("STOCK")?.[0]
  if (!size) return null
  // Its own id, not the fallback's, which would pass it off as that library stock.
  const stock: Stock = {
    ...fallback,
    id: `source-${fileName}`,
    name: UNSPECIFIED_STOCK_NAME,
    material: "Unspecified",
    color: "#a9b3c0",
    width: Number(size.width),
    depth: Number(size.depth),
    height: Number(size.height),
  }
  if (!isStock(stock)) return null
  return {
    stock,
    placement: {
      workOrigin: workOrigin(found.get("WORK_ORIGIN")?.[0]),
      anchor: anchor(found.get("STOCK_ANCHOR")?.[0]),
    },
    fixtures: (found.get("FIXTURE") ?? [])
      .flatMap((values) => fixture(values) ?? [])
      .slice(0, FIXTURE_LIMIT),
  }
}
