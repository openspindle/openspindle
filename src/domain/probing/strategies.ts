import { plateMachining } from "../compile/toolpath-bounds"
import type { PlateMachining } from "../compile/toolpath-bounds"
import { FIXTURE_KITS } from "../fixtures/catalog"
import { createOperation } from "../operations/operation"
import type {
  Operation,
  ProbingSource,
  ProbingSourceOf,
} from "../operations/operation"
import type { Plate } from "../plate/plate"
import { probeProfile } from "../tools/tool"
import { lowestFree } from "../tools/tool-table"
import type { ProbeProfile, Tool } from "../tools/tool"
import { OUTLINE_TRACE } from "./generic/outline-trace"
import { SURFACE_TOUCH } from "./generic/surface-touch"
import { readsAll } from "./parameters"
import type { ParameterSpecs, SpecReads } from "./parameters"
import type {
  Generation,
  MachineProbing,
  ProbingTask,
  StrategyInput,
  TaskParams,
  TaskSpecs,
  TaskStrategy,
} from "./strategy"

/**
 * OpenSpindle's own strategies, which a machine runs where it gives what they are made of
 * (`ProbingStrategy.runsOn`).
 */
export const GENERIC_STRATEGIES: readonly TaskStrategy[] = [
  SURFACE_TOUCH,
  OUTLINE_TRACE,
]

/** The strategies a machine offers: first the generic ones it runs, then its firmware's. */
export const machineStrategies = (
  machine: MachineProbing
): readonly TaskStrategy[] => [
  ...GENERIC_STRATEGIES.filter(
    (strategy) => strategy.runsOn?.(machine) ?? true
  ),
  ...machine.strategies,
]

/**
 * Whether a strategy probes with a probe of this profile on a machine: the strategy can probe
 * with it, and the machine's firmware lets that probe do the strategy's task.
 */
export const runsWith = (
  strategy: TaskStrategy,
  profile: ProbeProfile,
  machine: MachineProbing
): boolean =>
  strategy.accepts(profile, machine) && machine.probes(strategy.task, profile)

/** The strategies a probe with this profile can run on a machine (`runsWith`), generic first. */
export const strategiesFor = (
  machine: MachineProbing,
  profile: ProbeProfile
): TaskStrategy[] =>
  machineStrategies(machine).filter((strategy) =>
    runsWith(strategy, profile, machine)
  )

/**
 * Why a strategy cannot run on a plate, as picking it shows (`ProbingStrategy.blocked`); null
 * where it can.
 */
export const strategyBlocked = (
  strategy: TaskStrategy,
  plate: Plate,
  machine: MachineProbing
): string | null => strategy.blocked?.(plate, machine) ?? null

/**
 * A strategy's label by its id, among the generic strategies and those of every machine
 * OpenSpindle knows, so that a strategy of another machine than a plate's is named too; the id
 * itself for one it does not know.
 */
export function strategyLabel(id: string): string {
  const known = [
    ...GENERIC_STRATEGIES,
    ...FIXTURE_KITS.flatMap((kit) => kit.probing?.strategies ?? []),
  ]
  return known.find((strategy) => strategy.id === id)?.label ?? id
}

/** What a probing operation is shown as: its strategy's label (`strategyLabel`). */
export const probingLabel = (operation: {
  readonly source: Pick<ProbingSource, "strategy">
}): string => strategyLabel(operation.source.strategy)

/** The strategy a probing operation names, among a machine's; null where it has none so named. */
export const strategyOf = (
  id: string,
  machine: MachineProbing
): TaskStrategy | null =>
  machineStrategies(machine).find((strategy) => strategy.id === id) ?? null

/**
 * A probing operation's strategy on a machine: the one it names, when that does the operation's
 * task; null otherwise.
 */
export function strategyFor<TTask extends ProbingTask>(
  source: ProbingSourceOf<TTask>,
  machine: MachineProbing
): TaskStrategy<TTask> | null {
  const strategy = strategyOf(source.strategy, machine)
  // The strategy of the operation's task is one of that task's.
  return strategy?.task === source.task
    ? (strategy as unknown as TaskStrategy<TTask>)
    : null
}

/**
 * The ranges a probing operation's strategy gives its parameters on a machine (`strategyFor`);
 * null where the machine does not probe or has no such strategy.
 */
export function strategySpecs<TTask extends ProbingTask>(
  source: ProbingSourceOf<TTask>,
  machine: MachineProbing | null
): TaskSpecs[TTask] | null {
  const strategy = machine && strategyFor(source, machine)
  return machine && strategy ? strategy.parameters(machine) : null
}

/**
 * A strategy that reads the parameters of any task: a strategy's `task` decides its parameters'
 * shape as a probing operation's does, which TypeScript cannot pair across the two unions. The
 * functions below check the tasks match and state the pairing with this one cast.
 */
type AnyTaskStrategy = {
  readonly task: ProbingTask
  parameters: (machine: MachineProbing) => ParameterSpecs
  reads?: (params: ProbingSource["params"]) => SpecReads<ParameterSpecs>
  defaults: (
    plate: Plate,
    parameters: unknown,
    machining: PlateMachining
  ) => ProbingSource["params"]
  generate: (input: StrategyInput<ProbingSource["params"]>) => Generation
}
const anyTask = <TTask extends ProbingTask>(strategy: TaskStrategy<TTask>) =>
  strategy as unknown as AnyTaskStrategy

/**
 * A probing operation's NC with its strategy (`strategyFor`), or why there is none; null for a
 * strategy of another task.
 */
export function generateProbing(
  strategy: TaskStrategy,
  source: ProbingSource,
  input: Omit<StrategyInput<unknown>, "params">
): Generation | null {
  if (strategy.task !== source.task) return null
  return anyTask(strategy).generate({ ...input, params: source.params })
}

/**
 * Which of its task's numeric parameters a strategy reads with an operation's parameters, as its
 * form shows them (`ProbingStrategy.reads`): all of them where it does not say.
 */
export function strategyReads<TTask extends ProbingTask>(
  strategy: TaskStrategy<TTask>,
  params: TaskParams<TTask>,
  machine: MachineProbing
): SpecReads<TaskSpecs[TTask]> {
  const { reads, parameters } = anyTask(strategy)
  return (reads?.(params) ?? readsAll(parameters(machine))) as SpecReads<
    TaskSpecs[TTask]
  >
}

/**
 * A new probing operation with a library probe and one of the strategies it runs on the plate's
 * machine: named after the strategy, with its defaults fitted to the plate, selecting the probe
 * by the number the machine's firmware needs it in, or else by its post-processor number or the
 * lowest free one. `preferredTools` binds that number to the probe in the plate's table when the
 * operation is added (`bindTools`).
 */
export function newProbingOperation(
  plate: Plate,
  tool: Tool,
  strategy: TaskStrategy,
  machine: MachineProbing
): {
  operation: Operation
  preferredTools: ReadonlyMap<number | null, string>
} {
  const profile = probeProfile(tool)
  const probe =
    (profile && machine.slot(profile)) ??
    tool.postProcess.number ??
    lowestFree(new Set(plate.tools.map((entry) => entry.number)))
  const source = {
    kind: "probing" as const,
    task: strategy.task,
    strategy: strategy.id,
    probe,
    params: anyTask(strategy).defaults(
      plate,
      strategy.parameters(machine),
      plateMachining(plate)
    ),
  } as ProbingSource
  return {
    operation: createOperation(strategy.label, source),
    preferredTools: new Map([[probe, tool.id]]),
  }
}
