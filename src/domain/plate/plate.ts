import { z } from "zod"
import { DEVICE_ASSISTS, PlateAssistsSchema } from "@/machine/contract"
import {
  FIXTURE_LIMIT,
  FixtureInstanceSchema,
  defaultFixtureInstances,
  stockSupportHeight,
} from "@/domain/fixtures/definitions"
import type { FixtureInstance } from "@/domain/fixtures/definitions"
import { kitForSetup } from "../fixtures/catalog"
import { defaultPlateCoordinates } from "./placement"
import {
  StoredAnchorSetupSchema,
  bedAnchors,
} from "@/domain/anchors/stored-anchors"
import type { StoredAnchorSetup } from "@/domain/anchors/stored-anchors"
import type { StockPlacement } from "@/domain/nc/stock-markers"
import { StockSchema } from "@/domain/stock/stock"
import type { Stock } from "@/domain/stock/stock"
import { OperationSchema } from "../operations/operation"
import type { Operation } from "../operations/operation"
import {
  EntityIdSchema,
  Point3Schema,
  TextSchema,
  ToolNumberSchema,
  newId,
  toMicrometre,
  toolNumberText,
} from "../primitives"

export const StockSourceSchema = z.enum([
  "source",
  "assigned",
  "unspecified",
  // The former example plate's stock: saved projects and exported plates may still carry it.
  "example",
])
export type StockSource = z.infer<typeof StockSourceSchema>

/**
 * Where and how a plate is machined. There is exactly one work origin and one assist
 * policy per plate; every operation machines from that origin.
 */
export const PlateSetupSchema = z
  .object({
    stock: StockSchema.nullable(),
    stockSource: StockSourceSchema,
    stockAnchor: Point3Schema,
    /**
     * The stored anchor (its id) the stock anchor's X and Y are kept relative to, as
     * `workOriginAnchor` is for the work origin. Absent or null: bed coordinates.
     */
    stockRelativeTo: EntityIdSchema.nullable().optional(),
    workOrigin: Point3Schema,
    /**
     * The stored anchor (its id) the work origin's X and Y are kept relative to: it moves with
     * the anchor when the plate's anchors change. Absent or null: bed coordinates. The origin
     * itself is always `workOrigin`, in bed coordinates.
     */
    workOriginAnchor: EntityIdSchema.nullable().optional(),
    assists: PlateAssistsSchema,
    /**
     * What is on the bed: the bed itself, wasteboards, clamps and the rest. The fixture commands
     * change them (`fixture.add` and the others in `WorkspaceCommand`).
     */
    fixtures: z.array(FixtureInstanceSchema).max(FIXTURE_LIMIT),
    /** The machine profile this plate is set up for (fixtures and anchors). */
    deviceId: EntityIdSchema.nullable(),
    anchors: StoredAnchorSetupSchema.nullable(),
  })
  .refine(
    (setup) => !setup.anchors || setup.anchors.deviceId === setup.deviceId,
    "Plate anchors belong to another device."
  )
export type PlateSetup = z.infer<typeof PlateSetupSchema>

/**
 * One entry of the plate's tool table. The plate owns the T numbers; operations bind their
 * own tool numbers to these entries. `number: null` is the implicit tool of a program that
 * selects none. `toolId` refers to the tool library and may dangle after a library delete.
 */
export const PlateToolSchema = z.object({
  number: ToolNumberSchema.nullable(),
  toolId: EntityIdSchema.nullable(),
})
export type PlateTool = z.infer<typeof PlateToolSchema>

/** Named selection of program sections, by stable section id. */
export const GroupSchema = z.object({
  id: EntityIdSchema,
  name: TextSchema,
  sectionIds: z.array(z.string().min(1).max(400)).max(10000),
})
export type Group = z.infer<typeof GroupSchema>

/** Something an import changed that the user should review. */
export const PlateNoticeSchema = z.object({
  id: EntityIdSchema,
  message: z.string().min(1).max(1000),
  createdAt: z.number(),
})
export type PlateNotice = z.infer<typeof PlateNoticeSchema>

/** The most notices a plate holds. */
const NOTICE_LIMIT = 100

type PlateIssue = { readonly message: string; readonly path: PropertyKey[] }

/**
 * What makes a plate inconsistent: repeated operation ids or table numbers, and bindings the
 * tool table cannot serve. The compiler rewrites an operation's T words through its bindings,
 * so each binds its own number once, to an entry of the table; the program's tool (NC that
 * selects none) and numbered tools never bind each other.
 */
function plateIssues(plate: {
  readonly tools: readonly PlateTool[]
  readonly operations: readonly Operation[]
}): PlateIssue[] {
  const issues: PlateIssue[] = []
  const operationIds = new Set<string>()
  for (const [index, operation] of plate.operations.entries()) {
    if (operationIds.has(operation.id))
      issues.push({
        message: `Operation id "${operation.id}" appears more than once.`,
        path: ["operations", index, "id"],
      })
    operationIds.add(operation.id)
  }
  const numbers = new Set<number | null>()
  for (const [index, tool] of plate.tools.entries()) {
    if (numbers.has(tool.number))
      issues.push({
        message: `The tool table lists ${toolNumberText(tool.number)} more than once.`,
        path: ["tools", index, "number"],
      })
    numbers.add(tool.number)
  }
  for (const [index, operation] of plate.operations.entries()) {
    const locals = new Set<number | null>()
    for (const [position, binding] of operation.tools.entries()) {
      const path = ["operations", index, "tools", position]
      const binds = `Operation "${operation.name}" binds ${toolNumberText(binding.local)}`
      const target = toolNumberText(binding.plate)
      if (locals.has(binding.local))
        issues.push({ message: `${binds} more than once.`, path })
      locals.add(binding.local)
      if ((binding.local === null) !== (binding.plate === null))
        issues.push({
          message: `${binds} to ${target}: numbered tools bind numbered entries, and the program's tool binds the program's tool.`,
          path,
        })
      else if (!numbers.has(binding.plate))
        issues.push({
          message: `${binds} to ${target}, which is not in the tool table.`,
          path,
        })
    }
  }
  return issues
}

