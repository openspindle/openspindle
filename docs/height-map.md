# Height map

**Height map** is the probing strategy for a height grid: on the Makera Z1 the firmware's `G32` probes a rectangular grid and enables its height compensation, so the operations after it follow the measured surface. **Probing** on the Prepare toolbar, or **Probing** in **Add operation**, adds one to the selected plate: choose **Height map**, and the operation takes a library probe that touches along Z only, such as the Makera Wired Probe 2.0 ([probing](probing.md#adding-a-probing-operation)). Its NC is generated from its settings whenever the plate is compiled, so it can never go stale. A height map sets no work Z; a [Z surface](touch-off.md) does, exactly when it runs after the grid.

The program follows the firmware's own auto-level and has been checked against its source; the [firmware background](#firmware-background) explains it.

The grid's placement, its anchors, its stock checks and **Fit grid** belong to the height-grid task; the NC, the default settings and their ranges are those of the machine's cycle that performs the strategy, on the Z1 its auto-leveling. It probes with the probe in T0, the slot the Z1's firmware keeps for a probe that touches along Z ([probing](probing.md#the-probes-slot)).

## Settings

| Setting              | Meaning                                                                                                            | G32 | Range     | Default   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | --- | --------- | --------- |
| Width                | Grid extent along X from its start                                                                                 | `A` | 1–200 mm  | 50 mm     |
| Depth                | Grid extent along Y from its start                                                                                 | `B` | 1–200 mm  | 50 mm     |
| X probe points       | Points along X, both ends included                                                                                 | `I` | 2–15      | 5         |
| Y probe points       | Points along Y, both ends included                                                                                 | `J` | 2–15      | 5         |
| Clearance height     | Lift above the detected surface between samples, not an absolute Z                                                 | `H` | 0.5–10 mm | 2 mm      |
| Relative to          | Where the grid starts: the probe position, or one of the machine's stored anchors with X and Y from it (see below) |     |           | See below |
| Review after probing | Pause after probing to review the measured height map                                                              |     |           | On        |

The ranges are OpenSpindle's limits, not a clearance check. NC words carry at most six decimals.

- **Probe position**: position the probe above the grid's lower-left corner before Run; the grid extends towards +X and +Y.
- **A stored anchor**: the grid starts at one of the machine's [stored anchors](stored-anchors.md) plus **X** and **Y** from it (machine millimetres), as the work origin keeps its X and Y relative to one. As Makera Studio's probing does, the machine first rises to machine Z −3, the clearance Makera configures, then travels there with `G53`, then probes. X and Y are limited to ±10,000 mm, like stored anchors.

A new height map covers the plate's work area, as **Fit grid** sets it, from a stored anchor when the plate has them; otherwise it starts at the probe position with the default size.

**Fit grid**, on the **Work area** row, covers the plate's work area: its [toolpath bounds](outline-trace.md#toolpath-bounds) on the bed, clipped to the stock as placed and rounded outwards to hundredths, or the whole stock when the plate has no machining operations. It sets the width and depth, within their ranges, keeps the point counts and, with stored anchors of the plate's machine, anchors the grid's start at the area's lower-left corner: relative to the current anchor, or else Anchor 1, the bed's origin. The offset is the corner's distance from the anchor on the bed, so the `G53` travel reaches it in machine coordinates. Without anchors only the size changes, and the row's hint names the corner to position the probe above. With nothing to fit (machining without cutting moves, cuts off the stock, or neither machining operations nor stock) the button says why.

