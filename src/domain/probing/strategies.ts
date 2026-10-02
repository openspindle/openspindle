import { plateMachining } from "../compile/toolpath-bounds"
import type { PlateMachining } from "../compile/toolpath-bounds"
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
import { GENERIC_TRACE } from "./generic/outline-trace"
import { GENERIC_TOUCH } from "./generic/surface-touch"
import { readsAll } from "./parameters"
import type { ParameterSpecs, SpecReads } from "./parameters"
import type {
  Generation,
  MachineProbing,
  ProbingStrategy,
  ProbingTask,
  StrategyId,
  StrategyInput,
  TaskMethod,
  TaskParams,
  TaskSpecs,
} from "./strategy"
import { originRoutine } from "./tasks/origin/params"

export { originRoutine, originStrategy } from "./tasks/origin/params"

/** Every strategy a probing operation can have, in the order they are offered. */
export const PROBING_STRATEGIES: readonly ProbingStrategy[] = [
  {
    id: "outside-corner",
    task: "origin",
    label: "Outside corner",
    description:
      "Find an outside corner of the stock and set the work origin there.",
  },
  {
    id: "inside-corner",
    task: "origin",
    label: "Inside corner",
    description: "Find an inside corner and set the work origin there.",
  },
  {
    id: "pocket-center",
    task: "origin",
    label: "Pocket center",
    description:
      "Find the center of a pocket or bore and set work X and Y there.",
  },
  {
    id: "boss-center",
    task: "origin",
    label: "Boss center",
    description:
      "Find the center of a boss, such as the stock itself, and set the work origin there.",
  },
  {
    id: "touch-off",
    task: "touch-off",
    label: "Z surface",
    description: "Probe the stock's top surface and set work Z there.",
  },
  {
    id: "height-map",
    task: "grid",
    label: "Height map",
    description:
      "Probe a height grid on the stock surface; the machine compensates later cuts for it.",
  },
  {
    id: "outline-trace",
    task: "outline",
    label: "Outline trace",
    description: "Trace the edges of the plate's work area before cutting.",
  },
]

/**
 * OpenSpindle's own methods, which a machine runs where it gives what they are made of
 * (`ProbingMethod.runsOn`).
 */
const GENERIC_METHODS: readonly TaskMethod[] = [GENERIC_TOUCH, GENERIC_TRACE]

/** A strategy by its id; null for an id OpenSpindle does not know. */
export function strategyById(id: string): ProbingStrategy | null {
  return PROBING_STRATEGIES.find((strategy) => strategy.id === id) ?? null
}

/** A strategy's label by its id; the id itself for one OpenSpindle does not know. */
export function strategyLabel(id: string): string {
  return strategyById(id)?.label ?? id
}

/** What a probing operation is shown as: its strategy's label (`strategyLabel`). */
export const probingLabel = (operation: {
  readonly source: Pick<ProbingSource, "strategy">
}): string => strategyLabel(operation.source.strategy)

/**
 * The methods that perform a strategy on a machine: its firmware's cycles first, then the
 * generic methods it runs.
 */
export function strategyMethods(
  strategy: ProbingStrategy,
  machine: MachineProbing
): TaskMethod[] {
  const performs = (method: TaskMethod) =>
    method.task === strategy.task && method.strategies.includes(strategy.id)
  return [
    ...machine.cycles.filter(performs),
    ...GENERIC_METHODS.filter(
      (method) => performs(method) && (method.runsOn?.(machine) ?? true)
    ),
  ]
}

/**
 * Whether a machine supports a strategy at all, having a method for it: null where it does,
 * otherwise why not.
 */
export function strategyUnsupported(
  strategy: ProbingStrategy,
  machine: MachineProbing
): string | null {
  return strategyMethods(strategy, machine).length
    ? null
    : `This machine does not support ${strategy.label}.`
}

/**
 * Why a strategy cannot run on a plate whatever its settings, no method of it running there
 * (`ProbingMethod.blocked`): the first method's reason, or that the machine does not support it;
 * null where it can.
 */
export function strategyBlocked(
  strategy: ProbingStrategy,
  plate: Plate,
  machine: MachineProbing
): string | null {
  const reasons = strategyMethods(strategy, machine).map(
    (method) => method.blocked?.(plate, machine) ?? null
  )
  if (!reasons.length) return strategyUnsupported(strategy, machine)
  return reasons.includes(null) ? null : reasons[0]
}

/**
 * Whether a probe with this profile can perform a strategy on a machine: a method of it can probe
 * with it, and the machine's firmware lets that probe do the strategy's task.
 */
export const runsWith = (
  strategy: ProbingStrategy,
  profile: ProbeProfile,
  machine: MachineProbing
): boolean =>
  machine.probes(strategy.task, profile) &&
  strategyMethods(strategy, machine).some((method) =>
    method.accepts(profile, machine)
  )

/**
 * Why a probe tool cannot perform a strategy on a machine although a method of it accepts the
 * probe (`ProbingMethod.refuses`), naming the tool and `number`, the plate's table entry that
 * holds it: the first such method's reason where none takes it; null where one does, or where
 * none accepts it (`runsWith` says so).
 */
export function strategyRefuses(
  strategy: ProbingStrategy,
  tool: Tool,
  number: number | null,
  machine: MachineProbing
): string | null {
  const profile = probeProfile(tool)
  const reasons = strategyMethods(strategy, machine)
    .filter((method) => profile && method.accepts(profile, machine))
    .map((method) => method.refuses?.(tool, number) ?? null)
  return reasons.includes(null) ? null : (reasons[0] ?? null)
}

