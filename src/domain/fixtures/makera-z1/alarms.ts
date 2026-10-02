import type { MachineAlarm } from "../fixture-kit"

const unlock = (name: string, meaning: string): MachineAlarm => ({
  name,
  meaning,
  clear: "unlock",
})
const reset = (name: string, meaning: string): MachineAlarm => ({
  name,
  meaning,
  clear: "reset",
})

/**
 * The Z1 firmware's halt reasons (`HALT_REASON`, Kernel.h), which its status reports while it is
 * halted (`H:`): those below 21 clear by unlocking, those from 21 only with a reset, the spindle
 * alarm only by switching the machine off and on. MainButton halts with E-stop only when the
 * machine is not halted already, so another reason may stand while the E-stop is pressed.
 */
export const Z1_ALARMS: Readonly<Record<number, MachineAlarm>> = {
  1: unlock(
    "Halted",
    "Stop, the main button or a command the machine refused halted it."
  ),
  2: unlock(
    "Homing failed",
    "An axis ran its full travel without closing its home switch, or did not move at all, as with the E-stop pressed. The Z1 homes as it starts, so this returns after a restart until the cause is fixed."
  ),
  3: unlock("Probing failed", "A probe move ended without a touch."),
  4: unlock(
    "Tool calibration failed",
    "The tool could not be changed or measured."
  ),
  5: unlock(
    "Tool changer homing failed",
    "The tool changer did not reach its home switch."
  ),
  6: unlock(
    "Invalid tool",
    "The program asked for a tool the tool changer does not hold."
  ),
  7: unlock(
    "Tool missing",
    "No tool was found where one was expected. Check the tool rack."
  ),
  8: unlock(
    "Unexpected tool",
    "A tool was found where none was expected. Check the tool rack."
  ),
  9: unlock("Spindle overheated", "The spindle passed its temperature limit."),
  10: unlock("Soft limit", "A move would have gone past the machine's travel."),
  11: unlock("Cover open", "The cover was opened while machining."),
  12: unlock(
    "Probe not ready",
    "The probe is not set up, or its battery is flat."
  ),
  13: unlock("Emergency stop", "The E-stop was pressed."),
  14: unlock(
    "Electronics overheated",
    "The electronics cabinet passed its temperature limit."
  ),
  15: unlock("Not homed", "A move needs the machine homed first."),
  21: reset("Limit switch hit", "An axis hit a limit switch."),
  22: reset("X motor error", "The X motor's driver reported a fault."),
  23: reset("Y motor error", "The Y motor's driver reported a fault."),
  24: reset("Z motor error", "The Z motor's driver reported a fault."),
  25: reset("Spindle stalled", "The spindle stalled."),
  26: reset("SD card error", "The machine cannot read its SD card."),
  41: {
    name: "Spindle alarm",
    meaning: "The spindle's driver reported a fault.",
    clear: "power",
  },
}
