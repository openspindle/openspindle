# ADR-0001: Reliable Makera Z1 connections and USB serial transport

- **Status:** Proposed
- **Date:** 2026-11-10
- **Decision owners:** OpenSpindle maintainers
- **Scope:** Device communications, connection lifecycle, file transfer, observability and run safety
- **Implementation:** TCP telemetry health, bounded polling and write buffering, persistent motion lockout with Stop available, and camera reconnect are implemented in `src/machine/core/session.ts`, `src/machine/core/controller.ts`, `electron/machine/node-ports.ts` and `src/machine/core/camera.ts`. USB transport and automatic machine reconnection remain proposed. See [Device controls](../docs/device-controls.md).

## Context and problem

A Makera Z1 can become disconnected from OpenSpindle during normal use on Wi-Fi. A disconnect in the UI does **not** by itself establish that Wi-Fi dropped, that the TCP socket died or that the CNC program stopped. The Z1 can continue an already uploaded program autonomously. Losing the host-side session can therefore remove live progress and software Stop access while the machine continues moving.

Makera [documents three Z1 connection modes](https://wiki.makera.com/en/Z1/QuickStart): USB, the machine's own Wi-Fi access point, and a shared local Wi-Fi network. OpenSpindle currently implements only TCP over IPv4. The community controller demonstrates that a USB serial connection can carry the Makera framed protocol. The design must address **two different problems**:

1. **Misclassification and recovery of temporary status silence over a still-open transport.**
2. **Adding a genuine wired USB transport**, including transfers and reliable device identity, without bypassing the existing machine command safety model.

No real-Z1 trace has yet been attached to establish which failure mode causes the reported disconnections. The five-second watchdog below is a plausible source of false disconnects, **not a confirmed root cause**.

### Confirmed current-code observations

| Area | Current behavior | Consequence |
| --- | --- | --- |
| `electron/machine/node-ports.ts` | `MachinePorts.tcp` is a Node `net.Socket`; it enables `setNoDelay(true)` and `setKeepAlive(true, 1000)`. UDP listens for machine announcements. There is no serial port driver. | USB is not a selectable transport. TCP keepalive does not prove that firmware status replies are timely. |
| `src/machine/core/session.ts` | `HANDSHAKE_MS = 8000`, `STALE_MS = 5000`, normal poll 1,000 ms, fast poll 250 ms, outstanding query window 1,500 ms. The watchdog counts scheduled polling intervals without a **status** frame; it closes the session at five seconds. | A busy bridge, lost status frames or delayed responses can be reported as a disconnected device even if the socket remains open. Other valid frames do not reset the status counter. |
| `src/machine/core/session.ts` | Polling is suspended during transfers and the silence counter is reset after transfer. | A simple timeout increase would miss the distinction between normal transfer silence and genuine failures. |
| `src/machine/core/controller.ts` | `onClosed` removes the session, disposes the camera, aborts pending operations and calls `tracker.disconnected()`. | A monitored running job is marked lost; merely reconnecting cannot transparently recover its existing tracker. |
| `electron/machine/index.ts` | The last network address is tried **once at application launch**. | No general retry loop handles transient connection loss during an ordinary session. |
| `src/machine/contract/snapshot.ts` | Targets/devices require `host` and `port`, and `machineId` is based on model plus name. | USB cannot be represented accurately, and a different endpoint for the same physical Z1 can accidentally become a different machine/profile. |
| `src/features/device/device-picker.tsx` | Discovery and manual IP:port entry only (default port 2222). | No USB discovery, cable selection, or link-health reporting. |
| `src/machine/firmware/makera/transfer.ts` and `codec.ts` | Makera framed transfer uses fixed `FILE_BLOCK_BYTES = 8192`; upload then full readback is verified before play. | The current transfer mode cannot simply be reused at its Wi-Fi block size for serial. |
| `src/machine/core/operations/job-runner.ts` | A run can have multiple program parts. The controller actively starts subsequent parts. Upload/readback/play is a guarded operation with no blind retry. | A dropped link must **never** silently re-upload, replay, or advance to the next part. |
| `src/machine/core/protocol-trace.ts` | A bounded protocol trace exists and is exported using **Help → Export Protocol Trace…**. | There is an existing, privacy-conscious diagnosis mechanism to extend. |

### Evidence for USB and protocol differences

- [Makera Z1 Quick Start](https://wiki.makera.com/en/Z1/QuickStart) explicitly supports USB connection on Z1/Z1 Pro. [Makera's USB driver instructions](https://wiki.makera.com/en/carvera/manual/software-installation) describe an FTDI 232R UART / USB Serial Port on Windows; these driver instructions are for the Carvera-family controller and **do not replace USB device identification on the specific Z1**.
- [Carvera Community Controller `USBStream.py`](https://github.com/Carvera-Community/Carvera_Controller/blob/main/carveracontroller/USBStream.py) opens an 8N1 USB serial connection at **115200 baud** by default, with bounded read/write timeouts, DTR toggling, buffer flushing, and an initialization sequence. Those actions are reference behavior, **not safe initialization steps to copy blindly**, particularly when a machine is running.
- Its [`protocols/makera.py`](https://github.com/Carvera-Community/Carvera_Controller/blob/main/carveracontroller/protocols/makera.py) sends the same Makera command and realtime frame types over a byte stream; [`protocols/session.py`](https://github.com/Carvera-Community/Carvera_Controller/blob/main/carveracontroller/protocols/session.py) can detect/switch between Makera framing and legacy Smoothie protocol. OpenSpindle currently speaks only the Makera framed protocol and must fail safely if an unexpected protocol is encountered.
- The community controller's [`USBStream.py`](https://github.com/Carvera-Community/Carvera_Controller/blob/main/carveracontroller/USBStream.py) constructs XMODEM in `xmodem` mode; [`WIFIStream.py`](https://github.com/Carvera-Community/Carvera_Controller/blob/main/carveracontroller/WIFIStream.py) uses `xmodem8k`; [`XMODEM.py`](https://github.com/Carvera-Community/Carvera_Controller/blob/main/carveracontroller/XMODEM.py) maps those **Makera-framed** transfers to **128-byte USB blocks** versus **8,192-byte Wi-Fi blocks**. This is an essential compatibility requirement, not a generic serial optimization.
- [Community Controller release notes](https://github.com/Carvera-Community/Carvera_Controller/releases) describe identifying USB devices by FTDI and stable **VID:PID:serial** rather than changing COM paths, and treating missed heartbeats as communications backpressure rather than immediate transport death.
- [Makera's Z1 motion firmware](https://github.com/MakeraInc/MakeraZ1Firmware) is source for the **motion-controller** portion. It does **not alone** establish all host-to-USB bridge and Wi-Fi ESP-side behavior; validate those behaviors against a real Z1 and a protocol trace.

## Decision

**Adopt a transport-independent machine byte stream, add USB serial as an explicitly selected transport, and separate transport failure from stale firmware telemetry.** Retain one owner for machine commands in the Electron utility process, one protocol interpreter and the current admission/operation model. Keep the initial release conservative: **no automatic movement, job resume, transport failover, or replay of uncertain commands**.

### 1. Make physical transport independent of firmware protocol

Introduce a `MachineByteConnection`/`MachineConnector` abstraction in `src/machine/core/ports.ts` (names illustrative) with these semantics:

- Asynchronous `write(bytes)` with bounded buffering/backpressure and a clear closed/error signal.
- `open`, byte `data`, transport `closed` and transport-specific diagnostic events.
- `destroy()` is idempotent; generation/session IDs prevent callbacks from an old connection reaching a new session.
- An explicit endpoint kind, **`tcp`** or **`serial`**, with capabilities (`maxTransferBlockBytes`, optional camera network address). Never conflate an open stream with a healthy CNC controller.
- The Makera frame decoder, command verification, polling, and operation handling remain in `src/machine`, **not duplicated** for USB in Electron or React.

Suggested boundary:

```text
Device Picker -> Machine RPC -> MachineController -> MachineSession
                                           |             |
                                     FirmwareAdapter  MachineByteConnection
                                           |             |
                                  Makera frame codec   TCP | USB serial
                                           |
                               job/Stop/admission/trace
```

Retain `electron/machine` as the **only owner** of the serial handle (the renderer never opens Web Serial). Rename `TcpConnection`/`TcpConnector` to neutral interfaces or adapt them behind a neutral wrapper, keeping a compatibility adapter for the simulator. The UI is only an endpoint selector.

### 2. Typed endpoints, persistent identity and exclusive ownership

Replace the network-only target with a discriminated union, validated by Zod, for example:

```ts
type ConnectionTarget =
  | { kind: "tcp"; host: LocalIPv4; port: number; name?: string }
  | { kind: "serial"; portId: string; pathHint?: string; name?: string }
```

- Enumerate candidate FTDI devices in the utility process. Show the human-readable port and manufacturer; use **VID:PID:serial number** when available as `portId`, with a documented fallback for devices with no unique serial. Never persist `COM7` or `/dev/ttyUSB0` as the sole identity.
- Never open an arbitrary serial device without explicit selection. Require a successful **read-only** identity/status handshake and known Makera framing before enabling control; a device that cannot be verified remains disconnected.
- Preserve a separate **physical machine identity** from transport endpoint and connection instance. If a USB-reported name does not correspond reliably to the Wi-Fi advertised name, require an explicit one-time association with the existing machine profile; never silently attach an unknown device to saved fixtures, anchors or offsets.
- One active controller connection per machine. Refuse automatic dual-transport control and simultaneous independent TCP/USB command sessions. A manual transport switch during an active job remains confirmation-gated and must not cause a hidden Stop/Resume.

### 3. Implement USB serial using proven conservative defaults

Implement an Electron utility-process serial adapter, preferably with the maintained Node `serialport` library and its parser-free byte stream. Evaluate native addon compatibility with Electron 44, utility-process loading, prebuilds, `electron-builder`/asar unpacking and signed Windows/macOS and Linux packages **before** choosing a dependency; reject a dependency that cannot be packaged reliably.

Default **115200, 8N1**, no software/hardware flow control, with configurable driver-independent read/write deadlines. Use asynchronous readable/event-driven processing, not a blocking `read(1)` loop.

**Do not automatically toggle DTR/RTS, reset firmware, flush inbound data, or write the community controller's `\n;\n` initialization bytes upon connecting to an active machine.** First characterize how the particular Z1 USB bridge behaves. If any initialization sequence proves necessary, make it a separately reviewed, firmware-aware handshake with an explicit safe precondition; opening USB for read-only observation must not interrupt a running CNC program.

On unplug, reconnect or USB re-enumeration: close exactly one session, release the file descriptor, cancel outstanding writes, record a precise error and rescan by stable device ID. Missing FTDI driver/permission, serial port busy, and unknown protocol must have distinct user-facing diagnostics.

### 4. Transport-aware file transfer; verification is mandatory

Parameterize the existing `MakeraTransfer` block size instead of reimplementing upload in the USB layer:

| Transport | Initial framed block size | Basis |
| --- | ---: | --- |
| TCP over Wi-Fi | 8192 bytes | Current OpenSpindle transfer and community Wi-Fi stream |
| USB serial | 128 bytes | Community `USBStream` + `XMODEM` framed transfer |

The exact Z1/firmware combination **must be validated on real hardware**. Negotiate larger USB blocks only after explicit firmware capability evidence, not as a guess. Preserve frame CRC validation, upload acknowledgement rules, no unsafe transfer retries, **full byte-for-byte download/readback before play**, and behavior when stock firmware supplies a placeholder MD5. Model throughput-dependent deadlines by bytes and measured progress, not simply reuse Wi-Fi timing constants. Cancel stalled transfers without replaying the job.

A mid-transfer disconnect always leaves the outcome **unknown**. Never infer that a partially uploaded file is runnable, and never automatically start it on reconnection.

### 5. Separate link health, firmware responsiveness and machine state

The current five-second watchdog closes a live TCP socket when **no status reply** arrives. That conflates (a) transport closed/error, (b) healthy transport but late controller status, and (c) machine state unknown. Split the concepts:

- **Link:** opening / open / error / closed (from TCP/serial driver).
- **Telemetry:** fresh / late / stale (time and sequence of last valid status, plus last valid inbound frame).
- **Control trust:** verified / uncertain (whether an in-flight command outcome is known).
- **Machine execution:** reported by firmware, independently from the connection's UI health.

Retain the existing 5-second value initially as a **soft stale warning**, not an unconditional `session.close()`. Continue bounded, low-rate read-only polls when allowed by the operation/transfer lease. Do **not** issue an unlimited accumulating queue of unanswered queries; suspend redundant polls when one is outstanding and record backpressure. Preserve transfer polling suspension. A transport error, EOF or confirmed serial removal is a real lost link; a stream that remains open but does not return a status should display **"Communication unresponsive; machine state unknown"**, not "machine disconnected" or "job stopped".

The final hard-unresponsive/recovery thresholds require traces from real hardware; suggested measurements are 5 s soft stale, 15–30 s persistent stale diagnostics, and a separately bounded TCP/USB liveness/reconnect strategy. Do **not** hardcode those tentative values as proof of disconnect. TCP keepalive is not enough while polling traffic is being sent. Platform-specific `TCP_USER_TIMEOUT` / retransmission controls can be investigated, but only as an optional socket policy that is verified across Windows/macOS/Linux.

A stale link must not admit new motion, spindle start, configuration write, or Run. **Stop is exceptional:** keep an explicit Stop attempt available only if a writable, current control transport exists; send it once and label it **unverified** until acknowledged by the machine. The physical emergency stop remains necessary when the link is unavailable.

### 6. Safe reconnect and recovery semantics

Provide a distinct **reconnecting/observing** state after an actual transport loss:

1. Preserve a snapshot of the interrupted run (run ID, expected file/part, last verified telemetry/progress, operation stage, original machine identity). Do not claim that this snapshot is live machine state.
2. Drop all in-flight command/transfer leases and invalidate the old session generation. **Never replay** Run, M3/M5, G0/G1, `play`, an acknowledgement-uncertain write, or a multipart continuation.
3. Allow bounded, cancellable, read-only reconnect attempts to the same verified endpoint, with exponential backoff and jitter **only if such attempts do not reset or disturb the machine**. Default to manual reconnect while that prerequisite is unproven on USB. Persist manual-disconnect intent so the app never reconnects after explicit Disconnect.
4. Verify device identity and retrieve fresh firmware status. Display its actual state (Running/Tool/Pause/Idle/Alarm, file/progress if available), distinguish observations from assumptions, and offer Stop if verified available.
5. **Do not automatically restore the previous completion tracker or resume from a line**. Current `PartedCompletion.disconnected()` and `MakeraCompletion` may mark work `lost`; recovery needs an explicit read-only reconciliation flow and reliable firmware evidence (program identity, part, progress, state) before any "resume monitoring" feature is implemented.
6. A multipart job must **not** start its next part after a reconnect without an explicit separately verified transition. When evidence is insufficient, remain "Outcome unknown — inspect machine" and refuse automated continuation.

A connection recovered during a job is not proof that the job completed successfully. A reconnect is never a CNC resume command.

### 7. Camera and feature capability separation

The Z1 camera currently comes from a **network URL** derived from the connected device. USB serial cannot carry this WebSocket camera stream through the existing implementation. In USB-only mode, machine controls may be supported while the camera is clearly **unavailable**. A future optional **read-only camera network endpoint** can coexist with USB control, but must never introduce a second active controller connection.

The device picker and feature snapshot must represent this distinction without manufacturing a fake IP address for USB.

### 8. Diagnostics that identify the real cause

Extend **Help → Export Protocol Trace…** and the existing logging path to record bounded timestamped connection events: transport kind (not raw serial number in shared reports), socket/serial error category, open/close reason, last valid status age, last inbound frame age, outstanding polls, read/write queue high-water mark, operation phase, whether the machine was reported running, and reconnect attempts/results. Track a single reason code per transition:

- `TCP_ERROR` / `REMOTE_EOF` / `USB_REMOVED` / `PORT_BUSY`
- `STATUS_STALE` (soft health condition; **not** itself a transport close)
- `HANDSHAKE_TIMEOUT` / `FRAME_INVALID` / `TRANSFER_FAILED`
- `USER_DISCONNECT` / `PROCESS_EXIT` / `IDENTITY_MISMATCH`

Use the existing protocol trace's truncation/privacy rules. Do not include raw G-code, credentials, LAN scans or full device serial numbers in diagnostics. Logs and optional error reports remain user-controlled.

## Implementation sequence

| Phase | Work | Completion criteria |
| --- | --- | --- |
| **0 — Diagnose** | Capture an existing trace from a real disconnect; compare simultaneous ping, device LED/state and app log. Add failure reason instrumentation before changing thresholds. | Can distinguish true link loss, status starvation, host process restart and malformed firmware replies. |
| **1 — Health separation** | Introduce link/telemetry health, soft stale state, command gating, no poll pile-up, and explicit manual reconnect. Preserve current TCP behavior except for wrongly classifying stale replies as closed. | Five seconds of dropped status with an open transport shows "unresponsive", preserves honest run uncertainty and never sends motion. |
| **2 — Transport boundary** | Refactor `MachinePorts` and session to a generic bytes interface; move TCP behind the adapter. Update typed targets, persistent last target and snapshots without changing default Wi-Fi UX. | Simulator and TCP use identical command/transfer behavior and fail closed on stale responses. |
| **3 — USB MVP** | Discover/identify FTDI serial device; select in picker; read-only framed handshake; status and manual control; safe unplug handling. | Real Z1 reports identity and status via USB; no reset on connect; Stop verified under idle and running controlled dry tests. |
| **4 — USB transfers** | 128-byte framed blocks; adaptive deadlines; upload/download verification; run preflight and command semantics; native packaging on all supported OSes. | Real Z1 can run a small non-cutting verified job over USB without changing no-retry safety invariants. |
| **5 — Reconnect/reconcile** | Bounded read-only reconnection policy, safe same-machine binding and explicit monitoring recovery for a single-part run; defer multipart auto-continuation. | A cable pull/network loss during a job never triggers a duplicate start or an unverified "completed" state. |

No implementation or tests are executed by this documentation-only ADR.

## Validation and acceptance criteria for the later implementation

Use the Z1 simulator with fault injection where practical, then a **real Z1 with no cutting load**, physical E-stop available, and operator supervision. The proposed verification matrix covers:

1. **Healthy Wi-Fi:** 30+ minutes idle and a dry run; no false disconnect; normal status and transfer performance.
2. **Missed status, live TCP:** Block status replies for 6–20 seconds while keeping TCP open. Expect degraded/unknown, **not disconnected**; no automated motion or duplicated commands; recover on valid status.
3. **Actual TCP loss:** Router/AP restart, socket FIN/RST, Wi-Fi deauth. Expect an accurate link-loss reason, bounded reconnection and fresh identity validation.
4. **CPU/backpressure:** Artificially delay event loop or data delivery; count pending polls; confirm transfer suspension and sensible observability.
5. **USB discovery:** Driver absent, port already used by Makera Studio, ambiguous same-VID devices, no serial ID, changing COM/tty path, permission denied.
6. **USB device lifecycle:** Cable plug/unplug during idle and running dry test; re-enumeration; app restart; DTR behavior; ensure **no machine reset or hidden control command** on connect.
7. **USB data stream:** Split/coalesced Makera frames, CRC corruption, unexpected legacy text, 128-byte upload, download verification, timeouts, cancellation and file hash mismatch.
8. **Safety:** Disconnect after an uncertain `play` command, during `M6`, a probe, Stop, spindle state transition, and between multipart parts. No blind resend, no unverified success, no part skip.
9. **Physical identity:** Switching between USB and Wi-Fi on the **same** Z1 retains the explicitly associated profile; another Z1 with the same model is not silently mistaken for it.
10. **Camera:** USB-only controls work with camera unavailable; optional separate camera transport never opens a second control session.
11. **Packaging:** Windows x64 (including FTDI VCP driver), macOS Intel/Apple Silicon signed/notarized build, Linux AppImage and serial-group/udev permission diagnosis; bundled native modules load inside the machine utility process.
12. **Observability:** Export includes reason, timestamps and last health details but not private serial identifiers, raw toolpaths or secrets.

**Release gate:** Document actual Z1 firmware version(s), USB VID/PID and OS/driver used; verify unplug/reconnect without resetting the machine; capture protocol traces for successful USB upload/readback and both a genuine loss and a mere missed-heartbeat case. Any discrepancy must be resolved before advertising USB as production-ready.

## Alternatives considered

| Alternative | Why not selected |
| --- | --- |
| Increase `STALE_MS` to 15 or 30 seconds | May reduce symptoms but hides the distinction between transport loss and a temporarily busy controller, delaying safety-relevant uncertainty. |
| Always reconnect TCP immediately after missing a heartbeat | Risks dropping a still-live session, two simultaneous controllers, and wrongly assuming the prior job/command outcome. |
| Wrap USB serial in a virtual TCP forwarding process | Introduces another process/point of failure and still requires USB-specific protocol and 128-byte transfer handling; not suitable as the core design. |
| Implement USB separately in the renderer via Web Serial | Violates the single-owner utility-process architecture and is less reliable for Stop, lifecycle, native packaging and background monitoring. |
| Use the community controller as an OpenSpindle backend | Adds external process/vendor coupling and complicates command verification and job ownership; its implementation is a **reference**, not a shared controller. |
| Copy community code wholesale | Different language, license and lifecycle; study the documented behavior, write original code and review compatibility/licensing for any reuse. |
| Automatically fail over to USB mid-job | Unknown in-flight outcomes and uncertain machine identity make unsupervised failover unsafe. Leave as a possible future ADR after reconciliation is proven. |

## Consequences and unresolved questions

**Benefits:** Wired control option; fewer false network-drop diagnoses; more accurate state when Wi-Fi stalls; shared safety logic; actionable traces. **Costs:** Native serial dependency and packaging, cross-platform port handling, additional protocol and transfer complexity, and a larger typed connection contract.

Open questions requiring **real hardware** before implementation is accepted:

- Does the specific stock Z1/Z1 Pro bridge expose a unique FTDI VID/PID/serial on every supported OS, and does opening/DTR change reset any MCU or running job?
- Is the same Makera-framed protocol available on USB for the user's stock firmware, with 128-byte file blocks and the same reply ordering? Are any legacy firmware revisions different?
- Are USB and TCP connected to the same bridge with exclusive control, or can the machine accept concurrent sessions? Do **not** experiment with dual active controllers on a cutting run.
- What are the real status-delay distributions during tool changes, probes, large transfers, high CPU use and intermittent Wi-Fi loss?
- Is there a reliable firmware-reported file identity/run identifier to reconcile monitoring after reconnect, or must reconnect always leave the prior run's completion outcome unknown?
- Can USB control coexist with a Wi-Fi camera without making a second **control** connection?
- What is the minimum safe timeout and backpressure limit for serial at 115200, including full-program readback?

## References

**OpenSpindle implementation**

- [`electron/machine/node-ports.ts`](https://github.com/passeride/openspindle/blob/main/electron/machine/node-ports.ts)
- [`src/machine/core/ports.ts`](https://github.com/passeride/openspindle/blob/main/src/machine/core/ports.ts)
- [`src/machine/core/session.ts`](https://github.com/passeride/openspindle/blob/main/src/machine/core/session.ts)
- [`src/machine/core/controller.ts`](https://github.com/passeride/openspindle/blob/main/src/machine/core/controller.ts)
- [`src/machine/core/parted-completion.ts`](https://github.com/passeride/openspindle/blob/main/src/machine/core/parted-completion.ts)
- [`src/machine/firmware/makera/transfer.ts`](https://github.com/passeride/openspindle/blob/main/src/machine/firmware/makera/transfer.ts)
- [`src/machine/contract/snapshot.ts`](https://github.com/passeride/openspindle/blob/main/src/machine/contract/snapshot.ts)
- [`src/features/device/device-picker.tsx`](https://github.com/passeride/openspindle/blob/main/src/features/device/device-picker.tsx)
- [`electron/machine/index.ts`](https://github.com/passeride/openspindle/blob/main/electron/machine/index.ts)
- [`docs/architecture.md`](https://github.com/passeride/openspindle/blob/main/docs/architecture.md)

**External behavior and implementation references**

- [Makera Z1 Quick Start: connection modes](https://wiki.makera.com/en/Z1/QuickStart)
- [Makera firmware: motion-control source (not complete bridge firmware)](https://github.com/MakeraInc/MakeraZ1Firmware)
- [Carvera Community Controller: USBStream](https://github.com/Carvera-Community/Carvera_Controller/blob/main/carveracontroller/USBStream.py)
- [Carvera Community Controller: WIFIStream](https://github.com/Carvera-Community/Carvera_Controller/blob/main/carveracontroller/WIFIStream.py)
- [Carvera Community Controller: Makera framed protocol](https://github.com/Carvera-Community/Carvera_Controller/blob/main/carveracontroller/protocols/makera.py)
- [Carvera Community Controller: XMODEM transfer modes](https://github.com/Carvera-Community/Carvera_Controller/blob/main/carveracontroller/XMODEM.py)
- [Carvera Community Controller: releases](https://github.com/Carvera-Community/Carvera_Controller/releases)
