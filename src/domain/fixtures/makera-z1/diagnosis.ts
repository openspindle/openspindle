import type { HomeSwitch } from "@/machine/contract"
import type { MachineEvidence } from "@/domain/diagnosis/evidence"
import type { Resolution } from "@/domain/diagnosis/resolution"
import { ALARM_CHAIN, UNLOCK, alarmCode } from "@/domain/diagnosis/rules"
import type { StageRule } from "@/domain/rules/stages"
import { Z1_ALARMS } from "./alarms"
import { MAKERA_Z1_ID } from "./makera-z1"

/** HOME_FAIL (Kernel.h). */
const HOMING_FAILED = 2

/**
 * The X, Y and Z home switches the last inspection read; null before one. A's reads closed
 * without a rotary module, and homing then skips it (Endstops::home), so it tells nothing here.
 */
function homeSwitches({ switches }: MachineEvidence): HomeSwitch[] | null {
  return (
    switches?.homes.filter(
      (home) => home.axis === "X" || home.axis === "Y" || home.axis === "Z"
    ) ?? null
  )
}

const closedSwitches = (evidence: MachineEvidence) =>
  homeSwitches(evidence)?.filter((home) => home.closed) ?? []

const axesText = (homes: readonly HomeSwitch[]) =>
  homes.map((home) => home.axis).join(", ")

const readSwitches = ({ switches }: MachineEvidence): Resolution => ({
  kind: "inspect",
  label: switches ? "Read again" : "Read switches",
  inspection: "switches",
})

/** What to look at next, by what the switches read. */
function homingAdvice(evidence: MachineEvidence): string {
  const homes = homeSwitches(evidence)
  if (!homes)
    return "Read the switches: away from home, every home switch should read open."
  if (closedSwitches(evidence).length)
    return "Free the home switch that reads closed, then unlock the machine and home it again."
  return "Every home switch reads open, as it should away from home. Watch the next homing: Z rises first, then X and Y. The axis that stops short or keeps pushing is the one to check: press its switch by hand and read again, and it should read closed."
}

const homingFailed: StageRule<"diagnosis"> = {
  id: "diagnosis/z1-homing-failed",
  stage: "diagnosis",
  label: "Homing failed",
  description:
    "Homing failed (alarm 2): what the home switches read tells a blocked axis from a switch that does not close.",
  severity: "error",
  configurable: false,
  machines: [MAKERA_Z1_ID],
  chain: ALARM_CHAIN,
  test: (evidence) => alarmCode(evidence) !== HOMING_FAILED,
  explain: ({ first }) => ({
    title: `${Z1_ALARMS[HOMING_FAILED].name} (alarm ${HOMING_FAILED})`,
    problem: Z1_ALARMS[HOMING_FAILED].meaning,
    advice: homingAdvice(first),
  }),
  fixes: { offer: ({ first }) => [readSwitches(first), UNLOCK] },
}

const homeSwitchClosed: StageRule<"diagnosis"> = {
  id: "diagnosis/z1-home-switch-closed",
  stage: "diagnosis",
  label: "Home switch reads closed",
  description:
    "A home switch reads closed only while its axis sits at it; away from it, the switch is stuck or held, or its cable is damaged.",
  severity: "warning",
  configurable: false,
  machines: [MAKERA_Z1_ID],
  test: (evidence) => closedSwitches(evidence).length === 0,
  explain: ({ first }) => {
    const closed = closedSwitches(first)
    return {
      title:
        closed.length === 1
          ? `${axesText(closed)} home switch reads closed`
          : `${axesText(closed)} home switches read closed`,
      problem:
        "A home switch reads closed only while its axis sits at it. Away from it, the switch is stuck or held, or its cable is damaged.",
      advice: "Check the switch and its cable, then read the switches again.",
    }
  },
  fixes: { offer: ({ first }) => [readSwitches(first)] },
}

/** The Z1's own findings: its homing alarm, in the alarm chain, and its home switches. */
export const Z1_DIAGNOSIS_RULES: readonly StageRule<"diagnosis">[] = [
  homingFailed,
  homeSwitchClosed,
]
