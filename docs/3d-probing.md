# 3D probing (Z1 routines)

3D probing (Z1 routines) is the Makera Z1's strategy for finding a work origin: it finds a corner or a centre with a 3D probe and sets the work origin there, an outside or inside corner, or the centre of a pocket or of a boss, on the stock or on anything else on the bed, such as a bracket the stock is set against or a dowel pin. It runs the Z1 firmware's own 3D probing routines (`M480`), which report every contact, so the operation's card in the Job tab shows where the routine set the origin. **Probing** on the Prepare toolbar, or **Probing** in **Add operation**, adds one to the selected plate: pick a probe that touches in X, Y and Z, such as the Makera 3D Probe, then **3D probing (Z1 routines)** under **Makera Z1 firmware** ([probing](probing.md)). Its NC is generated from its settings whenever the plate is compiled.

The routines follow the firmware's source and have been checked against it, and the result the Job tab reads from the contacts matches the corner a Z1 Pro found with its inside-corner routine (`M480.8`). OpenSpindle's 3D probing programs have not run on a machine yet: read the [firmware background](#firmware-background) and check the work origin they set before cutting.

## The probe

The routines probe with a probe whose **Touches** is X, Y and Z in the tool library, and take its ball from it: the probe's diameter is the ball's diameter, which the routines take from 0.5 to 10 mm. The operation has no ball setting of its own; the inspector's **Probe** says which ball it uses on hover (`T9999 · Touches X Y Z · Ø 2 mm ball`). Correcting the probe's diameter in the tool library, or assigning another probe, changes the ball of every operation that probes with it.

The Makera 3D Probe (Makera sells it as the 3D Wired Probe) is in the Makera tool catalog and the starter library: its 1/8″ shank fitted, its Ø2 mm ruby ball on an M2 stylus, and a model drawn from Makera's product photos ([`scripts/3d-probe.mjs`](../scripts/3d-probe.mjs)). The Z1 firmware knows a 3D probe by tool number 9999: the operation changes to `T9999`, and the plate's T9999 entry holds the probe ([probing](probing.md#the-probes-slot)). Like T0, T9999 is a probe slot: only a probe may fill it, it is never renumbered, and moves made with it never cut. The firmware measures the 3D probe on the tool setter like any other tool.

Without a probe the routines can use, the operation generates no NC and shows an error (`probing-probe`) whose fix assigns a tool to T9999: when the plate's table has no T9999 entry or no tool in it, when the tool there is missing from the library, is no probe, is a probe of unknown profile or one that touches along Z only, and when the probe has no diameter or one outside 0.5–10 mm ("Makera 3D Probe in T9999 has no ball diameter: set it in the tool library, or assign another probe."). The Job tab reads a routine's result with the ball of the probe the plate's table held when the job ran; without one it shows no result.

## Routines

| Finds          | What it touches                                                                                    | Sets                                              | Firmware          |
| -------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------- |
| Outside corner | The top where it starts, then from outside the two sides at the corner, Probe depth below the top  | X0 Y0 at the corner, Z0 on the top                | `M480.1`–`M480.4` |
| Inside corner  | The top outside the corner, beyond both walls, then from inside it the two walls                   | X0 Y0 at the corner, Z0 on the top                | `M480.5`–`M480.8` |
| Pocket center  | The walls either side, from where the probe is inside the pocket                                   | X0 and Y0 midway between the walls                | `M480.9`          |
| Boss center    | The boss's top where it starts, then from outside its sides either side, Probe depth below the top | X0 and Y0 midway between the sides, Z0 on the top | `M480.10`         |

The corner subcodes run back-left, back-right, front-right and front-left, as seen from the front of the machine. A centre routine centres in X and Y, or in one of them.

## Settings

| Setting       | Meaning                                                                                                                                                                                                                        | Range     | Default        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | -------------- |
| Finds         | The routine: outside corner, inside corner, pocket center or boss center                                                                                                                                                       |           | Outside corner |
| Corner        | The corner a corner routine finds                                                                                                                                                                                              |           | Front-left     |
| Axes          | The axes a centre routine centres: X and Y, X only or Y only                                                                                                                                                                   |           | X and Y        |
| Distance X, Y | How far the probe moves out from where it starts before it comes down and touches back: past a corner's side, or past a boss's, more than half the boss plus the ball's radius; a pocket's centring searches this far each way | 2–100 mm  | 10 mm          |
| Probe depth   | How far below the top, which the probe touches first, it touches the sides (corners and bosses)                                                                                                                                | 0.5–50 mm | 2 mm           |
| Relative to   | Where the routine starts: the probe position, or one of the machine's stored anchors with X and Y from it, as for a [touch-off](touch-off.md)                                                                                  |           | Probe position |
| Z             | The height on the bed the probe comes down to over its start before the routine, like the work origin's Z; empty, it stays where the probe change or the travel leaves it                                                      |           | Empty          |

The form shows **Corner** for a corner routine and **Axes** for a centre routine, and only the distances and the depth the routine reads: a centre routine's distance in the axes it centres, and no depth for a pocket. The ranges are OpenSpindle's limits, not a clearance check; the firmware's own defaults are 20 mm distances and a 2 mm depth.

Like a touch-off, the operation takes where it starts: from the **Probe position** it runs the routine where the probe is in X and Y when the job starts (a probe change returns above it at the firmware's clearance height), and from one of the machine's [stored anchors](stored-anchors.md) it rises to machine Z −3 and travels with `G53` to the anchor plus X and Y. With a **Z**, the probe then comes down to that height on the bed, in work coordinates like the rest of the plate's program, so work Z must already be on the plate's work origin. It starts best half the distances in from an outside corner, over its top, as far out over the top from an inside corner, beyond both walls, and over the middle of a boss, whose distances then take the probe past its sides. A pocket's centring touches no top, so it needs a Z: the height on the bed at which the ball touches the pocket's walls.

The routine sets the machine's work origin where it finds the corner or centre. The plate's programs run from there, so the plate's work origin, set in its Setup as always, belongs on what the routine finds.

## Generated program

A front-left outside corner from the probe position, with the Makera 3D Probe in T9999, produces:

```gcode
; Makera 3D Probe - 3D probing: outside corner, front-left
; The firmware's corner routine (M480.4) touches the top, then the left and front sides,
; and sets work X0 Y0 at the corner and Z0 on the top.
; REQUIRE: homed machine, installed 3D probe with its cable in, tested probe signal.
; Position the probe about X5 Y5 in from the corner, over its top, before Run;
; a probe change returns above it at the firmware's clearance height.
; A search that touches nothing alarms the machine.
; Replaces work X, Y and Z of the active coordinate system; the firmware saves G54.
M5
G21 G90
M6 T9999
M480.4 D2 X10 Y10 Z2
M2
```

The title names the probe in the plate's T9999 entry. `M480.n` runs the routine with `D` the probe's ball diameter, `X` and `Y` the distances and `Z` the depth, which a pocket's centring, touching no top, does without; a centring routine skips an axis given as 0. From a stored anchor the travel of a touch-off comes before it (`G53 G0 Z-3`, then `G53 G0 X… Y…`), and with a Z, from either start, the descent to it (`G0 Z…`, its height on the bed less the work origin's).

The routine forms one **3D probing** section in the Plates list, the G-code list and the Job timeline. When a plate combines operations, only a 3D probing operation may run `M480`, with T9999 active, a stopped spindle and `G21 G90`. The 3D view draws the probe's path green as the firmware moves ([firmware-preview.md](firmware-preview.md)), and has the routine find the corner or centre where the plate's work origin is, as it belongs there.

### In the Job tab

The firmware's routines reply to every connection, even from a played file, so the machine reports each contact (`[PRB:x,y,z:1]`). The operation's card in the Job tab counts them as they come, then shows the machine X and Y where the routine set work X0 and Y0, the top it set Z0 on, and a pocket's or boss's size between the sides it touched, or that the machine stopped before the routine found it ([device-jobs.md](device-jobs.md#the-job-tab)).

## Checks

Errors block Run; warnings inform. What stops the NC from being generated is the operation's error (`probing-invalid`, or `probing-probe` for the probe and its ball); the rest are rules in the [rule list](workspace-model.md#rules).

| Check                                                                                                                                                                                                          | Id                       | Severity |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------- |
| A setting is missing or out of range                                                                                                                                                                           | `probing-invalid`        | error    |
| Stored anchor: no anchor snapshot for the plate's device, or the anchor is gone                                                                                                                                | `probing-invalid`        | error    |
| An anchored start leaves the ±10,000 mm coordinate range                                                                                                                                                       | `probing-invalid`        | error    |
| T9999 holds no 3D probe with a ball the routines take (see [the probe](#the-probe))                                                                                                                            | `probing-probe`          | error    |
| The plate holds the factory-default anchors                                                                                                                                                                    | `origin/factory-anchors` | warning  |
| A later probe grid, unless it starts from the same stored anchor and offset: the routine leaves the probe over what it found, not over the top it touched ([touch-off](touch-off.md#order-with-a-height-grid)) | `origin/before-grid`     | warning  |

The order check applies to the routines that set work Z, all but a pocket's centring. Before Run, an anchored start needs anchors read from the connected machine, exactly like an anchored height map (`probing/anchors-…`).

## Firmware background

Sources in [Makera's Z1 firmware](https://github.com/MakeraInc/MakeraZ1Firmware/tree/b3a2e26a9eaa2b01358f74ccdef549b993a08175), by line:

- [`ATCHandler.cpp`](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/modules/tools/atc/ATCHandler.cpp): `M480` (2251–2489) runs `fill_OutCorner_scripts` (545–705), `fill_InCorner_scripts` (706–874), `fill_InPocket_scripts` (876–1048) or `fill_OutPocket_scripts` (1050–1389), with defaults of a 2 mm ball, 20 mm distances and a 2 mm depth, and does nothing unless the machine is homed. Each routine touches twice, at `atc.probe.slow_rate_mm_m` (100 mm/min) and then half of it, backing off `atc.probe.retract_mm` (1 mm) between; it comes down beside a side at 10 % speed (`M220 S10`), rises back to the height it started at between the sides, and sets the work origin with `G10 L20 P0`, the ball's radius beyond the touch at a side. The corners and the boss go back over X0 Y0 at that height; a pocket's centring stays at its centre. The firmware keeps the distance mode, feed and units the program had, and leaves the speed override at 100 %. The outside corners' lines are queued and echoed like the firmware's other routines; the others run at once without an echo, their contacts still reported.
- The same file, for T9999: a change to it calibrates it on the tool setter like any tool (`fill_change_scripts` and `fill_cali_scripts`, 126–302) and switches the probe's port on (2041–2050, 2199–2210), which the main loop keeps on while it is in (3094–3099). [`ZProbe.cpp`](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/modules/tools/zprobe/ZProbe.cpp) ignores a double tap on the probe with T9999 in (`probe_doubleHit`, 255–300), and [`SpindleControl.cpp`](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/modules/tools/spindle/SpindleControl.cpp) refuses to start the spindle with a tool from 1000 up (55).
- `ZProbe.cpp`: `probe_XYZ` (530–608) moves by the given distances, reports `[PRB:…]` and alarms when nothing is touched; while the probe is not probing, a contact during a move in X or Y, or up, halts the machine (`read_probe`, 204–220).
- [`Gcode.cpp`](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/modules/communication/utils/Gcode.cpp) reads the digits after a code's point as a whole number (224), so `M480.10` is the boss's routine and `M480.1` a corner's, although both are the number 480.1; the preview reads the subcode as written.

Before running: home all axes; install the 3D probe with its cable in and test its signal; with the probe position, place the probe where the settings say; keep every travel, and the probe's cable, clear of fixtures.

The strategy (the routines' program, their ranges and the ball it takes from the probe) is `src/domain/fixtures/makera-z1/strategies/routines.ts`. The origin task is in `src/domain/probing/tasks/origin` (parameters, planning, the start, rules and the result from the contacts) and its settings form in `src/features/probing/origin-settings.tsx`. How the Z1's NC reads the routines is in `src/domain/fixtures/makera-z1/3d-probe/blocks.ts`, with the blocks combining accepts in `src/domain/fixtures/makera-z1/nc-grammar.ts` and the preview's motion in `src/domain/fixtures/makera-z1/firmware.ts`.
