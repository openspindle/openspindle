import { z } from "zod"
import { DEVICE_ASSISTS, PlateAssistsSchema } from "@/machine/contract"
import {
  FIXTURE_LIMIT,
  FixtureInstanceSchema,
  defaultFixtureInstances,
  fixtureBounds,
  fixtureInstance,
  isBedKind,
  isLocked,
  stockSupportHeight,
} from "@/domain/fixtures/definitions"
import type {
  FixtureBounds,
  FixtureDefinition,
  FixtureInstance,
} from "@/domain/fixtures/definitions"
import { formatMillimetres } from "@/domain/geometry/millimetres"
import { kitForSetup } from "../fixtures/catalog"
import { defaultPlateCoordinates } from "./placement"
import type { WorkAreaXY } from "./placement"
import {
  StoredAnchorSetupSchema,
  bedAnchors,
} from "@/domain/anchors/stored-anchors"
import type { StoredAnchorSetup } from "@/domain/anchors/stored-anchors"
import type { MarkedFixture, StockPlacement } from "@/domain/nc/stock-markers"
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
    /**
     * The bed setup of its device's profile it is set up on (`BedSetup`), whose anchors its
     * snapshot holds after the device's; null or absent for none.
     */
    bedSetupId: EntityIdSchema.nullable().optional(),
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
  bedSetupId?: string | null
}): PlateSetup {
  const kit = kitForSetup({
    deviceId: options.deviceId ?? null,
    fixtures: options.fixtures ?? [],
  })
  const fixtures =
    options.fixtures ?? defaultFixtureInstances(kit.definitions())
  const supportHeight = stockSupportHeight(
    fixtures,
    defaultPlateCoordinates(options.stock, kit, kit.tableTop).stockAnchor,
    options.stock,
    kit.tableTop
  )
  const coordinates = defaultPlateCoordinates(options.stock, kit, supportHeight)
  return {
    stock: options.stock,
    stockSource: options.stockSource,
    stockAnchor: coordinates.stockAnchor,
    workOrigin: coordinates.workOrigin,
    assists: { ...DEVICE_ASSISTS },
    fixtures,
    deviceId: options.deviceId ?? null,
    anchors: options.anchors ?? null,
    ...(options.bedSetupId && { bedSetupId: options.bedSetupId }),
  }
}

/**
 * A setup with the stock it now has placed as a new plate's: stock where there was none keeps
 * its front-left bottom corner where the setup kept it, resting on what carries it there (a
 * wasteboard under it, else the bed), with the work origin on its top front-left corner; a work
 * origin on the stock's top stays on it as the stock's height changes. Otherwise unchanged.
 */
export function withStockChange(
  before: PlateSetup,
  setup: PlateSetup
): PlateSetup {
  const { stock } = setup
  if (!stock) return setup
  if (!before.stock) {
    const [x, y] = setup.stockAnchor
    const rest = stockSupportHeight(
      setup.fixtures,
      [x, y],
      stock,
      kitForSetup(setup).tableTop
    )
    return {
      ...setup,
      stockAnchor: [x, y, rest],
      workOrigin: [x, y, toMicrometre(rest + stock.height)],
      workOriginAnchor: setup.stockRelativeTo ?? null,
    }
  }
  const top = before.stockAnchor[2] + before.stock.height
  if (
    stock.height === before.stock.height ||
    Math.abs(before.workOrigin[2] - top) > 0.0005
  )
    return setup
  const [x, y] = setup.workOrigin
  return {
    ...setup,
    workOrigin: [x, y, toMicrometre(setup.stockAnchor[2] + stock.height)],
  }
}

/**
 * The setup with its stock where its program puts it (`placement`, read from its markers): its
 * front-left bottom corner at the offsets from its anchor, where the plate's anchors, else
 * `machine.anchors`, have that anchor and the stock then overlaps the work area; else where it
 * is. It rests on what carries it there, with the work origin at the program's zero on it, else
 * on its top front-left corner. Placed from an anchor, the stock and the work origin stay
 * relative to it, so Run sets the machine's work X and Y from it, and the plate holds the anchors
 * it was placed by (`machine.anchors` when it had none, which Run asks to read from the device).
 * A setup without stock stays as it is.
 */