/** A plate's name; empty until the user names it, and the plate shows as "Plate N" meanwhile. */
export const PlateNameSchema = z.union([z.literal(""), TextSchema])

/** "Plate N": how a plate without a name shows, numbered by its place in the workspace. */
export const numberedPlate = (index: number) => `Plate ${index + 1}`

/** How a plate shows: its name, or its number while it has none (`index` counts from 0). */
export const plateLabel = (plate: { readonly name: string }, index: number) =>
  plate.name || numberedPlate(index)

export const PlateSchema = z
  .object({
    id: EntityIdSchema,
    name: PlateNameSchema,
    setup: PlateSetupSchema,
    tools: z.array(PlateToolSchema).max(100),
    operations: z.array(OperationSchema).max(100),
    groups: z.array(GroupSchema).max(500),
    notices: z.array(PlateNoticeSchema).max(NOTICE_LIMIT),
    example: z.boolean(),
  })
  .superRefine((plate, context) => {
    for (const issue of plateIssues(plate))
      context.addIssue({ code: "custom", ...issue })
  })
export type Plate = z.infer<typeof PlateSchema>

/**
 * Defaults for a new plate: stock centred in the work area of its machine (`kitForSetup`), on
 * what carries it there (a wasteboard under it, else the bed), work origin at its top
 * front-left corner. Without fixtures it has those of its machine's kit.
 */
export function createPlateSetup(options: {
  stock: Stock | null
  stockSource: StockSource
  fixtures?: FixtureInstance[]
  deviceId?: string | null
  anchors?: StoredAnchorSetup | null
}): PlateSetup {
  const kit = kitForSetup({
    deviceId: options.deviceId ?? null,
    fixtures: options.fixtures ?? [],
  })
  const fixtures =
    options.fixtures ?? defaultFixtureInstances(kit.definitions())
  const { workArea } = kit
  const supportHeight = stockSupportHeight(
    fixtures,
    defaultPlateCoordinates(options.stock, workArea).stockAnchor,
    options.stock
  )
  const coordinates = defaultPlateCoordinates(
    options.stock,
    workArea,
    supportHeight
  )
  return {
    stock: options.stock,
    stockSource: options.stockSource,
    stockAnchor: coordinates.stockAnchor,
    workOrigin: coordinates.workOrigin,
    assists: { ...DEVICE_ASSISTS },
    fixtures,
    deviceId: options.deviceId ?? null,
    anchors: options.anchors ?? null,
  }
}

/**
 * The setup with its stock where its program puts it (`placement`, read from its markers): its
 * front-left bottom corner at the offsets from its anchor, where the plate's anchors, else
 * `machine.anchors`, have that anchor and the stock then overlaps the work area; else where it
 * is. It rests on what carries it there, with the work origin at the program's zero on it, else
 * on its top front-left corner. A setup without stock stays as it is.
 */
export function withStockPlacement(
  setup: PlateSetup,
  placement: StockPlacement,
  machine: {
    readonly workArea: readonly number[]
    readonly anchors: StoredAnchorSetup
  }
): PlateSetup {
  const { stock } = setup
  if (!stock) return setup
  const { anchor } = placement
  const position = anchor
    ? bedAnchors(setup.anchors ?? machine.anchors).find(
        (bed) => bed.id === anchor.id
      )?.position
    : undefined
  const corner =
    anchor && position
      ? [position[0] + anchor.offset[0], position[1] + anchor.offset[1]]
      : null
  const [width, depth] = machine.workArea
  const overlaps =
    corner !== null &&
    corner[0] < width &&
    corner[0] + stock.width > 0 &&
    corner[1] < depth &&
    corner[1] + stock.depth > 0
  const [x, y] = overlaps ? corner : setup.stockAnchor
  const supportHeight = stockSupportHeight(setup.fixtures, [x, y], stock)
  const [originX, originY, originZ] = placement.workOrigin ?? [
    0,
    0,
    stock.height,
  ]
  return {
    ...setup,
    stockAnchor: [toMicrometre(x), toMicrometre(y), supportHeight],
    workOrigin: [
      toMicrometre(x + originX),
      toMicrometre(y + originY),
      toMicrometre(supportHeight + originZ),
    ],
  }
}

/** A new plate, without a name until the user gives it one. */
export function createPlate(
  setup: PlateSetup,
  operations: Operation[] = []
): Plate {
  return {
    id: newId(),
    name: "",
    setup,
    tools: [],
    operations,
    groups: [],
    notices: [],
    example: false,
  }
}

export const notice = (message: string): PlateNotice => ({
  id: newId(),
  message,
  createdAt: Date.now(),
})
