# Device controls

One module owns the machine: `MachineController` in `src/machine/core`, hosted in the Electron main process. The renderer, the native menu and plugins reach it only through a `MachineGateway` for their principal. Requests are the closed `MachineCommand` union (Zod-validated at the RPC boundary and again in the controller), plus Run, reads, writing the stored anchors, a line typed in the [console](#protocol-trace-and-console) and Stop.

## Admission and availability

Every request passes one admission chain, the command rules (`contract/command-rules.ts`, [rules](workspace-model.md#rules)) that `core/admission.ts` runs, before anything is sent:

1. a verified connection, and no lockout (an earlier outcome that is unknown);
2. fresh status (at most 5 s old);
3. no other operation in progress (the controller runs one at a time; nothing queues);
4. while a program streams, only light, beep, overrides, pause, resume and tool confirmation are admitted, reads are **deferred** until the program ends, and writing the anchors or a typed console line is refused;
5. the capability is reported by the machine (for example, no tool confirmation on ATC machines);
6. the firmware's machine-state rules (`firmware/makera/commands.ts`).

The same chain produces `snapshot.availability`, so every disabled control shows the exact reason the controller would refuse it. Stop only needs a connection. Reset needs a connection, no lockout and no running program or operation, whatever the machine's state. A typed console line goes in any machine state: the firmware answers what it will not run.

Reads are shared by kind (anchors, height map). A read asked for while one of its kind runs joins it instead of being refused as busy, and one the chain defers joins the read of its kind that waits already, so the deferred list holds at most one per kind. One read answers every caller; a caller that cancels withdraws only itself, and a deferred read that every caller left is dropped.

## Verification

A written command is not a successful command. Without a program stream, success needs the firmware acknowledgement **and** a telemetry post-condition. While a program streams, acknowledgements may belong to its played lines, so they are never trusted and only telemetry counts.

| Control                 | Firmware request                                 | Proof                                                                                                                    |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Jog                     | `$J X1 F0.1` (one axis; converted for inch mode) | Idle at start + distance (±0.005 mm)                                                                                     |
| Home all                | `$H`                                             | `ok`, then Idle (Alarm before the acknowledgement is expected)                                                           |
| Unlock (Alarm only)     | `$X`                                             | `[Caution: Unlocked]` and `ok`, then status leaves Alarm. Homing is advised afterwards.                                  |
| Work zero               | `G10 L20 P0 X0` (selected axes)                  | `ok`, WPos of those axes ≈ 0. Z also clears the tool-length offset; the UI asks first.                                   |
| Spindle start / speed   | `M3 S10000`                                      | `ok`, spindle on at that target. A running spindle without motion accepts a new speed (**Apply**).                       |
| Spindle stop            | `M5`                                             | `ok`, spindle off                                                                                                        |
| Work light              | `M821` / `M822`                                  | `ok`, diagnose G light flag                                                                                              |
| Beep                    | `M861` / `M862`                                  | `ok`, diagnose G beep flag                                                                                               |
| Vacuum                  | `M851 S100` / `M852`                             | `ok`, diagnose G external-output flag                                                                                    |
| Follow spindle          | `M331` / `M332`                                  | `ok`, status S vacuum mode                                                                                               |
| Feed / spindle override | `M220 S…` / `M223 S…`                            | `ok`, status F / S override                                                                                              |
| Pause / resume          | `suspend` / `resume`                             | status Pause / Run or Idle                                                                                               |
| Tool installed          | `M490.2` (manual tool change only)               | status leaves Tool. On ATC machines M490.2 loosens the tool, so it is never offered there.                               |
| Stop                    | realtime `0x18` in an `0xa1` frame               | Alarm                                                                                                                    |
| Write anchors           | `config-set sd <key> <value>` for each key       | `sd: <key> has been set to <value>`, then every key read back ([stored anchors](stored-anchors.md#changing-the-anchors)) |

A rejection line fails the command. An unverified command reports that its outcome is unknown and never retries; unverified motion (jog, home, spindle) also closes the connection so the machine can be checked. A late acknowledgement of an unverified command is swallowed for two seconds.

**Reset** (Device, after a confirmation) sends the console command `reset`, which reboots the controller three seconds later ("Rebooting machine in 3 seconds..."). The connection does not outlive a reboot, so the session ends right away and the controller connects to the same device again: first after five seconds, then every three, for up to 90 seconds. Meanwhile `snapshot.connection.restarting` is set and failed attempts are not reported as errors; connecting or disconnecting by hand ends the wait.

Stop preempts everything: it cancels an in-flight transfer (the B5 frame, see [Transaction](device-jobs.md#transaction)), aborts the current operation and every deferred read, then sends the halt and waits for Alarm. Machine › Stop (⌘.) goes straight to the controller in the main process, so it works even if the renderer is unresponsive. An unconfirmed Stop sets a lockout; only Stop is admitted until the machine is reconnected or confirms a Stop. That holds for Reset too, whose reconnection would otherwise clear the lockout before anyone checked the machine. Stop does not replace the physical emergency stop.

## Status

Status `?` uses `0xa1` / reply `0x81`; `diagnose` uses `0xa2` / `0x82`; commands use `0xa2` and text replies `0x90`. Frames are CRC-checked and bounded. The poller keeps one query outstanding, runs at 1 Hz (4 Hz while verifying or finishing a job) and pauses during file transfers; five seconds of polling without status closes the connection. Only polling time counts: when the app itself was held up (a blocking call, the Mac asleep), the poll that comes late counts one interval, and the replies that arrived meanwhile are read right after it. The C field carries model, FuncSetting (bit 2: automatic tool changer), inch and absolute modes. T carries the tool and its length offset from the tool work Z was set with (in millimetres in either unit mode), and manual tool-change machines append the requested tool. Missing values stay unknown; nothing is estimated. What the firmware prints as integers (tool numbers, the halt reason, the played line) is read as safe integers, and a value that is not one stays unknown too.

The firmware reports the work position as the machine position less the work offset (with any `G92` shift) and, in Z, less the tool offset. So the work origin the machine keeps (`Telemetry.workOrigin`) is the machine position less the work position, and in Z less the tool offset too. In laser mode the tool offset also holds the laser's X and Y, which the status leaves out, so there it stays unknown. The Device page shows the tool offset in its live status and the work origin in the coordinates card's **Origin** column; the Job tab's 3D view marks it on the plate's bed ([device-jobs.md](device-jobs.md#the-job-tab)).

Every snapshot the controller builds is checked against the machine contract (`MachineSnapshotSchema`). The renderer drops a snapshot the contract refuses, and so every later one while the value stays, which would freeze the UI. So a refused value is left out instead, by the nearest part of it the contract lets go: a nullable value becomes null, a list entry is dropped. The app's log gets the contract's issues once for each run of such snapshots.

A device connected by address takes the name it announces: unless it was heard already, the controller listens up to three seconds for it before opening the connection, and **Disconnect** meanwhile cancels the connect. While connected, the app prevents system sleep. The last device the app connected to is recorded in its data folder (`last-device.json`), and each launch tries once to connect to it again; a device that is off or unreachable fails within the eight-second handshake.

Disconnecting never stops a running program, and the app's Stop goes with the connection. So while a job is active (from Run until it ends), quitting asks first, and the controller refuses to disconnect, or to connect to another device, with `confirmation-required` unless the request says the user confirmed it (`confirmed: true`). The device picker then asks, in the controller's words, and **Disconnect** or **Connect** sends the request again, confirmed. Connecting to the device the job runs on changes nothing and asks nothing. Plugins can neither connect nor disconnect.

## Camera

The main process opens `ws://<host>:82/ws_video`, sends `start_stream` and forwards binary JPEG frames (at most 4 MiB, SOI/EOI checked, 8 s connect and 15 s frame timeouts) to subscribers. The renderer opens no sockets of its own.

## Protocol trace and console

The controller keeps the recent exchange with the device in a bounded ring (about 20,000 entries across connections): every frame sent, every status report and reply line with its classification, file transfer blocks summarised by size only, and notes for connecting, disconnecting, Stop and job phase changes. **Help › Export Protocol Trace…** saves it as text from the main process, so it works even when the window is unresponsive. It is the evidence to attach when a job's completion, a pause or a verification behaves differently on a real machine than described here.

The part people read is the **console**, under the G-code on the Job tab: the commands the app sent (the halt byte reads `^X`), the machine's replies and the app's notes, without status polling, transfer blocks or the upload's checksum. The controller keeps its last 1,000 entries across connections and pushes new ones to the app renderer (`machine.console`: the backlog on subscribing, then batches); plugins cannot subscribe. Reported failures (errors, alarms, halts, refusals) show in red and acknowledgements muted. **Clear** empties the view of what it shows so far; the controller keeps the entries, and the protocol trace has them.

Under the console, a command line sends the machine one line as typed, of at most 256 characters. The connected machine's program rules that the project reports as errors, which block Run ([program rules](design-rules.md#program-rules)), check it first: on the Z1 they refuse, for example, `M4`, `M498.2` (which erases the tool data and work offsets the machine saves) and the firmware's own commands such as `rm`, `config-set` and `play`. It is then admitted like a command ([above](#admission-and-availability): for example, refused while a program runs), sent as a command frame and given five seconds for its acknowledgement. A rejection line fails it, and a line the firmware answers without an acknowledgement ends after that time, a late one swallowed for two seconds. A refusal's reason shows under the field and the machine's replies in the console; nothing verifies what the line did, and nothing is retried. Plugins cannot send a line.

## Development simulator

`npm run sim:z1 -- [options]` starts a fake Z1 on 127.0.0.1:2222; npm passes on the options after `--`, and `--help` lists them (its anchors, the tool at start, its speed and fault injection). It announces itself for discovery and mimics the firmware behaviour described here, including its own routines (tool changes, `M495` probing and the 3D probe's `M480` routines, which it runs against a corner, pocket or boss around where the probe starts) echoing their script lines and replies as the firmware does.

It moves in real time at the Z1's rates, without acceleration: `G0` at 2000 mm/min, `G1` without an F at 1000, and no axis faster than its own (X and Y 1200 mm/min, Z 600); `--speed <n>` makes it move n times faster. It follows modal `G0` to `G3`, arcs included, in `G90` and `G91`; `G28` parks (up to the clearance, then over to machine −11.6, −14.6); a probe search (`G38.2` to `G38.5`) takes its time, and a `G38.2` that meets nothing alarms at the end of it. A tool change by hand waits at the firmware's change position (anchor 1 + 180.78, 179.74: `toolrack_offset_x` + 132 and `toolrack_offset_y`), then measures the tool at the tool sensor and goes back over where it began. It keeps tool length offsets as the firmware does: `M493.1` measures one, setting work Z (`G10 L20 Z…`) makes the measured tool the reference, and status reports the offset (`T:tool,offset`).

The app takes a device on the loopback address for the simulator; a machine is never there. Before each Run it sends the simulator the plate's bed, in a `sim-bed` line that no machine is sent: the stock's box and top, and the height of what carries it, in machine coordinates as the preview places them ([firmware-preview.md](firmware-preview.md)). The simulator's probing then meets the plate's stock, else what carries it, and the tool sensor where it is; before any bed, stock everywhere at the height of a 1 mm PCB on the MDF bed. Its camera stream is only a test card, so the camera panels (the Job tab's overlay and the Device page's camera card) show the plate in the 3D view instead, from the direction the machine's kit gives its camera, with the tool where the machine reports it, or, following a job, at the playhead.

It is a development tool; what the README lists as [not yet verified on a machine](../README.md#status-and-safety) still needs a real Z1.

Sources: [Makera's Z1 firmware](https://github.com/MakeraInc/MakeraZ1Firmware/tree/b3a2e26a9eaa2b01358f74ccdef549b993a08175) — `Kernel.cpp` `get_query_string` / `get_diagnose_string`, `SimpleShell.cpp` (diagnose, model, jog, homing), `Robot.cpp` (work zero, the work position (`mcs2wcs`), feed override), `SpindleControl.cpp`, `ATCHandler.cpp` (M490.1/M490.2 and FuncSetting bit 2), `Player.cpp` (suspend/resume, abort), `SerialConsole.cpp` (realtime halt). Camera: the [Carvera Community Controller](https://github.com/Carvera-Community/Carvera_Controller/tree/63da3c0a8ab6bca2563ff4c2aadb7ab5323335bf)'s `Z1Camera.py`.
