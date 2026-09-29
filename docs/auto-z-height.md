# Auto Z-height

Auto Z-height touches the stock top with the wired probe and sets work Z0 there. From a stored anchor, with the plate's work origin kept relative to one, it runs the firmware's own Z probe (`M495`), which Makera Studio runs before its auto-level, and the machine reports the touch; otherwise it runs the same touches as explicit `G38.2` blocks and sets work Z0 with `G10 L20 P0 Z0`. **Auto Z-height** on the Prepare toolbar, next to Auto-level, or in **Add operation** adds one to the selected plate. Like [auto-level](auto-level.md) it is a built-in operation: its NC is generated from its settings whenever the plate is compiled.

The program follows the firmware's own Z probe and has been checked against its source, but it has not run on a machine yet: read the [firmware background](#firmware-background) and check the work Z it sets before cutting.

As with [auto-level](auto-level.md), the operation is machine-neutral and its NC, defaults and ranges are the machine's probe's; this page describes the Makera Z1's wired Probe 2.0.

## Settings

| Setting          | Meaning                                                                                                                     | Range     | Default   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- | --------- | --------- |
| Probe travel     | Longest downward search of the fast touch; the firmware's own Z probe searches to its `coordinate.toolrack_z`               | 1–150 mm  | 108 mm    |
| Clearance height | The lift above the probed surface afterwards                                                                                | 0.5–50 mm | 5 mm      |
| Relative to      | Where the probe touches: the probe position, or one of the machine's stored anchors with X and Y from it, as for auto-level |           | See below |

The ranges are OpenSpindle's limits, not a clearance check. **Probe position** touches below the probe where it is when the operation starts; from one of the machine's [stored anchors](stored-anchors.md) it rises to the probe's travel height (machine Z −3 on the Z1), travels with `G53` to the anchor plus X and Y, then touches, as Makera Studio's Z probe does. A new auto Z-height touches the middle of the plate's work area from a stored anchor, as **Center** places it, when the plate has anchors and cuts; otherwise it touches at the probe position.

The 3D view marks the touch point with a red dot in a half-opaque border, the size of the anchors' markers: at the anchored point, or with the probe position where the program leaves the probe (the last sample of a grid probed before it, or the probe's start, drawn at the work origin as probe-position grids are). Tool changes return the probe to its XY; after any other XY move the program no longer says where it is, and no dot is drawn. The probe's path to the touch is drawn green, as the firmware moves ([firmware-preview.md](firmware-preview.md)).

The probed surface always becomes work Z0, so programs that cut down from Z0 on the stock top, as CAM and pcb2gcode write them, cut at their depth whatever the stock height says. A plate with an auto Z-height keeps its work origin's Z on the stock top to match: opening a project, adding the operation, or changing the stock or the origin puts it back there, the origin's Z field is locked, and **Set from stock…** offers only the top. A program written with Z0 on the stock bottom would cut above the stock by its height; the stock-depth check warns that it cuts only above the stock ([workspace-model.md](workspace-model.md)).

The fast and slow feeds and the back-off between the touches are the Z1 configuration's (500 and 100 mm/min, 1 mm), as the firmware's own Z probe uses them.

**Center** anchors the touch point in the middle of the plate's work area, the extent of its cuts on the stock (the whole stock when the plate has no machining operations) that auto-level's **Fit grid** covers: relative to the current anchor, or else the nearest one. It needs stored anchors of the plate's machine; without them the settings name the middle to position the probe above.

## Generated program

Default settings produce:

```gcode
; Makera wired Probe 2.0 - auto Z-height
; Touches the stock top and sets work Z0 there with G10 L20.
; REQUIRE: homed machine, installed/calibrated probe, tested probe signal.
; Position the probe above the point to measure before Run;
; a probe change returns to the firmware's clearance Z above it.
; The probe searches at most 108 mm down; no contact alarms the machine.
; Replaces work Z of the active coordinate system; the firmware saves G54.
M5
G21 G90
M6 T0
M494.1
; Touch fast, back off, touch again slowly (relative G38.2 distances).
G91
G38.2 Z-108 F500
G0 Z1
G38.2 Z-2 F100
G90
; The probed surface is the stock top: work Z0.
G10 L20 P0 Z0
G0 Z5
M494.2
M2
```

With a stored anchor the positioning comments are replaced by explicit travel, as for auto-level but without `M370`, so the compensation of an earlier auto-level stays active:

```gcode
; Probe placement: stored anchor "anchor-1"; firmware configuration snapshot.
; Rises to the machine's clearance before moving in X and Y; verify homing.
G53 G0 Z-3
G53 G0 X-182.4 Y-189.3
```

With the work origin kept relative to a stored anchor too, the program sets work X and Y before its operations, so the touch point is known in work coordinates, and the firmware's own Z probe touches instead (`ATCHandler::fill_zprobe_scripts`, run by `M495` with zero `O`/`F` offsets from X Y). It rises to the clearance and goes over X Y, where the `G53` travel already is, touches fast and slowly like the program above, sets work Z0 at the contact (`atc.probe.probe_height_mm`, 0 in Z1 configurations) and lifts 1 mm, leaving `G91` on; it switches the probe's laser itself. With the work origin at anchor 1 + X5 Y5:

