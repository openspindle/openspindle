import {
  anchorsFromDevice,
  bedAnchors,
  isAnchorXY,
  isStoredAnchorSetup,
} from "@/domain/anchors/stored-anchors"
import type {
  StoredAnchor,
  StoredAnchorSetup,
} from "@/domain/anchors/stored-anchors"
import { PLATE_SUBJECT, operationSubject } from "@/domain/diagnostics"
import type { Area, QuickFix } from "@/domain/diagnostics"
import type { Point3 } from "@/domain/nc/gcode"
import type { Stock } from "@/domain/stock/stock"
import { isAnchorConfiguration } from "@/machine/contract"
import type { RuleFixes } from "@/machine/contract"
import { autoLevelError } from "./issues"
import type { AutoLevelIssue } from "./issues"
import {
  autoLevelParamsSchema,
  formatMillimetres,
  roundMillimetres,
} from "./params"
import type { AutoLevelGridParameters, AutoLevelParams } from "./params"
import type { ProbePoint } from "./probe-grid"
import { placementContext } from "../probing/placement"
import type { AnchorPlacement, PlacementContext } from "../probing/placement"
import type {
  OperationRuleSubject,
  RunRuleSubject,
  StageRule,
} from "../rules/stages"

/** The plate an auto-level operation belongs to. `Plate` satisfies it. */
export type AutoLevelPlateContext = PlacementContext & {
  stock: Pick<Stock, "width" | "depth" | "height"> | null
  /** Bed position of the stock's minimum corner. */
  stockAnchor: Point3
}

/** The grid starts at the operator-positioned probe, offset in X and Y. */
export type ProbePositionStart = { kind: "probe-position"; offset: ProbePoint }
/** Travel to machine XY (G53), at the height the probe travels at, then the grid from there. */
export type MachineStart = {
  kind: "machine"
  anchor: StoredAnchor
  source: StoredAnchorSetup["source"]
  target: ProbePoint
  /** The target in work coordinates when the program sets work X and Y; null otherwise. */
  work: ProbePoint | null
}
export type ProbeStart = ProbePositionStart | MachineStart

type Checked<TValue> =
  ({ ok: true } & TValue) | { ok: false; issues: AutoLevelIssue[] }
/** Parameters and grid start that generation can render, or what blocks it. */
export type AutoLevelPlan = Checked<{
  params: AutoLevelParams
  start: ProbeStart
}>
export type AnchorStartResolution = Checked<{ start: MachineStart }>

const EPSILON = 1e-6

/**
 * Everything that prevents generating NC: the parameters, within the ranges of the machine's
 * probe (`parameters`), and the grid start.
 */
export function planAutoLevel(
  params: AutoLevelParams,
  plate: PlacementContext,
  parameters: AutoLevelGridParameters
): AutoLevelPlan {
  const checked = checkParams(params, parameters)
  if (!checked.ok) return checked
  const resolved = resolveStart(checked.params, plate)
  if (!resolved.ok) return resolved
  return { ok: true, params: checked.params, start: resolved.start }
}

/**
 * The anchored grid's machine start from the plate's anchor snapshot. Issues keep the order of the
 * plugin-era checks: snapshot, anchor, coordinate range.
 */
export function resolveAnchorStart(
  placement: AnchorPlacement,
  size: Pick<AutoLevelParams, "width" | "depth">,
  plate: PlacementContext
): AnchorStartResolution {
  const setup = plate.anchorSetup
  if (!isStoredAnchorSetup(setup) || setup.deviceId !== plate.deviceId)
    return {
      ok: false,
      issues: [
        autoLevelError(
          "anchor-snapshot-missing",
          "Select an anchor snapshot for this plate's device."
        ),
      ],
    }
  const anchor = setup.anchors.find((item) => item.id === placement.anchorId)
  if (!anchor)
    return {
      ok: false,
      issues: [
        autoLevelError(
          "anchor-unavailable",
          "The selected probe anchor is unavailable."
        ),
      ],
    }
  const target: ProbePoint = [
    anchor.machinePosition[0] + placement.offset.x,
    anchor.machinePosition[1] + placement.offset.y,
  ]
  const inRange =
    isAnchorXY(target) &&
    isAnchorXY([target[0] + size.width, target[1] + size.depth])
  if (!inRange)
    return {
      ok: false,
      issues: [
        autoLevelError(
          "anchor-grid-out-of-range",
          "The anchored probe grid exceeds the supported coordinate range."
        ),
      ],
    }
  const origin = plate.machineWorkOrigin ?? null
  const work: ProbePoint | null = origin
    ? [
        roundMillimetres(target[0] - origin[0]),
        roundMillimetres(target[1] - origin[1]),
      ]
    : null
  return {
    ok: true,
    start: { kind: "machine", anchor, source: setup.source, target, work },
  }
}