export function withStockPlacement(
  setup: PlateSetup,
  placement: StockPlacement,
  machine: WorkAreaXY & {
    readonly anchors: StoredAnchorSetup
    /** The bed Z of the machine's own bed top (`FixtureKit.tableTop`). */
    readonly tableTop: number
  }
): PlateSetup {
  const { stock } = setup
  if (!stock) return setup
  const { anchor } = placement
  const anchors = setup.anchors ?? machine.anchors
  const position = anchor
    ? bedAnchors(anchors).find((bed) => bed.id === anchor.id)?.position
    : undefined
  const corner =
    anchor && position
      ? [position[0] + anchor.offset[0], position[1] + anchor.offset[1]]
      : null
  const [width, depth] = machine.workArea
  const [left, front] = machine.workAreaOrigin
  const overlaps =
    corner !== null &&
    corner[0] < left + width &&
    corner[0] + stock.width > left &&
    corner[1] < front + depth &&
    corner[1] + stock.depth > front
  const [x, y] = overlaps ? corner : setup.stockAnchor
  const supportHeight = stockSupportHeight(
    setup.fixtures,
    [x, y],
    stock,
    machine.tableTop
  )
  const [originX, originY, originZ] = placement.workOrigin ?? [
    0,
    0,
    stock.height,
  ]
  const relativeTo = overlaps && anchor ? anchor.id : null
  return {
    ...setup,
    ...(relativeTo && {
      anchors,
      stockRelativeTo: relativeTo,
      workOriginAnchor: relativeTo,
    }),
    stockAnchor: [toMicrometre(x), toMicrometre(y), supportHeight],
    workOrigin: [
      toMicrometre(x + originX),
      toMicrometre(y + originY),
      toMicrometre(supportHeight + originZ),
    ],
  }
}

/** A fixture's name without Fusion 360's number for each use of a component ("Jig:1"). */
const fixtureName = (name: string) => name.replace(/:\d+$/, "").trim()

/** What fixtures are found by: their name, whatever its case and spacing. */
const fixtureKey = (name: string) =>
  fixtureName(name).replace(/\s+/g, " ").toLowerCase()

/** How far a fixture's size in a program may be from the device's and still be the same, mm. */
const FIXTURE_SIZE_TOLERANCE = 0.5

const sizeText = (size: readonly number[]) =>
  size.map((length) => formatMillimetres(Number(length.toFixed(2)))).join(" × ")

/**
 * The setup with the fixtures that hold its program's stock (`fixtures`, read from its markers)
 * where the program has them beside the stock: each is the device's fixture of that name
 * (`definitions`; Fusion 360's use number, as in "Jig:1", aside), the plate's own if it has one,
 * enabled. The stock and the fixtures under it keep the program's heights between them, the
 * lowest resting on what carries it (a wasteboard under it, else the bed), and the work origin
 * moves up with the stock; the other fixtures rest on what carries them. They stay relative to
 * the anchor the stock is. Beds stay as the plate has them. Notices say which fixtures the plate
 * could not have, and which differ in size from the program's. A setup without stock stays as it
 * is.
 */
