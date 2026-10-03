# OpenSpindle

OpenSpindle is a desktop app for preparing, checking and running jobs on a Makera Z1 CNC machine. Nothing moves the machine until you run a job or use a control, and every command is checked against what the machine reports.

![The Job tab running a PCB job on a Z1: the run's stages, the 3D view with the machine's camera feed, the G-code as the machine receives it and the console](docs/images/job.webp)

> [!WARNING]
> OpenSpindle is early ALPHA software for a machine that can hurt you and itself. Some features have not run on a real Z1 yet: see [Status and safety](#status-and-safety). Review every program before you run it, and keep the machine's emergency stop within reach.

## Features

- Plates on a 3D model of the Z1's bed, each with its stock, fixtures, work origin and tool table, drawn as Smooth Shades or as Shaded Edges with fine edge lines
- Fixtures: the MDF bed, L-brackets, top clamps, dowel pins and 4th axis, or your own STEP and GLB models, each drawn as what it is made of
- Placement relative to the machine's stored anchors, with move, snap and lock in the 3D view
- Import of `.nc`, `.cnc`, `.gcode`, `.tap` and `.ngc` programs from your CAM, Finder or Explorer, split into operations by tool or toolpath
- Discover NC programs in Fusion 360, import them directly through the installable Python add-in, and update imported operations from them
- Probing chosen by what it does, each strategy pictured as it probes, with a probe from your tool library that can do it: Z surface sets work Z on the stock top, Height map compensates later cuts for an uneven surface, and Outline trace traces where the plate cuts, or the edges you choose, with the probe's laser
- The work origin found with the Makera 3D Probe: Outside corner, Inside corner, Pocket center or Boss center, on the stock or on a bracket or anything else on the bed, from a start picked in the 3D view that snaps to the corners, holes and centres there
- Design rules that catch what the Z1 would not run as written, with fixes, checked before Run and marked where they are in the 3D view
- Playback of the program as the firmware runs it, timed as the Z1's planner would move it by the machine's own limits, with how long it takes and the depth and width of cut
- The G-code exactly as the machine receives it, and a glossary of the Z1's codes (**Help › G-code Glossary**)
- A run checklist, upload read-back and large programs sent in parts
- The job followed live in the 3D view, with the moves ahead, where the probe touches next and the time left
- Machine controls, a console to send the machine one line at a time, the machine's camera, its height map and its stored anchors
- Machine alarms by name, with what clears them; a pressed E-stop and failed homing diagnosed, with a read of the home switches
- A simulated Z1 to try jobs on without a machine, moving as the Z1's planner moves it, its camera picture drawn as the Z1's camera sees the bed (**Settings › General › Z1 Simulator device**)
- A firmware configuration editor with verified saves, a saved vacuum-power default, and work-light brightness for each appearance with an inactivity timer; the machine's own light timer, which darkens a dimmed light as a job starts, turned off from the Device page
- A tool library with Fusion 360 import and Makera, Genmitsu, SpeTool, Dreanique and FoxAlien catalogs
- STEP-NC project files, and NC export with the plate's setup
- Built-in PCB preparation from KiCad Gerber and Excellon files, using your local pcb2gcode installation
- Error reports and logs under your control; no account or cloud service
- An app for Windows, and a signed and notarized app for Apple silicon and Intel Macs, that update themselves

![The Prepare tab with three plates for a double-sided PCB, each on the Z1's MDF bed with L-brackets, and the selected plate's stock placed relative to Anchor 1](docs/images/prepare.webp)

## Install

**macOS:** download `OpenSpindle-<version>-universal.dmg` from the [latest release](../../releases/latest) and drag OpenSpindle to **Applications**. Allow local network access when macOS asks, or OpenSpindle cannot reach the machine; you can turn it on later in **System Settings › Privacy & Security › Local Network**.

**Windows:** download `OpenSpindle-Setup-<version>.exe` from the [latest release](../../releases/latest) and run it: it installs OpenSpindle for your user, without administrator rights, and starts it. The installer is for x64 PCs and runs on Windows on Arm too. It is not signed yet, so Windows warns before running it: choose **More info**, then **Run anyway**. Allow OpenSpindle through the firewall when Windows asks, or it does not find machines on the network; entering a machine's IP address works either way.

## Quick start

1. **Connect:** click the device card in **Prepare** and choose your Z1, or enter its IP address.
2. **Import:** drop your CAM's NC files on the window, open them with OpenSpindle from Finder or Explorer, or choose **File › Import…** or **File › Import from Fusion 360**. When a program splits into operations, or holds what the Z1 would not run as written, OpenSpindle asks first: which plate it goes to, how to split it and how to fix it.
3. **Set up:** place the stock, set the work origin and assign the tools that were not matched from your library.
4. **Check:** play the program back on the **Job** tab.
5. **Run:** once the run checklist passes. **Machine › Stop** (⌘. on macOS, Ctrl+. on Windows) stops at any time.

## Status and safety

Machine behaviour follows the source of [Makera's Z1 firmware](https://github.com/MakeraInc/MakeraZ1Firmware/tree/b3a2e26a9eaa2b01358f74ccdef549b993a08175) and is tested against a simulator; on a Z1 Pro, uploads and their read-back are verified. Not yet verified on a real Z1:

- starting a job, and its completion report
- pauses (`M600`) and **Resume**
- tool changes, including the bare `M6` and `M3` lines pcb2gcode writes
- Stop ending in Alarm
- programs sent in parts

Importing, previewing and saving projects never send anything to the machine, and Run lives only on the Job tab. The Device tab explicitly saves firmware configuration and vacuum defaults; startup settings take effect after a separate restart. Work-light preferences can adjust brightness while idle and turn the light off after the configured inactivity period. Controls the machine's state does not allow are refused, and a command whose outcome is unknown is never retried. Stop does not replace the machine's emergency stop.

If something behaves differently, **Help › Export Protocol Trace…** saves the recent exchange with the machine. Please open an issue with what you saw and the trace.

## Documentation

- [Probing](docs/probing.md): [Z surface](docs/touch-off.md), [height map](docs/height-map.md), [outline trace](docs/outline-trace.md), and [corners and centres](docs/3d-probing.md) with the 3D probe
- [PCB operations](docs/pcb.md) from KiCad Gerber and Excellon files, and setting up pcb2gcode
- [Fusion 360](docs/fusion360.md): install the add-in, connect, and import and update NC programs
- [Stored anchors](docs/stored-anchors.md), [models](docs/models.md) and [design rules](docs/design-rules.md)
- [Device controls](docs/device-controls.md) and [diagnosis](docs/device-controls.md#diagnosis), [running programs](docs/device-jobs.md) and [the height map](docs/device-height-map.md)
- [Project files](docs/step-nc-projects.md) and [exported NC](docs/plate-definition.md)
- For developers: [architecture](docs/architecture.md), [the workspace model](docs/workspace-model.md), [the firmware in the preview and its timing](docs/firmware-preview.md) and [releasing](docs/releasing.md)

## Contributing

Contributions are welcome, from people and their coding agents: testing on a real Z1 (the open release pull request has a [build to try](docs/releasing.md#trying-the-next-release)), support for more machines, tool catalogs, testing on Windows, and fixes. [AGENTS.md](AGENTS.md) holds the project's conventions.

### Development

You need Node.js 22.18 or later and, to build the Mac app, macOS. `npm run package:win` builds the Windows installer on macOS or Windows.

```sh
npm ci
npm run dev      # the app, with the renderer's dev server
npm run sim:z1   # another simulated Z1, with fault injection, on 127.0.0.1:2222
```

The renderer updates while developing. Changes to Electron main, the machine process, preload or the host or machine RPC contracts require a full app restart: save your project, quit normally, and run `npm run dev` again. Reloading the window alone keeps the old host and can cause an `Unknown method` error when the renderer calls a newly added method.

Before you open a pull request, `npm run typecheck`, `npm run lint`, `npm run check` (`npm run format` fixes it) and `npm run build` must pass. Say in the pull request how you checked your change, and for anything sent to the machine whether that was against the simulator, with a protocol trace or on a real machine.

### Pull requests

Branch from `main` and keep each pull request to one change; it is squash-merged once CI passes. Its title becomes the commit on `main`, so it is a [Conventional Commit](https://www.conventionalcommits.org/) in the present tense, such as `fix(job): A pause is found by the line the machine reports`:

- `feat`, `fix`, `perf` and `revert` go into the release notes and decide the next version
- `docs`, `style`, `refactor`, `test`, `build`, `ci` and `chore` stay out of them
- `!` before the colon marks a breaking change

The release pull request updates the version and CHANGELOG.md ([releasing](docs/releasing.md)).

## Acknowledgements

Framing, model identification and the probing sequences are documented in [Makera's Z1 firmware](https://github.com/MakeraInc/MakeraZ1Firmware/tree/b3a2e26a9eaa2b01358f74ccdef549b993a08175), and discovery and the file transfer in [Makera's controller](https://github.com/MakeraInc/CarveraController/tree/3914c912452f83fbd5b5d90c730cb78795198438). The camera stream is the one the Z1's own web page shows, at the frame size its configuration sets, numbered as in [Espressif's camera driver](https://github.com/espressif/esp32-camera/blob/2bba0d1d57219ddacd18d2c5701927e1884a51d1/driver/sensor.c#L26-L54). OpenSpindle implements these protocols itself and includes none of that code.

The About panel lists the open-source libraries OpenSpindle is built with, such as Electron, React and three.js, with their licenses.
