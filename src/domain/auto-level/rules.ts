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
import type { Area } from "@/domain/diagnostics"
import type { Point3 } from "@/domain/nc/gcode"
import type { Stock } from "@/domain/stock/stock"
import { isAnchorConfiguration } from "@/machine/contract"
import type { AnchorConfiguration } from "@/machine/contract"
import { autoLevelError, autoLevelWarning } from "./issues"
import type { AutoLevelIssue } from "./issues"
import {
  autoLevelParamsSchema,
  formatMillimetres,
  roundMillimetres,
} from "./params"
import type { AutoLevelGridParameters, AutoLevelParams } from "./params"
import type { ProbePoint } from "./probe-grid"
import type { AnchorPlacement, PlacementContext } from "../probing/placement"

/** The plate an auto-level operation belongs to. `Plate` satisfies it. */
export type AutoLevelPlateContext = PlacementContext & {
  stock: Pick<Stock, "width" | "depth" | "height"> | null
  /** Bed position of the stock's minimum corner. */
  stockAnchor: Point3
}

/** The connected machine, as far as running an anchored grid depends on it. */
export type AutoLevelMachineContext = {
  connectedDeviceId: string | null
  /** Stored anchors from the connected device's latest successful read. */
  anchors?: AnchorConfiguration | null
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

/** Issues to show while editing: generation blockers, anchor provenance and the stock fit. */
export function validateAutoLevel(
  params: AutoLevelParams,
  plate: AutoLevelPlateContext,
  parameters: AutoLevelGridParameters
): AutoLevelIssue[] {
  const checked = checkParams(params, parameters)
  if (!checked.ok) return checked.issues
  const resolved = resolveStart(checked.params, plate)
  const start = resolved.ok ? resolved.start : null
  return [
    ...(resolved.ok ? [] : resolved.issues),
    ...(start?.kind === "machine" && start.source === "factory"
      ? [
          autoLevelWarning(
            "factory-anchors",
            "The anchor positions are factory defaults. Use Read anchors to verify them against the device before Run."
          ),
        ]
      : []),
    ...stockIssues(checked.params, plate, start),
  ]
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

/**
 * Whether an anchored grid may run on the connected machine: the plate's snapshot must be a
 * firmware read from that device that still matches its stored anchors. Generation blockers
 * (validateAutoLevel errors) block Run as well. At most one issue, the first failed gate.
 */
export function autoLevelRunIssues(
  params: Pick<AutoLevelParams, "placement">,
  plate: PlacementContext,
  machine: AutoLevelMachineContext
): AutoLevelIssue[] {
  const { placement } = params
  if (placement.kind === "probe-position") return []
  const setup = plate.anchorSetup
  const connected = machine.connectedDeviceId
  if (
    !connected ||
    plate.deviceId !== connected ||
    !isStoredAnchorSetup(setup) ||
    setup.source !== "firmware-config" ||
    setup.deviceId !== connected
  )
    return [
      autoLevelError(
        "anchors-not-read",
        "Use Read anchors to load this plate's connected device settings before Run."
      ),
    ]
  if (!isAnchorConfiguration(machine.anchors))
    return [
      autoLevelError(
        "live-anchors-unavailable",
        "Use Read anchors to load the connected device's current stored anchors before Run."
      ),
    ]
  const live = anchorsFromDevice(machine.anchors, connected).anchors
  const saved = ({ id, machinePosition: [x, y] }: StoredAnchor) =>
    setup.anchors.some(
      (anchor) =>
        anchor.id === id &&
        Math.abs(anchor.machinePosition[0] - x) <= EPSILON &&
        Math.abs(anchor.machinePosition[1] - y) <= EPSILON
    )
  if (
    !live.some((anchor) => anchor.id === placement.anchorId) ||
    !live.every(saved)
  )
    return [
      autoLevelError(
        "anchors-changed",
        "Stored anchors changed. Use Read anchors before Run."
      ),
    ]
  return []
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

function stockIssues(
  params: AutoLevelParams,
  plate: AutoLevelPlateContext,
  start: ProbeStart | null
): AutoLevelIssue[] {
  const { stock } = plate
  if (!stock)
    return [
      autoLevelWarning(
        "stock-unspecified",
        "The stock size is unspecified, so the probe grid cannot be checked against it."
      ),
    ]
  const [stockX, stockY, stockZ] = plate.stockAnchor
  const grid = gridArea(params, plate, stockZ + stock.height, start)
  const places = grid ? { places: [grid] } : {}
  if (
    params.width > stock.width + EPSILON ||
    params.depth > stock.depth + EPSILON
  )
    return [
      autoLevelError(
        "grid-exceeds-stock",
        `The ${formatMillimetres(params.width)} × ${formatMillimetres(params.depth)} mm probe grid is larger than the ${formatMillimetres(stock.width)} × ${formatMillimetres(stock.depth)} mm stock.`,
        places
      ),
    ]
  if (
    !grid ||
    (grid.min[0] >= stockX - EPSILON &&
      grid.min[1] >= stockY - EPSILON &&
      grid.max[0] <= stockX + stock.width + EPSILON &&
      grid.max[1] <= stockY + stock.depth + EPSILON)
  )
    return []
  return [
    autoLevelWarning(
      "grid-outside-stock",
      "The anchored probe grid extends beyond the stock as placed on the bed.",
      places
    ),
  ]
}
