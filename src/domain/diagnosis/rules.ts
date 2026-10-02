import type { MachineAlarm } from "../fixtures/fixture-kit"
import type { StageRule } from "../rules/stages"
import type { MachineEvidence } from "./evidence"
import type { Resolution } from "./resolution"

/**
 * Why the machine is halted: the first finding of the chain decides, and the rules after it
 * assume it passed. The E-stop comes first, as the alarm it leaves may name another cause; then
 * the machines' own findings for their alarms (their kits' rules), the generic alarm last.
 */
export const ALARM_CHAIN = "alarm"

/** The alarm code the machine reports while halted; null while it is not. */
export const alarmCode = ({ telemetry }: MachineEvidence) =>
  telemetry?.state === "Alarm" ? telemetry.alarm : null

export const UNLOCK: Resolution = {
  kind: "command",
  label: "Unlock",
  command: { type: "unlock" },
  afterwards:
    "Home the machine before running a program: its position may have changed.",
}

const RESET: Resolution = { kind: "reset", label: "Reset" }

/** What clears an alarm once its cause is fixed, and what to do then. */
const CLEARING: Record<
  MachineAlarm["clear"],
  { readonly advice: string; readonly resolutions: readonly Resolution[] }
> = {
  unlock: {
    advice:
      "Once its cause is fixed, unlock the machine, and home it before running.",
    resolutions: [UNLOCK],
  },
  reset: {
    advice: "Once its cause is fixed, reset the machine to clear it.",
    resolutions: [RESET],
  },
  power: {
    advice:
      "Once its cause is fixed, switch the machine off and on to clear it.",
    resolutions: [],
  },
}

const unconfirmedStop: StageRule<"diagnosis"> = {
  id: "diagnosis/lockout",
  stage: "diagnosis",
  label: "Stop not confirmed",
  description:
    "When the machine did not confirm a Stop, nothing but Stop goes until one is confirmed or the device is connected again.",
  severity: "error",
  configurable: false,
  test: ({ lockout }) => lockout === null,
  explain: ({ first }) => ({ problem: first.lockout ?? "" }),
  fixes: { offer: () => [{ kind: "stop", label: "Stop" }] },
}

const estop: StageRule<"diagnosis"> = {
  id: "diagnosis/estop",
  stage: "diagnosis",
  label: "E-stop pressed",
  description:
    "With the E-stop pressed the motors are off: nothing moves, and homing fails. A machine halted already keeps the alarm it had, which may name another cause.",
  severity: "error",
  configurable: false,
  chain: ALARM_CHAIN,
  test: ({ telemetry }) => telemetry?.estop !== true,
  explain: ({ first }) => ({
    problem:
      "The E-stop is pressed, so the motors are off: the machine cannot move or home.",
    advice:
      alarmCode(first) === null
        ? "Release it to move the machine again."
        : "Release it, then unlock the machine and home it.",
  }),
  fixes: { offer: ({ first }) => (alarmCode(first) === null ? [] : [UNLOCK]) },
}

/** The alarm the machine reports, as its kit names it; undefined for a code it does not. */
const alarmOf = (evidence: MachineEvidence): MachineAlarm | undefined => {
  const code = alarmCode(evidence)
  return code === null ? undefined : evidence.kit?.alarms[code]
}

const alarm: StageRule<"diagnosis"> = {
  id: "diagnosis/alarm",
  stage: "diagnosis",
  label: "Machine alarm",
  description:
    "A halted machine says why, as its kit names the code it reports, and what clears it.",
  severity: "error",
  configurable: false,
  chain: ALARM_CHAIN,
  test: (evidence) => alarmCode(evidence) === null,
  explain: ({ first }) => {
    const code = alarmCode(first)
    const named = alarmOf(first)
    if (!named)
      return {
        title: `Machine alarm ${code}`,
        problem: "The machine halted with an alarm OpenSpindle does not name.",
        advice: CLEARING.unlock.advice,
      }
    return {
      title: `${named.name} (alarm ${code})`,
      problem: named.meaning,
      advice: CLEARING[named.clear].advice,
    }
  },
  fixes: {
    offer: ({ first }) =>
      CLEARING[alarmOf(first)?.clear ?? "unlock"].resolutions,
  },
}

/** What every machine is diagnosed for, before the machines' own alarm findings. */
export const DIAGNOSIS_RULES: readonly StageRule<"diagnosis">[] = [
  unconfirmedStop,
  estop,
]

/** The generic alarm, after the machines' own alarm findings in its chain. */
export const ALARM_RULES: readonly StageRule<"diagnosis">[] = [alarm]