function checkParams(
  params: AutoLevelParams,
  parameters: AutoLevelGridParameters
): Checked<{ params: AutoLevelParams }> {
  const parsed = autoLevelParamsSchema(parameters).safeParse(params)
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) =>
        autoLevelError("invalid-parameters", issue.message)
      ),
    }
  return { ok: true, params: parsed.data }
}

function resolveStart(
  params: AutoLevelParams,
  plate: PlacementContext
): Checked<{ start: ProbeStart }> {
  if (params.placement.kind === "probe-position")
    return { ok: true, start: { kind: "probe-position", offset: [0, 0] } }
  return resolveAnchorStart(params.placement, params, plate)
}

/**
 * Where an anchored grid is on the bed, at the stock top it probes; null from the probe
 * position, which the plate does not know.
 */
function gridArea(
  params: AutoLevelParams,
  plate: AutoLevelPlateContext,
  top: number,
  start: ProbeStart | null
): Area | null {
  if (start?.kind !== "machine") return null
  // Machine XY reaches the bed through the snapshot's registration, as the viewer places it.
  const anchor = bedAnchors(plate.anchorSetup).find(
    (item) => item.id === start.anchor.id
  )
  if (!anchor) return null
  const x =
    anchor.position[0] + start.target[0] - start.anchor.machinePosition[0]
  const y =
    anchor.position[1] + start.target[1] - start.anchor.machinePosition[1]
  return {
    kind: "area",
    min: [x, y, top],
    max: [x + params.width, y + params.depth, top],
  }
}

/** What a probing operation's advice offers: editing the operation. */
export const editOperation: RuleFixes<OperationRuleSubject, QuickFix> = {
  offer: ({ first }) => [
    { kind: "edit-operation", operationId: first.operation.id },
  ],
}

/**
 * An auto-level operation's grid as its advice reads it: its parameters, its plate, and where
 * the grid starts (null where that does not resolve, which the compiler reports). Null for
 * another kind, a machine without a probe, or parameters that do not parse (the compiler
 * reports those too).
 */
function gridAdvice({ operation, plate, kit }: OperationRuleSubject): {
  readonly params: AutoLevelParams
  readonly plate: AutoLevelPlateContext
  readonly start: ProbeStart | null
} | null {
  const { source } = operation
  if (source.kind !== "auto-level" || !kit.probe) return null
  const checked = checkParams(source.params, kit.probe.autoLevel.parameters)
  if (!checked.ok) return null
  const context: AutoLevelPlateContext = {
    ...placementContext(plate),
    stock: plate.setup.stock,
    stockAnchor: plate.setup.stockAnchor,
  }
  const resolved = resolveStart(checked.params, context)
  return {
    params: checked.params,
    plate: context,
    start: resolved.ok ? resolved.start : null,
  }
}

/**
 * An auto-level's grid against the plate's stock, with where the grid is on the bed at the
 * stock top (null from the probe position); null without stock.
 */
function gridOnStock(subject: OperationRuleSubject) {
  const advice = gridAdvice(subject)
  const stock = advice?.plate.stock
  if (!advice || !stock) return null
  const { params, plate, start } = advice
  const top = plate.stockAnchor[2] + stock.height
  return {
    params,
    stock,
    stockAnchor: plate.stockAnchor,
    grid: gridArea(params, plate, top, start),
  }
}

const exceedsStock = (
  params: Pick<AutoLevelParams, "width" | "depth">,
  stock: Pick<Stock, "width" | "depth">
) =>
  params.width > stock.width + EPSILON || params.depth > stock.depth + EPSILON

/** Where a failing grid is on the bed, when the plate knows. */
const gridPlaces = (grid: Area | null | undefined) =>
  grid ? { places: [grid] } : {}

