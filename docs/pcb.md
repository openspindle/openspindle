# PCB

PCB preparation turns KiCad Gerber and Excellon exports into Front, Back, Outline, Drill and Mill drill operations on a plate. It is built into OpenSpindle. [pcb2gcode](https://github.com/pcb2gcode/pcb2gcode), which you install yourself, generates programs locally. Importing, editing and generating never send commands to the machine.

Use **PCB** in the Prepare toolbar or **Add operation** to import exports. Select a PCB operation to edit its source file, tool and cutting settings in the operation inspector.

## pcb2gcode

OpenSpindle does not include pcb2gcode: install it, with [Homebrew](https://brew.sh) for example (`brew install pcb2gcode`). The converter supports pcb2gcode 3.0.4.

In **Settings › PCB**, choose the pcb2gcode executable or use automatic detection. With no chosen path, OpenSpindle checks `/opt/homebrew/bin/pcb2gcode`, then `/usr/local/bin/pcb2gcode`. It accepts an executable owned by you or root that other users cannot modify and that reports a version with `--version`. It does not search `PATH`.

A chosen executable takes precedence, including when it cannot run. Use automatic detection to clear that choice. The PCB settings and operation editor report whether conversion is ready; **Check again** checks the installation after installing or upgrading pcb2gcode. Operations keep their source files and settings while waiting for a working executable.

pcb2gcode is distributed by its authors under GPL-3.0-or-later. OpenSpindle runs it as a separate program; pcb2gcode, Homebrew and KiCad do not endorse this integration.

## Using it

Select a plate, then click **PCB** in the toolbar (or choose **PCB** in Add operation). Drop one or more KiCad exports into the importer (or choose them). Each recognized file immediately becomes an independent, pending operation on that plate (on a new project's empty plate, OpenSpindle starts a new plate with the same setup instead); two copper files create two milling operations. The importer then closes and shows the first new operation. Imported files remain saved while awaiting tool selection. The importer takes Gerber files (`.gbr`, `.ger`, `.gtl`, `.gbl`, `.gko`, `.gm1`) and Excellon drill files (`.drl`, `.xln`, and `.txt` with an Excellon header); other files are ignored. File names and Gerber X2 metadata identify copper, outline and Excellon sources; ambiguous files are imported without a type, and unrelated Gerber layers (solder mask, silkscreen and others) are ignored. At most 50 files are imported at once, each up to 8 MiB.

Select a PCB operation to open its **PCB** editor in the operation inspector. Configure its type, tool and settings there. Its **Operation** field offers what its file can make: Front, Back or Outline for a Gerber, Drill or Mill drill for a drill file. An operation whose type does not fit its file waits for its type to be chosen again. Changes to its file, tool or settings regenerate that operation's program through the local conversion service after a short pause, updating the toolpath in the 3D viewer. Only settings for that source type appear. Stock and setup belong to the plate. **Replace file** replaces the operation's source while keeping its identity; a file of another type starts over and waits for a tool. Each update regenerates only that operation, preserving its siblings. Original files, settings, generated NC and tool assignments are kept in the operation, in the workspace and in the project.

An operation stays **pending** (no program) until it has a type, a tool and every cutting value; pending operations block Run and NC export. OpenSpindle saves each program together with the settings it was generated from, using the revision of the operation it read: if the operation changed meanwhile (for example a tool assignment in the workspace), the save is refused, the editor reloads the operation and regenerates it if still needed. Tool assignments made in the workspace win: the operation follows the assigned tool, keeps its cutting values and takes the new tool's diameter. Settings changed elsewhere replace unsaved edits, and the editor says so. Automatic updates never send commands to a machine, and saved programs stay usable without a working pcb2gcode installation.

## KiCad exports and setup

Plot the layers you need as Gerber: `F.Cu`, `B.Cu` and `Edge.Cuts`. Generate an Excellon drill file with the **same plot/drill origin**. Combined drill exports and separate PTH/NPTH drill files are supported. Solder mask, silkscreen and unrelated files are ignored; ambiguous files can be assigned manually. Multiple files of the same type are separate operations, each with its own settings. Archives and `.kicad_pcb` files are not conversion inputs.

All dimensions and feeds use millimeters and mm/min. Click the operation's tool card to open OpenSpindle's tool chooser; it opens on the tool types recommended for that operation (flat, bull-nose, chamfer or engraving tools for copper; flat end mills for the outline and for milled holes; drills for drilled holes), and any tool can be chosen. After a tool, the chooser's preset step asks whether to apply one of that tool's cutting presets, offering its preset named PCB first (else one for the stock's material). **Yes** applies that preset's spindle speed, feeds and depth per pass; **No** keeps the current cutting values; cancelling keeps the current tool. There is no preset selector in the operation form. Tool geometry supplies the copper, outline or hole-milling cutter diameter. Copper depth starts at the negative preset stepdown; outline and hole-milling depth per pass use the preset stepdown directly. Values remain editable, and explicit overrides are stored separately from the generated values so preset values stay linked to the library. Cutting values absent from the preset remain blank until entered. For tapered (chamfer and engraving) tools the effective diameter follows the copper depth: tip + 2 × depth × tan(half the point angle), so a 0.1 mm, 30° tip cuts 0.148 mm wide at 0.09 mm deep; an entered diameter replaces it. Drill and outline depth start at the selected stock thickness plus 0.2 mm; confirm the final depth, including drill point length, for the intended cut. Outline and drill operations need stock assigned to their plate.

Operations map directly to pcb2gcode inputs: Front uses `--front`, Back uses `--back`, Outline uses `--outline`, and Drill and Mill drill use `--drill`. Each operation passes its own parameters. An Excellon file is a Drill or a Mill drill operation, chosen in its **Operation** field, which decides how its holes are made:

- **Drill** plunges a drill into every hole, with depth, plunge feed, spindle speed and side. Selecting a library tool does not change the operation or require its diameter to match the Excellon file. The file is passed unchanged to pcb2gcode, which takes one drill per hole size, so a file with more than one size is refused. OpenSpindle does not merge sizes or enable `--onedrill` to discard differences between them.
- **Mill drill** makes every hole with one end mill, however many sizes the file has (pcb2gcode's milldrill with `--min-milldrill-hole-diameter=0`). Holes wider than the end mill are cut as helical circles, and slots as ovals, descending by the depth per pass; holes as wide as the end mill are plunged. Holes narrower than the end mill come out at its width, and the editor warns which sizes do. The end mill supplies the tool diameter; its preset supplies feed rate, plunge feed, spindle speed and depth per pass.

A drill file with more than one hole size starts as Mill drill, since no single drill makes it; a file with one size starts as Drill. Switching between them clears the tool, since each takes another kind; replacing the file keeps the one its tool was chosen for. Each generated operation must use a single tool slot. Output with multiple slots is rejected and the operation remains pending, blocking Run and NC export while preserving its source file and settings.

The operation settings preserve the shared KiCad origin across individually generated files. **Back-side flip axis X** and the drill/outline side selectors make mirroring explicit; the editor never shifts one file to zero on its own, which would break alignment. Front and back programs require separate physical board setups and alignment. OpenSpindle's 3D viewer shows the actual generated coordinates.

OpenSpindle requests metric input/output, disables implicit `millproject` files, uses explicit drilling moves instead of `G81`, and omits `G64`/`G91.1` headers. Milled holes are `G2` arcs whose `I`/`J` centres are relative to the arc's start, the default arc mode of most controllers. pcb2gcode tool changes, pauses, spindle controls, coordinates and motion commands are preserved. It does not insert machine-specific probing, remap tool numbers or fabricate height compensation. Each program starts with comments naming OpenSpindle PCB, the toolpath and the SHA-256 of its input. Inspect compatibility with your controller before Run.

## How pcb2gcode runs

Jobs run one at a time in temporary directories inside OpenSpindle's private temporary folder, with bounded inputs (8 MiB per file), output, logs and a two-minute time limit, and with only fixed flags and checked values: no shell, configuration files or extra pcb2gcode options. Cancelling an update (for example by editing again) or quitting OpenSpindle ends its pcb2gcode process. The conversion service accepts file contents, never file paths, URLs or shell commands; the only program it runs is the one the setting names or, while it names none, the one found where Homebrew installs it (above).

## Developing

The PCB feature builds with the application:

| Path | Responsibility |
| --- | --- |
| `src/features/pcb/` | Importer, operation editor, executable settings and workspace commands. |
| `src/domain/pcb/` | Validated operation data, file recognition, cutting parameters and generation requests. |
| `src/platform/contract/pcb.ts` | Typed status, executable selection and generation RPC. |
| `electron/main/pcb/` | Executable discovery, bounded conversion and program checks. |

Generation takes `{ schemaVersion: 1, files: [{ role, name, content }], parameters }` and returns `{ schemaVersion: 1, programs: [{ name, source }], warnings }`. Invalid files, values or multi-tool output are refused. Cancellation terminates pcb2gcode; an unavailable executable leaves operations pending. Generated NC is saved with its source settings only if the operation's revision still matches.

Saved projects restore PCB operations directly, including those created by the former bundled PCB plugin. Their source files, cutting settings, NC and tool bindings remain available.

References: [pcb2gcode v3.0.4 options](https://github.com/pcb2gcode/pcb2gcode/blob/v3.0.4/src/options.cpp) and [KiCad Gerber and drill output](https://docs.kicad.org/9.0/en/pcbnew/pcbnew.html#fabrication-outputs).
