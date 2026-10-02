import { isJsonObject } from "./json"
import type { JsonObject } from "./json"

/** The strategies probing operations name since project format 10 (exports since version 9). */
type CurrentStrategy =
  | "outside-corner"
  | "inside-corner"
  | "pocket-center"
  | "boss-center"
  | "touch-off"
  | "height-map"
  | "outline-trace"

/**
 * The labels of the strategies the earlier ones became, as a new operation of one is named, for
 * the operations still named after their earlier strategy. Written out here, as the earlier
 * strategies are, for the upgrade to stay what it was when format 10 came.
 */
const LABELS: Readonly<Record<CurrentStrategy, string>> = {
  "outside-corner": "Outside corner",
  "inside-corner": "Inside corner",
  "pocket-center": "Pocket center",
  "boss-center": "Boss center",
  "touch-off": "Z surface",
  "height-map": "Height map",
  "outline-trace": "Outline trace",
}

/** The routines 3D probing finds, each the strategy that finds it now. */
const ROUTINES: ReadonlySet<unknown> = new Set<CurrentStrategy>([
  "outside-corner",
  "inside-corner",
  "pocket-center",
  "boss-center",
])

/** One of the strategies probing operations named before format 10. */
type EarlierStrategy = {
  /** What a new operation of it was named. */
  readonly label: string
  /** The strategy it is now, for an operation with these params; null where they name none. */
  readonly now: (params: unknown) => CurrentStrategy | null
}

/**
 * The probing strategies projects before format 10 (exports before version 9) named, by id: who
 * wrote the NC rather than what it does. Written out here rather than read from the app's
 * strategies, which no longer know these ids: the upgrade reads what those formats saved. 3D
 * probing with the Z1's routines is the strategy of the routine its params name.
 */
const EARLIER_STRATEGIES: ReadonlyMap<unknown, EarlierStrategy> = new Map<
  unknown,
  EarlierStrategy
>([
  ["surface-touch", { label: "Surface touch", now: () => "touch-off" }],
  [
    "makera-z1/z-probe",
    { label: "Z probe (Z1 firmware)", now: () => "touch-off" },
  ],
  [
    "makera-z1/height-map",
    { label: "Height map (Z1 firmware)", now: () => "height-map" },
  ],
  ["outline-trace", { label: "Outline trace", now: () => "outline-trace" }],
  [
    "makera-z1/routines",
    {
      label: "3D probing (Z1 routines)",
      now: (params) =>
        isJsonObject(params) && ROUTINES.has(params.routine)
          ? (params.routine as CurrentStrategy)
          : null,
    },
  ],
])

/**
 * What a new probing operation was named before format 10: its strategy's label; null for an id
 * no earlier strategy had.
 */
export const earlierStrategyLabel = (id: string): string | null =>
  EARLIER_STRATEGIES.get(id)?.label ?? null

/**
 * The earlier strategy a probing source saved before format 10 names, and the strategy it is now
 * (`EARLIER_STRATEGIES`); null where it is no probing source, or names no earlier strategy, or
 * 3D probing with no routine.
 */
function strategyChange(source: JsonObject): {
  readonly was: EarlierStrategy
  readonly now: CurrentStrategy
} | null {
  const was =
    source.kind === "probing" && EARLIER_STRATEGIES.get(source.strategy)
  const now = was ? was.now(source.params) : null
  return was && now !== null ? { was, now } : null
}

/** The strategy a probing source saved before format 10 names now (`strategyChange`). */
export const currentStrategy = (source: JsonObject): CurrentStrategy | null =>
  strategyChange(source)?.now ?? null

/** What upgrading a plate's probing strategies makes of it. */
export type UpgradedStrategies = {
  readonly plate: JsonObject
  /** The names of the operations it renamed as they were saved, by operation id. */
  readonly savedNames: ReadonlyMap<string, string>
}

/**
 * A plate's saved data as projects before format 10 (exports before version 9) saved it, whose
 * probing operations named their strategy by who wrote the NC, with each naming the strategy
 * that does what it did (`strategyChange`). One still named after its earlier strategy is named
 * after the new one, as the inspector renames an operation along with its strategy. What it does
 * not recognize stays as it is, for reading to report.
 */
export function upgradeStrategies(plate: JsonObject): UpgradedStrategies {
  const savedNames = new Map<string, string>()
  if (!Array.isArray(plate.operations)) return { plate, savedNames }
  const operations = plate.operations.map((operation: unknown) => {
    if (!isJsonObject(operation) || !isJsonObject(operation.source))
      return operation
    const change = strategyChange(operation.source)
    if (!change) return operation
    const upgraded = {
      ...operation,
      source: { ...operation.source, strategy: change.now },
    }
    const label = LABELS[change.now]
    if (operation.name !== change.was.label || label === change.was.label)
      return upgraded
    if (typeof operation.id === "string")
      savedNames.set(operation.id, change.was.label)
    return { ...upgraded, name: label }
  })
  return { plate: { ...plate, operations }, savedNames }
}