export function withProgramFixtures(
  setup: PlateSetup,
  fixtures: readonly MarkedFixture[],
  definitions: readonly FixtureDefinition[],
  /** Where `definitions` come from, which the notices name; null without a profile. */
  from: { readonly device: string; readonly bedSetup: string } | null = null
): { readonly setup: PlateSetup; readonly notices: readonly string[] } {
  const { stock } = setup
  if (!stock || !fixtures.length) return { setup, notices: [] }
  const [x, y, rest] = setup.stockAnchor
  const { tableTop } = kitForSetup(setup)
  const notices: string[] = []
  const placed = [...setup.fixtures]
  const held: {
    readonly instance: FixtureInstance
    readonly index: number
    readonly box: FixtureBounds
    readonly corner: readonly [number, number]
    readonly below: number
    readonly support: number
    /** Whether its footprint and the stock's overlap. */
    readonly under: boolean
  }[] = []
  for (const marked of fixtures) {
    const key = fixtureKey(marked.name)
    const definition = definitions.find((item) => fixtureKey(item.name) === key)
    const where = from
      ? `${from.device} › ${from.bedSetup}`
      : "the plate's device"
    if (!definition) {
      notices.push(
        from
          ? `${fixtureName(marked.name)} holds the program's stock, but ${where} has no fixture of that name, so the plate does not have it.`
          : `${fixtureName(marked.name)} holds the program's stock, but the plate's device has no fixtures set up, so the plate does not have it.`
      )
      continue
    }
    if (!definition.model) {
      notices.push(
        `${definition.name} holds the program's stock, but in ${where} it has no 3D model, so the plate does not have it.`
      )
      continue
    }
    if (isBedKind(definition.kind)) continue
    const index = placed.findIndex(
      (item, at) =>
        item.definition.id === definition.id &&
        !held.some((other) => other.index === at)
    )
    const own = index >= 0 ? placed[index] : null
    if (own && isLocked(own)) {
      notices.push(
        `${definition.name} is locked, so it stays where it is, not where the program has it.`
      )
      continue
    }
    if (
      !own &&
      placed.length + held.filter((item) => item.index < 0).length >=
        FIXTURE_LIMIT
    ) {
      notices.push(
        `The plate holds no more fixtures, so it does not have ${definition.name}.`
      )
      continue
    }
    const instance = own
      ? { ...own, enabled: true }
      : fixtureInstance(definition)
    // Its box from its position, as it is turned.
    const box = fixtureBounds({ ...instance, position: [0, 0, 0] })
    if (!box) continue
    const size = box.max.map((high, axis) => high - box.min[axis])
    if (
      size.some(
        (length, axis) =>
          Math.abs(length - marked.size[axis]) > FIXTURE_SIZE_TOLERANCE
      )
    )
      notices.push(
        `${definition.name} is ${sizeText(marked.size)} mm in the program but ${sizeText(size)} mm in ${where}: check where the plate has it.`
      )
    const corner = [x + marked.corner[0], y + marked.corner[1]] as const
    const support = stockSupportHeight(
      setup.fixtures.filter((item) => item !== own),
      corner,
      { width: size[0], depth: size[1] },
      tableTop
    )
    const under =
      corner[0] < x + stock.width &&
      x < corner[0] + size[0] &&
      corner[1] < y + stock.depth &&
      y < corner[1] + size[1]
    held.push({
      instance,
      index,
      box,
      corner,
      below: marked.corner[2],
      support,
      under,
    })
  }
  if (!held.length) return { setup, notices }
  // Heights from the stock's bottom, as the program has them, for the fixtures under it: the
  // lowest rests on its support. The others rest on theirs.
  const bottom = Math.max(
    rest,
    ...held
      .filter((item) => item.under)
      .map((item) => item.support - item.below)
  )
  for (const { instance, index, box, corner, below, support, under } of held) {
    const moved: FixtureInstance = {
      ...instance,
      // Kept relative to the anchor the stock is, as it is placed beside the stock.
      relativeTo: setup.stockRelativeTo ?? null,
      position: [
        toMicrometre(corner[0] - box.min[0]),
        toMicrometre(corner[1] - box.min[1]),
        toMicrometre((under ? bottom + below : support) - box.min[2]),
      ],
    }
    if (index >= 0) placed[index] = moved
    else placed.push(moved)
  }
  const [originX, originY, originZ] = setup.workOrigin
  return {
    setup: {
      ...setup,
      fixtures: placed,
      stockAnchor: [x, y, toMicrometre(bottom)],
      workOrigin: [originX, originY, toMicrometre(originZ + bottom - rest)],
    },
    notices,
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
