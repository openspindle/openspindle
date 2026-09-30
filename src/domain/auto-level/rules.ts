import {
  anchorsFromDevice,
  isStoredAnchorSetup,
  machineToBed,
} from "@/domain/anchors/stored-anchors"
import type { StoredAnchor } from "@/domain/anchors/stored-anchors"
import type { Area } from "@/domain/diagnostics"
import type { Point3 } from "@/domain/nc/gcode"
import type { Stock } from "@/domain/stock/stock"
import { isAnchorConfiguration } from "@/machine/contract"
import type { AnchorConfiguration } from "@/machine/contract"
import { autoLevelError, autoLevelWarning } from "./issues"
import type { AutoLevelIssue } from "./issues"
import { EPSILON, formatMillimetres } from "../geometry/millimetres"
import { boxRect, contains, rectAt } from "../geometry/rect"
import { AutoLevelParamsSchema } from "./params"
import type { AutoLevelParameters, AutoLevelParams } from "./params"
import { rangedSchema } from "../probing/parameters"
import { resolvePlacement } from "../probing/placement"
import type {
  PlacementContext,
  PlacementFailure,
  ProbeStart,
} from "../probing/placement"

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

type Checked<TValue> =
  ({ ok: true } & TValue) | { ok: false; issues: AutoLevelIssue[] }
/** Parameters and grid start that generation can render, or what blocks it. */
export type AutoLevelPlan = Checked<{
  params: AutoLevelParams
  start: ProbeStart
}>

/**
 * Everything that prevents generating NC: the parameters, within the ranges of the machine's
 * probe (`parameters`), and the grid start.
 */
export function planAutoLevel(
  params: AutoLevelParams,
  plate: PlacementContext,
  parameters: AutoLevelParameters
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
  parameters: AutoLevelParameters
): AutoLevelIssue[] {
  const checked = checkParams(params, parameters)
  if (!checked.ok) return checked.issues
  const resolved = resolveStart(checked.params, plate)
  const start = resolved.ok ? resolved.start : null
  return [
    ...(resolved.ok ? [] : resolved.issues),
    ...(start?.kind === "anchor" && start.source === "factory"
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

const PLACEMENT_ISSUES: Readonly<Record<PlacementFailure, AutoLevelIssue>> = {
  "anchor-snapshot-missing": autoLevelError(
    "anchor-snapshot-missing",
    "Select an anchor snapshot for this plate's device."
  ),
  "anchor-unavailable": autoLevelError(
    "anchor-unavailable",
    "The selected probe anchor is unavailable."
  ),
  "out-of-range": autoLevelError(
    "anchor-grid-out-of-range",
    "The anchored probe grid exceeds the supported coordinate range."
  ),
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
  parameters: AutoLevelParameters
): Checked<{ params: AutoLevelParams }> {
  const parsed = rangedSchema(AutoLevelParamsSchema, parameters).safeParse(
    params
  )
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
  const resolved = resolvePlacement(
    params.placement,
    plate,
    rectAt([0, 0], params.size)
  )
  if (!resolved.ok)
    return { ok: false, issues: [PLACEMENT_ISSUES[resolved.error]] }
  return { ok: true, start: resolved.value }
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
  if (start?.kind !== "anchor" || !plate.anchorSetup) return null
  // Machine XY reaches the bed through the snapshot's registration, as the viewer places it.
  const [x, y] = machineToBed(plate.anchorSetup)(start.machine)
  return {
    kind: "area",
    min: [x, y, top],
    max: [x + params.size[0], y + params.size[1], top],
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
  const [width, depth] = params.size
  if (width > stock.width + EPSILON || depth > stock.depth + EPSILON)
    return [
      autoLevelError(
        "grid-exceeds-stock",
        `The ${formatMillimetres(width)} × ${formatMillimetres(depth)} mm probe grid is larger than the ${formatMillimetres(stock.width)} × ${formatMillimetres(stock.depth)} mm stock.`,
        places
      ),
    ]
  if (
    !grid ||
    contains(
      rectAt([stockX, stockY], [stock.width, stock.depth]),
      boxRect(grid)
    )
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
