# Touch-off

A touch-off touches the stock top with a probe that touches along Z and sets work Z0 there. **Probing** on the Prepare toolbar, or **Probing** in **Add operation**, adds one to the selected plate: pick the probe, then one of the two strategies ([probing](probing.md)):

- **Surface touch**, under **Generic**, is OpenSpindle's own toolpath: a fast and a slow `G38.2` touch straight down, then `G10 L20 P0 Z0`. It probes with any probe the machine lets touch off, on the Z1 a probe that touches along Z only, in T0. It always touches with `G38.2`, also from a stored anchor and on a plate whose work origin is kept relative to one.
- **Z probe (Z1 firmware)**, under **Makera Z1 firmware**, runs the firmware's own Z probe (`M495`), which Makera Studio runs before its auto-level, and the machine reports the touch. It touches only from a stored anchor, on a plate whose work origin is kept relative to an anchor, where the touch point has work coordinates. On any other plate the picker and the inspector's **Strategy** list it unavailable and say why: "The firmware's Z probe touches only at a stored anchor: select an anchor snapshot for this plate's device." without anchors, "The firmware's Z probe touches only on a plate whose work origin is kept relative to an anchor." without such a work origin. An operation that keeps it after its placement moves to the probe position, or its plate's work origin to bed coordinates, generates no NC and says so, suggesting Surface touch.

Either way the NC is generated from the settings whenever the plate is compiled. The programs follow the firmware's own Z probe and have been checked against its source, but they have not run on a machine yet: read the [firmware background](#firmware-background) and check the work Z they set before cutting.

## Settings

| Setting          | Meaning                                                                                                                         | Range     | Default   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------- | --------- |
| Probe travel     | How far the fast touch searches down before the machine alarms (Surface touch only)                                             | 1–150 mm  | 108 mm    |
| Clearance height | The lift above the probed surface once work Z is set                                                                            | 0.5–50 mm | 5 mm      |
| Relative to      | Where the probe touches: the probe position, or one of the machine's stored anchors with X and Y from it, as for the height map |           | See below |

The ranges are the Z1's for both strategies, OpenSpindle's limits rather than a clearance check. The Z probe searches down as far as the firmware's tool rack Z (`coordinate.toolrack_z`), whatever the probe travel, so its form leaves **Probe travel** out and its NC ignores what the operation holds; switching back to Surface touch checks the stored value against its range again. Surface touch's default travel is the Z probe's search on the Z1: a probe change, or the travel to an anchor, ends near the top of Z travel, and the search has to reach the stock from there.

**Probe position** touches below the probe where it is when the operation starts; from one of the machine's [stored anchors](stored-anchors.md) it rises to machine Z −3, travels with `G53` to the anchor plus X and Y, then touches, as Makera Studio's Z probe does. A new touch-off touches the middle of the plate's work area from a stored anchor, as **Center** places it, when the plate has anchors and a work area; otherwise it touches at the probe position.

**Center**, on the placement's **Work area** row, anchors the touch point in the middle of the plate's work area, the extent of its cuts on the stock (the whole stock when the plate has no machining operations) that the height map's **Fit grid** covers: relative to the current anchor, or else the nearest one. It needs stored anchors of the plate's device; without them the row's hint names the middle to position the probe above.

The 3D view marks the touch point with a red dot in a half-opaque border, the size of the anchors' markers: at the anchored point, or with the probe position where the program leaves the probe (the last sample of a grid probed before it, or the probe's start, drawn at the work origin as probe-position grids are). Tool changes return the probe to its XY; after any other XY move the program no longer says where it is, and no dot is drawn. The probe's path to the touch is drawn green, as the firmware moves ([firmware-preview.md](firmware-preview.md)).

The probed surface always becomes work Z0, so programs that cut down from Z0 on the stock top, as CAM and pcb2gcode write them, cut at their depth whatever the stock height says. A plate with a touch-off keeps its work origin's Z on the stock top to match: opening a project, adding the operation, or changing the stock or the origin puts it back there, the origin's Z field is locked ("Touch-off sets work Z0 on the stock top."), and **Set from stock…** offers only the top. A program written with Z0 on the stock bottom would cut above the stock by its height; the stock-depth check warns that it cuts only above the stock ([workspace-model.md](workspace-model.md)).

## Surface touch

