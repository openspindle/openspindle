# PCB

The PCB plugin turns KiCad Gerber and Excellon exports into Front, Back, Outline and Drill operations on a plate. It comes with OpenSpindle, and [pcb2gcode](https://github.com/pcb2gcode/pcb2gcode), which you install yourself, generates the programs on your computer: nothing is sent to a cloud service, and the plugin never talks to the machine.

The plugin has three parts:

- **Importer view** (in **Add operation** and behind the **PCB** toolbar item): drop KiCad exports to create one operation per recognized file on the plate.
- **Editor view** (in the operation inspector): edits one PCB operation's file, tool and settings and regenerates its program.
- **Companion** (a Node program OpenSpindle starts while a PCB view is open): runs pcb2gcode.

It is a plugin like any other ([plugins](plugins.md)): both views run in sandboxed plugin frames and reach the app only through the plugin API. It asks for three permissions: **Read the workspace** (plates, stock and selection), **Manage its own operations**, and **Read the tool library** (tools, cutting presets and the app's tool chooser). It has no machine access. It can be disabled in **Plugins…**, but not removed, and it updates with OpenSpindle.

## pcb2gcode

OpenSpindle does not include pcb2gcode: install it, with [Homebrew](https://brew.sh) for example (`brew install pcb2gcode`). The plugin is tested with pcb2gcode 3.0.4.

In **Plugins…**, the PCB plugin's card has a **pcb2gcode** setting. While it is empty, the plugin looks for pcb2gcode where Homebrew installs it: `/opt/homebrew/bin/pcb2gcode` (Apple silicon), then `/usr/local/bin/pcb2gcode` (Intel Macs, where builds from source install it too). It uses the first one that belongs to you or the system (owned by you or root), that no other user can change, and that runs `pcb2gcode --version` and reports a version, and the card says so: "pcb2gcode 3.0.4 at /opt/homebrew/bin/pcb2gcode, found automatically". Nothing else is searched, not even the `PATH` (apps opened from the Dock get only the system's part of it), so another account's install, or a program elsewhere, is only used when you choose it.

To use another pcb2gcode, enter its full path and choose **Save**, or choose **Choose…** and select it (the dialog shows hidden folders such as `/opt`). OpenSpindle checks that it is a program you can run and keeps the path as entered, so a link such as Homebrew's keeps working when pcb2gcode is upgraded. A path in the setting always wins, also when it does not run. The companion then restarts and runs `pcb2gcode --version`: the card shows **Ready** with the version. An empty path goes back to looking for it.

Until a pcb2gcode that runs is set or found, the companion reports that it **needs setup**, the card and the PCB editor say why, and operations wait instead of failing. After installing pcb2gcode while OpenSpindle is open, choose **Check again** in the PCB editor, or **Run setup** on the plugin's card. A program that fails `--version` or reports no version is refused the same way; a program that reports one is shown with it, so a wrong choice shows on the card.

pcb2gcode is distributed by its authors under GPL-3.0-or-later. The companion runs it as a separate program, and pcb2gcode, Homebrew and KiCad do not endorse this integration.

## Using it

Select a plate, then click **PCB** in the toolbar (or choose **PCB** in Add operation). Drop one or more KiCad exports into the importer (or choose them). Each recognized file immediately becomes an independent, pending operation on that plate (on a new project's empty plate, OpenSpindle starts a new plate with the same setup instead); two copper files create two milling operations. The importer then closes and shows the first new operation. Imported files remain saved while awaiting tool selection. The importer takes Gerber files (`.gbr`, `.ger`, `.gtl`, `.gbl`, `.gko`, `.gm1`) and Excellon drill files (`.drl`, `.xln`, and `.txt` with an Excellon header); other files are ignored. File names and Gerber X2 metadata identify copper, outline and Excellon sources; ambiguous files are imported without a type, and unrelated Gerber layers (solder mask, silkscreen and others) are ignored. At most 50 files are imported at once, each up to 8 MiB.

Select a PCB operation to open its **PCB** editor in the operation inspector. Configure its type, tool and settings there. Changes to its file, tool or settings regenerate that operation's program through the companion after a short pause, updating the toolpath in the 3D viewer. Only settings for that source type appear. Stock and setup belong to the plate. **Replace file** replaces the operation's source while keeping its identity; a file of another type starts over and waits for a tool. Each update regenerates only that operation, preserving its siblings. Original files, settings, generated NC and tool assignments are kept in the operation, in the workspace and in the project.

An operation stays **pending** (no program) until it has a type, a tool and every cutting value; pending operations block Run and NC export. The plugin saves each program together with the settings it was generated from, using the revision of the operation it read: if the operation changed meanwhile (for example a tool assignment in the workspace), the save is refused, the editor reloads the operation and regenerates it if still needed. Tool assignments made in the workspace win: the operation follows the assigned tool, keeps its cutting values and takes the new tool's diameter. Settings changed elsewhere replace unsaved edits, and the editor says so. Automatic updates never send commands to a machine, and saved programs stay usable when the companion is stopped or the plugin is disabled.

## KiCad exports and setup

Plot the layers you need as Gerber: `F.Cu`, `B.Cu` and `Edge.Cuts`. Generate an Excellon drill file with the **same plot/drill origin**. Combined drill exports and separate PTH/NPTH drill files are supported. Solder mask, silkscreen and unrelated files are ignored; ambiguous files can be assigned manually. Multiple files of the same type are separate operations, each with its own settings. Archives and `.kicad_pcb` files are not conversion inputs.

All dimensions and feeds use millimeters and mm/min. Click the operation's tool card to open OpenSpindle's tool chooser; it opens on the tool types recommended for that operation (flat, bull-nose, chamfer or engraving tools for copper; flat end mills for the outline and for milled holes; drills for drilled holes), and any tool can be chosen. After a tool, the chooser's preset step asks whether to apply one of that tool's cutting presets, offering its preset named PCB first (else one for the stock's material). **Yes** applies that preset's spindle speed, feeds and depth per pass; **No** keeps the current cutting values; cancelling keeps the current tool. There is no preset selector in the operation form. Tool geometry supplies the copper, outline or hole-milling cutter diameter. Copper depth starts at the negative preset stepdown; outline and hole-milling depth per pass use the preset stepdown directly. Values remain editable, and explicit overrides are stored separately from the generated values so preset values stay linked to the library. Cutting values absent from the preset remain blank until entered. For tapered (chamfer and engraving) tools the effective diameter follows the copper depth: tip + 2 × depth × tan(half the point angle), so a 0.1 mm, 30° tip cuts 0.148 mm wide at 0.09 mm deep; an entered diameter replaces it. Drill and outline depth start at the selected stock thickness plus 0.2 mm; confirm the final depth, including drill point length, for the intended cut. Outline and drill operations need stock assigned to their plate.

Operations map directly to pcb2gcode inputs: Front uses `--front`, Back uses `--back`, Outline uses `--outline`, and Drill uses `--drill`. Each operation passes its own parameters. A Drill operation's **Method** decides how its holes are made:

- **Drill** plunges a drill into every hole, with depth, plunge feed, spindle speed and side. Selecting a library tool does not change the operation or require its diameter to match the Excellon file. The file is passed unchanged to pcb2gcode, which takes one drill per hole size, so a file with more than one size is refused. The plugin does not merge sizes or enable `--onedrill` to discard differences between them.
- **Mill** makes every hole with one end mill, however many sizes the file has (pcb2gcode's milldrill with `--min-milldrill-hole-diameter=0`). Holes wider than the end mill are cut as helical circles, and slots as ovals, descending by the depth per pass; holes as wide as the end mill are plunged. Holes narrower than the end mill come out at its width, and the plugin warns which sizes do. The end mill supplies the tool diameter; its preset supplies feed rate, plunge feed, spindle speed and depth per pass.

A drill file with more than one hole size starts as Mill, since no single drill makes it; a file with one size starts as Drill. Changing the method clears the tool, since each method takes another kind; replacing the file keeps the method its tool was chosen for. Each generated operation must use a single tool slot. Output with multiple slots is rejected and the operation remains pending, blocking Run and NC export while preserving its source file and settings.

The operation settings preserve the shared KiCad origin across individually generated files. **Back-side flip axis X** and the drill/outline side selectors make mirroring explicit; the editor never shifts one file to zero on its own, which would break alignment. Front and back programs require separate physical board setups and alignment. OpenSpindle's 3D viewer shows the actual generated coordinates.

The plugin requests metric input/output, disables implicit `millproject` files, uses explicit drilling moves instead of `G81`, and omits `G64`/`G91.1` headers. Milled holes are `G2` arcs whose `I`/`J` centres are relative to the arc's start, the default arc mode of most controllers. pcb2gcode tool changes, pauses, spindle controls, coordinates and motion commands are preserved. It does not insert machine-specific probing, remap tool numbers or fabricate height compensation. Each program starts with comments naming the plugin version, the toolpath and the SHA-256 of its input. Inspect compatibility with your controller before Run.

## How pcb2gcode runs

Jobs run one at a time in temporary directories inside the companion's private temporary folder, with bounded inputs (8 MiB per file), output, logs and a two-minute time limit, and with only fixed flags and checked values: no shell, configuration files or extra pcb2gcode options. Cancelling an update (for example by editing again) or stopping the companion ends its pcb2gcode process. The companion accepts file contents, never file paths, URLs or shell commands; the only program it runs is the one the setting names or, while it names none, the one found where Homebrew installs it (above).

## Developing

The plugin's sources are in `plugins/pcb/`, and it builds against the plugin SDK like any plugin:

| Path                      | What it is                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `openspindle-plugin.json` | The manifest: permissions, views, toolbar item, companion and the pcb2gcode setting.           |
| `ui/`                     | The views (`definePlugin` in `ui/index.tsx`), with Tailwind CSS.                               |
| `src/companion.mjs`       | The companion (`serveCompanion`): `health`, `setup` (which looks again) and `generate`.        |
| `src/converter.mjs`       | The conversion core: request validation, pcb2gcode arguments, output checks and program notes. |
| `src/runtime.mjs`         | Finds the chosen or installed pcb2gcode and checks it, and runs programs within limits.        |
| `src/manifest.mjs`        | The recognized inputs and pcb2gcode parameters, shared by the views and the companion.         |

Every build of the app builds it (`tools/vite/bundled-plugins.ts`) into `out/plugins/pcb/`, which packaged apps carry among their resources, and the app installs it from there at start ([plugins](plugins.md#plugins-that-come-with-openspindle)). `npm run dev` builds it once as it starts, so restart it after changing the plugin. Bump the manifest's version when the plugin changes what it generates: every program names it.

The views call one companion method with `companion.call`:

| Method     | Parameters                                                           | Result                                                         |
| ---------- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| `generate` | `{ schemaVersion: 1, files: [{ role, name, content }], parameters }` | `{ schemaVersion: 1, programs: [{ name, source }], warnings }` |

Failures carry a code: `INVALID_PARAMS` for a request or file the plugin refuses (a value out of range, or a program with several tool slots, whose `data` is `{ reason: "multiple-tool-slots", slots }`), `UNAVAILABLE` when pcb2gcode cannot run, `CANCELLED` when the update is cancelled or the companion stops, and `FAILED` when pcb2gcode fails. `health` reports `ready` (with the version, and where it was found when it was), `needs-setup` (no pcb2gcode chosen or found, or the one there does not run) or `degraded`; `setup` looks for pcb2gcode again and reports its health. Operation data is `schemaVersion: 1`: the file, explicit values, generated values, tool, preset and a refusal reason.

References: [pcb2gcode v3.0.4 options](https://github.com/pcb2gcode/pcb2gcode/blob/v3.0.4/src/options.cpp) and [KiCad Gerber and drill output](https://docs.kicad.org/9.0/en/pcbnew/pcbnew.html#fabrication-outputs).
