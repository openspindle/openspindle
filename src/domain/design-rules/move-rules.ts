import { toMicrometre } from "../primitives"
import type { StageRule } from "../rules/stages"

/** Less than this is float noise, or a cut that only grazes. */
export const EPSILON = 0.001

/** A feed in words: "2,400", "12.5". */
const feed = (value: number) => Number(value.toFixed(1)).toLocaleString("en-US")

/** A length in words, to the micrometre: "0.3". */
const mm = (value: number) => String(toMicrometre(value))

/** What a move's depth is measured from: the stock top, or Z0 without stock. */
const top = (under: number | null) => (under === null ? "Z0" : "the stock top")

const maxCuttingFeed: StageRule<"move"> = {
  id: "max-cutting-feed",
  stage: "move",
  label: "Max cutting feed",
  description: "The fastest feed a move may cut at.",
  severity: "warning",
  configurable: true,
  limit: { unit: "mm/min", min: 1, max: 100_000, default: 2000 },
  test: ({ cutting, segment }, limit) => !cutting || segment.feed <= limit,
  locate: ({ segment }) => [segment.line],
  measure: ({ segment }) => segment.feed,
  explain: ({ worst, limit }) => ({
    problem: `cuts at up to ${feed(worst.segment.feed)} mm/min, over the ${feed(limit)} mm/min limit`,
    advice: `Cut at ${feed(limit)} mm/min or slower.`,
    worst: "fastest",
  }),
}

const maxPlungeRate: StageRule<"move"> = {
  id: "max-plunge-rate",
  stage: "move",
  label: "Max plunge rate",
  description:
    "The fastest a cutting move may go down: a straight plunge at its feed, a ramp at part of it.",
  severity: "warning",
  configurable: true,
  limit: { unit: "mm/min", min: 1, max: 100_000, default: 300 },
  test: ({ cutting, plungeRate }, limit) => !cutting || plungeRate <= limit,
  locate: ({ segment }) => [segment.line],
  measure: ({ plungeRate }) => plungeRate,
  explain: ({ worst, limit }) => ({
    problem: `plunges at up to ${feed(worst.plungeRate)} mm/min, over the ${feed(limit)} mm/min limit`,
    advice: `Plunge at ${feed(limit)} mm/min or slower, or ramp in.`,
    worst: "fastest",
  }),
}

const maxCutDepth: StageRule<"move"> = {
  id: "max-cut-depth",
  stage: "move",
  label: "Max cut depth",
  description: "How far below the stock top a cut may reach, in total.",
  severity: "warning",
  configurable: true,
  limit: { unit: "mm", min: 0, max: 1_000, default: 3 },
  test: ({ cutting, depth }, limit) => !cutting || depth <= limit + EPSILON,
  locate: ({ segment }) => [segment.line],
  measure: ({ depth }) => depth,
  explain: ({ worst, limit }) => ({
    problem: `cuts ${mm(worst.depth)} mm below ${top(worst.under)}, over the ${mm(limit)} mm limit`,
    advice: `Cut no deeper than ${mm(limit)} mm below ${top(worst.under)}.`,
    worst: "deepest",
  }),
}

/** Passes without stock, which the design rule check notes. */
export const maxDepthUnderStock: StageRule<"move"> = {
  id: "max-depth-under-stock",
  stage: "move",
  label: "Max depth under the stock",
  description:
    "How far a cut may reach below the stock bottom, into what the stock lies on.",
  severity: "warning",
  configurable: true,
  limit: { unit: "mm", min: 0, max: 1_000, default: 0.3 },
  test: ({ cutting, under }, limit) =>
    !cutting || under === null || under <= limit + EPSILON,
  locate: ({ segment }) => [segment.line],
  measure: ({ under }) => under ?? 0,
  explain: ({ worst, limit }) => ({
    problem: `cuts ${mm(worst.under ?? 0)} mm under the stock, over the ${mm(limit)} mm limit`,
    advice: `Cut no deeper than ${mm(limit)} mm under the stock.`,
    worst: "deepest",
  }),
}

const spindleStoppedWhileCutting: StageRule<"move"> = {
  id: "spindle-stopped-while-cutting",
  stage: "move",
  label: "Spindle stopped while cutting",
  description:
    "A move cuts while the spindle is stopped, or turns without a speed.",
  severity: "warning",
  configurable: true,
  test: ({ cutting, segment }) => !cutting || segment.spindle > 0,
  locate: ({ segment }) => [segment.line],
  explain: () => ({
    problem: "cuts with the spindle stopped or without a speed",
    advice: "Start the spindle with M3 and a speed before the cut.",
  }),
}

const rapidIntoStock: StageRule<"move"> = {
  id: "rapid-into-stock",
  stage: "move",
  label: "Rapid move into the stock",
  description: "A rapid move (G0) goes into the stock.",
  severity: "warning",
  configurable: true,
  test: ({ segment }) => !segment.rapid,
  locate: ({ segment }) => [segment.line],
  measure: ({ depth }) => depth,
  explain: ({ worst }) => ({
    problem:
      worst.under === null
        ? `moves rapidly ${mm(worst.depth)} mm below Z0 where it cuts`
        : `moves rapidly ${mm(worst.depth)} mm into the stock`,
    advice: "Move into the stock with G1 rather than G0.",
    worst: "deepest",
  }),
}

/**
 * The rules a plate's moves keep where they reach into the stock: the project's limits on feed,
 * plunge and depth, a turning spindle, and no rapid move into it.
 */
export const MOVE_RULES: readonly StageRule<"move">[] = [
  maxCuttingFeed,
  maxPlungeRate,
  maxCutDepth,
  maxDepthUnderStock,
  spindleStoppedWhileCutting,
  rapidIntoStock,
]