/** A grid's checks against the stock: without stock, or larger than it, the later ones do not apply. */
const AUTO_LEVEL_STOCK_CHAIN = "auto-level/stock"

const autoLevelFactoryAnchors: StageRule<"operation"> = {
  id: "auto-level/factory-anchors",
  stage: "operation",
  label: "Auto-level anchors read",
  description:
    "A grid placed from the machine's factory default anchor positions lands wherever the device's own anchors differ from them.",
  severity: "warning",
  configurable: false,
  test: (subject) => {
    const start = gridAdvice(subject)?.start
    return start?.kind !== "machine" || start.source !== "factory"
  },
  explain: ({ first }) => ({
    problem:
      "The anchor positions are factory defaults. Use Read anchors to verify them against the device before Run.",
    about: operationSubject(first.operation.id),
  }),
  fixes: editOperation,
}

const autoLevelStockUnspecified: StageRule<"operation"> = {
  id: "auto-level/stock-unspecified",
  stage: "operation",
  label: "Auto-level stock size",
  description: "A grid is checked against the stock, which needs its size.",
  severity: "warning",
  configurable: false,
  chain: AUTO_LEVEL_STOCK_CHAIN,
  test: (subject) => {
    const advice = gridAdvice(subject)
    return !advice || advice.plate.stock !== null
  },
  explain: ({ first }) => ({
    problem:
      "The stock size is unspecified, so the probe grid cannot be checked against it.",
    about: operationSubject(first.operation.id),
  }),
  fixes: editOperation,
}

const gridExceedsStock: StageRule<"operation"> = {
  id: "auto-level/grid-exceeds-stock",
  stage: "operation",
  label: "Auto-level grid within the stock size",
  description:
    "A grid larger than the stock probes beside it, where there is nothing to measure.",
  severity: "error",
  configurable: false,
  chain: AUTO_LEVEL_STOCK_CHAIN,
  test: (subject) => {
    const fit = gridOnStock(subject)
    return !fit || !exceedsStock(fit.params, fit.stock)
  },
  explain: ({ first }) => {
    const fit = gridOnStock(first)
    return {
      problem: fit
        ? `The ${formatMillimetres(fit.params.width)} × ${formatMillimetres(fit.params.depth)} mm probe grid is larger than the ${formatMillimetres(fit.stock.width)} × ${formatMillimetres(fit.stock.depth)} mm stock.`
        : "The probe grid is larger than the stock.",
      about: operationSubject(first.operation.id),
      ...gridPlaces(fit?.grid),
    }
  },
  fixes: editOperation,
}

const gridOutsideStock: StageRule<"operation"> = {
  id: "auto-level/grid-outside-stock",
  stage: "operation",
  label: "Auto-level grid on the stock",
  description:
    "An anchored grid that extends beyond the stock as placed on the bed probes beside it.",
  severity: "warning",
  configurable: false,
  chain: AUTO_LEVEL_STOCK_CHAIN,
  test: (subject) => {
    const fit = gridOnStock(subject)
    const grid = fit?.grid
    if (!fit || !grid) return true
    const [stockX, stockY] = fit.stockAnchor
    return (
      grid.min[0] >= stockX - EPSILON &&
      grid.min[1] >= stockY - EPSILON &&
      grid.max[0] <= stockX + fit.stock.width + EPSILON &&
      grid.max[1] <= stockY + fit.stock.depth + EPSILON
    )
  },
  explain: ({ first }) => ({
    problem:
      "The anchored probe grid extends beyond the stock as placed on the bed.",
    about: operationSubject(first.operation.id),
    ...gridPlaces(gridOnStock(first)?.grid),
  }),
  fixes: editOperation,
}

/** The advice for an auto-level operation: its anchors, and its grid against the stock. */
export const AUTO_LEVEL_RULES: readonly StageRule<"operation">[] = [
  autoLevelFactoryAnchors,
  autoLevelStockUnspecified,
  gridExceedsStock,
  gridOutsideStock,
]

/**
 * An anchored probing operation (auto-level, auto Z-height, 3D probing) among Run's subjects:
 * the anchor it travels to, and where its plate places it; null for any other subject.
 */
