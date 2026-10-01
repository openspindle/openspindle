# Design rules

Design rules are what a plate's program is checked against, as a PCB editor checks a board against its design rules. **Check design rules** (the shield on the Prepare toolbar) checks the selected plate, and the Job tab checks the plate before Run. **Workspace settings** (beside the shield) sets the rules. The rules belong to the project: they are saved in the project file, kept when the window reloads, and changing them is an unsaved change. A project keeps only what it sets differently from a rule's default, so a rule it does not set takes its default; a setting for a rule this version does not know, saved by a newer one, is kept as it is and not checked.

Each rule is reported as an **Error** or a **Warning**, or not at all (**Ignore**). An error blocks Run (**Design rules met** in the run checklist); a warning does not. Nothing blocks NC export, and checking sends nothing to a machine.

The design rules are the rules a project sets: the move rules and the program rules, which the project keeps by their ids ([rules](workspace-model.md#rules)).

## Move rules

| Rule                          | Id                              | What breaks it                                                                                       | Default              |
| ----------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------- |
| Max cutting feed              | `max-cutting-feed`              | A cutting move faster than the limit                                                                 | 2000 mm/min, warning |
| Max plunge rate               | `max-plunge-rate`               | A cutting move going down faster than the limit: a straight plunge at its feed, a ramp at part of it | 300 mm/min, warning  |
| Max cut depth                 | `max-cut-depth`                 | A cut reaching further below the stock top than the limit, in total (not per pass)                   | 3 mm, warning        |
| Max depth under the stock     | `max-depth-under-stock`         | A cut reaching further below the stock bottom than the limit, into what the stock lies on            | 0.3 mm, warning      |
| Spindle stopped while cutting | `spindle-stopped-while-cutting` | A cutting move while the spindle is stopped (`M5`, or no `M3`/`M4` yet), or turns without a speed    | warning              |
| Rapid move into the stock     | `rapid-into-stock`              | A rapid move (`G0`) into the stock                                                                   | warning              |

Limits are from 1 to 100,000 mm/min for feeds and from 0 to 1,000 mm for depths. Feeds are the feeds the moves run at, `M220` overrides included.

## Program rules

Program rules find what the plate's machine would not run as written in each operation's own NC, or should not run from a program at all, and suggest a fix that keeps the program's line numbers. Each operation starts with the spindle speed the operations before it leave set. Importing a program asks how to resolve what they find ([importing](step-nc-projects.md#usage)); a rule set to Ignore is not asked about. The Job tab's console holds a typed line to the connected machine's program rules the project reports as errors, as they block Run: a line that breaks one is not sent, and the field says why.

| Rule                                     | Id                     | Machine   | Default | Suggested fix                                                   |
| ---------------------------------------- | ---------------------- | --------- | ------- | --------------------------------------------------------------- |
| Spindle speed not set                    | `spindle-speed`        | any       | warning | Start the spindle at the speed set before it, when there is one |
| Spindle reverse (M4)                     | `spindle-reverse`      | Makera Z1 | error   | Replace with `M3`                                               |
| Relative arc centres (G91.1)             | `relative-arc-centres` | Makera Z1 | error   | Drop `G91.1`                                                    |
| Absolute arc centres (G90.1)             | `absolute-arc-centres` | Makera Z1 | error   | Give each arc its centre as an offset, and drop `G90.1`         |
| Arcs given by a radius (R)               | `radius-arcs`          | Makera Z1 | error   | Replace `R` with `I`, `J` and `K`                               |
| Mode cancels (G40, G49, G80)             | `mode-cancels`         | Makera Z1 | warning | Drop them                                                       |
| Tool length offsets (G43)                | `tool-length-offsets`  | Makera Z1 | warning | Drop `G43` and `H`                                              |
| Cutter compensation (G41, G42)           | `cutter-compensation`  | Makera Z1 | warning | Drop `G41`, `G42` and `D`                                       |
| Erase stored tool data (M498.2)          | `erase-stored-data`    | Makera Z1 | error   | Drop `M498.2`                                                   |
| Firmware commands (rm, config-set, play) | `firmware-commands`    | Makera Z1 | error   | Remove the commands, leaving their lines empty                  |

`M498.2` zeroes the tool number, the tool lengths and the G54 offsets the Z1 saves, so the work zero and the tool reference that probing set are lost. The firmware commands are the Z1's own commands that delete or rename files on its storage (`rm`, `mv`), change or reload the settings it stores or its factory settings (`config-set`, `config-load`, `fset`), start firmware update mode (`dfu`) or play a file outside Run (`play`).

Hovering a rule's name in the settings says why.

## What is measured

The move rules are checked on the plate's program as it runs: every operation combined, in order, with the plate's tool numbers.

- **Where the stock is.** Heights are measured from the plate's work origin against the stock as placed on the plate. Only the part of a move over the stock counts, widened by the radius of the tool making it (the library tool its tool number holds), so a tool whose side reaches the stock's edge counts too. Moves beside the stock, such as travel to a tool change, do not count.
- **Without stock**, the stock is taken to reach down from the program's Z0 over the area the program cuts, and Max depth under the stock is not checked; the results say so.
- **Cutting moves** are feed moves (`G1`, `G2`, `G3`) that reach below the stock top. The probes' moves (T0, and the 3D probe's T9999) do not cut, and a move straight up (a retract) leaves through what the tool has cut, so none of these count.
- **Rapid moves** count when they end below the stock top or travel sideways below it; a rapid straight up out of a cut does not.
- **Lifts to the clearance.** A move in machine coordinates is not in the program's work coordinates. After one that moves Z alone (`G53 G0 Z…`, which the combined program makes between operations and before it ends), and at the start of the program, the tool is taken to be at the machine's clearance: moves that keep Z travel above the stock, and the first move that sets Z comes down from there.
- **Operations that do not compile** (for example a PCB operation that has not generated its NC) are not in the program. The results say their moves are not checked; the program rules still read their NC.

The check does not model material already removed: a move into a pocket that an earlier move cleared counts as a move into the stock.

## Results

The results stay over the 3D view until closed. They name the plate and count the errors and warnings, then list each problem under its rule: **Problem:** what breaks it and where (the worst value against the limit and how many lines break it, or the lines a program rule found, numbered as in the operation's own NC), and **Suggested:** how to fix it. **Apply** makes a program rule's fix in an NC file's program, which can be undone; PCB operations show the suggestion only. **Show** selects the operation, highlights those lines in the 3D view and marks where the worst move ends (for a program rule, where the tool is at its first line), panning to it when it is out of view; selecting program sections in the plate list highlights them instead.

When the plate or the rules change after a check, the results are marked **Out of date** and Apply and Show are unavailable: **Check again** (the arrow) checks the plate again. Removing the plate closes its results.

Before Run, **Design rules met** lists the first problems the same way, and **Show in Prepare** opens the results.