```gcode
G53 G0 Z-3
G53 G0 X-182.4 Y-189.3
M495 X5 Y0 O0 F0
G90
G0 Z5
```

The firmware's routine replies to every connection, even from a played file, so the machine reports the touch (`[PRB:x,y,z:1]`) and the Job tab's Auto Z-height card shows where it touched the stock top ([device-jobs.md](device-jobs.md#the-job-tab)); the explicit touches report nothing, as lines a file plays reply to a null stream.

- `M6 T0` selects and calibrates the probe; Run sets no tool first, so the change and the measurement run even when the machine believes the probe is loaded ([Tool reset](device-jobs.md#transaction)). After a probe change the firmware returns to its configured clearance Z (`coordinate.clearance_z`) above the previous XY, which is why the default search covers the whole stroke, like the firmware's own.
- The firmware reads `G38.2` distances as relative in any distance mode; `G91` says so for every reader. No contact within the travel is `ALARM: Probe fail`, and a probe that is already triggered halts before moving.
- `G10 L20 P0 Z0` sets Z0 of the active work coordinate system at the contact. The firmware also makes the current tool, the calibrated probe, the reference for later tool lengths, so every tool change afterwards keeps that Z. G54 is saved by the firmware and stays after the job.
- `M494.1` and `M494.2` switch the probe indicator on and off, as the firmware's own Z probe does.

The touches, the back-off, `G10 L20` and the lift form one section, **Z-height probing**, in the Plates list, the G-code list and the Job timeline. When a plate combines operations, only the built-in probing operations may contain these probing and work-offset codes: a plain NC file with them is refused.

## Order with auto-level

Auto-level measures heights relative to its grid's first point, while `G10 L20` sets work Z from the position without compensation. So:

- **Auto-level, then auto Z-height**: work Z is exact wherever it touches.
- **Auto Z-height, then auto-level**: work Z is exact only where the grid starts, and off by any height difference elsewhere. It starts there when both use the probe position and the auto-level follows directly without Pause before (`G32` starts above the point just touched), or when both use the same anchor and offset.

Otherwise the operation warns that a later auto-level may start its grid elsewhere.

## Checks

Errors block Run; warnings inform.

| Check                                                                                | Severity |
| ------------------------------------------------------------------------------------ | -------- |
| A setting is missing or out of range                                                 | error    |
| Stored anchor: no anchors for the plate's machine, or the anchor is gone             | error    |
| An anchored touch point leaves the ±10,000 mm coordinate range                       | error    |
| The plate holds the factory-default anchors                                          | warning  |
| The plate has no stock size to check the touch point against                         | warning  |
| An anchored touch point, placed on the bed as the 3D view shows it, is off the stock | warning  |
| A later auto-level may start its grid elsewhere (see above)                          | warning  |

Before Run, an anchored touch point needs anchors read from the connected machine, exactly like an anchored auto-level grid.

## Firmware background

Sources in [Makera's Z1 firmware](https://github.com/MakeraInc/MakeraZ1Firmware/tree/b3a2e26a9eaa2b01358f74ccdef549b993a08175), by line:

- [`ATCHandler.cpp`](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/modules/tools/atc/ATCHandler.cpp): `M495` with `O`/`F` offsets runs `fill_zprobe_scripts` (2561–2569, 2615–2622), the sequence above (355–405). Setting work Z makes the current tool's calibrated length the reference (`set_ref_tool_mz`, 3183–3192); later calibrations offset from it (1917). A tool change returns to clearance Z, then to the saved XY (2827–2833).
- [`ZProbe.cpp`](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/modules/tools/zprobe/ZProbe.cpp): `probe_XYZ` (530–609) moves by the given distances, reports `[PRB:…]` and alarms without contact. Soft limits are not checked while probing (`Robot.cpp` 1496).
- [`Robot.cpp`](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/modules/robot/Robot.cpp): `G10 L2/L20` (568–641), including the tool-length reset and saving G54.
- [`CartGridStrategy.cpp`](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/modules/tools/zprobe/CartGridStrategy.cpp): grid heights relative to the first point (665–699).
- [`configZ1.default`](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/configZ1.default): `coordinate.toolrack_z` (413), `coordinate.clearance_z` (427), `atc.probe.*` feeds and retract (465–467).

Before running: home all axes; install, calibrate and test the probe; stop the spindle; with the probe position, place the probe above a point on the stock top; keep every travel clear of fixtures.

The code is in `src/domain/auto-z-height`, the settings form in `src/features/auto-z-height` (its placement fields and form helpers shared with auto-level and auto-scan through `src/features/probing`), and the Makera Z1's touch-off (program, motion and settings) in `src/domain/fixtures/makera-z1/wired-probe/touch-off.ts`, with the blocks combining accepts in a touch-off in `src/domain/fixtures/makera-z1/nc-grammar.ts`.