function anchoredProbing({ plate, operation }: RunRuleSubject): {
  readonly placement: AnchorPlacement
  readonly plate: PlacementContext
} | null {
  if (!plate || !operation) return null
  const { source } = operation
  if (
    source.kind !== "auto-level" &&
    source.kind !== "auto-z-height" &&
    source.kind !== "probe-3d"
  )
    return null
  const { placement } = source.params
  return placement.kind === "anchor"
    ? { placement, plate: placementContext(plate) }
    : null
}

/** An anchored probing operation's gates before Run: a failure stops its later ones. */
const PROBING_CHAIN = "probing"

/** What each of an anchored probing operation's failures offers: reading the device's anchors. */
const readAnchors: RuleFixes<RunRuleSubject, QuickFix> = {
  offer: () => [{ kind: "read-anchors" }],
}

/** What a probing operation's failure before Run is about: the operation. */
const aboutOperation = ({ operation }: RunRuleSubject) =>
  operation ? operationSubject(operation.id) : PLATE_SUBJECT

const probingAnchorsNotRead: StageRule<"run"> = {
  id: "probing/anchors-not-read",
  stage: "run",
  label: "Probing anchors read",
  description:
    "An anchored probing operation needs the plate's anchor snapshot read from the connected device, which the plate is set up for.",
  severity: "error",
  configurable: false,
  chain: PROBING_CHAIN,
  test: (subject) => {
    const anchored = anchoredProbing(subject)
    if (!anchored) return true
    const setup = anchored.plate.anchorSetup
    const connected = subject.machine.connectedDeviceId
    return (
      !!connected &&
      anchored.plate.deviceId === connected &&
      isStoredAnchorSetup(setup) &&
      setup.source === "firmware-config" &&
      setup.deviceId === connected
    )
  },
  explain: ({ first }) => ({
    problem:
      "Use Read anchors to load this plate's connected device settings before Run.",
    about: aboutOperation(first),
  }),
  fixes: readAnchors,
}

const probingLiveAnchorsUnavailable: StageRule<"run"> = {
  id: "probing/live-anchors-unavailable",
  stage: "run",
  label: "Probing anchors loaded",
  description:
    "An anchored probing operation is checked against the connected device's current stored anchors, which Read anchors loads.",
  severity: "error",
  configurable: false,
  chain: PROBING_CHAIN,
  test: (subject) =>
    !anchoredProbing(subject) || isAnchorConfiguration(subject.machine.anchors),
  explain: ({ first }) => ({
    problem:
      "Use Read anchors to load the connected device's current stored anchors before Run.",
    about: aboutOperation(first),
  }),
  fixes: readAnchors,
}

const probingAnchorsChanged: StageRule<"run"> = {
  id: "probing/anchors-changed",
  stage: "run",
  label: "Probing anchors unchanged",
  description:
    "The connected device must still store the anchors of the plate's snapshot, the probing operation's among them.",
  severity: "error",
  configurable: false,
  chain: PROBING_CHAIN,
  test: (subject) => {
    const anchored = anchoredProbing(subject)
    const setup = anchored?.plate.anchorSetup
    const { connectedDeviceId, anchors } = subject.machine
    if (
      !anchored ||
      !isStoredAnchorSetup(setup) ||
      !connectedDeviceId ||
      !isAnchorConfiguration(anchors)
    )
      return true
    const live = anchorsFromDevice(anchors, connectedDeviceId).anchors
    const saved = ({ id, machinePosition: [x, y] }: StoredAnchor) =>
      setup.anchors.some(
        (anchor) =>
          anchor.id === id &&
          Math.abs(anchor.machinePosition[0] - x) <= EPSILON &&
          Math.abs(anchor.machinePosition[1] - y) <= EPSILON
      )
    return (
      live.some((anchor) => anchor.id === anchored.placement.anchorId) &&
      live.every(saved)
    )
  },
  explain: ({ first }) => ({
    problem: "Stored anchors changed. Use Read anchors before Run.",
    about: aboutOperation(first),
  }),
  fixes: readAnchors,
}

/**
 * What Run needs of an anchored probing operation (auto-level, auto Z-height, 3D probing): the
 * plate's anchor snapshot read from the connected device, which the plate is set up for, and
 * still matching the device's stored anchors. Generation blockers block Run as compile errors.
 */
export const PROBING_RUN_RULES: readonly StageRule<"run">[] = [
  probingAnchorsNotRead,
  probingLiveAnchorsUnavailable,
  probingAnchorsChanged,
]