**Pick in the 3D view**, under the placement, starts the grid at a point clicked on the stock, a fixture or the bed in the 3D view, snapping to the outer corners and the middles of the stock's and the fixtures' tops unless Alt is held ([placement](probing.md#placement)): relative to the current anchor, or else Anchor 1, keeping its size. Escape, or the button again, ends picking. It needs stored anchors of the plate's device.

## Generated program

Default settings, with the Makera Wired Probe 2.0 in T0, produce:

```gcode
; Makera Wired Probe 2.0 - rectangular auto-leveling
; The firmware measures the grid and applies Z compensation.
; REQUIRE: homed machine, installed/calibrated probe, tested probe signal.
; Position probe above the lower-left grid corner; confirm initial Z and travel.
; Check firmware probe speeds, maximum travel, offsets and initial_height.
; Keep the entire grid and clearance moves within stock and clear of fixtures.
; G32 measures real heights internally and enables compensation; no work-zero is set.
M5
G21 G90
M6 T0
M494.0
; Grid extends positive X and Y from the current probe position.
G32 R1 X0 Y0 A50 B50 I5 J5 H2
; Review pause: check the measured height map (M375.1), then Resume or Stop.
M0
; Verify successful probing in the controller before any subsequent machining.
; Compensation remains active; M370 clears it when deliberately requested.
M2
```

The title names the probe in the plate's T0 entry. `M5` stops the spindle, `M6 T0` changes to that probe and calibrates it, and `M494.0` enables the probe indicator, as the firmware's own routine does. With a stored anchor, the operator-positioning comments are replaced by explicit travel:

```gcode
; Probe placement: stored anchor "anchor-1"; firmware configuration snapshot.
; Rises to the machine's clearance before moving in X and Y; verify homing and firmware initial_height.
G21 G90
; Clear previous height compensation before machine-coordinate travel.
M370
G53 G0 Z-3
G53 G0 X-187.4 Y-189.3
G32 R1 X0 Y0 A80 B60 I6 J4 H2
```

`M370` clears earlier compensation before the machine-coordinate moves. The moves are ordinary queued blocks, never `M496`'s deferred action. When the plate holds the factory-default anchors rather than ones read from the machine, the comment reads `FACTORY DEFAULT coordinates - verify against the device before Run` instead.

When the plate's program sets work X and Y before its operations, from its [work origin](plate-definition.md) kept relative to a stored anchor, or at the bed origin once the plate's anchors were read from its device ([stored anchors](stored-anchors.md#work-origin-from-an-anchor)), so the grid's start is known in work coordinates too. The firmware's own auto-leveling then probes the grid, as Makera Studio has it do: `M495` with the grid's start in work coordinates and its size, points and height (`ATCHandler::fill_autolevel_scripts` goes over X Y, where the `G53` travel already is, and runs the same `G32 R1 X0 Y0`). It switches the probe's laser itself, so `M494.0` is left out, and the introduction says the firmware reports every point and the height map. With the work origin at anchor 1 + X5 Y5, the grid above ends:

```gcode
G53 G0 Z-3
G53 G0 X-187.4 Y-189.3
M495 X0 Y0 A80 B60 I6 J4 H2
```

The firmware's routines reply to every connection, even from a played file, while the lines a file plays reply to a null stream: a `G32` in the program reports nothing, the one `M495` runs reports each point it probes (`DEBUG: X… Y… Z…`), then the height map and its spread. The Job tab's console shows those lines, and the operation's card fills in its grid from them ([device-jobs.md](device-jobs.md#the-job-tab)).

The `G32` or `M495` block forms one **Height map probing** section in the Plates list, the G-code list and the Job timeline. When a plate combines operations, only a height-grid operation may probe a grid, with T0 active, a stopped spindle and `G21 G90`; a plain NC file with a grid is refused.

## Reviewing the height map

With **Review after probing**, a standard `M0` program stop, preceded by an explanatory comment, follows the grid; the Z1 receives it as `M600` ([device-jobs.md](device-jobs.md)). While the job waits there, the Job tab reads the height map once (`M375.1`, display only: [device-height-map.md](device-height-map.md)), shows the analysis below and offers **Retry read**; **Resume** (continue the program) and **Stop** are in the job panel's toolbar. Without review the program runs on after probing.

Heights are relative compensation values, never machine Z. Rows and columns are counted from one, in the order the machine reports them.

- **Samples**: total, measured and missing counts, and the missing positions.
- **Statistics** of the measured heights: minimum, maximum, mean, median and range.
- **Grid size**: the machine's columns × rows compared with those the operation probed. A mismatch means the map may come from another probe.
- **Outliers**: a least-squares plane is fitted over the grid (G32 spacing is uniform, so it is the same plane in millimetres). Each sample's distance from the plane is compared with the median distance; its modified z-score, 0.6745 · deviation / MAD, must exceed 3.5, and the deviation 0.02 mm, below which differences are probe noise. When the MAD is zero, the 0.02 mm floor alone decides. Fewer than five samples yield no outliers. Scoring distances from the plane keeps a tilted bed from hiding a spike.
- **Surface**: the plane refitted without outliers gives the **tilt**, the height change it explains across the grid, and the **flatness**, the peak-to-valley deviation from it.
- **Verdict**: unreliable when nothing was measured, the grid size differs, samples are missing or stand out; otherwise uneven when the flatness exceeds 0.1 mm, else flat.

Each finding is a height-map rule in the [rule list](workspace-model.md#rules), and the review lists their failures in list order, errors first, then `height-map/flat` for a surface within the tolerance:

| Rule                         | Finding                                                    | Severity |
| ---------------------------- | ---------------------------------------------------------- | -------- |
| `height-map/no-samples`      | The machine reported no measured heights                   | error    |
| `height-map/size-mismatch`   | The machine's grid is not the one the operation probes     | error    |
| `height-map/missing-samples` | Points without a measured height                           | error    |
| `height-map/outliers`        | Points that stand out from the fitted surface              | error    |
| `height-map/tilted`          | The surface tilts by more than 0.1 mm across the grid      | warning  |
| `height-map/uneven`          | The peak-to-valley deviation from the plane exceeds 0.1 mm | warning  |

The thresholds are defaults for PCB work, not firmware values. The Device page's **Measured heights** shows the same grid and statistics.

## Checks

Errors block Run; warnings inform. What stops the NC from being generated is the operation's error (`probing-invalid`, or `probing-probe` for the probe); the rest are rules in the [rule list](workspace-model.md#rules).

| Check                                                                                           | Id                       | Severity |
| ----------------------------------------------------------------------------------------------- | ------------------------ | -------- |
| A setting is missing or out of range                                                            | `probing-invalid`        | error    |
| Stored anchor: no anchor snapshot for the plate's device, or the anchor is gone                 | `probing-invalid`        | error    |
| An anchored grid leaves the ±10,000 mm coordinate range                                         | `probing-invalid`        | error    |
| T0 holds no probe the strategy runs with ([probing](probing.md#checks))                         | `probing-probe`          | error    |
| The plate holds the factory-default anchors                                                     | `grid/factory-anchors`   | warning  |
| The plate has no stock size to check against                                                    | `grid/stock-unspecified` | warning  |
| The grid is wider or deeper than the stock                                                      | `grid/exceeds-stock`     | error    |
| An anchored grid, placed on the bed as the 3D view shows it, extends beyond the stock as placed | `grid/outside-stock`     | warning  |

A grid at the probe position needs nothing from the machine. An anchored grid needs, before Run, anchors read from the connected machine, which must be the plate's machine, and they must still match its current stored anchors (`probing/anchors-not-read`, `probing/live-anchors-unavailable`, `probing/anchors-changed`). Otherwise the run checklist offers **Read anchors**, since the NC follows the anchors the plate holds.

## Firmware background

`G32 R1 X… Y… A… B… I… J… H…` probes a rectangular grid: A/B are its width (X) and depth (Y) in millimetres, I/J the endpoint-inclusive point counts, and H the lift above the initially detected surface between samples, not an absolute Z. R1 makes the X/Y offsets relative to the current probe position; the grid extends toward positive X and Y. The firmware measures the surface itself and enables its compensation transform; the program sets no work-zero and saves no map. Between samples the probe keeps H above the surface it first touched; at each sample it probes down and returns to that height. The 3D view shows the planned samples, never measured heights: yellow dots in a half-opaque border lying on the stock top, the size of the anchors' markers or smaller on dense grids. The probe's path is drawn green as the firmware moves, from the probe change on ([firmware-preview.md](firmware-preview.md)): over the grid's start, a fast touch and back up, down to H above the touch, then every sample in turn, touching the stock top, or a fixture where one stands under the sample; a fixture rising above that height at a sample ends the path there, as the probe would meet it and halt the machine. `G32` is deliberately not interchangeable with `G29`, a reporting scan in this firmware. Compensation remains active; `M370` clears it when deliberately requested.

The program selects the firmware's leveling probe with a combined `M6 T0`. The firmware skips a change to the tool it believes is loaded, so Run first sets no tool ([Tool reset](device-jobs.md#transaction)): the Z1 always runs its manual tool-change and calibration sequence, and file playback waits for it; confirm the installed probe with **Confirm** in the Job tab's **Change tool** dialog, **Confirm installed** in its toolbar, **Tool installed** on the Device page or the machine's button. `M494.0` enables the probe indicator, as the firmware's own auto-level routine does. The plate's T0 entry holds the probe, and the Plates list and the Job timeline show the T0 change.

Before running: verify the firmware and configuration support the rectangular grid strategy; home all axes; install, calibrate and test the probe; stop the spindle; position the probe above the first grid corner (probe-position placement); check initial Z, the configured `initial_height`, offsets, feed rates, maximum probe travel and the configured grid capacity (15 × 15 by default). Keep the whole rectangle and every clearance move clear of fixtures and within reachable stock: the setting ranges are application limits and cannot verify physical clearance. Confirm successful probing in the machine controller before any machining. The command profile is based on the Z1 firmware below, not a claim of compatibility with every machine.

Primary sources:

- [Makera wired Probe V2.0 product](https://www.makera.com/products/makera-wired-probe-v2-0) identifies its probing/leveling purpose and supported product families.
- [Makera's Z1 manual](https://wiki.makera.com/Z1/Manual) describes installing the wired probe and checking its signal.
- [Official CartGridStrategy.cpp](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/modules/tools/zprobe/CartGridStrategy.cpp): `handleGcode`, `findBed`, `doProbe` and `setAdjustFunction` establish G31/G32 probing, R1, XYAB/IJ/H and compensation behaviour.
- [Official ATCHandler.cpp](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/modules/tools/atc/ATCHandler.cpp): `M495` (changing to the probe first when another tool is in) fills `fill_autolevel_scripts`, which emits `G32R1X0Y0A...B...I...J...H...`, and `on_main_loop` echoes each script line to every connection and runs it with them as its stream.
- [Official ZProbe.cpp](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/modules/tools/zprobe/ZProbe.cpp): configured probe feed/travel and trigger handling; `doProbeAt` moves over a sample at the current height, and `run_probe_return` probes down and returns to it.

The strategy is `height-map` in `src/domain/probing/strategies.ts`; the Z1's auto-leveling cycle that performs it (the `G32` and `M495` programs and the grid's ranges) is `src/domain/fixtures/makera-z1/strategies/height-map.ts`. The height-grid task is in `src/domain/probing/tasks/grid` (parameters, planning, **Fit grid**, rules and the height-map analysis), its settings form in `src/features/probing/grid-settings.tsx` and the review panel in `src/features/probing/height-map-review.tsx`, with the placement fields and form helpers every probing task shares in `src/features/probing`. Previews find grids in any NC file with the firmware's sample order in `src/domain/fixtures/makera-z1/wired-probe/grid.ts`; the probe's blocks read as sections in `wired-probe/blocks.ts`, and combining checks them in `nc-grammar.ts`.
