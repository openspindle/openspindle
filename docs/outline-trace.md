# Outline trace

Outline trace is OpenSpindle's own strategy for tracing an outline: it traces the edges of the plate's work area with a probe's laser pointer at a safe height, so the outline can be checked against the stock and fixtures before anything is cut. It is the explicit equivalent of the margin scan in the Z1 firmware's `M495` automation. **Probing** on the Prepare toolbar, or **Probing** in **Add operation**, adds one to the selected plate: pick a probe with a laser pointer, such as the Makera Wired Probe 2.0, then **Outline trace** under **Generic** ([probing](probing.md)). Its NC is generated whenever the plate is compiled.

The trace follows the firmware's own margin scan and has been checked against its source, but it has not run on a machine yet: read the [firmware background](#firmware-background) first.

It probes with a probe whose **Laser pointer** is Yes in the tool library, and the machine must let that probe trace: on the Z1, a probe that touches along Z only, in T0. The program is made of the machine's probing NC ([probing](probing.md#what-the-machine-contributes)): the machine switches the pointer on (`M494.0` on the Z1), and the ranges and defaults are the machine's. A machine that cannot switch a pointer on, or gives no ranges for the trace, does not offer it.

## What it traces

The outline is the plate's [toolpath bounds](#toolpath-bounds): where its machining operations cut, not clipped to the stock, so cuts that overhang the stock show as an outline that does too. It is derived on every compile and never goes stale. The 3D view draws the same bounds as a dashed outline on the stock, and the hint on the settings' **Outline** names the rectangle in work coordinates.

## Settings

| Setting             | Meaning                                                     | Range           | Default     |
| ------------------- | ----------------------------------------------------------- | --------------- | ----------- |
| Machine Z           | Machine Z of the trace (`G53`), clear of stock and fixtures | −102 to −1 mm   | −3 mm       |
| Trace feed          | Feed of the traced edges                                    | 100–3000 mm/min | 1000 mm/min |
| Pause after tracing | Pause after the trace to check the outline                  |                 | On          |

On the Z1 the defaults are the firmware's own: its configured clearance Z (`coordinate.clearance_z`: −3 on the Z1 Pro as Makera sets it; the published default file has −1) and margin speed (`atc.margin_rate_mm_m`). Machine Z stays within the Z the Z1 moves in: its firmware stops a move above −1 and below −102. The feeds are OpenSpindle's limits; neither range is a clearance check.

## Generated program

For cuts from X5 Y5 to X45 Y30, with the Makera Wired Probe 2.0 in T0:

```gcode
; Outline trace
; Traces the edges of the plate's work area with the probe's pointer.
; REQUIRE: homed machine, installed probe; work X/Y set to the plate's work origin.
; Outline: X5 to X45, Y5 to Y30 in work coordinates.
M5
G21 G90
M6 T0
M494.0
G53 G0 Z-3
G0 X5 Y5
G1 X5 Y30 F1000
G1 X45 Y30
G1 X45 Y5
G1 X5 Y5
; Check the outline against the stock and fixtures, then Resume or Stop.
M0
M2
```

- `M6 T0` changes to the probe. `M494.0` switches its laser on. The firmware switches it off itself after five minutes or when another tool is loaded; the program does not, because `M494` is not queued with the moves and would switch it off before the trace ran.
- The rectangle is in work coordinates, from its lower-left corner, as the firmware's margin scan: it shows where the machine will cut with the work X and Y it has, set by hand or by the plate's work origin kept relative to an anchor. The bounds are rounded outwards to hundredths.
- The pause is a standard `M0` program stop (sent as `M600`); Resume continues, Stop ends the job before it cuts.

The traced moves form one **Probe scan** section: feed moves with a probe in a probe slot (T0 or T9999) never cut, so the Plates list, the G-code list and the Job timeline name them as a scan, and the 3D view draws them in the probe's green ([firmware-preview.md](firmware-preview.md)).

## Checks

Errors block Run; warnings inform. What stops the NC from being generated is the operation's error (`probing-invalid`, or `probing-probe` for the probe); the rest are rules in the [rule list](workspace-model.md#rules).

| Check                                                                                                        | Id                        | Severity |
| ------------------------------------------------------------------------------------------------------------ | ------------------------- | -------- |
| A setting is missing or out of range                                                                         | `probing-invalid`         | error    |
| Nothing to trace: the plate has no machining operations, or they have no cutting moves                       | `probing-invalid`         | error    |
| T0 holds no probe the strategy runs with, such as one without a laser pointer ([probing](probing.md#checks)) | `probing-probe`           | error    |
| The toolpath bounds reach beyond the stock as placed                                                         | `outline/outside-stock`   | warning  |
| A machining operation runs before the trace, which then checks too late                                      | `outline/after-machining` | warning  |

## Toolpath bounds

The toolpath bounds are where a plate cuts. One definition, `plateToolpathBounds` in `src/domain/compile/toolpath-bounds.ts` (measured in `cutting-bounds.ts`), serves Outline trace, the height map's **Fit grid**, the touch-off's **Center** and the 3D view:

- A cutting move is a feed move that is neither made with a probe in a probe slot (T0 or T9999) nor probing, such as a tool's touch on the tool setter. Rapids and probe moves travel.
- A program's cutting bounds are the extent of its cutting moves. The start of the program's first move is the preview's assumed position, not a place it moves to, and does not count.
- A plate's toolpath bounds are the union over its operations outside the setup phase, each measured from its own NC, so a setup operation such as an outline trace can trace them while its plate compiles. A probing strategy measures them only when it reads them.
- The work area, which Fit grid and Center use, is those bounds on the bed within the stock, rounded outwards to hundredths, or the whole stock when the plate has no machining operations.

The 3D view outlines the bounds, and the design's snap points and selection box use them.

## Firmware background

[`ATCHandler.cpp`](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/modules/tools/atc/ATCHandler.cpp) in Makera's Z1 firmware: `M495 X Y C D` runs `fill_margin_scripts` (lines 304–340): `M494.0`, `G53 G0 Z<clearance_z>`, `G90 G0` to the start, then `G1` around the rectangle at `margin_rate` and back; the laser is left on (`M494.2` is commented out). `countdown_probe_laser` (1709–1742) switches the laser off after 300 s or as soon as a tool other than the probe is active. [`configZ1.default`](https://github.com/MakeraInc/MakeraZ1Firmware/blob/b3a2e26a9eaa2b01358f74ccdef549b993a08175/src/configZ1.default): `coordinate.clearance_z` (427), `atc.margin_rate_mm_m` (463).

Before running: home all axes, install the probe, set work X and Y (or use a work origin kept relative to an anchor), and keep the trace height clear of fixtures.

The strategy is `src/domain/probing/generic/outline-trace.ts`, made of the Z1's probing NC, with the trace's ranges, in `src/domain/fixtures/makera-z1/probing-nc.ts`. The outline task is in `src/domain/probing/tasks/outline` (parameters, planning and rules) and its settings form in `src/features/probing/outline-settings.tsx`.