Default settings, with the Makera Wired Probe 2.0 in T0, produce:

```gcode
; Surface touch
; Touches the stock top and sets work Z0 there with G10 L20.
; REQUIRE: homed machine, installed/calibrated probe, tested probe signal.
; Position the probe above the point to touch before Run;
; it touches straight down from where the probe change leaves it.
; The probe searches at most 108 mm down; no contact alarms the machine.
; Replaces work Z of the active coordinate system.
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

The program is made of the machine's probing NC ([probing](probing.md#what-the-machine-contributes)): the probe change, the indicator, the travel to an anchor and the touch feeds and back-off are the Z1's. With a stored anchor the positioning comments are replaced by explicit travel after `M494.1`, as for the height map but without `M370`, so the compensation of an earlier height map stays active:

```gcode
; Probe placement: stored anchor "anchor-1"; firmware configuration snapshot.
; Rises to the machine's clearance before moving in X and Y; verify homing.
G53 G0 Z-3
G53 G0 X-182.4 Y-189.3
```

- `M6 T0` changes to the probe and calibrates it; Run sets no tool first, so the change and the measurement run even when the machine believes the probe is loaded ([Tool reset](device-jobs.md#transaction)). After a probe change the firmware returns to its configured clearance Z (`coordinate.clearance_z`) above the previous XY, which is why the default search covers the whole stroke, like the firmware's own.
- The fast touch searches the probe travel at 500 mm/min, the probe backs off 1 mm, and the slow touch searches 1 mm past where the fast one stopped at 100 mm/min: the Z1 configuration's speeds and back-off, as the firmware's own Z probe uses them.
- The firmware reads `G38.2` distances as relative in any distance mode; `G91` says so for every reader. No contact within the travel is `ALARM: Probe fail`, and a probe that is already triggered halts before moving.
- `G10 L20 P0 Z0` sets Z0 of the active work coordinate system at the contact. The Z1's firmware also makes the current tool, the calibrated probe, the reference for later tool lengths, so every tool change afterwards keeps that Z. G54 is saved by the firmware and stays after the job.
- `M494.1` and `M494.2` switch the probe indicator on and off, as the firmware's own Z probe does.

The explicit touches report nothing, as lines a file plays reply to a null stream, so the operation's card in the Job tab shows no touch point.

## Z probe (Z1 firmware)

From anchor 1 + X10 Y5, on a plate whose work origin is at anchor 1 + X5 Y5, default settings produce:

```gcode
; Makera Wired Probe 2.0 - auto Z-height
; The firmware's own Z probe (M495, as Makera Studio runs it) touches the stock top,
; reports the touch and sets work Z0 there.
; REQUIRE: homed machine, installed/calibrated probe, tested probe signal.
; The probe searches down as far as the firmware's tool rack Z; no contact alarms the machine.
; Replaces work Z of the active coordinate system; the firmware saves G54.
M5
G21 G90
M6 T0
; Probe placement: stored anchor "anchor-1"; firmware configuration snapshot.
; Rises to the machine's clearance before moving in X and Y; verify homing.
G53 G0 Z-3
G53 G0 X-182.4 Y-189.3
M495 X5 Y0 O0 F0
G90
G0 Z5
M2
```

The title names the probe in the plate's T0 entry. The program sets work X and Y before its operations, so the touch point is known in work coordinates, and `M495` with zero `O`/`F` offsets runs the firmware's own Z probe from there (`ATCHandler::fill_zprobe_scripts`). It rises to the clearance and goes over X Y, where the `G53` travel already is, touches fast and slowly like Surface touch, sets work Z0 at the contact (`atc.probe.probe_height_mm`, 0 in Z1 configurations) and lifts 1 mm, leaving `G91` on, which the program's `G90` undoes before it lifts to the clearance height. It switches the probe's laser itself, so the program has no `M494.1` or `M494.2`.

The firmware's routine replies to every connection, even from a played file, so the machine reports the touch (`[PRB:x,y,z:1]`) and the operation's card in the Job tab shows where it touched the stock top, at machine X and Y and at work X and Y, and the top's machine Z ([device-jobs.md](device-jobs.md#the-job-tab)).

## Sections and combining

The touches, the back-off, `G10 L20` and the lift, or the `M495` block, form one section, **Z-height probing**, in the Plates list, the G-code list and the Job timeline. When a plate combines operations, only a touch-off operation may contain these probing and work-offset codes, with T0 active and a stopped spindle: a plain NC file with them is refused.

## Order with a height grid

A height map measures heights relative to its grid's first point, while `G10 L20` sets work Z from the position without compensation. So:

- **Height map, then touch-off**: work Z is exact wherever it touches.
- **Touch-off, then height map**: work Z is exact only where the grid starts, and off by any height difference elsewhere. It starts there when both use the probe position and the height map follows directly without Pause before (`G32` starts above the point just touched), or when both use the same anchor and offset.

Otherwise the touch-off warns that a later probe grid may start elsewhere (`touch-off/before-grid`).

## Checks

Errors block Run; warnings inform. What stops the NC from being generated is the operation's error (`probing-invalid`, or `probing-probe` for the probe); the rest are rules in the [rule list](workspace-model.md#rules).

| Check                                                                                     | Id                            | Severity |
| ----------------------------------------------------------------------------------------- | ----------------------------- | -------- |
| A setting the strategy reads is missing or out of range                                   | `probing-invalid`             | error    |
| Stored anchor: no anchor snapshot for the plate's device, or the anchor is gone           | `probing-invalid`             | error    |
| An anchored touch point leaves the ±10,000 mm coordinate range                            | `probing-invalid`             | error    |
| Z probe: not from a stored anchor, or the plate's work origin is not kept relative to one | `probing-invalid`             | error    |
| T0 holds no probe the strategy runs with ([probing](probing.md#checks))                   | `probing-probe`               | error    |
| The plate holds the factory-default anchors                                               | `touch-off/factory-anchors`   | warning  |
| The plate has no stock size to check the touch point against                              | `touch-off/stock-unspecified` | warning  |
| An anchored touch point, placed on the bed as the 3D view shows it, is off the stock      | `touch-off/outside-stock`     | warning  |
| A later probe grid may start elsewhere (see above)                                        | `touch-off/before-grid`       | warning  |

Before Run, an anchored touch point needs anchors read from the connected machine, exactly like an anchored height map (`probing/anchors-…`).

## Firmware background

Sources in [Makera's Z1 firmware](https://github.com/MakeraInc/MakeraZ1Firmware/tree/b3a2e26a9eaa2b01358f74ccdef549b993a08175), by line:

- [`ATCHandler.cpp`](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/modules/tools/atc/ATCHandler.cpp): `M495` with `O`/`F` offsets runs `fill_zprobe_scripts` (2561–2569, 2615–2622), the sequence above (355–405). Setting work Z makes the current tool's calibrated length the reference (`set_ref_tool_mz`, 3183–3192); later calibrations offset from it (1917). A tool change returns to clearance Z, then to the saved XY (2827–2833).
- [`ZProbe.cpp`](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/modules/tools/zprobe/ZProbe.cpp): `probe_XYZ` (530–609) moves by the given distances, reports `[PRB:…]` and alarms without contact. Soft limits are not checked while probing (`Robot.cpp` 1496).
- [`Robot.cpp`](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/modules/robot/Robot.cpp): `G10 L2/L20` (568–641), including the tool-length reset and saving G54.
- [`CartGridStrategy.cpp`](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/modules/tools/zprobe/CartGridStrategy.cpp): grid heights relative to the first point (665–699).
- [`configZ1.default`](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/configZ1.default): `coordinate.toolrack_z` (413), `coordinate.clearance_z` (427), `atc.probe.*` feeds and retract (465–467).

Before running: home all axes; install, calibrate and test the probe; stop the spindle; with the probe position, place the probe above a point on the stock top; keep every travel clear of fixtures.

Surface touch is `src/domain/probing/generic/surface-touch.ts`, made of the Z1's probing NC and ranges in `src/domain/fixtures/makera-z1/probing-nc.ts`; the Z probe is `src/domain/fixtures/makera-z1/strategies/z-probe.ts`. The touch-off task is in `src/domain/probing/tasks/touch-off` (parameters, planning, **Center** and rules) and its settings form in `src/features/probing/touch-off-settings.tsx`. Previews find touch points in any NC file in `src/domain/fixtures/makera-z1/wired-probe/touch-off.ts`, and combining checks a touch-off's blocks in `src/domain/fixtures/makera-z1/nc-grammar.ts`.
