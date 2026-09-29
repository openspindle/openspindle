import type { NcGlossaryEntry } from "@/domain/nc/glossary"

/**
 * The codes of the Z1's NC as its firmware handles them (MakeraZ1Firmware, where each is
 * handled), and codes CAM programs may contain that it does not run.
 */
export const Z1_GLOSSARY: readonly NcGlossaryEntry[] = [
  // src/modules/robot/Robot.cpp:535
  {
    code: "G0",
    name: "Rapid move",
    description:
      "Moves in a straight line at the rapid rate, 2000 mm/min by default, within each axis's maximum rate. An F on a G0 block sets the rapid rate for later G0 moves, not the feed.",
    words: "X Y Z A F",
    example: "G0 X10 Y10",
    group: "motion",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:536
  {
    code: "G1",
    name: "Linear move at feed",
    description:
      "Moves in a straight line at feed F in mm/min, 1000 until an F is given; F stays in effect. In laser mode S sets the laser power (0 to 1) for the move.",
    words: "X Y Z A F S",
    example: "G1 X20 Y5 F800",
    group: "motion",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:537
  {
    code: "G2",
    name: "Clockwise arc",
    description:
      "Cuts a clockwise arc in the selected plane to X Y Z at feed F, centred at the I J K offsets from its start; a change along the third axis makes a helix. R (radius) arcs are not supported: the centre comes only from I, J and K.",
    words: "X Y Z I J K F",
    example: "G2 X10 Y0 I5 J0 F600",
    group: "motion",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:538
  {
    code: "G3",
    name: "Counter-clockwise arc",
    description:
      "Cuts a counter-clockwise arc in the selected plane to X Y Z at feed F, centred at the I J K offsets from its start; a change along the third axis makes a helix. R (radius) arcs are not supported: the centre comes only from I, J and K.",
    words: "X Y Z I J K F",
    example: "G3 X0 Y0 I-5 J0 F600",
    group: "motion",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:539
  {
    code: "G4",
    name: "Dwell",
    description:
      "Waits for queued moves to finish, then pauses for P seconds (decimals allowed) plus S whole seconds. P is in seconds, not milliseconds.",
    words: "P S",
    example: "G4 P2.5",
    group: "program",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:568
  {
    code: "G10",
    name: "Set work offsets",
    description:
      "Sets work offsets: L2 to the X Y Z A B given, L20 so the current position reads as them, for P1 to P9 (G54 to G59.3) or P0 (the active system); other L values do nothing. Setting Z also makes the current tool the reference for tool length offsets, and only G54's offsets are kept across restarts.",
    words: "L P X Y Z A B",
    example: "G10 L20 P1 X0 Y0 Z0",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:643
  {
    code: "G17",
    name: "XY plane",
    description:
      "Selects the XY plane for arcs, the default: centres come from I and J, and G2 turns clockwise as seen from +Z.",
    words: "",
    example: "G17",
    group: "plane-units",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:644
  {
    code: "G18",
    name: "XZ plane",
    description:
      "Selects the XZ plane for arcs, which then take their centre from I and K. G2 turns clockwise as seen from +Y.",
    words: "",
    example: "G18",
    group: "plane-units",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:645
  {
    code: "G19",
    name: "YZ plane",
    description:
      "Selects the YZ plane for arcs, which then take their centre from J and K. G2 turns clockwise as seen from +X.",
    words: "",
    example: "G19",
    group: "plane-units",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:646
  {
    code: "G20",
    name: "Inch units",
    description:
      "Reads X Y Z, arc offsets and feeds in inches until G21. Probing distances (G38) and the firmware's routine parameters stay in millimetres.",
    words: "",
    example: "G20",
    group: "plane-units",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:647
  {
    code: "G21",
    name: "Millimetre units",
    description:
      "Reads X Y Z, arc offsets and feeds in millimetres, the default.",
    words: "",
    example: "G21",
    group: "plane-units",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2846
  {
    code: "G28",
    name: "Park at clearance position",
    description:
      "Parks rather than homes: lifts Z to the clearance height, then moves X and Y to the clearance position, in machine coordinates (Z -1, X -11.6, Y -14.6 by default). Axis words on its block are ignored; G28.2 homes.",
    words: "",
    example: "G28",
    group: "motion",
    machine: "runs",
  },
  // src/modules/tools/endstops/Endstops.cpp:1334
  {
    code: "G28.1",
    name: "Store park position",
    description:
      "Stores the current X and Y (or the X Y given) as a park position, but nothing uses it: G28 always goes to the clearance position.",
    words: "X Y",
    example: "G28.1",
    group: "coordinates",
    machine: "ignored",
  },
  // src/modules/tools/endstops/Endstops.cpp:1350
  {
    code: "G28.2",
    name: "Home axes",
    description:
      "Homes the axes named, or without words all axes with switches (X Y Z, and A when the rotary axis is enabled), Z first. X, Y and Z home to their maximum ends, where machine coordinates are 0, so positions inside the travel are negative.",
    words: "X Y Z A",
    example: "G28.2",
    group: "motion",
    machine: "runs",
  },
  // src/modules/tools/endstops/Endstops.cpp:1358
  {
    code: "G28.3",
    name: "Set position as homed",
    description:
      "Sets the X Y Z A given (all to 0 without words) as the current machine position without moving, and marks those axes homed.",
    words: "X Y Z A",
    example: "G28.3 X0 Y0 Z0",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/tools/endstops/Endstops.cpp:1376
  {
    code: "G28.4",
    name: "Set actuator positions",
    description:
      "Sets the motor positions of the X Y Z given without moving and marks those axes homed; on the Z1 this matches G28.3 for X, Y and Z.",
    words: "X Y Z",
    example: "G28.4 Z0",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/tools/endstops/Endstops.cpp:1386
  {
    code: "G28.5",
    name: "Clear homed state",
    description:
      "Clears the homed state of the axes named, or of all axes without words; playback and routines that need homing then refuse until the machine is homed.",
    words: "X Y Z A",
    example: "G28.5",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/tools/endstops/Endstops.cpp:1399
  {
    code: "G28.6",
    name: "Report homed state",
    description:
      "Reports whether each axis with a homing switch is homed, as X:1 Y:1 Z:1 A:0.",
    words: "",
    example: "G28.6",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/zprobe/CartGridStrategy.cpp:406
  {
    code: "G29",
    name: "Scan bed heights",
    description:
      "Probes a grid of I by J points (at least 5 by 5, 15 by default) over X by Y mm from the current position, with the probe H above the surface, and prints the height differences. Height compensation stays off.",
    words: "X Y I J H",
    example: "G29 X50 Y50 I5 J5 H2",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/zprobe/ZProbe.cpp:404
  {
    code: "G30",
    name: "Single Z probe",
    description:
      "Probes straight down at F mm/min (90 by default) for up to 200 mm and reports how far it went, then returns to its start. With Z it stays at the touch and sets that point as the Z given (through G92); R1 probes upward.",
    words: "Z F R",
    example: "G30 F90",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/zprobe/CartGridStrategy.cpp:377
  {
    code: "G31",
    name: "Probe grid, as G32",
    description:
      "Probes a rectangular height grid and turns on Z height compensation, exactly as G32 does.",
    words: "R X Y A B I J H",
    example: "G31 R1 X0 Y0 A80 B60 I6 J4 H2",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/zprobe/CartGridStrategy.cpp:377
  {
    code: "G32",
    name: "Probe grid and compensate",
    description:
      "Probes a rectangular height grid and turns on Z height compensation from it: with R1 the grid starts at the current position offset by X Y, otherwise at machine X Y; A and B are its size, I and J the points along each side (225 points at most) and H the height the probe travels at above the first touch. Outside the grid Z is not compensated.",
    words: "R X Y A B I J H",
    example: "G32 R1 X0 Y0 A80 B60 I6 J4 H2",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/zprobe/ZProbe.cpp:458
  {
    code: "G38.2",
    name: "Probe toward work",
    description:
      "Moves by the X Y Z given (always relative distances, in mm) at F mm/min until the probe touches, then reports [PRB:x,y,z:1] in machine coordinates. Halts with an alarm if nothing is touched or the probe is already touching at the start.",
    words: "X Y Z F",
    example: "G38.2 Z-10 F100",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/zprobe/ZProbe.cpp:458
  {
    code: "G38.3",
    name: "Probe toward, no alarm",
    description:
      "Probes like G38.2, moving by the relative X Y Z given at F mm/min until the probe touches, but without the alarm when nothing is touched. It still halts if the probe is already touching at the start.",
    words: "X Y Z F",
    example: "G38.3 X-20 F100",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/zprobe/ZProbe.cpp:471
  {
    code: "G38.4",
    name: "Probe away from work",
    description:
      "Moves by the relative X Y Z given at F mm/min until the probe loses contact, then reports [PRB:x,y,z:1]. Halts with an alarm if contact is never lost or there is none at the start.",
    words: "X Y Z F",
    example: "G38.4 Z2 F50",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/zprobe/ZProbe.cpp:471
  {
    code: "G38.5",
    name: "Probe away, no alarm",
    description:
      "Probes away like G38.4, moving by the relative X Y Z given until the probe loses contact, but without the alarm when contact is not lost. It still halts if there is no contact at the start.",
    words: "X Y Z F",
    example: "G38.5 Z2 F50",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/zprobe/ZProbe.cpp:477
  {
    code: "G38.6",
    name: "Probe tool setter",
    description:
      "Moves Z by the relative distance given at F mm/min until the tool setter triggers, then reports [PRB:x,y,z:1]; halts with an alarm if it does not. Tool changes use it to measure tool length.",
    words: "Z F",
    example: "G38.6 Z-108 F500",
    group: "probing",
    machine: "runs",
  },
  {
    code: "G40",
    name: "Cutter compensation off",
    description:
      "Not handled: the Z1 has no cutter radius compensation, so the tool always follows the programmed path and the block changes nothing.",
    words: "",
    example: "G40",
    group: "spindle-tool",
    machine: "unsupported",
  },
  {
    code: "G41",
    name: "Cutter compensation left",
    description:
      "Not handled: there is no cutter radius compensation, so the path is cut as programmed, without the offset D asks for.",
    words: "D",
    example: "G41 D1",
    group: "spindle-tool",
    machine: "unsupported",
  },
  {
    code: "G42",
    name: "Cutter compensation right",
    description:
      "Not handled: there is no cutter radius compensation, so the path is cut as programmed, without the offset D asks for.",
    words: "D",
    example: "G42 D1",
    group: "spindle-tool",
    machine: "unsupported",
  },
  {
    code: "G43",
    name: "Tool length offset",
    description:
      "Not handled: each tool's length offset comes from measuring it on the tool setter after a change, and H is ignored. A Z on the same block is not moved to.",
    words: "H Z",
    example: "G43 Z15 H1",
    group: "spindle-tool",
    machine: "unsupported",
  },
  {
    code: "G49",
    name: "Cancel tool length offset",
    description:
      "Not handled: the tool length offset measured at the last tool change stays in effect.",
    words: "",
    example: "G49",
    group: "spindle-tool",
    machine: "unsupported",
  },
  // src/modules/communication/GcodeDispatch.cpp:190
  {
    code: "G53",
    name: "Move in machine coordinates",
    description:
      "Moves the G0 or G1 on its block (or the current motion mode, with none) in machine coordinates, absolute and without work offsets; machine X, Y and Z are 0 at the homed corner and negative inside the travel. Other G codes after it on the block, apart from G90 and G91, void the rest of the block.",
    words: "X Y Z A",
    example: "G53 G0 Z-1",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:649
  {
    code: "G54",
    name: "Work coordinates 1",
    description:
      "Selects work coordinate system 1, the default and the one M2 and M30 return to. Its offsets are kept across restarts.",
    words: "",
    example: "G54",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:649
  {
    code: "G55",
    name: "Work coordinates 2",
    description:
      "Selects work coordinate system 2 (G10 P2). Its offsets are lost at restart.",
    words: "",
    example: "G55",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:649
  {
    code: "G56",
    name: "Work coordinates 3",
    description:
      "Selects work coordinate system 3 (G10 P3). Its offsets are lost at restart.",
    words: "",
    example: "G56",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:649
  {
    code: "G57",
    name: "Work coordinates 4",
    description:
      "Selects work coordinate system 4 (G10 P4). Its offsets are lost at restart.",
    words: "",
    example: "G57",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:649
  {
    code: "G58",
    name: "Work coordinates 5",
    description:
      "Selects work coordinate system 5 (G10 P5). Its offsets are lost at restart.",
    words: "",
    example: "G58",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:649
  {
    code: "G59",
    name: "Work coordinates 6",
    description:
      "Selects work coordinate system 6 (G10 P6). Its offsets are lost at restart.",
    words: "",
    example: "G59",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:652
  {
    code: "G59.1",
    name: "Work coordinates 7",
    description:
      "Selects work coordinate system 7 (G10 P7). Its offsets are lost at restart.",
    words: "",
    example: "G59.1",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:652
  {
    code: "G59.2",
    name: "Work coordinates 8",
    description:
      "Selects work coordinate system 8 (G10 P8). Its offsets are lost at restart.",
    words: "",
    example: "G59.2",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:652
  {
    code: "G59.3",
    name: "Work coordinates 9",
    description:
      "Selects work coordinate system 9 (G10 P9). Its offsets are lost at restart.",
    words: "",
    example: "G59.3",
    group: "coordinates",
    machine: "runs",
  },
  {
    code: "G61",
    name: "Exact path mode",
    description:
      "Not handled: the Z1 always blends corners by junction deviation (M205), so the block changes nothing.",
    words: "",
    example: "G61",
    group: "plane-units",
    machine: "unsupported",
  },
  {
    code: "G61.1",
    name: "Exact stop mode",
    description:
      "Not handled: the Z1 always blends corners by junction deviation (M205), so the block changes nothing.",
    words: "",
    example: "G61.1",
    group: "plane-units",
    machine: "unsupported",
  },
  {
    code: "G64",
    name: "Path blending",
    description:
      "Not handled: corners always blend by junction deviation (M205), and P and Q are ignored.",
    words: "P Q",
    example: "G64 P0.01",
    group: "plane-units",
    machine: "unsupported",
  },
  {
    code: "G73",
    name: "High-speed peck drilling",
    description:
      "Not handled: canned cycles are not available on the Z1, as its configuration leaves the drilling-cycle module disabled, so the block does not move. Later blocks with only X and Y move in the last G0 to G3 mode instead of drilling.",
    words: "X Y Z R Q F",
    example: "G73 X10 Y10 Z-5 R2 Q1 F100",
    group: "motion",
    machine: "unsupported",
  },
  {
    code: "G80",
    name: "Cancel canned cycle",
    description:
      "Not handled: canned cycles are not available on the Z1, as its configuration leaves the drilling-cycle module disabled, so there is nothing to cancel and the block changes nothing.",
    words: "",
    example: "G80",
    group: "motion",
    machine: "unsupported",
  },
  {
    code: "G81",
    name: "Drilling cycle",
    description:
      "Not handled: canned cycles are not available on the Z1, as its configuration leaves the drilling-cycle module disabled, so the block does not move. Later blocks with only X and Y move in the last G0 to G3 mode instead of drilling.",
    words: "X Y Z R F",
    example: "G81 X10 Y10 Z-3 R2 F100",
    group: "motion",
    machine: "unsupported",
  },
  {
    code: "G82",
    name: "Drilling with dwell",
    description:
      "Not handled: canned cycles are not available on the Z1, as its configuration leaves the drilling-cycle module disabled, so the block does not move. Later blocks with only X and Y move in the last G0 to G3 mode instead of drilling.",
    words: "X Y Z R P F",
    example: "G82 X10 Y10 Z-3 R2 P0.5 F100",
    group: "motion",
    machine: "unsupported",
  },
  {
    code: "G83",
    name: "Peck drilling",
    description:
      "Not handled: canned cycles are not available on the Z1, as its configuration leaves the drilling-cycle module disabled, so the block does not move. Later blocks with only X and Y move in the last G0 to G3 mode instead of drilling.",
    words: "X Y Z R Q F",
    example: "G83 X10 Y10 Z-8 R2 Q2 F100",
    group: "motion",
    machine: "unsupported",
  },
  {
    code: "G84",
    name: "Tapping cycle",
    description:
      "Not handled: the Z1 has no tapping cycle, so the block does not move.",
    words: "X Y Z R F",
    example: "G84 X10 Y10 Z-8 R2 F150",
    group: "motion",
    machine: "unsupported",
  },
  {
    code: "G85",
    name: "Boring, feed out",
    description:
      "Not handled: the Z1 has no boring cycles, so the block does not move.",
    words: "X Y Z R F",
    example: "G85 X10 Y10 Z-8 R2 F100",
    group: "motion",
    machine: "unsupported",
  },
  {
    code: "G86",
    name: "Boring, spindle stop",
    description:
      "Not handled: the Z1 has no boring cycles, so the block does not move.",
    words: "X Y Z R F",
    example: "G86 X10 Y10 Z-8 R2 F100",
    group: "motion",
    machine: "unsupported",
  },
  {
    code: "G87",
    name: "Back boring",
    description:
      "Not handled: the Z1 has no boring cycles, so the block does not move.",
    words: "X Y Z R I J K F",
    example: "G87 X10 Y10 Z-8 R2 I1 J0 K2 F100",
    group: "motion",
    machine: "unsupported",
  },
  {
    code: "G88",
    name: "Boring, manual retract",
    description:
      "Not handled: the Z1 has no boring cycles, so the block does not move.",
    words: "X Y Z R P F",
    example: "G88 X10 Y10 Z-8 R2 P1 F100",
    group: "motion",
    machine: "unsupported",
  },
  {
    code: "G89",
    name: "Boring with dwell",
    description:
      "Not handled: the Z1 has no boring cycles, so the block does not move.",
    words: "X Y Z R P F",
    example: "G89 X10 Y10 Z-8 R2 P0.5 F100",
    group: "motion",
    machine: "unsupported",
  },
  // src/modules/robot/Robot.cpp:658
  {
    code: "G90",
    name: "Absolute distances",
    description:
      "Absolute distance mode, the default: X Y Z A are positions in the active work coordinates. Arc centres (I J K) stay relative to the arc's start.",
    words: "",
    example: "G90",
    group: "plane-units",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:658
  {
    code: "G90.1",
    name: "Absolute arc centres, read as G90",
    description:
      "Read as G90, as the firmware ignores the subcode: it selects absolute distance mode. Arc centres are always relative to the arc's start.",
    words: "",
    example: "G90.1",
    group: "plane-units",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:659
  {
    code: "G91",
    name: "Relative distances",
    description:
      "Relative distance mode: X Y Z A are distances from the current position. G53 moves stay absolute, and G38 probe distances are always relative.",
    words: "",
    example: "G91",
    group: "plane-units",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:659
  {
    code: "G91.1",
    name: "Relative arc centres, read as G91",
    description:
      "Read as G91, as the firmware ignores the subcode: it switches X Y Z to relative distance mode, so later absolute coordinates are taken as distances. Arc centres are always relative to the arc's start.",
    words: "",
    example: "G91.1",
    group: "plane-units",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:742
  {
    code: "G92",
    name: "Offset current position",
    description:
      "Offsets the active work coordinates so the current position reads as the X Y Z A B given; G92 alone clears the offset. The offset is lost at restart.",
    words: "X Y Z A B",
    example: "G92 X0 Y0",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:662
  {
    code: "G92.1",
    name: "Clear G92 offset",
    description: "Clears the G92 offset.",
    words: "",
    example: "G92.1",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:662
  {
    code: "G92.2",
    name: "Clear G92 offset",
    description:
      "Clears the G92 offset, like G92.1, rather than keeping it for later.",
    words: "",
    example: "G92.2",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:729
  {
    code: "G92.3",
    name: "Set G92 offset directly",
    description:
      "Sets the G92 offset to the X Y Z A B given, rather than from the current position.",
    words: "X Y Z A B",
    example: "G92.3 X10 Y10 Z0",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:666
  {
    code: "G92.4",
    name: "Set machine position",
    description:
      "Sets the machine position of the X Y Z (and A) given without moving or marking the axes homed. For A, S wraps the reading into one turn, and R turns A within one turn to the given work angle.",
    words: "X Y Z A S R",
    example: "G92.4 X0 Y0 Z0",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:739
  {
    code: "G92.5",
    name: "Apply laser offset",
    description:
      "In laser mode, sets the G92 offset to the laser head's offset from the spindle (X 0, Y 0, Z -7 by default); outside laser mode it does nothing.",
    words: "",
    example: "G92.5",
    group: "coordinates",
    machine: "runs",
  },
  {
    code: "G93",
    name: "Inverse time feed",
    description:
      "Not handled: F stays in units per minute, so inverse-time F values are taken as feeds.",
    words: "",
    example: "G93",
    group: "plane-units",
    machine: "unsupported",
  },
  {
    code: "G94",
    name: "Feed per minute",
    description:
      "Not handled, but feeds are always in units per minute, so nothing changes.",
    words: "",
    example: "G94",
    group: "plane-units",
    machine: "unsupported",
  },
  {
    code: "G95",
    name: "Feed per revolution",
    description:
      "Not handled: F stays in units per minute, so per-revolution F values are taken as feeds per minute.",
    words: "",
    example: "G95",
    group: "plane-units",
    machine: "unsupported",
  },
  {
    code: "G96",
    name: "Constant surface speed",
    description:
      "Not handled: an S on the M3 block is taken as rpm, not as a surface speed.",
    words: "S",
    example: "G96 S200",
    group: "spindle-tool",
    machine: "unsupported",
  },
  {
    code: "G97",
    name: "Spindle speed in rpm",
    description:
      "Not handled, but spindle speeds are always in rpm, so nothing changes.",
    words: "S",
    example: "G97 S12000",
    group: "spindle-tool",
    machine: "unsupported",
  },
  {
    code: "G98",
    name: "Retract to initial Z",
    description:
      "Not handled: canned cycles are not available on the Z1, as its configuration leaves the drilling-cycle module disabled, so the block changes nothing.",
    words: "",
    example: "G98",
    group: "motion",
    machine: "unsupported",
  },
  {
    code: "G99",
    name: "Retract to R plane",
    description:
      "Not handled: canned cycles are not available on the Z1, as its configuration leaves the drilling-cycle module disabled, so the block changes nothing.",
    words: "",
    example: "G99",
    group: "motion",
    machine: "unsupported",
  },
  {
    code: "M0",
    name: "Program stop",
    description:
      "Not handled, so the program does not stop here. M600 pauses a playing program instead.",
    words: "",
    example: "M0",
    group: "program",
    machine: "unsupported",
  },
  {
    code: "M1",
    name: "Optional stop",
    description: "Not handled, so the program does not stop here.",
    words: "",
    example: "M1",
    group: "program",
    machine: "unsupported",
  },
  // src/modules/robot/Robot.cpp:807
  {
    code: "M2",
    name: "End of program",
    description:
      "Ends the program: stops the spindle (M5) and returns to G54, absolute distances and a 100% feed override. It does not stop playback, so lines after it still run.",
    words: "",
    example: "M2",
    group: "program",
    machine: "runs",
  },
  // src/modules/tools/spindle/SpindleControl.cpp:44
  {
    code: "M3",
    name: "Spindle on",
    description:
      "Once queued moves finish, starts the spindle clockwise at S rpm (without S at the last speed, 10000 after startup) and, if it was off, waits 8 s before the next move. Halts unless a cutting tool T1 to T999 is active; an S on a block without M3 does not change the speed.",
    words: "S",
    example: "M3 S12000",
    group: "spindle-tool",
    machine: "runs",
  },
  {
    code: "M4",
    name: "Spindle on counter-clockwise",
    description:
      "Not handled, so the spindle does not start. Only M3 starts it, clockwise.",
    words: "S",
    example: "M4 S12000",
    group: "spindle-tool",
    machine: "unsupported",
  },
  // src/modules/tools/spindle/SpindleControl.cpp:112
  {
    code: "M5",
    name: "Spindle off",
    description:
      "Once queued moves finish, stops the spindle and waits 4 s before the next move; vacuum mode's extend-out port and blowing mode's fan go off with it. In laser mode it switches the laser off instead.",
    words: "",
    example: "M5",
    group: "spindle-tool",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:1931
  {
    code: "M6",
    name: "Tool change",
    description:
      "Manual tool change to T, which must be on the same block (M6 alone does nothing): stops the spindle, lifts to the clearance height, goes to the change position and beeps, waits until the tool is confirmed (M490.2 or the button), then measures it on the tool setter and returns above where it started. Nothing happens when T is already the active tool.",
    words: "T",
    example: "M6 T1",
    group: "spindle-tool",
    machine: "runs",
  },
  {
    code: "M7",
    name: "Mist coolant on",
    description:
      "Not handled: no coolant or air output is configured on the Z1, so nothing switches.",
    words: "",
    example: "M7",
    group: "accessories",
    machine: "unsupported",
  },
  {
    code: "M8",
    name: "Flood coolant on",
    description:
      "Not handled: no coolant output is configured on the Z1, so nothing switches.",
    words: "",
    example: "M8",
    group: "accessories",
    machine: "unsupported",
  },
  {
    code: "M9",
    name: "Coolant off",
    description:
      "Not handled: no coolant output is configured on the Z1, so nothing changes.",
    words: "",
    example: "M9",
    group: "accessories",
    machine: "unsupported",
  },
  // src/modules/robot/Robot.cpp:812
  {
    code: "M17",
    name: "Enable motors",
    description: "Powers all stepper motors, holding their positions.",
    words: "",
    example: "M17",
    group: "settings",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:816
  {
    code: "M18",
    name: "Disable motors",
    description:
      "Once queued moves finish, switches off the motors named (X Y Z A B), or all of them without words.",
    words: "X Y Z A B",
    example: "M18",
    group: "settings",
    machine: "runs",
  },
  // src/modules/utils/simpleshell/SimpleShell.cpp:208
  {
    code: "M20",
    name: "List SD card files",
    description:
      "Would list the SD card's files, but the Z1 firmware has no SD card file system, so the list is empty.",
    words: "",
    example: "M20",
    group: "program",
    machine: "ignored",
  },
  // src/modules/utils/player/Player.cpp:164
  {
    code: "M21",
    name: "Initialise SD card",
    description:
      "Would initialise the SD card, but that is compiled out of the Z1 firmware, so nothing happens.",
    words: "",
    example: "M21",
    group: "program",
    machine: "ignored",
  },
  // src/modules/utils/player/Player.cpp:169
  {
    code: "M23",
    name: "Select SD file",
    description:
      "Would open a file on the SD card for playing, but the Z1 firmware has no SD card file system, so it reports 'file.open failed'.",
    words: "",
    example: "M23 PART.NC",
    group: "program",
    machine: "ignored",
  },
  // src/modules/utils/player/Player.cpp:209
  {
    code: "M24",
    name: "Start SD file",
    description:
      "Would start the file selected with M23; as none can be opened on the Z1, nothing starts.",
    words: "",
    example: "M24",
    group: "program",
    machine: "ignored",
  },
  // src/modules/utils/player/Player.cpp:219
  {
    code: "M25",
    name: "Stop reading program",
    description:
      "Stops the playing program from reading further lines without saving any state. Neither M24 nor M601 resumes it.",
    words: "",
    example: "M25",
    group: "program",
    machine: "runs",
  },
  // src/modules/utils/player/Player.cpp:222
  {
    code: "M26",
    name: "Reset SD file",
    description:
      "Would rewind the file selected with M23; with none open it reports 'No file loaded'.",
    words: "",
    example: "M26",
    group: "program",
    machine: "ignored",
  },
  // src/modules/utils/player/Player.cpp:246
  {
    code: "M27",
    name: "Report play progress",
    description:
      "Reports how many bytes of the playing program have been read (SD printing byte n/m), or that none is playing.",
    words: "",
    example: "M27",
    group: "program",
    machine: "runs",
  },
  // src/modules/communication/GcodeDispatch.cpp:235
  {
    code: "M28",
    name: "Start file upload",
    description:
      "Would write the following lines to a file on the SD card, but the Z1 firmware has no SD card file system, so it reports 'open failed' and the lines run as usual.",
    words: "",
    example: "M28 PART.NC",
    group: "program",
    machine: "ignored",
  },
  // src/modules/communication/GcodeDispatch.cpp:439
  {
    code: "M29",
    name: "End file upload",
    description:
      "Would end an M28 upload, which cannot start on the Z1, so it does nothing.",
    words: "",
    example: "M29",
    group: "program",
    machine: "ignored",
  },
  // src/modules/robot/Robot.cpp:804
  {
    code: "M30",
    name: "End of program",
    description:
      "Ends the program like M2, as the Z1 runs in grbl mode: stops the spindle and returns to G54, absolute distances and a 100% feed override. Lines after it still run.",
    words: "",
    example: "M30",
    group: "program",
    machine: "runs",
  },
  // src/modules/utils/player/Player.cpp:249
  {
    code: "M32",
    name: "Select and play SD file",
    description:
      "Would open and play a file on the SD card, but the Z1 firmware has no SD card file system, so it reports 'file.open failed'.",
    words: "",
    example: "M32 PART.NC",
    group: "program",
    machine: "ignored",
  },
  {
    code: "M48",
    name: "Enable overrides",
    description:
      "Not handled: the feed and spindle overrides (M220, M223) always apply.",
    words: "",
    example: "M48",
    group: "settings",
    machine: "unsupported",
  },
  {
    code: "M49",
    name: "Disable overrides",
    description:
      "Not handled: the feed and spindle overrides (M220, M223) stay in effect.",
    words: "",
    example: "M49",
    group: "settings",
    machine: "unsupported",
  },
  // src/modules/robot/Robot.cpp:844
  {
    code: "M82",
    name: "Absolute extruder mode",
    description:
      "Sets the extruder distance mode to absolute; the Z1 has no extruder, so nothing changes.",
    words: "",
    example: "M82",
    group: "plane-units",
    machine: "ignored",
  },
  // src/modules/robot/Robot.cpp:845
  {
    code: "M83",
    name: "Relative extruder mode",
    description:
      "Sets the extruder distance mode to relative; the Z1 has no extruder, so nothing changes.",
    words: "",
    example: "M83",
    group: "plane-units",
    machine: "ignored",
  },
  // src/modules/robot/Robot.cpp:839
  {
    code: "M84",
    name: "Disable all motors",
    description: "Once queued moves finish, switches off all stepper motors.",
    words: "",
    example: "M84",
    group: "settings",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:847
  {
    code: "M92",
    name: "Set steps per mm",
    description:
      "Sets the steps per mm for X Y Z (per degree for A) and reports them; the values are lost at restart.",
    words: "X Y Z A B",
    example: "M92 X1600 Y1600 Z3200",
    group: "settings",
    machine: "runs",
  },
  {
    code: "M98",
    name: "Call subprogram",
    description:
      "Not handled: subprograms are not supported, so the block does nothing.",
    words: "P L",
    example: "M98 P1000",
    group: "program",
    machine: "unsupported",
  },
  {
    code: "M99",
    name: "Return from subprogram",
    description:
      "Not handled: there are no subprograms to return from, so the block does nothing.",
    words: "",
    example: "M99",
    group: "program",
    machine: "unsupported",
  },
  // src/configZ1.default:195
  {
    code: "M105",
    name: "Report spindle temperature",
    description: "Reports the spindle motor's temperature, as M:temperature.",
    words: "",
    example: "M105",
    group: "settings",
    machine: "runs",
  },
  // src/configZ1.default:202
  {
    code: "M106",
    name: "Report cabinet temperature",
    description:
      "Reports the electronics cabinet's temperature; on the Z1 it does not switch a fan.",
    words: "",
    example: "M106",
    group: "settings",
    machine: "runs",
  },
  {
    code: "M107",
    name: "Fan off",
    description:
      "Not handled: the Z1's fans are switched with M801, M802, M811 and M812.",
    words: "",
    example: "M107",
    group: "accessories",
    machine: "unsupported",
  },
  // src/modules/communication/GcodeDispatch.cpp:268
  {
    code: "M112",
    name: "Emergency stop",
    description:
      "Halts at once, stopping motion and the spindle. M999 clears the alarm, after which the machine should be homed.",
    words: "",
    example: "M112",
    group: "program",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:867
  {
    code: "M114",
    name: "Report work position",
    description:
      "Reports the commanded X Y Z position in work coordinates (C: X Y Z).",
    words: "",
    example: "M114",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:447
  {
    code: "M114.1",
    name: "Report live work position",
    description:
      "Reports the live X Y Z position in work coordinates, read back from the motors.",
    words: "",
    example: "M114.1",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:451
  {
    code: "M114.2",
    name: "Report live machine position",
    description:
      "Reports the live X Y Z (and A B) position in machine coordinates.",
    words: "",
    example: "M114.2",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:454
  {
    code: "M114.3",
    name: "Report motor positions",
    description: "Reports the motors' live positions (X Y Z A B).",
    words: "",
    example: "M114.3",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:430
  {
    code: "M114.4",
    name: "Report planned machine position",
    description:
      "Reports the last planned machine position, before height compensation.",
    words: "",
    example: "M114.4",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:434
  {
    code: "M114.5",
    name: "Report compensated position",
    description:
      "Reports the last planned machine position including height compensation.",
    words: "",
    example: "M114.5",
    group: "coordinates",
    machine: "runs",
  },
  // src/modules/communication/GcodeDispatch.cpp:277
  {
    code: "M115",
    name: "Report firmware version",
    description:
      "Reports the firmware's name, version, build date and capabilities.",
    words: "",
    example: "M115",
    group: "settings",
    machine: "runs",
  },
  // src/modules/communication/GcodeDispatch.cpp:301
  {
    code: "M117",
    name: "Display message",
    description:
      "Would show its text on a display panel, which the Z1 firmware does not have, so it only replies ok.",
    words: "",
    example: "M117 ROUGHING",
    group: "program",
    machine: "ignored",
  },
  // src/modules/tools/endstops/Endstops.cpp:1417
  {
    code: "M119",
    name: "Report switch states",
    description:
      "Reports the states of the homing switches and of the probe input.",
    words: "",
    example: "M119",
    group: "settings",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:874
  {
    code: "M120",
    name: "Save modal state",
    description:
      "Saves the feed and rapid rates, distance mode, units and work coordinate system for M121 to restore.",
    words: "",
    example: "M120",
    group: "program",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:878
  {
    code: "M121",
    name: "Restore modal state",
    description:
      "Restores the feed and rapid rates, distance mode, units and work coordinate system saved by M120.",
    words: "",
    example: "M121",
    group: "program",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:882
  {
    code: "M203",
    name: "Set maximum axis speeds",
    description:
      "Sets the maximum X, Y and Z speeds in mm/s, S limiting the combined speed; without words it reports them. The values are lost at restart.",
    words: "X Y Z S",
    example: "M203 X20 Y20 Z10",
    group: "settings",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:882
  {
    code: "M203.1",
    name: "Set maximum motor rates",
    description:
      "Sets each motor's maximum rate in mm/s (degrees per second for A); without words it reports them. The values are lost at restart.",
    words: "X Y Z A B",
    example: "M203.1 X20 Y20 Z10",
    group: "settings",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:938
  {
    code: "M204",
    name: "Set acceleration",
    description:
      "Sets the acceleration in mm/s²: S for all moves, X Y Z A B for single axes. The values are lost at restart.",
    words: "S X Y Z A B",
    example: "M204 S150",
    group: "settings",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:957
  {
    code: "M205",
    name: "Set junction deviation",
    description:
      "Sets the cornering junction deviation (X), a separate one for Z-only moves (Z) and the minimum planner speed in mm/s (S).",
    words: "X Z S",
    example: "M205 X0.01",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/endstops/Endstops.cpp:1434
  {
    code: "M206",
    name: "Set home offsets",
    description:
      "Sets home offsets for X Y Z A, added to where each axis reads after homing; they apply at the next homing.",
    words: "X Y Z A",
    example: "M206 Z-0.5",
    group: "settings",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:981
  {
    code: "M211",
    name: "Soft limits on or off",
    description:
      "Turns the soft limits on (S1) or off (S0); without S it reports them. The Z1's configuration starts with them off.",
    words: "S",
    example: "M211 S1",
    group: "settings",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:1004
  {
    code: "M220",
    name: "Feed override",
    description:
      "Scales the speed of every move planned after it, rapids included, to S percent (10 to 1000); without S it reports the factor. M2 and M30 reset it to 100.",
    words: "S",
    example: "M220 S80",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/spindle/SpindleControl.cpp:148
  {
    code: "M223",
    name: "Spindle speed override",
    description: "Scales the spindle speed to S percent (50 to 200).",
    words: "S",
    example: "M223 S90",
    group: "spindle-tool",
    machine: "runs",
  },
  // src/modules/tools/temperaturecontrol/PID_Autotuner.cpp:91
  {
    code: "M303",
    name: "Heater PID autotune",
    description:
      "Would autotune a heater's PID loop for temperature sensor E, but the Z1's temperature sensors have no heater, so it only reports status until M304.",
    words: "E S C B L",
    example: "M303 E0 S40",
    group: "settings",
    machine: "ignored",
  },
  // src/modules/tools/temperaturecontrol/PID_Autotuner.cpp:87
  {
    code: "M304",
    name: "Stop PID autotune",
    description: "Stops an M303 autotune, which has nothing to tune on the Z1.",
    words: "",
    example: "M304",
    group: "settings",
    machine: "ignored",
  },
  // src/modules/tools/temperaturecontrol/TemperatureControl.cpp:258
  {
    code: "M305",
    name: "Temperature sensor settings",
    description:
      "Sets or shows the thermistor settings of the temperature sensor S selects: B the beta value, R and X a resistance and its temperature, I J K Steinhart-Hart coefficients, P a predefined table. The values are lost at restart.",
    words: "S B R X I J K P",
    example: "M305 S0 B3950",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/endstops/Endstops.cpp:1449
  {
    code: "M306",
    name: "Home offset from position",
    description:
      "Sets the home offsets so the current position reads as the X Y Z given, applied at the next homing; each axis must be homed first.",
    words: "X Y Z",
    example: "M306 Z0",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/laser/Laser.cpp:283
  {
    code: "M321",
    name: "Laser mode on",
    description:
      "Enters laser mode: changes to the laser module (M6 T8888), applies its offset (G92.5) and runs the cabinet fan at 40%. M3 and M5 then switch the laser, and S on G1 to G3 sets its power (0 to 1).",
    words: "",
    example: "M321",
    group: "spindle-tool",
    machine: "runs",
  },
  // src/modules/tools/laser/Laser.cpp:319
  {
    code: "M321.2",
    name: "Laser mode on, no change",
    description:
      "Enters laser mode like M321, but without the tool change and the laser offset.",
    words: "",
    example: "M321.2",
    group: "spindle-tool",
    machine: "runs",
  },
  // src/modules/tools/laser/Laser.cpp:345
  {
    code: "M322",
    name: "Laser mode off",
    description:
      "Leaves laser mode once queued moves finish: switches the laser output off and clears the G92 offset (G92.1).",
    words: "",
    example: "M322",
    group: "spindle-tool",
    machine: "runs",
  },
  // src/modules/tools/laser/Laser.cpp:368
  {
    code: "M322.2",
    name: "Laser mode off, keep offset",
    description: "Leaves laser mode like M322, but keeps the G92 offset.",
    words: "",
    example: "M322.2",
    group: "spindle-tool",
    machine: "runs",
  },
  // src/modules/tools/laser/Laser.cpp:381
  {
    code: "M323",
    name: "Laser test on",
    description:
      "Starts laser test mode: in laser mode the laser fires at its test power (1%) until M324.",
    words: "",
    example: "M323",
    group: "spindle-tool",
    machine: "runs",
  },
  // src/modules/tools/laser/Laser.cpp:386
  {
    code: "M324",
    name: "Laser test off",
    description: "Ends laser test mode.",
    words: "",
    example: "M324",
    group: "spindle-tool",
    machine: "runs",
  },
  // src/modules/tools/laser/Laser.cpp:393
  {
    code: "M325",
    name: "Laser power scale",
    description:
      "Scales the laser power to S percent; without S it reports the scale.",
    words: "S",
    example: "M325 S50",
    group: "spindle-tool",
    machine: "runs",
  },
  // src/modules/utils/simpleshell/SimpleShell.cpp:217
  {
    code: "M331",
    name: "Vacuum mode on",
    description:
      "Vacuum mode: the extend-out port (external extractor) runs whenever the spindle runs, switching on at once if the spindle already does.",
    words: "",
    example: "M331",
    group: "accessories",
    machine: "runs",
  },
  // src/modules/utils/simpleshell/SimpleShell.cpp:247
  {
    code: "M331.1",
    name: "Auto blowing on",
    description:
      "Auto blowing: while the spindle runs, the spindle fan runs at S percent.",
    words: "S",
    example: "M331.1 S60",
    group: "accessories",
    machine: "runs",
  },
  // src/modules/utils/simpleshell/SimpleShell.cpp:258
  {
    code: "M331.2",
    name: "Auto bed cleaning on",
    description:
      "Auto bed cleaning: when a program completes, the bed-cleaning sweep (M486.1) runs.",
    words: "",
    example: "M331.2",
    group: "accessories",
    machine: "runs",
  },
  // src/modules/tools/laser/Laser.cpp:400
  {
    code: "M331.4",
    name: "Static removal on",
    description:
      "Turns static-electricity removal on, switching the laser module's power output on.",
    words: "",
    example: "M331.4",
    group: "accessories",
    machine: "runs",
  },
  // src/modules/utils/simpleshell/SimpleShell.cpp:265
  {
    code: "M332",
    name: "Vacuum mode off",
    description:
      "Ends vacuum mode, switching the extend-out port off if the spindle runs.",
    words: "",
    example: "M332",
    group: "accessories",
    machine: "runs",
  },
  // src/modules/utils/simpleshell/SimpleShell.cpp:295
  {
    code: "M332.1",
    name: "Auto blowing off",
    description: "Ends auto blowing.",
    words: "",
    example: "M332.1",
    group: "accessories",
    machine: "runs",
  },
  // src/modules/utils/simpleshell/SimpleShell.cpp:301
  {
    code: "M332.2",
    name: "Auto bed cleaning off",
    description: "Ends auto bed cleaning.",
    words: "",
    example: "M332.2",
    group: "accessories",
    machine: "runs",
  },
  // src/modules/tools/laser/Laser.cpp:407
  {
    code: "M332.4",
    name: "Static removal off",
    description:
      "Turns static-electricity removal off; the laser module's output goes off unless laser mode is on.",
    words: "",
    example: "M332.4",
    group: "accessories",
    machine: "runs",
  },
  // src/modules/tools/zprobe/CartGridStrategy.cpp:432
  {
    code: "M370",
    name: "Clear height grid",
    description:
      "Clears the probed height grid and turns Z height compensation off.",
    words: "",
    example: "M370",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/zprobe/CartGridStrategy.cpp:439
  {
    code: "M374",
    name: "Save height grid",
    description:
      "Would save the height grid to the SD card, but the Z1's two-corner grid mode refuses it with an error.",
    words: "",
    example: "M374",
    group: "probing",
    machine: "ignored",
  },
  // src/modules/tools/zprobe/CartGridStrategy.cpp:440
  {
    code: "M374.1",
    name: "Delete saved height grid",
    description:
      "Would delete the saved height grid file, but the Z1 firmware has no SD card file system, so there is none.",
    words: "",
    example: "M374.1",
    group: "probing",
    machine: "ignored",
  },
  // src/modules/tools/zprobe/CartGridStrategy.cpp:453
  {
    code: "M375",
    name: "Load height grid",
    description:
      "Would load a saved height grid, but the Z1's two-corner grid mode refuses it with an error.",
    words: "",
    example: "M375",
    group: "probing",
    machine: "ignored",
  },
  // src/modules/tools/zprobe/CartGridStrategy.cpp:454
  {
    code: "M375.1",
    name: "Print height grid",
    description: "Prints the current height grid.",
    words: "",
    example: "M375.1",
    group: "probing",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:1020
  {
    code: "M400",
    name: "Wait for moves",
    description:
      "Waits until every queued move has finished before the next block runs.",
    words: "",
    example: "M400",
    group: "program",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2258
  {
    code: "M480.1",
    name: "Outside corner, back left",
    description:
      "With the 3D probe above the part near its back-left corner, touches the top twice and sets work Z0, then comes down Z beside the left and back sides, touches each twice and sets work X0 Y0 at the corner, allowing for the ball diameter D. X and Y are the distances out from the start (defaults D2 X20 Y20 Z2); it needs homing.",
    words: "D X Y Z",
    example: "M480.1 D2 X20 Y20 Z2",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2281
  {
    code: "M480.2",
    name: "Outside corner, back right",
    description:
      "With the 3D probe above the part near its back-right corner, touches the top twice and sets work Z0, then comes down Z beside the right and back sides, touches each twice and sets work X0 Y0 at the corner, allowing for the ball diameter D. X and Y are the distances out from the start (defaults D2 X20 Y20 Z2); it needs homing.",
    words: "D X Y Z",
    example: "M480.2 D2 X20 Y20 Z2",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2304
  {
    code: "M480.3",
    name: "Outside corner, front right",
    description:
      "With the 3D probe above the part near its front-right corner, touches the top twice and sets work Z0, then comes down Z beside the right and front sides, touches each twice and sets work X0 Y0 at the corner, allowing for the ball diameter D. X and Y are the distances out from the start (defaults D2 X20 Y20 Z2); it needs homing.",
    words: "D X Y Z",
    example: "M480.3 D2 X20 Y20 Z2",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2327
  {
    code: "M480.4",
    name: "Outside corner, front left",
    description:
      "With the 3D probe above the part near its front-left corner, touches the top twice and sets work Z0, then comes down Z beside the left and front sides, touches each twice and sets work X0 Y0 at the corner, allowing for the ball diameter D. X and Y are the distances out from the start (defaults D2 X20 Y20 Z2); it needs homing.",
    words: "D X Y Z",
    example: "M480.4 D2 X20 Y20 Z2",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2351
  {
    code: "M480.5",
    name: "Inside corner, back left",
    description:
      "With the 3D probe above the top beside a pocket's back-left corner, touches the top twice and sets work Z0, then moves in by X and Y, comes down Z, touches the left and back walls twice each and sets work X0 Y0 at the corner, allowing for the ball diameter D. Defaults are D2 X20 Y20 Z2; it needs homing.",
    words: "D X Y Z",
    example: "M480.5 D2 X20 Y20 Z2",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2374
  {
    code: "M480.6",
    name: "Inside corner, back right",
    description:
      "With the 3D probe above the top beside a pocket's back-right corner, touches the top twice and sets work Z0, then moves in by X and Y, comes down Z, touches the right and back walls twice each and sets work X0 Y0 at the corner, allowing for the ball diameter D. Defaults are D2 X20 Y20 Z2; it needs homing.",
    words: "D X Y Z",
    example: "M480.6 D2 X20 Y20 Z2",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2397
  {
    code: "M480.7",
    name: "Inside corner, front right",
    description:
      "With the 3D probe above the top beside a pocket's front-right corner, touches the top twice and sets work Z0, then moves in by X and Y, comes down Z, touches the right and front walls twice each and sets work X0 Y0 at the corner, allowing for the ball diameter D. Defaults are D2 X20 Y20 Z2; it needs homing.",
    words: "D X Y Z",
    example: "M480.7 D2 X20 Y20 Z2",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2420
  {
    code: "M480.8",
    name: "Inside corner, front left",
    description:
      "With the 3D probe above the top beside a pocket's front-left corner, touches the top twice and sets work Z0, then moves in by X and Y, comes down Z, touches the left and front walls twice each and sets work X0 Y0 at the corner, allowing for the ball diameter D. Defaults are D2 X20 Y20 Z2; it needs homing.",
    words: "D X Y Z",
    example: "M480.8 D2 X20 Y20 Z2",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2443
  {
    code: "M480.9",
    name: "Pocket centre",
    description:
      "With the 3D probe inside a pocket at probing depth, touches both X walls and both Y walls, searching up to X and Y each way, and sets work X0 Y0 at the centre, where it stays. It does not touch the top or set Z; it needs homing.",
    words: "X Y",
    example: "M480.9 X15 Y15",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2466
  {
    code: "M480.10",
    name: "Boss centre",
    description:
      "With the 3D probe above a boss, touches the top twice and sets work Z0, then comes down Z beside each side, X and Y out from the start, and sets work X0 Y0 at the boss's centre. It needs homing.",
    words: "X Y Z",
    example: "M480.10 X30 Y30 Z2",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2497
  {
    code: "M486.1",
    name: "Bed cleaning sweep",
    description:
      "Switches the extend-out port (extractor) on and sweeps the bed in machine coordinates at the current height, in rows T mm apart (40 by default) for N passes (1 by default), then switches it off. It needs homing.",
    words: "N T",
    example: "M486.1 N1 T40",
    group: "accessories",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2074
  {
    code: "M490",
    name: "Tool changer service check",
    description:
      "Service check of the tool-change motor: drives it until its sensor input trips, then partly back. On machines with the automatic tool changer it homes the collet instead.",
    words: "",
    example: "M490",
    group: "spindle-tool",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2128
  {
    code: "M490.1",
    name: "Wait for tool change",
    description:
      "Enters the manual tool-change wait: beeps, reports the waiting state and holds a running tool change until the tool is confirmed with M490.2 or the button. On machines with the automatic tool changer it clamps the tool instead.",
    words: "",
    example: "M490.1",
    group: "spindle-tool",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2134
  {
    code: "M490.2",
    name: "Confirm tool installed",
    description:
      "Confirms the new tool is installed and ends the manual tool-change wait. On machines with the automatic tool changer it releases the tool instead.",
    words: "",
    example: "M490.2",
    group: "spindle-tool",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2140
  {
    code: "M491",
    name: "Measure tool length",
    description:
      "Measures the active tool on the tool setter (a fast, then a slow G38.6 touch) and applies its tool length offset, lifting to the clearance height first and returning above its start after. It needs homing.",
    words: "",
    example: "M491",
    group: "spindle-tool",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2174
  {
    code: "M492.1",
    name: "Check tool in rack",
    description:
      "Checks that a tool is in its rack slot on machines with the automatic tool changer; with the Z1's manual tool change it does nothing.",
    words: "",
    example: "M492.1",
    group: "spindle-tool",
    machine: "ignored",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2174
  {
    code: "M492.2",
    name: "Check rack slot empty",
    description:
      "Checks that a rack slot is empty on machines with the automatic tool changer; with the Z1's manual tool change it does nothing.",
    words: "",
    example: "M492.2",
    group: "spindle-tool",
    machine: "ignored",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2176
  {
    code: "M492.3",
    name: "Check probe triggered",
    description:
      "Halts with 'Probe dead or not set' unless the probe triggered within the last 10 seconds, as it does when measured on the tool setter.",
    words: "",
    example: "M492.3",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2187
  {
    code: "M493",
    name: "Apply tool length offset",
    description:
      "Takes the last probe touch as the active tool's measured length and sets the tool length offset from the reference tool's, saving it in EEPROM; tool changes run it after measuring.",
    words: "",
    example: "M493",
    group: "spindle-tool",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2187
  {
    code: "M493.1",
    name: "Apply tool length offset",
    description:
      "Same as M493: takes the last probe touch as the active tool's measured length and sets the tool length offset from the reference tool's, saving it in EEPROM.",
    words: "",
    example: "M493.1",
    group: "spindle-tool",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2190
  {
    code: "M493.2",
    name: "Set active tool",
    description:
      "Sets the active tool number to T without changing tools, saving it in EEPROM; T-1 means no tool. T9999 also switches the probe laser on, any other tool switches it off.",
    words: "T",
    example: "M493.2 T-1",
    group: "spindle-tool",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2234
  {
    code: "M494",
    name: "Probe laser on, timed",
    description:
      "Switches the probe laser (the tool sensor output) on; it goes off after 300 s, or sooner once a tool other than T0 is active.",
    words: "",
    example: "M494",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2240
  {
    code: "M494.1",
    name: "Probe laser on",
    description:
      "Switches the probe laser (the tool sensor output) on until M494.2.",
    words: "",
    example: "M494.1",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2244
  {
    code: "M494.2",
    name: "Probe laser off",
    description: "Switches the probe laser (the tool sensor output) off.",
    words: "",
    example: "M494.2",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2530
  {
    code: "M495",
    name: "Probing and leveling routines",
    description:
      "Runs the firmware's probing from the path origin X Y in work coordinates, changing to the probe (T0) first when another tool is in: C D trace the margin to that corner, O F probe Z at that offset from X Y and set work Z0 there (O without F probes the rotary axis instead), and A B I J H level a grid of that size, points and height. P then returns above X Y at the clearance height.",
    words: "X Y C D O F A B I J H R P",
    example: "M495 X0 Y0 A80 B60 I6 J4 H2",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2516
  {
    code: "M495.3",
    name: "Touch block XYZ probing",
    description:
      "From above a touch block, probes down and sets work Z to H (the block height, 9 by default), then probes toward -X and -Y and sets work X0 and Y0 at the touched faces, allowing for the tool diameter D (3.175 by default).",
    words: "D H",
    example: "M495.3 D3.175 H9",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2858
  {
    code: "M496",
    name: "Go to clearance position",
    description:
      "Lifts Z to the clearance height, then moves to the clearance position in machine coordinates, as G28 does.",
    words: "",
    example: "M496",
    group: "motion",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2858
  {
    code: "M496.1",
    name: "Go to clearance position",
    description:
      "Same as M496: lifts Z to the clearance height, then moves to the clearance position in machine coordinates.",
    words: "",
    example: "M496.1",
    group: "motion",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2870
  {
    code: "M496.2",
    name: "Go to work origin",
    description:
      "Lifts Z to the clearance height, then moves to work X0 Y0 (and A0, first wrapping A within one turn).",
    words: "",
    example: "M496.2",
    group: "motion",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2900
  {
    code: "M496.3",
    name: "Go to anchor 1",
    description:
      "Lifts Z to the clearance height, then moves to anchor 1 (machine X -192.4 Y -194.3 by default).",
    words: "",
    example: "M496.3",
    group: "motion",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2903
  {
    code: "M496.4",
    name: "Go to anchor 2",
    description:
      "Lifts Z to the clearance height, then moves to anchor 2 (X 88.5, Y 45 from anchor 1 by default).",
    words: "",
    example: "M496.4",
    group: "motion",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2915
  {
    code: "M496.5",
    name: "Go to work position",
    description:
      "Lifts Z to the clearance height, then moves to the work position X Y (both required) and turns A to the A given.",
    words: "X Y A",
    example: "M496.5 X0 Y0",
    group: "motion",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:3000
  {
    code: "M496.6",
    name: "Go to machine position",
    description:
      "Lifts Z to the clearance height, then moves to the machine position X Y (both required) and turns A to the A given.",
    words: "X Y A",
    example: "M496.6 X-100 Y-100",
    group: "motion",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2715
  {
    code: "M497",
    name: "Clear routine state",
    description:
      "Waits for queued moves, then clears the routine state that status reports show. It moves nothing.",
    words: "",
    example: "M497",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2715
  {
    code: "M497.1",
    name: "Mark tool drop step",
    description:
      "Waits for queued moves, then shows the tool-drop step in status reports (A:1). It moves nothing.",
    words: "",
    example: "M497.1",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2715
  {
    code: "M497.2",
    name: "Mark tool change step",
    description:
      "Waits for queued moves, then shows the tool pick or change step in status reports (A:2); tool changes send it. It moves nothing.",
    words: "",
    example: "M497.2",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2715
  {
    code: "M497.3",
    name: "Mark tool measuring step",
    description:
      "Waits for queued moves, then shows the tool-measuring step in status reports (A:3); tool measuring sends it. It moves nothing.",
    words: "",
    example: "M497.3",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2715
  {
    code: "M497.4",
    name: "Mark margin trace step",
    description:
      "Waits for queued moves, then shows the margin-trace step in status reports (A:4); M495's margin trace sends it. It moves nothing.",
    words: "",
    example: "M497.4",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2715
  {
    code: "M497.5",
    name: "Mark probing step",
    description:
      "Waits for queued moves, then shows the probing step in status reports (A:5); the Z probe and 3D probing send it. It moves nothing.",
    words: "",
    example: "M497.5",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2715
  {
    code: "M497.6",
    name: "Mark auto-leveling step",
    description:
      "Waits for queued moves, then shows the auto-leveling step in status reports (A:6); M495's leveling sends it. It moves nothing.",
    words: "",
    example: "M497.6",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2720
  {
    code: "M498",
    name: "Show stored tool data",
    description:
      "Prints the tool number, tool length values and G54 offsets saved in EEPROM.",
    words: "",
    example: "M498",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2726
  {
    code: "M498.2",
    name: "Erase stored tool data",
    description:
      "Zeroes the tool number, tool length values and G54 offsets saved in EEPROM.",
    words: "",
    example: "M498.2",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2731
  {
    code: "M499",
    name: "Show tool offsets",
    description:
      "Prints the active tool, the reference and current tool lengths and the tool length offset.",
    words: "",
    example: "M499",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2734
  {
    code: "M499.2",
    name: "Show rack positions",
    description: "Prints the tool setter and tool rack positions.",
    words: "",
    example: "M499.2",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2741
  {
    code: "M499.3",
    name: "Beep job complete",
    description: "Sounds the beeper's job-complete signal, two short beeps.",
    words: "",
    example: "M499.3",
    group: "accessories",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2745
  {
    code: "M499.4",
    name: "Beep alarm",
    description: "Sounds the beeper's alarm signal, two longer beeps.",
    words: "",
    example: "M499.4",
    group: "accessories",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2749
  {
    code: "M499.5",
    name: "Beep tool change",
    description: "Sounds the beeper's tool-change signal, three short beeps.",
    words: "T",
    example: "M499.5 T1",
    group: "accessories",
    machine: "runs",
  },
  // src/modules/communication/GcodeDispatch.cpp:334
  {
    code: "M500",
    name: "Save settings",
    description:
      "Would save the current settings to the SD card's config-override file; it replies 'Settings Stored', but the Z1 firmware has no SD card file system, so nothing is saved.",
    words: "",
    example: "M500",
    group: "settings",
    machine: "ignored",
  },
  // src/modules/communication/GcodeDispatch.cpp:353
  {
    code: "M501",
    name: "Load saved settings",
    description:
      "Would load settings from the SD card's config-override file, but the Z1 firmware has no SD card file system, so it reports the file not found.",
    words: "",
    example: "M501",
    group: "settings",
    machine: "ignored",
  },
  // src/modules/communication/GcodeDispatch.cpp:366
  {
    code: "M502",
    name: "Delete saved settings",
    description:
      "Would delete the SD card's config-override file, but the Z1 firmware has no SD card file system, so there is nothing to delete.",
    words: "",
    example: "M502",
    group: "settings",
    machine: "ignored",
  },
  // src/modules/communication/GcodeDispatch.cpp:372
  {
    code: "M503",
    name: "Report settings",
    description:
      "Prints the current motion, homing, probe, grid and temperature settings as the codes that set them.",
    words: "",
    example: "M503",
    group: "settings",
    machine: "runs",
  },
  // src/modules/communication/GcodeDispatch.cpp:354
  {
    code: "M504",
    name: "Save settings to file",
    description:
      "Would save the current settings to a named config-override file, but the Z1 firmware has no SD card file system, so nothing is saved.",
    words: "",
    example: "M504",
    group: "settings",
    machine: "ignored",
  },
  // src/modules/tools/zprobe/CartGridStrategy.cpp:432
  {
    code: "M561",
    name: "Clear height grid",
    description:
      "Same as M370: clears the probed height grid and turns Z height compensation off.",
    words: "",
    example: "M561",
    group: "probing",
    machine: "runs",
  },
  // src/modules/tools/zprobe/CartGridStrategy.cpp:461
  {
    code: "M565",
    name: "Set probe offsets",
    description:
      "Sets the probe's X Y Z offset from the spindle, which grid probing allows for; the values are lost at restart.",
    words: "X Y Z",
    example: "M565 X0 Y0 Z0",
    group: "probing",
    machine: "runs",
  },
  // src/modules/utils/player/Player.cpp:288
  {
    code: "M600",
    name: "Pause program",
    description:
      "Pauses a playing program once its queued moves finish, saving its work position and modal state, and leaves the spindle as it is. It does nothing when no program is playing.",
    words: "",
    example: "M600",
    group: "program",
    machine: "runs",
  },
  // src/modules/utils/player/Player.cpp:291
  {
    code: "M601",
    name: "Resume program",
    description:
      "Resumes a program paused by M600: moves straight back to the saved work position with G1 at 1000 mm/min, restores the modal state and continues.",
    words: "",
    example: "M601",
    group: "program",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:1092
  {
    code: "M665",
    name: "Set move segmentation",
    description:
      "Sets how moves are cut into segments: S segments per second, or U millimetres per segment (5 by default). The values are lost at restart.",
    words: "S U",
    example: "M665 U5",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/endstops/Endstops.cpp:1490
  {
    code: "M666",
    name: "Set endstop trims",
    description:
      "Sets endstop trims on delta and SCARA machines; the Z1 is Cartesian, so nothing changes.",
    words: "X Y Z",
    example: "M666 X0 Y0 Z0",
    group: "settings",
    machine: "ignored",
  },
  // src/modules/tools/zprobe/ZProbe.cpp:497
  {
    code: "M670",
    name: "Set probe parameters",
    description:
      "Sets the probe's slow (S), fast (K) and return (R) feeds in mm/s, its maximum travel Z, probe height H, dwell before probing D in seconds and the unexpected-trigger guard Q (0 or 1); I inverts the probe input. The values are lost at restart.",
    words: "S K R Z H I D Q",
    example: "M670 S1.5 K5 R20",
    group: "probing",
    machine: "runs",
  },
  // src/configZ1.default:131
  {
    code: "M801",
    name: "Cabinet fan on",
    description:
      "Runs the electronics cabinet fan at S percent (30 without S) at once, without waiting for queued moves. The fan's temperature control also switches it.",
    words: "S",
    example: "M801 S60",
    group: "accessories",
    machine: "runs",
  },
  // src/configZ1.default:132
  {
    code: "M802",
    name: "Cabinet fan off",
    description:
      "Switches the electronics cabinet fan off at once, without waiting for queued moves; its temperature control can switch it on again.",
    words: "",
    example: "M802",
    group: "accessories",
    machine: "runs",
  },
  // src/configZ1.default:138
  {
    code: "M811",
    name: "Spindle fan on",
    description:
      "Runs the spindle fan at S percent (50 without S) at once, without waiting for queued moves. The spindle's temperature control also switches it.",
    words: "S",
    example: "M811 S80",
    group: "accessories",
    machine: "runs",
  },
  // src/configZ1.default:139
  {
    code: "M812",
    name: "Spindle fan off",
    description:
      "Switches the spindle fan off at once, without waiting for queued moves; its temperature control can switch it on again.",
    words: "",
    example: "M812",
    group: "accessories",
    machine: "runs",
  },
  // src/configZ1.default:147
  {
    code: "M821",
    name: "Light on",
    description:
      "Switches the work light on at once, without waiting for queued moves.",
    words: "",
    example: "M821",
    group: "accessories",
    machine: "runs",
  },
  // src/configZ1.default:148
  {
    code: "M822",
    name: "Light off",
    description:
      "Switches the work light off at once, without waiting for queued moves.",
    words: "",
    example: "M822",
    group: "accessories",
    machine: "runs",
  },
  // src/configZ1.default:154
  {
    code: "M831",
    name: "Tool sensor on",
    description:
      "Switches the tool sensor output on at once, without waiting for queued moves; the probe laser (M494) uses this output.",
    words: "",
    example: "M831",
    group: "accessories",
    machine: "runs",
  },
  // src/configZ1.default:155
  {
    code: "M832",
    name: "Tool sensor off",
    description:
      "Switches the tool sensor output off at once, without waiting for queued moves.",
    words: "",
    example: "M832",
    group: "accessories",
    machine: "runs",
  },
  // src/configZ1.default:160
  {
    code: "M841",
    name: "Probe charger on",
    description:
      "Switches the wireless probe charger output on at once, without waiting for queued moves; it is on at startup.",
    words: "",
    example: "M841",
    group: "accessories",
    machine: "runs",
  },
  // src/configZ1.default:161
  {
    code: "M842",
    name: "Probe charger off",
    description:
      "Switches the wireless probe charger output off at once, without waiting for queued moves.",
    words: "",
    example: "M842",
    group: "accessories",
    machine: "runs",
  },
  // src/configZ1.default:176
  {
    code: "M851",
    name: "Extend-out port on",
    description:
      "Switches the extend-out port, which drives the external extractor, on at S percent (98 without S) at once, without waiting for queued moves.",
    words: "S",
    example: "M851 S100",
    group: "accessories",
    machine: "runs",
  },
  // src/configZ1.default:177
  {
    code: "M852",
    name: "Extend-out port off",
    description:
      "Switches the extend-out port (external extractor) off at once, without waiting for queued moves.",
    words: "",
    example: "M852",
    group: "accessories",
    machine: "runs",
  },
  // src/configZ1.default:168
  {
    code: "M861",
    name: "Beeper on",
    description:
      "Switches the beeper on at once, without waiting for queued moves, until M862.",
    words: "",
    example: "M861",
    group: "accessories",
    machine: "runs",
  },
  // src/configZ1.default:169
  {
    code: "M862",
    name: "Beeper off",
    description:
      "Switches the beeper off at once, without waiting for queued moves.",
    words: "",
    example: "M862",
    group: "accessories",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2758
  {
    code: "M887",
    name: "Require homing again",
    description:
      "Turns the homing requirement back on after M888; its reply reads 'Home Check Disabled'.",
    words: "",
    example: "M887",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:2761
  {
    code: "M888",
    name: "Skip homing check",
    description:
      "Lets program playback, tool measuring, leveling, 3D probing and bed cleaning run without homing, until M887 or a restart; its reply reads 'Home Check Enabled'.",
    words: "",
    example: "M888",
    group: "settings",
    machine: "runs",
  },
  // src/modules/communication/canopen/CANOpenManager.cpp:189
  {
    code: "M940",
    name: "Report CAN bus status",
    description:
      "Reports the CANopen bus status: whether it is enabled and ready, its bit rate, node ID, role and frame counts.",
    words: "",
    example: "M940",
    group: "settings",
    machine: "runs",
  },
  // src/modules/communication/canopen/CANOpenManager.cpp:199
  {
    code: "M941",
    name: "Send CAN frame",
    description:
      "Sends a raw CAN frame: X the identifier, L the length (up to 8) and A to H the data bytes.",
    words: "X L A B C D E F G H",
    example: "M941 X513 L2 A1 B0",
    group: "settings",
    machine: "runs",
  },
  // src/modules/communication/canopen/CANOpenManager.cpp:233
  {
    code: "M941.1",
    name: "Read CAN node ID",
    description:
      "Reads a CANopen node's ID; N selects the node, otherwise the configured one.",
    words: "N",
    example: "M941.1 N1",
    group: "settings",
    machine: "runs",
  },
  // src/modules/communication/canopen/CANOpenManager.cpp:242
  {
    code: "M941.2",
    name: "Set CAN node ID",
    description:
      "Sets a CANopen node's ID to X (1 to 127), applied once the device is power-cycled; N selects the node.",
    words: "N X",
    example: "M941.2 N1 X2",
    group: "settings",
    machine: "runs",
  },
  // src/modules/communication/canopen/CANOpenManager.cpp:260
  {
    code: "M941.3",
    name: "Read CAN node baud rate",
    description: "Reads a CANopen node's baud rate; N selects the node.",
    words: "N",
    example: "M941.3 N1",
    group: "settings",
    machine: "runs",
  },
  // src/modules/communication/canopen/CANOpenManager.cpp:274
  {
    code: "M941.4",
    name: "Set CAN node baud rate",
    description:
      "Sets a CANopen node's baud rate to X, given in bits per second or as a rate code; N selects the node.",
    words: "N X",
    example: "M941.4 N1 X500000",
    group: "settings",
    machine: "runs",
  },
  // src/modules/communication/canopen/CANOpenManager.cpp:300
  {
    code: "M941.5",
    name: "Read CAN node outputs",
    description: "Reads a CANopen node's digital outputs; N selects the node.",
    words: "N",
    example: "M941.5 N1",
    group: "settings",
    machine: "runs",
  },
  // src/modules/communication/canopen/CANOpenManager.cpp:309
  {
    code: "M941.6",
    name: "Set CAN node outputs",
    description:
      "Sets a CANopen node's digital outputs to the bit mask X; N selects the node.",
    words: "N X",
    example: "M941.6 N1 X3",
    group: "settings",
    machine: "runs",
  },
  // src/modules/communication/canopen/CANOpenManager.cpp:323
  {
    code: "M941.7",
    name: "Read CAN node inputs",
    description: "Reads a CANopen node's digital inputs; N selects the node.",
    words: "N",
    example: "M941.7 N1",
    group: "settings",
    machine: "runs",
  },
  // src/modules/communication/canopen/CANOpenManager.cpp:336
  {
    code: "M942",
    name: "CAN input-output test",
    description:
      "Copies CAN node 1's digital inputs to its outputs, holds them for 10 s while the controller waits, then clears them.",
    words: "",
    example: "M942",
    group: "settings",
    machine: "runs",
  },
  // src/modules/tools/spindle/SpindleControl.cpp:25
  {
    code: "M957",
    name: "Report spindle speed",
    description:
      "Reports the spindle's state, measured and target rpm and PWM output.",
    words: "",
    example: "M957",
    group: "spindle-tool",
    machine: "runs",
  },
  // src/modules/tools/spindle/SpindleControl.cpp:30
  {
    code: "M958",
    name: "Set spindle PID",
    description:
      "Once queued moves finish, sets the spindle speed controller's P, I and D terms and reports them; the values are lost at restart.",
    words: "P I D",
    example: "M958 P0.00001 I0.00005 D0.00005",
    group: "spindle-tool",
    machine: "runs",
  },
  // src/modules/communication/GcodeDispatch.cpp:167
  {
    code: "M999",
    name: "Clear alarm",
    description:
      "Clears the alarm (halt) state after M112, a limit, a failed probe or another error; outside an alarm it does nothing. The position may be lost, so the machine should be homed.",
    words: "",
    example: "M999",
    group: "program",
    machine: "runs",
  },
  // src/modules/communication/GcodeDispatch.cpp:310
  {
    code: "M1000",
    name: "Run console command",
    description:
      "Runs the rest of the block as a console command, lowercased (M1000 VERSION runs version).",
    words: "",
    example: "M1000 VERSION",
    group: "settings",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:614
  {
    code: "A",
    name: "4th axis angle",
    description:
      "Turns the 4th axis module to an angle in degrees, absolute or relative as G90 and G91 set.",
    words: "",
    example: "G1 A90 F300",
    group: "words",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp
  {
    code: "F",
    name: "Feed rate",
    description:
      "Sets the feed rate of G1, G2 and G3 moves in mm/min, or in/min after G20. It stays until another F sets it.",
    words: "",
    example: "G1 X10 F300",
    group: "words",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:1874
  {
    code: "I",
    name: "Arc centre along X",
    description:
      "Offsets an arc's centre along X from its start. Arcs in G17 and G18 use it.",
    words: "",
    example: "G2 X10 Y0 I5 J0",
    group: "words",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:1874
  {
    code: "J",
    name: "Arc centre along Y",
    description:
      "Offsets an arc's centre along Y from its start. Arcs in G17 and G19 use it.",
    words: "",
    example: "G3 X0 Y10 I0 J5",
    group: "words",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:1874
  {
    code: "K",
    name: "Arc centre along Z",
    description:
      "Offsets an arc's centre along Z from its start. Arcs in G18 and G19 use it.",
    words: "",
    example: "G18 G2 X5 Z0 I5 K0",
    group: "words",
    machine: "runs",
  },
  // src/modules/communication/GcodeDispatch.cpp:488
  {
    code: "N",
    name: "Line number",
    description:
      "Numbers a line. The Z1 skips a whole line that starts with one, so line numbers are removed before a program is sent.",
    words: "",
    example: "N10 G1 X10",
    group: "words",
    machine: "unsupported",
  },
  // src/modules/robot/Robot.cpp:541
  {
    code: "P",
    name: "Dwell time or parameter",
    description:
      "Gives G4 its dwell in seconds, and other codes their parameter, such as the coordinate system G10 sets.",
    words: "",
    example: "G4 P1",
    group: "words",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp:1166
  {
    code: "R",
    name: "Arc radius",
    description:
      "Would give an arc by its radius, but the Z1 takes an arc's centre only from I, J and K, so an arc given by R alone has no centre.",
    words: "",
    example: "G2 X10 Y0 R5",
    group: "words",
    machine: "unsupported",
  },
  // src/modules/tools/spindle/SpindleControl.cpp
  {
    code: "S",
    name: "Spindle speed or value",
    description:
      "Sets the spindle speed in rpm, on its own or with M3. Beside other codes it is their value, such as M220's percentage or M851's duty cycle.",
    words: "",
    example: "S12000 M3",
    group: "words",
    machine: "runs",
  },
  // src/modules/tools/atc/ATCHandler.cpp:1931
  {
    code: "T",
    name: "Tool number",
    description: "Selects the tool that M6 changes to.",
    words: "",
    example: "T2 M6",
    group: "words",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp
  {
    code: "X",
    name: "X position",
    description:
      "Moves along X in mm, or inches after G20: to a position in G90, by a distance in G91.",
    words: "",
    example: "G1 X10",
    group: "words",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp
  {
    code: "Y",
    name: "Y position",
    description:
      "Moves along Y in mm, or inches after G20: to a position in G90, by a distance in G91.",
    words: "",
    example: "G1 Y10",
    group: "words",
    machine: "runs",
  },
  // src/modules/robot/Robot.cpp
  {
    code: "Z",
    name: "Z position",
    description:
      "Moves along Z in mm, or inches after G20: to a position in G90, by a distance in G91.",
    words: "",
    example: "G1 Z-1",
    group: "words",
    machine: "runs",
  },
]