/**
 * A method that reads the parameters of any task: a method's `task` decides its parameters'
 * shape as a probing operation's does, which TypeScript cannot pair across the two unions. The
 * functions below check the tasks match and state the pairing with this one cast.
 */
type AnyTaskMethod = {
  readonly task: ProbingTask
  blocked?: (
    plate: Plate,
    machine: MachineProbing,
    params?: ProbingSource["params"]
  ) => string | null
  parameters: (machine: MachineProbing) => ParameterSpecs
  reads?: (params: ProbingSource["params"]) => SpecReads<ParameterSpecs>
  defaults: (
    plate: Plate,
    parameters: unknown,
    machining: PlateMachining,
    strategy: StrategyId
  ) => ProbingSource["params"]
  generate: (input: StrategyInput<ProbingSource["params"]>) => Generation
}
const anyTask = <TTask extends ProbingTask>(method: TaskMethod<TTask>) =>
  method as unknown as AnyTaskMethod

/**
 * The method that writes a probing operation's NC on a machine: the first of its strategy's
 * methods (`strategyMethods`) not blocked on its plate with its parameters, a cycle of the
 * machine's before a generic one; else the first, whose NC then says why it cannot. Without a
 * plate, the first. Null where the machine has no method for the strategy, or the strategy is
 * unknown or of another task than the operation's.
 */
export function methodFor<TTask extends ProbingTask>(
  source: ProbingSourceOf<TTask>,
  machine: MachineProbing,
  plate: Plate | null
): TaskMethod<TTask> | null {
  const strategy = strategyById(source.strategy)
  if (strategy?.task !== source.task) return null
  const methods = strategyMethods(strategy, machine)
  const runs = (method: TaskMethod) =>
    !plate || !anyTask(method).blocked?.(plate, machine, source.params)
  const method = methods.find(runs) ?? methods.at(0) ?? null
  // A method of the strategy is one of the operation's task.
  return method as TaskMethod<TTask> | null
}

/**
 * The ranges the method that writes a probing operation's NC on a machine (`methodFor`) gives
 * its parameters; null where the machine does not probe or has no method for its strategy.
 */
export function methodSpecs<TTask extends ProbingTask>(
  source: ProbingSourceOf<TTask>,
  machine: MachineProbing | null,
  plate: Plate | null
): TaskSpecs[TTask] | null {
  const method = machine && methodFor(source, machine, plate)
  return machine && method
    ? (anyTask(method).parameters(machine) as TaskSpecs[TTask])
    : null
}

/**
 * Which of its task's numeric parameters a method reads with an operation's parameters, as its
 * form shows them (`ProbingMethod.reads`): all of them where it does not say.
 */
export function methodReads<TTask extends ProbingTask>(
  method: TaskMethod<TTask>,
  params: TaskParams<TTask>,
  machine: MachineProbing
): SpecReads<TaskSpecs[TTask]> {
  const { reads, parameters } = anyTask(method)
  return (reads?.(params) ?? readsAll(parameters(machine))) as SpecReads<
    TaskSpecs[TTask]
  >
}

/**
 * A probing operation's NC with a method (`methodFor`), or why there is none; null for a method
 * of another task.
 */
export function generateProbing(
  method: TaskMethod,
  source: ProbingSource,
  input: Omit<StrategyInput<unknown>, "params">
): Generation | null {
  if (method.task !== source.task) return null
  return anyTask(method).generate({ ...input, params: source.params })
}

/**
 * A new probing operation with a library probe and a strategy the plate's machine supports
 * (`strategyUnsupported`): named after the strategy, with the defaults of the method that would
 * run it on the plate fitted to the plate, selecting the probe by the number the machine's
 * firmware needs it in, or else by its post-processor number or the lowest free one.
 * `preferredTools` binds that number to the probe in the plate's table when the operation is
 * added (`bindTools`). Throws for a strategy the machine does not support, which is never
 * offered.
 */
export function newProbingOperation(
  plate: Plate,
  tool: Tool,
  strategy: ProbingStrategy,
  machine: MachineProbing
): {
  operation: Operation
  preferredTools: ReadonlyMap<number | null, string>
} {
  const methods = strategyMethods(strategy, machine)
  const method =
    methods.find((item) => !item.blocked?.(plate, machine)) ?? methods.at(0)
  if (!method)
    throw new Error(`This machine does not support ${strategy.label}.`)
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
    params: anyTask(method).defaults(
      plate,
      method.parameters(machine),
      plateMachining(plate),
      strategy.id
    ),
  } as ProbingSource
  return {
    operation: createOperation(strategy.label, source),
    preferredTools: new Map([[probe, tool.id]]),
  }
}

/**
 * An operation's source with another strategy of its task: an origin's routine becomes the
 * strategy's (`originRoutine`), and its other parameters stay. Null for a strategy of another
 * task.
 */
export function withStrategy(
  source: ProbingSource,
  strategy: ProbingStrategy
): ProbingSource | null {
  if (strategy.task !== source.task) return null
  if (source.task !== "origin") return { ...source, strategy: strategy.id }
  const routine = originRoutine(strategy.id)
  return (
    routine && {
      ...source,
      strategy: strategy.id,
      params: { ...source.params, routine },
    }
  )
}
