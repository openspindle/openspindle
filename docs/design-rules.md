# Design rules

Design rules are limits a plate's program is checked against, as a PCB editor checks a board against its design rules. **Check design rules** (the shield on the Prepare toolbar) checks the selected plate; **Workspace settings** (beside it) sets the rules. The rules belong to the project: they are saved in the project file, kept when the window reloads, and changing them is an unsaved change. A new project, and a project saved before design rules existed, starts with the defaults.

The check only reports. It never blocks Run or NC export, and nothing is sent to a machine.

## Rules

Each rule is reported as an **Error** or a **Warning**, or not at all (**Ignore**).

| Rule                          | What breaks it                                                                                       | Default              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------- |
| Max cutting feed              | A cutting move faster than the limit                                                                 | 2000 mm/min, warning |
| Max plunge rate               | A cutting move going down faster than the limit: a straight plunge at its feed, a ramp at part of it | 300 mm/min, warning  |
| Max cut depth                 | A cut reaching further below the stock top than the limit, in total (not per pass)                   | 3 mm, warning        |
| Max depth under the stock     | A cut reaching further below the stock bottom than the limit, into what the stock lies on            | 0.3 mm, error        |
| Spindle stopped while cutting | A cutting move while the spindle is stopped (`M5`, or no `M3`/`M4` yet), or turns without a speed    | error                |
| Rapid move into the stock     | A rapid move (`G0`) into the stock                                                                   | error                |

Limits are from 1 to 100,000 mm/min for feeds and from 0 to 1,000 mm for depths. Feeds are the feeds the moves run at, `M220` overrides included.

## What is measured

The check reads the plate's program as it runs: every operation combined, in order, with the plate's tool numbers.

- **Where the stock is.** Heights are measured from the plate's work origin against the stock as placed on the plate. Only the part of a move over the stock counts, widened by the radius of the tool making it (the library tool its tool number holds), so a tool whose side reaches the stock's edge counts too. Moves beside the stock, such as travel to a tool change, do not count.
- **Without stock**, the stock is taken to reach down from the program's Z0 over the area the program cuts, and Max depth under the stock is not checked; the results say so.
- **Cutting moves** are feed moves (`G1`, `G2`, `G3`) that reach below the stock top. The probe's moves (T0) do not cut, and a move straight up (a retract) leaves through what the tool has cut, so none of these count.
- **Rapid moves** count when they end below the stock top or travel sideways below it; a rapid straight up out of a cut does not.
- **Lifts to the clearance.** A move in machine coordinates is not in the program's work coordinates. After one that moves Z alone (`G53 G0 Z…`, which the combined program makes between operations and before it ends), and at the start of the program, the tool is taken to be at the machine's clearance: moves that keep Z travel above the stock, and the first move that sets Z comes down from there.
- **Operations that do not compile** (for example a plugin operation that has not generated its NC) are not in the program. The results name them as not checked.

The check does not model material already removed: a move into a pocket that an earlier move cleared counts as a move into the stock.

## Results

The results stay over the 3D view until closed. They name the plate and count the errors and warnings, then list each rule that an operation breaks: its worst value against the limit, how many of the operation's lines break it, and the line of the worst one (the first, for the spindle), numbered as in the operation's own NC. **Show** selects the operation, highlights those lines in the 3D view and marks where the worst move ends, panning to it when it is out of view; selecting program sections in the plate list highlights them instead.

When the plate or the rules change after a check, the results are marked **Out of date** and Show is unavailable: **Check again** (the arrow) checks the plate again. Removing the plate closes its results.
