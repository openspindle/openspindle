# OpenSpindle

OpenSpindle is a desktop app for preparing, checking and running jobs on a Makera Z1 CNC machine. Nothing moves the machine until you run a job or use a control, and every command is checked against what the machine reports.

![The Job tab running a PCB job on a Z1: the run's stages, the 3D view with the machine's camera feed, the G-code as the machine receives it and the console](docs/images/job.webp)

> [!WARNING]
> OpenSpindle is early ALPHA software for a machine that can hurt you and itself. Some features have not run on a real Z1 yet: see [Status and safety](#status-and-safety). Review every program before you run it, and keep the machine's emergency stop within reach.

## Features

- Plates on a 3D model of the Z1's bed, each with its stock, fixtures, work origin and tool table
- Fixtures: the MDF bed, L-brackets, top clamps, dowel pins and 4th axis, or your own STEP and GLB models
- Placement relative to the machine's stored anchors, with move, snap and lock in the 3D view
- Import of `.nc`, `.cnc`, `.gcode`, `.tap` and `.ngc` programs from your CAM
- Auto-level, auto Z-height and auto-scan with the Makera wired probe
- 3D probing with the Makera 3D Probe: the work origin at an outside or inside corner, or the center of a pocket or boss, on the stock or on a bracket or anything else on the bed
- Design-rule checks, and problems marked where they are in the 3D view
- Playback of the program as the firmware runs it, at its feeds, with depth and width of cut
- The G-code exactly as the machine receives it
- A run checklist, upload read-back and large programs sent in parts
- Machine controls, the machine's camera and its height map
- A tool library with Fusion 360 import and Makera, Genmitsu, SpeTool, Dreanique and FoxAlien catalogs
- STEP-NC project files, and NC export with the plate's setup
- Sandboxed plugins, and the PCB plugin for KiCad Gerber and Excellon files, which runs the pcb2gcode you install
- Error reports and logs under your control; no account or cloud service
- A signed and notarized app for Apple silicon and Intel Macs that updates itself

![The Prepare tab with three plates for a double-sided PCB, each on the Z1's MDF bed with L-brackets, and the selected plate's stock placed relative to Anchor 1](docs/images/prepare.webp)

## Install

Download `OpenSpindle-<version>-universal.dmg` from the [latest release](../../releases/latest) and drag OpenSpindle to **Applications**. OpenSpindle is released for macOS only. Allow local network access when macOS asks, or OpenSpindle cannot reach the machine.

## Quick start

1. **Connect:** click the device card in **Prepare** and choose your Z1, or enter its IP address.
2. **Import:** drop your CAM's NC file anywhere in the window. It becomes a plate.
3. **Set up:** place the stock, set the work origin and assign tools in the plate's settings.
4. **Check:** play the program back on the **Job** tab.
5. **Run:** once the run checklist passes. **Machine › Stop** (⌘.) stops at any time.

## Status and safety

Machine behaviour follows the source of [Makera's Z1 firmware](https://github.com/MakeraInc/MakeraZ1Firmware/tree/b3a2e26a9eaa2b01358f74ccdef549b993a08175) and is tested against a simulator; on a Z1 Pro, uploads and their read-back are verified. Not yet verified on a real Z1:

- starting a job, and its completion report
- pauses (`M600`) and **Resume**
- tool changes, including the bare `M6` and `M3` lines pcb2gcode writes
- Stop ending in Alarm
- programs sent in parts
- the auto-level, auto Z-height, auto-scan and 3D probing programs

Importing, previewing and saving never send anything to the machine, and Run lives only on the Job tab. Controls the machine's state does not allow are refused, and a command whose outcome is unknown is never retried. No plugin can move the machine or run a program. Stop does not replace the machine's emergency stop.

If something behaves differently, **Help › Export Protocol Trace…** saves the recent exchange with the machine. Please open an issue with what you saw and the trace.

## Documentation

- [Auto-level](docs/auto-level.md), [auto Z-height](docs/auto-z-height.md), [auto-scan](docs/auto-scan.md) and [3D probing](docs/3d-probing.md)
- [PCB operations](docs/pcb.md) from KiCad Gerber and Excellon files, and setting up pcb2gcode
- [Stored anchors](docs/stored-anchors.md), [models](docs/models.md) and [design rules](docs/design-rules.md)
- [Device controls](docs/device-controls.md), [running programs](docs/device-jobs.md) and [the height map](docs/device-height-map.md)
- [Project files](docs/step-nc-projects.md) and [exported NC](docs/plate-definition.md)
- For developers: [architecture](docs/architecture.md), [the workspace model](docs/workspace-model.md), [plugins](docs/plugins.md) and [releasing](docs/releasing.md)

## Contributing

Contributions are welcome, from people and their coding agents: testing on a real Z1 (the open release pull request has a [build to try](docs/releasing.md#trying-the-next-release)), support for more machines, tool catalogs, plugins, testing on Windows, and fixes. [AGENTS.md](AGENTS.md) holds the project's conventions.

### Development

You need Node.js 22.18 or later and, to build releases, macOS.

```sh
npm ci
npm run dev      # the app, with the renderer's dev server
npm run sim:z1   # a simulated Z1 to connect to on 127.0.0.1
```

Before you open a pull request, `npm run typecheck`, `npm run lint`, `npm run check` (`npm run format` fixes it) and `npm run build` must pass. Say in the pull request how you checked your change, and for anything sent to the machine whether that was against the simulator, with a protocol trace or on a real machine.

### Pull requests

Branch from `main` and keep each pull request to one change; it is squash-merged once CI passes. Its title becomes the commit on `main`, so it is a [Conventional Commit](https://www.conventionalcommits.org/) in the present tense, such as `fix(job): A pause is found by the line the machine reports`:

- `feat`, `fix`, `perf` and `revert` go into the release notes and decide the next version
- `docs`, `style`, `refactor`, `test`, `build`, `ci` and `chore` stay out of them
- `!` before the colon marks a breaking change

The release pull request updates the version and CHANGELOG.md ([releasing](docs/releasing.md)).

## Acknowledgements

Framing, model identification and the probing sequences follow [Makera's Z1 firmware](https://github.com/MakeraInc/MakeraZ1Firmware/tree/b3a2e26a9eaa2b01358f74ccdef549b993a08175); discovery, the camera stream and the file transfer follow the [Carvera Community Controller](https://github.com/Carvera-Community/Carvera_Controller/tree/63da3c0a8ab6bca2563ff4c2aadb7ab5323335bf/carveracontroller). The About panel credits the open-source software OpenSpindle includes.
