# Probing

Probing operations measure with a probe from the tool library: they probe a height grid the machine compensates for, touch off the stock top and set work Z there, trace the outline of where the plate cuts, or find a corner or centre and set the work origin there. A probing operation is a probe and a strategy doing one of these tasks. Generic strategies are OpenSpindle's own toolpaths, made of the machine's probing NC; a machine adds strategies of its own for what its firmware does itself. Like every operation, a probing operation is part of a plate's program, and its NC is generated from its settings whenever the plate is compiled, so it never goes stale.

| Task        | What it does                                                        | Strategies                                                                                             |
| ----------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Height grid | Probes a grid of heights; the machine compensates later cuts for it | [Height map (Z1 firmware)](height-map.md)                                                              |
| Touch-off   | Touches the stock top and sets work Z0 there                        | [Surface touch](touch-off.md#surface-touch), [Z probe (Z1 firmware)](touch-off.md#z-probe-z1-firmware) |
| Outline     | Traces the edges of the plate's work area with a laser pointer      | [Outline trace](outline-trace.md)                                                                      |
| Origin      | Finds a corner or centre and sets the work origin there             | [3D probing (Z1 routines)](3d-probing.md)                                                              |

Surface touch and Outline trace are generic; the others are the Makera Z1's.

## Probes

A probe is a library tool whose **Tool type** is Probe. Besides its dimensions it has a profile, which decides the probing it can do: **Touches**, Z only or X, Y and Z (a 3D touch probe), and **Laser pointer**, whether it carries one, which traces without touching. Both are in the tool library's editor; a tool that becomes a probe starts as Z only without a pointer. A probe whose profile is unknown probes nothing until the tool library says what it touches. The starter library has the Makera Wired Probe 2.0 (Z only, with a laser pointer) and the Makera 3D Probe (X, Y and Z, with its Ø2 mm ball). Tools from earlier library versions gain a profile when they are read: the bundled Makera probes their catalog's, another probe numbered 9999 a 3D probe's, any other probe Z only without a pointer.

A probe is bound in the plate's tool table like any tool, and the operation's NC changes to it with `M6`, so tool changes work as for cutters: the Plates list and the Job timeline show the change, and the Job tab asks to install it ([device-jobs.md](device-jobs.md)).

## Adding a probing operation

**Probing** on the Prepare toolbar opens the **Probing** dialog; **Probing** in **Add operation** leads to the same steps, with **All sources** back to the other sources. Either adds the operation to the selected plate, or to a new one. Both are unavailable, and say why on hover, when the plate's machine has no probing or the tool library has no probe ("The tool library has no probe.").

1. **Probe** lists the library's probes. Each card says what the probe senses and carries ("Touches Z · laser pointer"), is labelled with its number when the plate's table holds it (**In T0**), and says what adding it would replace (see [the probe's slot](#the-probes-slot)). A probe of unknown profile, or one the machine has no strategy for, is unavailable and says why. **Tool library** opens the library to add or correct one.
2. Then the strategies that probe with it on the plate's machine: OpenSpindle's own under **Generic** first, then the machine's under its firmware's name (**Makera Z1 firmware**). A strategy that cannot run on the plate whatever its settings is unavailable and says why on hover. Choosing one adds its operation, named after the strategy, with its defaults fitted to the plate, and selects it. **All probes** goes back to the probes.

On the Z1 that gives:

| Probe                                        | Generic                      | Makera Z1 firmware                              |
| -------------------------------------------- | ---------------------------- | ----------------------------------------------- |
| Makera Wired Probe 2.0 (Z only, laser)       | Surface touch, Outline trace | Height map (Z1 firmware), Z probe (Z1 firmware) |
| A probe that touches Z only, without a laser | Surface touch                | Height map (Z1 firmware), Z probe (Z1 firmware) |
| Makera 3D Probe (X, Y and Z)                 |                              | 3D probing (Z1 routines)                        |

The Z1's only blocked strategy is the Z probe, which touches only from a stored anchor, on a plate whose work origin is kept relative to an anchor: without anchors of the plate's device, or without such a work origin, it is listed unavailable with the reason ([touch-off.md](touch-off.md)).

## The probe's slot

A machine's firmware may need a probe in a particular tool number. On the Z1 a probe that touches along Z only goes in T0 and a 3D probe in T9999, the firmware's own number for it. A new probing operation selects its probe by that number (on a machine that needs none, by the probe's post-processor number, or else the lowest free one) and binds it in the plate's table. T0 and T9999 are probe slots: only a probe fills them (`tool-probe-slot`), a probe fills nothing else (`tool-probe-elsewhere`), they are never renumbered, moves made with them never cut, and assigning a tool to one in the plate's tools opens the tool library on its probes.

Each slot is one entry per plate, which every operation that uses its number shares. Putting a probe there replaces what the entry held for all of them, so both places that do it say so first:

- In the picker, a probe whose slot holds another tool says on its card what adding replaces (`replaces Makera Wired Probe 2.0 in T0`), and names the plate's operations whose strategies could not probe with the new probe (`Outline trace cannot use it`). Adding puts the probe in the slot.
- In the inspector, a probe in the **Probe** list that would replace another operation's says so on hover: "Replaces Makera Wired Probe 2.0 in T0, which 1 other operation uses.", followed by the operations it leaves without a probe they run with.

Those operations then report that their probe no longer suits them (`probing-probe`, below) until another probe is assigned.

## Changing the probe and the strategy

The inspector shows a probing operation's **Probe** and **Strategy** above its task's settings.

- **Probe** lists the library's probes the strategy probes with on the machine. Its label's hint gives the number the operation selects it by, what it senses and, for 3D probing, its ball (`T9999 · Touches X Y Z · Ø 2 mm ball`). A probe the strategy cannot run with stays listed while it is bound, unavailable, so the list names it (or says **No probe**, or **Missing from the library**). Choosing another puts it in the number the machine needs it in, for every operation that uses that entry.
- **Strategy** lists the strategies of the operation's task that probe with its probe; one blocked on the plate is unavailable, with its reason. Another strategy keeps the operation's settings, which its own ranges then check, and an operation still named after its strategy takes the new one's name. A form shows only what its strategy reads: the Z probe's leaves out **Probe travel**.

## Placement

A height grid, a touch-off and a 3D probing start at a placement, edited with the fields the work origin, the stock and fixtures use. **Relative to** is the **Probe position**, or one of the stored anchors of the plate's device ([stored anchors](stored-anchors.md)), with **X** and **Y** from it in machine millimetres, up to ±10,000 mm. Factory-default anchors are marked "(default)", and an anchor the plate no longer has shows as **Unavailable anchor**. Switching to the probe position and back restores the last anchor's X and Y.

- From the **Probe position**, the operation starts where the operator leaves the probe before Run; a probe change returns above it.
- From an anchor, the program travels first, as Makera Studio's probing does: up to the clearance the machine travels at (machine Z −3 on the Z1), then over the anchor plus X and Y with `G53`. When the plate also keeps its work origin relative to an anchor, the start is known in work coordinates too, which the Z1's firmware strategies use.

3D probing also takes an optional **Z**, the height on the bed the probe comes down to before the routine; the placement keeps a height for every task, but only 3D probing offers and reads it. An outline has no placement: it traces in work coordinates. **Fit grid** ([height map](height-map.md)) and **Center** ([touch-off](touch-off.md)) place a grid or a touch point over the plate's work area. Before Run, an anchored placement needs the plate's anchors read from the connected machine ([checks](#checks)).

## What the machine contributes

How a machine probes is its fixture kit's `MachineProbing` (`FixtureKit.probing`); a kit without one offers no probing. It says:

- **Which probes may do which task** (`probes`): on the Z1, a 3D probe finds origins and a probe that touches along Z does everything else, as its firmware selects them.
- **The probe's slot** (`slot`): T0 for a Z probe and T9999 for a 3D probe on the Z1.
- **The NC generic strategies are made of** (`nc`): readying a probe (on the Z1 `M5`, `G21 G90` and `M6 T…`), switching its pointer on (`M494.0`; a machine without one runs no Outline trace), the indicator around a touch (`M494.1` and `M494.2`), the travel to an anchored start (`G53 G0 Z-3`, then `G53 G0 X… Y…`), and the touch-off's feeds and back-off (500 and 100 mm/min, 1 mm, as the Z1's configuration has them).
- **The ranges and defaults of the generic strategies it runs** (`specs`): a generic strategy is offered only on a machine that gives its ranges.
- **Its firmware's strategies** (`strategies`): on the Z1, Height map (Z1 firmware), Z probe (Z1 firmware) and 3D probing (Z1 routines).
- **How its NC reads as probing in any file** (`sections`, `readers`): sections and previews.

A strategy (`ProbingStrategy`, `src/domain/probing/strategy.ts`) has an id, stored in the operation (a generic one's is plain, `surface-touch`; a machine's is prefixed, `makera-z1/height-map`), its task, label and description. It says which machines run it (generic ones), which probe profiles it probes with, which probe tools it refuses (3D probing a ball it does not take), why it cannot run on a plate (the Z probe), its parameters' ranges and defaults on the machine, which of them it reads, a new operation's settings fitted to the plate, and its NC. A probing operation that names a strategy its plate's machine does not offer keeps its settings, shows none in the inspector and reports it (`probing-unsupported`).

## Previews

The 3D view draws probing from the NC, as the plate's machine reads it, in any program: a probing operation's or an imported file's. Planned grid samples are yellow dots on the stock top, never measured heights; a touch point is a red dot; the probe's path is green, as the machine's firmware moves ([firmware-preview.md](firmware-preview.md)). Anchored starts are drawn on the bed through the plate's anchor snapshot; starts at the probe position at the work origin. The Plates list, the G-code list and the Job timeline name the probing's sections: **Height map probing** for a grid, **Z-height probing** for a touch-off along Z, **3D probing** for the 3D probe's routines and touches, **Touch-off** for a touch that moves in X or Y, and **Probe scan** for feed moves with a probe in a probe slot.

## Checks

Errors block Run; warnings inform. A probing operation whose NC cannot be generated shows the error on the operation:

| Code                  | Why                                                                                                                                                                                                                                                                                                                                                    | Fix                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `probing-unsupported` | The plate's machine does not probe, or does not offer the operation's strategy for its task                                                                                                                                                                                                                                                            |                                                     |
| `probing-probe`       | The number the operation selects its probe by is not in the plate's table, holds no tool, a tool missing from the library, no probe or a probe of unknown profile; the strategy cannot probe with that probe, the machine does not let it do the task, it is not in the number the machine needs it in, or the strategy refuses it (3D probing's ball) | Assign a tool to the entry, else edit the operation |
| `probing-invalid`     | The strategy's first reason: a setting out of its range, an anchored placement without the plate's anchor snapshot or out of range, nothing to trace, the Z probe away from an anchor                                                                                                                                                                  | Edit the operation                                  |

For example, a 3D probe in T0 under a Surface touch reads "Surface touch: T0 holds Makera 3D Probe, but the Makera Z1 does not touch off with a probe like it: assign another probe, or correct the probe's profile in the tool library."

The rest are rules in the one [rule list](workspace-model.md#rules), by task whatever the strategy, none of them configurable:

| Rules                                                                                                                                              | Stage        | Checks                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `grid/factory-anchors`, `grid/stock-unspecified`, `grid/exceeds-stock`, `grid/outside-stock`                                                       | `operation`  | A height grid's anchors and stock ([height map](height-map.md#checks))                                                                           |
| `touch-off/factory-anchors`, `touch-off/stock-unspecified`, `touch-off/outside-stock`, `touch-off/before-grid`                                     | `operation`  | A touch-off's anchors, its point on the stock and its order with a grid ([touch-off](touch-off.md#checks))                                       |
| `outline/outside-stock`, `outline/after-machining`                                                                                                 | `operation`  | An outline beyond the stock, and traced after machining ([outline trace](outline-trace.md#checks))                                               |
| `origin/factory-anchors`, `origin/before-grid`                                                                                                     | `operation`  | A 3D probing's anchors and its order with a grid ([3D probing](3d-probing.md#checks))                                                            |
| `probing/anchors-not-read`, `probing/live-anchors-unavailable`, `probing/anchors-changed`                                                          | `run`        | An anchored placement's anchors read from the connected machine, the plate's, and still its stored anchors; each failure offers **Read anchors** |
| `height-map/no-samples`, `height-map/size-mismatch`, `height-map/missing-samples`, `height-map/outliers`, `height-map/tilted`, `height-map/uneven` | `height-map` | A height map read at the review pause ([height map](height-map.md#reviewing-the-height-map))                                                     |
| `tool-probe-slot`, `tool-probe-elsewhere`                                                                                                          | `tool`       | A probe in the probe slots and nowhere else                                                                                                      |

## Opening older projects

Projects saved before format 8, and NC files exported with their setup before [plate definition](plate-definition.md) version 7, had an operation kind of their own for each of auto-level, auto Z-height, auto-scan and 3D probing. Opening one makes each a probing operation of the task it did, with the strategy that writes the NC it wrote:

| Was           | Becomes                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto-level    | Height map (Z1 firmware); its width and depth become the grid's size, its probe point counts its points                                                        |
| Auto Z-height | Z probe (Z1 firmware) when its placement is anchored and the plate's work origin is kept relative to an anchor its snapshot holds; otherwise Surface touch     |
| Auto-scan     | Outline trace                                                                                                                                                  |
| 3D probing    | 3D probing (Z1 routines), which takes its ball from the probe in T9999 instead of its own ball diameter; its distances in X and Y become one distance per axis |

Each selects the probe slot its NC selected, T0 or, for 3D probing, T9999. An operation still named after its kind ("Auto-level", "Auto Z-height", "Auto-scan", "3D probing") is named after its strategy, as a new one is. Where the plate's table has no entry for the slot, it gains one holding the library's probe for it, as adding a program that selects that number picks it (for T0 the probe numbered 0, else one not numbered 9999, else any probe; for T9999 the probe numbered 9999), or no tool when the library has none, which the table then reports. The library is the project's own; for an exported NC file, the importing app's. Groups that held a grid's section keep it under its new name, **Height map probing**.

A notice on the plate says what to review:

- an operation whose strategy cannot probe with the probe in its entry: "Auto-scan is now Outline trace, which cannot probe with Hand-made probe in T0: assign a probe it runs with.";
- a 3D probing that was set for another ball than the T9999 probe's, or whose T9999 holds no probe from the library or a probe without a ball: "3D probing was set for a 3 mm ball; it now takes the ball of the probe in T9999, Makera 3D Probe (2 mm): assign the probe you use, or correct its ball in the tool library."

The domain's probing is `src/domain/probing`: the strategy contract and the machine's probing (`strategy.ts`), the strategies a machine offers and new operations (`strategies.ts`), the probe an operation binds (`bound-probe.ts`), placement, parameters, previews and the run rules, the generic strategies (`generic/`) and each task's parameters, planning, fitting and rules (`tasks/grid`, `tasks/touch-off`, `tasks/outline`, `tasks/origin`). Operations resolve through `src/domain/operations/kinds.ts`. The Makera Z1's probing is wired in `src/domain/fixtures/makera-z1/makera-z1.ts`, with the NC the generic strategies are made of and their ranges in `probing-nc.ts`, its firmware's strategies in `strategies/`, and how its NC reads in any file in `wired-probe/`, `3d-probe/` and `nc-grammar.ts`. The picker is `src/features/prepare/add-operation/probing-picker.tsx`, the inspector's probe and strategy `src/features/prepare/inspector/probing-choice-fields.tsx`, and the task forms and their shared fields `src/features/probing`. Opening older projects upgrades probing in `src/formats/upgrade/probing.ts` and `src/formats/upgrade/plate.ts`.
