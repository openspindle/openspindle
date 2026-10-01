import { ToolNumberSchema } from "@/domain/primitives"
import { isJsonObject } from "./json"
import type { JsonObject } from "./json"
import { upgradePlacement } from "./placement"

/**
 * The probe slots of the Z1, the only probes earlier formats knew: their probing operations' NC
 * selected T0, and 3D probing T9999.
 */
const PROBE = 0
const PROBE_3D = 9999

/** One of the earlier formats' probing kinds as a probing operation. */
type ProbingKind = {
  /** What earlier formats named a new operation of it, and showed it as. */
  readonly label: string
  readonly task: "grid" | "touch-off" | "outline" | "origin"
  /** The tool number its NC selected, which the operation's probe now is. */
  readonly probe: number
  /** The strategy that writes the NC it wrote, on the plate with this setup. */
  readonly strategy: (params: JsonObject, setup: unknown) => string
  readonly params: (params: JsonObject) => JsonObject
}

/** The params with their placement upgraded, where they have one. */
const withPlacement = (params: JsonObject): JsonObject =>
  Object.hasOwn(params, "placement")
    ? { ...params, placement: upgradePlacement(params.placement) }
    : params

/**
 * Two fields as one value per axis, X then Y, where the first of them was. Params that lack
 * either, or already have the pair, stay as they are, for reading to report what it does not
 * keep.
 */
function paired(
  params: JsonObject,
  x: string,
  y: string,
  field: string
): JsonObject {
  if (
    params[x] === undefined ||
    params[y] === undefined ||
    Object.hasOwn(params, field)
  )
    return params
  return Object.fromEntries(
    Object.entries(params).flatMap(([key, value]) => {
      if (key === x) return [[field, [params[x], params[y]]]]
      return key === y ? [] : [[key, value]]
    })
  )
}

/** 3D probing's params without the ball it was set for, which its probe now gives. */
function withoutBall(params: JsonObject): JsonObject {
  if (typeof params.ballDiameter !== "number") return params
  const { ballDiameter: _ball, ...rest } = params
  return rest
}

/**
 * Whether a plate's work X and Y are set from one of its stored anchors, as its program sets them
 * (`workOriginOnMachine`): its work origin is kept relative to an anchor its snapshot holds.
 */
function keepsWorkOriginAtAnchor(setup: unknown): boolean {
  if (!isJsonObject(setup) || !isJsonObject(setup.anchors)) return false
  const { workOriginAnchor, anchors } = setup
  return (
    typeof workOriginAnchor === "string" &&
    workOriginAnchor !== "" &&
    Array.isArray(anchors.anchors) &&
    anchors.anchors.some(
      (anchor) => isJsonObject(anchor) && anchor.id === workOriginAnchor
    )
  )
}

/**
 * The touch-off an auto Z-height ran: the firmware's own Z probe from an anchor when the plate
 * set work X and Y from one, otherwise a touch below where it started.
 */
function touchOffStrategy(params: JsonObject, setup: unknown): string {
  const anchored =
    isJsonObject(params.placement) && params.placement.kind === "anchor"
  return anchored && keepsWorkOriginAtAnchor(setup)
    ? "makera-z1/z-probe"
    : "surface-touch"
}

/** Format 5's probing kinds, by their source's kind. */
const KINDS = new Map<unknown, ProbingKind>([
  [
    "auto-level",
    {
      label: "Auto-level",
      task: "grid",
      probe: PROBE,
      strategy: () => "makera-z1/height-map",
      params: (params) =>
        withPlacement(
          paired(
            paired(params, "width", "depth", "size"),
            "columns",
            "rows",
            "points"
          )
        ),
    },
  ],
  [
    "auto-z-height",
    {
      label: "Auto Z-height",
      task: "touch-off",
      probe: PROBE,
      strategy: touchOffStrategy,
      params: withPlacement,
    },
  ],
  [
    "auto-scan",
    {
      label: "Auto-scan",
      task: "outline",
      probe: PROBE,
      strategy: () => "outline-trace",
      params: (params) => params,
    },
  ],
  [
    "probe-3d",
    {
      label: "3D probing",
      task: "origin",
      probe: PROBE_3D,
      strategy: () => "makera-z1/routines",
      params: (params) =>
        withPlacement(
          paired(withoutBall(params), "distanceX", "distanceY", "distance")
        ),
    },
  ],
])

/** What upgrading a probing operation's source makes of it. */
export type UpgradedSource = {
  readonly source: JsonObject
  /** The earlier kind's label, which a new operation of it was named. */
  readonly label: string
  /** The strategy that writes its NC; null where the source holds no valid one. */
  readonly strategy: string | null
  /** The tool number its NC selects; null where the source holds no valid one. */
  readonly probe: number | null
  /** The ball diameter 3D probing was set for, which the probe now gives; null for none. */
  readonly ball: number | null
}

/**
 * An operation's source as earlier formats saved it (projects before format 8, exports before
 * version 7), in the current one, when it is one of their four probing kinds with parameters:
 * one probing source of the task the kind did, the strategy that writes the NC the kind wrote on
 * this plate (`setup`), and the probe slot its NC selected. 3D probing takes the ball of that
 * probe rather than its own. Keys the source already has stay as they are. Null for any other
 * source.
 */
export function upgradeProbingSource(
  source: JsonObject,
  setup: unknown
): UpgradedSource | null {
  const kind = KINDS.get(source.kind)
  if (!kind || !isJsonObject(source.params)) return null
  const { kind: _kind, params, ...rest } = source
  const upgraded = {
    kind: "probing",
    task: kind.task,
    strategy: kind.strategy(params, setup),
    probe: kind.probe,
    ...rest,
    params: kind.params(params),
  }
  const probe = ToolNumberSchema.safeParse(upgraded.probe)
  return {
    source: upgraded,
    label: kind.label,
    strategy: typeof upgraded.strategy === "string" ? upgraded.strategy : null,
    probe: probe.success ? probe.data : null,
    ball:
      source.kind === "probe-3d" && typeof params.ballDiameter === "number"
        ? params.ballDiameter
        : null,
  }
}
