# ADR-0001: Resilient Z1 connections and USB serial transport

- **Status:** Proposed
- **Date:** 2026-11-10
- **Scope:** Makera Z1 / Z1 Pro device communication, health detection, and recovery
- **Decision owners:** OpenSpindle maintainers
- **Implementation status:** Design only; no runtime behavior changed by this ADR

## Context and problem

A Z1 user reports intermittent disconnections from OpenSpindle over Wi-Fi. This is not yet a diagnosed radio failure. OpenSpindle can deliberately close a healthy TCP socket when status replies are delayed, and the existing implementation does not attempt recovery after an ordinary unexpected disconnect. A disconnection while cutting is especially serious: the Z1 can continue executing an uploaded program, while OpenSpindle loses its progress view and the ability to issue software Stop.

The Z1 officially supports a USB cable as a control connection. Community Carvera Controller also implements serial USB control of the Z1. OpenSpindle currently cannot select or use that connection.

We need **two complementary changes**, not just a new connection picker: (1) make network failures observable and recoverable without duplicating any machine action, and (2) add correctly framed, USB-compatible serial control and transfers.

### Verified state of this repository (main at 5f0f23437e0f67cae64d539c0e0ee2d8f34f25b7)

| Area | Observed behavior | Relevant code |
| --- | --- | --- |
| Transport | The machine port is a Node TCP socket; UDP is for passive discovery; there is no serial port implementation. | [node-ports.ts](../electron/machine/node-ports.ts), [ports.ts](../src/machine/core/ports.ts) |
| Session | `MachineSession` owns a single TCP stream, its firmware parser, handshake (8 s), and status polling (1 s normally, 250 ms when busy). | [session.ts](../src/machine/core/session.ts) |
| Health | After 5 s of polling intervals without a **status response**, the session closes, even if TCP has not failed. Outstanding status requests are rate-limited to 1.5 s. Polling is explicitly suspended during file transfers. | [session.ts](../src/machine/core/session.ts) |
| Reconnection | One remembered network endpoint is attempted on app launch; a special retry loop exists after an explicit firmware Reset. There is no general reconnect loop for lost sessions. | [index.ts](../electron/machine/index.ts), [last-device.ts](../electron/machine/last-device.ts), [controller.ts](../src/machine/core/controller.ts) |
| Loss handling | `onClosed` drops the session, calls the job tracker's `disconnected()`, aborts pending work, and clears the current lockout; it does not reattach to the running machine. | [controller.ts](../src/machine/core/controller.ts) |
| Identity | Connect targets, discovered devices and connected devices all assume `host` + `port`; `machineId` uses model + announced name for fixtures. | [snapshot.ts](../src/machine/contract/snapshot.ts), [device-picker.tsx](../src/features/device/device-picker.tsx) |
| File delivery | `MakeraTransfer` is hardcoded to **8192-byte blocks**, followed by full readback; the job runner uses conservative network transfer rates and no replay of a motion command. | [codec.ts](../src/machine/firmware/makera/codec.ts), [transfer.ts](../src/machine/firmware/makera/transfer.ts), [job-runner.ts](../src/machine/core/operations/job-runner.ts) |
| Camera | The camera is a separate WebSocket built from the connected device's network host, currently `ws://<host>:82/ws_video`. | [adapter.ts](../src/machine/firmware/makera/adapter.ts), [camera.ts](../src/machine/core/camera.ts) |

### External evidence and an important USB difference

1. [Makera's official Z1 Quick Start](https://wiki.makera.com/en/Z1/QuickStart) explicitly lists USB, the built-in Wi-Fi hotspot, and LAN Wi-Fi as control connection methods.
2. [Carvera Community Controller's USBStream](https://github.com/Carvera-Community/Carvera_Controller/blob/e5623ece10309597d43a708dde35ae41c7854cb8/carveracontroller/USBStream.py) opens serial at **115200 baud, 8 data bits, no parity, one stop bit**, without software/hardware flow control, and manipulates DTR on open. This is evidence of one working controller implementation, **not** proof that all Z1 firmware versions react identically to DTR.
3. The community controller's [Makera protocol implementation](https://github.com/Carvera-Community/Carvera_Controller/blob/e5623ece10309597d43a708dde35ae41c7854cb8/carveracontroller/protocols/makera.py) uses the Makera binary framing, not an unframed G-code stream. The existing [OpenSpindle codec](../src/machine/firmware/makera/codec.ts) implements the same frame envelope: 0x8668 header, big-endian length, frame type, payload, CRC-16, 0x55AA footer.
4. **Critical:** the community controller's [XMODEM framed-transfer code](https://github.com/Carvera-Community/Carvera_Controller/blob/e5623ece10309597d43a708dde35ae41c7854cb8/carveracontroller/XMODEM.py) uses **128-byte data blocks for USB** and **8192-byte blocks for Wi-Fi** (see `_framed_packet_size`). Simply replacing TCP with serial while retaining OpenSpindle's 8192-byte transfer blocks is not a valid USB implementation. [Z1 firmware SerialConsole.cpp](https://github.com/MakeraInc/MakeraZ1Firmware/blob/8ae81f3b1b092ca55842cf4f875c8169631de9e2/src/modules/communication/SerialConsole.cpp) also shows a bounded framed UART receive buffer, corroborating the need for transport-aware transfer sizes.
5. [Community Controller release notes](https://github.com/Carvera-Community/Carvera_Controller/releases) record previously fixed USB-only failures: DTR/boot-time false disconnects, failed higher-baud upgrades, reconnecting to the wrong transport, and serial device selection instability. These are relevant hazards to validate in OpenSpindle, not functionality to copy blindly.

**Unknown until hardware verification:** whether the user's exact Z1 reports a stable VID/PID/serial; whether opening its port resets any controller; the default protocol/mode of each firmware revision; the negotiated file-transfer behavior; and whether any camera network address is available while machine control is USB-only.

## Decision

**Adopt an explicit, mutually exclusive control-transport abstraction (TCP or USB serial), implement USB as a separate stream provider with transport-specific transfer capabilities, and add a conservative connection-health/recovery state machine.** Preserve the existing single-owner machine process, firmware adapter, command admission, verified-command semantics, and explicit Run/Stop actions.

An unexpectedly lost connection may be re-established automatically only where opening it is proven non-disruptive. Re-establishing **communication is never permission to repeat a command, replay an upload, start a program, continue a multipart job, or declare the original job complete**.

The operator continues to have a physical emergency-stop requirement. An inaccessible machine cannot be stopped reliably by software.

### 1. Separate endpoint, physical stream, firmware, and identity

Introduce a discriminated `ConnectTarget` while retaining a migration path for old persisted TCP targets:

~~~ts
type ConnectTarget =
  | { kind: "network"; host: string; port: number; name?: string }
  | { kind: "serial"; identity: SerialIdentity; path: string; name?: string }

type SerialIdentity = {
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
  locationId?: string;
};

interface ByteConnection {
  write(bytes: Uint8Array): void;
  destroy(): void;
}

interface ByteConnector {
  connect(target: ConnectTarget, events: StreamEvents): ByteConnection;
}
~~~

The exact names are illustrative, not a mandate to refactor unrelated code. The machine process remains the sole owner of the control stream. Keep a network connector and serial connector behind one validated, host-injected interface in `src/machine/core/ports.ts`. Implement serial only in `electron/machine/`; do not import Node/native modules into `src/machine` or the renderer.

Treat **physical endpoint** (IP/port or serial device), **firmware identity** (reported Z1 model and name), **connection instance** (new UUID per handshake), and **optional camera endpoint** as distinct concepts. The fixture/height-map ID must not change just because the same Z1 switched from Wi-Fi to USB. Maintain backward compatibility for `machineId`, stored profiles and existing `last-device.json`. The new stored-target version should preserve old version-1 network entries.

Discover USB ports via OS enumeration, not UDP. Prefer persistent VID:PID:serial identity for matching a previously selected USB device; a COM number or `/dev/tty*` path is only a current locator and can change. If serial number is unavailable, show the candidate port details and require deliberate selection; do not silently claim another serial device. A known FTDI interface can be ranked, but do not assume every valid Z1 must have one hardcoded VID/PID.

**Only one control connection at a time.** Do not hand off an executing job between TCP and serial automatically. Connecting to another transport uses the existing leave-running-job confirmation rule.

### 2. USB serial provider

Use a maintained Electron-compatible serial library, e.g. `serialport`, pinned and packaged for the actual Windows/macOS/Linux targets. The chosen integration must support prebuilt or rebuilt native modules for Electron, ASAR unpacking where necessary, and the project's installer/updater; validate installed packages, not only `npm run dev`.

Start with **115200, 8N1, no XON/XOFF, no RTS/CTS**, subject to the hardware gate below. Preserve raw bytes and all frame boundaries through the existing `FrameDecoder`; serial read events may split or coalesce arbitrary frames. Serial write completion/drain, backpressure, write errors, unplug detection, and port-exclusive ownership need explicit handling. Never convert framed binary to text.

**DTR/RTS is a safety gate.** On some controllers the host asserting/toggling DTR while opening can reset hardware. A USB reconnection attempt during cutting is unacceptable until a real-Z1 experiment proves the chosen driver/open sequence does not reset either controller or disturb motion. Explicitly control DTR/RTS if supported; note that controlling them *after* port open may be too late to prevent a transition. If nondisruptive open cannot be demonstrated, disable automatic USB reconnect during active/unknown machine state and require deliberate operator action. Do not use serial opening as a reset mechanism.

Remote firmware Reset over USB is **unsupported by default** until its exact behavior has been demonstrated; adjust `reset` availability using transport capabilities. No silent baud upgrade. Any higher-baud support must be negotiated only with known compatible firmware and verified after switching before use.

### 3. Transport-aware Makera file transfer — mandatory for USB

Refactor `MakeraTransfer` to take a validated transfer capability, including the per-transport block size:

- TCP/Wi-Fi: retain the proven 8192-byte default.
- USB: start with **128-byte blocks** as shown in Community Controller.
- Encode the negotiated packet count and block size in `PTYPE_FILE_VIEW` and calculate sequence, payload offsets, bytes sent and readback boundaries from that block size.
- Bound USB payloads to the receiving firmware's capability; do not use the 8192-byte constant when constructing USB `PTYPE_FILE_DATA` frames.
- Keep OpenSpindle's **upload → full readback → explicit play** transaction. Do not automatically resend data or a command after ambiguous loss; the existing narrowly scoped readback-request repeat remains subject to protocol evidence.
- Account for serial throughput and per-frame/roundtrip overhead in `preparationMs`, stall and stage deadlines; an 8192-byte frame at 115200 8N1 alone needs roughly 0.71 seconds of wire time, while 128-byte USB frames incur many more request/response exchanges.
- Suspended status polling during a transfer must not be classified as a status timeout. File-transfer progress, timeouts, connection health and UART-buffer backpressure are separate signals.

This is not just a transport configuration flag: [`transfer.ts`](../src/machine/firmware/makera/transfer.ts) assumes 8192-byte slices and [`codec.ts`](../src/machine/firmware/makera/codec.ts) currently bounds special file-data frames based on that size. Ensure the chosen capability propagates through the firmware adapter and transfer interpreter without changing normal command validation.

### 4. Diagnose failure before loosening the watchdog

Present distinct causes in the machine connection status, protocol trace and diagnostic export:

| Signal | Interpretation | User-facing outcome |
| --- | --- | --- |
| TCP error / EOF / serial unplug | Physical transport closed | "Connection lost" with OS reason and endpoint |
| Readable bytes / valid frames but no status | Firmware/status path stalled or starved, not necessarily Wi-Fi down | "Device status not responding" |
| No bytes and no status while socket still open | Link or device nonresponsive; not enough evidence to label radio failure | "Device is not responding" |
| CRC/frame parse failure | Protocol corruption/incompatibility | Named protocol error, not generic Wi-Fi failure |
| App/machine utility process restart | Host-side failure | Separate machine-process diagnostic |
| Transfer progress ongoing while polling suspended | Expected transfer mode | No false "status stale" alarm |

Record the transport kind, device endpoint (redacted as appropriate in exported reports), connection UUID, timestamp of last incoming bytes/valid frame/status, polling cadence, unanswered query duration, lifecycle state, hardware/OS error, retry attempts, operation phase and any machine-reported signal strength. Keep telemetry diagnostics small and bounded; do not dump G-code, personally identifying pathnames or arbitrary binary payloads by default.

The current 5-second watchdog is a **status silence watchdog**, not a Wi-Fi detector. Its `silentMs` counts due poll intervals, resets on a valid status and pauses during transfer. First gather traces and controlled reproduction, then explicitly model `healthy → degraded → unreachable`. Candidate *starting values for validation*, not a silently accepted timeout policy: show "degraded" at 5 seconds of eligible unanswered status queries and sever/reconnect at 10 seconds. Disable new machine-changing commands while status is degraded; an already running program's state is **unknown**, not automatically stopped. Keep hard per-command deadlines and fail closed on unsafe uncertainty. Do not solve the issue by arbitrarily increasing `STALE_MS` alone.

Provide an optional user-facing diagnostic recipe: sustained ping to the machine IP and a simultaneous OpenSpindle protocol trace. Ping success does **not** establish firmware responsiveness, but loss of ping alongside loss of status helps distinguish network issues.

### 5. Recovery is a new observation session, not a replay

Use an explicit state machine owned by `MachineController`:

~~~text
DISCONNECTED --user connect--> CONNECTING --identity+status--> HEALTHY
HEALTHY --status late--> DEGRADED --status arrives--> HEALTHY
HEALTHY/DEGRADED --link lost or deadline--> LOST
LOST --safe, configured retry--> RECONNECTING --new handshake--> RECONCILING
RECONCILING --identity and state verified--> HEALTHY (observational only)
RECONCILING --mismatch or uncertainty--> LOCKED/NEEDS_OPERATOR
LOST/RECONNECTING --user disconnect--> DISCONNECTED (cancel retries)
~~~

- The first implementation should make network reconnect **opt-in** (or restrict it to idle sessions) with capped exponential backoff and jitter, e.g. 0.5/1/2/4/8/15 seconds. Never automatically change transport. Cancel pending retries when the user disconnects, connects elsewhere, quits, or a newer connection generation starts.
- Revalidate reported model/name, fresh status, alarm, motion/hold state and relevant current file/progress if the firmware exposes them. An address or USB serial number is not sufficient proof of what is executing. Refuse control on identity mismatch or unverified critical state.
- **Never repeat** `play`, Run, a jog, a tool change, config writes, a file-start/upload, or an unacknowledged command automatically. A new Run requires another explicit operator action and the standard preflight.
- Preserve an unresolved operation/unsafe-outcome marker through disconnection and reconnection until fresh telemetry and operation-specific evidence resolve it. Today `onClosed` clears `lockout`; the implementation must not treat reconnection alone as a reason to clear a safety lockout.
- Existing `tracker.disconnected()` can mark the job `lost`. Avoid silently converting it to completed or claiming that reconnect resumes execution. First recover **machine monitoring only** and show that the machine reports Running/Paused/Idle; restoring the original job's line tracking is a separate phase requiring verified identity, known uploaded path, part number, and compatible firmware progress evidence.
- For multipart programs, the next part must never be launched automatically after a link loss unless original ownership and progress can be proven under a separately reviewed design. Otherwise demand explicit user recovery.
- Software Stop is impossible while disconnected. Always communicate this, leave hardware emergency-stop instructions visible, and never claim a lost software Stop succeeded.

### 6. UI and camera behavior

In `device-picker.tsx` show two groups: network devices (existing passive UDP discovery and manual IP) and available USB serial devices (enumerated on request and refreshed when the picker opens). Identify USB port path plus stable hardware identity, permission errors, busy/exclusive-open errors, and the selected connection method. Retain one active machine card.

Decouple the control channel from the camera's separate Wi-Fi WebSocket. A USB-only Z1 control session is legitimate with **no camera**. If the same machine's verified network address is separately available, the camera may use it as an optional independent connection; camera failure must not disconnect USB control or block Run. Do not synthesize a WebSocket URL from a serial device or opportunistically switch the control channel to Wi-Fi.

Expose concise distinctions: "Connected via USB", "Connected via Wi-Fi", "Status delayed", "Reconnecting", and "Connection lost; program may still be running." Keep all machine controls subject to the same `snapshot.availability` admission decisions.

### 7. Security, packaging, and compatibility

- Limit candidate ports to plausible hardware by default, but allow manual override only with an explicit warning. Do not send Makera framed commands to arbitrary newly appeared serial devices during background discovery.
- Maintain connection generation IDs so late callbacks from a disposed TCP socket or serial port cannot update a newer machine session.
- Persist a versioned discriminated endpoint; migrate old `last-device.json` without invalidating user profiles.
- Validate Windows COM/FTDI driver behavior and stable identity; macOS `/dev/cu.*` vs `tty.*` handling; Linux permissions and unplug/replug; Electron module ABI and packaged desktop builds.
- Keep the existing firmware-neutral core and Makera-specific framing in their existing layers. Do not copy code from Community Controller into this MIT-licensed repository: its repository is GPL-2.0. Implement from documented protocol behavior and independently verified observations.

## Alternatives considered

| Option | Assessment |
| --- | --- |
| Increase the 5-second timeout only | Rejected alone: hides symptoms without distinguishing radio loss, stalled status and firmware overload; can mask unsafe uncertainty. |
| Auto-reconnect the current TCP socket immediately | Useful as a staged network fix, but only with command non-replay and reconciliation; insufficient for USB and DTR. |
| Expose serial as a virtual TCP bridge | Rejected as primary architecture: introduces another process, timeout/error ambiguity and no transport-aware packet sizing. A temporary diagnostic bridge may still help isolate a link problem. |
| Replace the entire communication stack with Community Controller code | Rejected: Python/Kivy lifecycle differs, GPL-2.0 code cannot simply be imported into MIT implementation, and current verified-command safeguards must remain. |
| USB only, remove Wi-Fi | Rejected: wireless remains a documented Z1 mode; camera and remote control require separate network handling. |
| Transparent live failover between USB and Wi-Fi | Deferred: verifying execution ownership, serial reset behavior and in-flight file/command semantics is too risky for the initial release. |

## Implementation sequence

**Phase 0 — establish baseline and hardware gates (no application behavior changes):** Collect timestamped OpenSpindle protocol traces and a continuous ping for a reproduced disconnect. Record whether the machine is idle, uploading or cutting, router/AP mode, firmware revision, host OS, status RSSI if exposed and exact disconnect message. Test Makera Studio/Community Controller over USB with the same physical machine. Document serial port identity, DTR/RTS transitions, whether the controller reboots, framing and 128-byte transfer/readback before proceeding.

**Phase 1 — connection diagnostics and conservative network recovery:** Extend telemetry/logging; separate transport closure from status staleness; model degraded/unreachable; preserve uncertain-outcome lockout; add cancellable, opt-in network reconnect with fresh identity/state verification. No automatic command replay and no automatic resumption of multipart jobs.

**Phase 2 — serial transport and device selection:** Generalize the stream port; add Electron serial provider with read/write backpressure and hot-unplug handling, serial enumeration and picker UI, tagged endpoint/identity schemas and storage migration. Keep USB Reset disabled until validated. Package native modules on each supported desktop OS. Camera becomes optional and independent of control connectivity.

**Phase 3 — USB transfer compatibility:** Parameterize Makera file block sizing (USB 128, network 8192), frame bounds, transfer timeouts, and full readback. Demonstrate genuine upload, byte-for-byte readback and explicit start on a real idle Z1, then supervised no-cut dry runs. Maintain the current "no automatic retry of machine-changing actions" guarantee.

**Phase 4 — optional enhanced recovery:** Only after repeated real-machine evidence, consider safe USB reconnect and observational reattachment to an existing job. A separate ADR is required before automatic transport failover or continuation of multipart execution.

### Expected code touchpoints

- `src/machine/contract/snapshot.ts` — transport-discriminated target, connected identity, availability and migration contract
- `src/machine/core/ports.ts`, `session.ts`, `controller.ts`, `discovery.ts` — stream abstraction, health state, recovery policy and ownership
- `electron/machine/node-ports.ts` (or a small adjacent serial provider), `index.ts`, `last-device.ts` — native serial, lifecycle and persistence
- `src/machine/firmware/makera/codec.ts`, `transfer.ts`, `adapter.ts`, `src/machine/core/operations/job-runner.ts` — framed USB, 128-byte blocks, deadlines and reset capability
- `src/features/device/device-picker.tsx` and relevant status/diagnosis UI — transport choice and actionable failure reporting
- `src/machine/core/camera.ts` and the device camera hooks — optional network camera independent of serial control
- `electron-builder.yml` and dependencies — packaged native module support
- `README.md` and `docs/device-controls.md`, `docs/device-jobs.md`, `docs/architecture.md` — update only when these capabilities actually ship

## Validation and acceptance criteria

The following is a **plan for implementation work**, not a claim that any of these checks has run. Follow the repository policy not to add or run automated tests unless explicitly requested.

| Scenario | Required observation / pass condition |
| --- | --- |
| Normal Wi-Fi session | Existing upload/readback, camera, job progress, alarms and explicit Stop behave as before. |
| 3–7 s delayed status with socket alive | Named degraded-status diagnostic; no false claim that Wi-Fi disconnected; no motion command admitted on stale telemetry. |
| Network cable/AP loss and recovery | Lost shown promptly, controlled retries only if enabled; fresh handshake required; no NC line or motion command replayed. |
| Firmware replies malformed or only diagnostics arrive | Protocol/status-specific failure, not "Wi-Fi dropped"; logs distinguish it. |
| USB connect from a cold or warm controller | Verify 115200 8N1, identity, DTR behavior, correct framed status, and **no uncommanded movement or reset**. |
| USB unplug/replug | Clear loss reason, safe serial close, stable selection across changed COM path, no automatic restart of cutting. |
| USB upload and full readback | Uses 128-byte blocks, verifies exact bytes before explicit play; handles slow serial throughput without false status timeout. |
| Unplug or status loss during USB upload | Marks upload outcome uncertain, refuses automatic replay, and does not run unverified files. |
| Loss during an executing job | Machine may continue; UI does not report success or software Stop availability; reconnection is observational only. |
| Multipart run interrupted between parts | No automatic upload, new part, or Run is issued after link loss. |
| Camera unavailable with USB | USB controls work without camera; camera error does not tear down control. |
| Windows/macOS/Linux installed builds | USB port enumeration, ownership, native module loading, permissions and installer path validated on actual packaged artifacts. |

**Release gates:** (1) safe DTR behavior or explicit prevention of automatic USB reconnect; (2) USB transfer packet-size compatibility and full readback; (3) zero machine-changing command replay after ambiguous failure; (4) credible distinction between status timeout and physical transport loss; (5) an always-visible warning that hardware Stop is required if software control is lost.

## Consequences and outstanding questions

This design adds endpoint types, native serial packaging and reconciliation complexity, but retains one machine owner and the existing firmware dialect/command admission. The camera may be unavailable over USB-only sessions; low-baud USB uploads may be slower than Wi-Fi. The design must not promise seamless cutting recovery.

Open questions requiring a real Z1: exact USB VID/PID/serial and OS driver; whether port open toggles reset on this revision; framed-vs-legacy mode behavior by firmware; maximum sustainable throughput; precise stop/hold behavior after host loss; which telemetry proves the uploaded file and currently executing part; whether camera can be discovered independently while USB controls the machine.

## References

- [Makera Z1 Quick Start — official connection methods](https://wiki.makera.com/en/Z1/QuickStart)
- [OpenSpindle architecture](../docs/architecture.md), [running programs](../docs/device-jobs.md), [device controls](../docs/device-controls.md)
- [Community Controller USBStream, pinned](https://github.com/Carvera-Community/Carvera_Controller/blob/e5623ece10309597d43a708dde35ae41c7854cb8/carveracontroller/USBStream.py)
- [Community Controller XMODEM, pinned — USB 128 / Wi-Fi 8192 blocks](https://github.com/Carvera-Community/Carvera_Controller/blob/e5623ece10309597d43a708dde35ae41c7854cb8/carveracontroller/XMODEM.py)
- [Community Controller Makera framing, pinned](https://github.com/Carvera-Community/Carvera_Controller/blob/e5623ece10309597d43a708dde35ae41c7854cb8/carveracontroller/protocols/framing.py)
- [Makera Z1 firmware SerialConsole, pinned](https://github.com/MakeraInc/MakeraZ1Firmware/blob/8ae81f3b1b092ca55842cf4f875c8169631de9e2/src/modules/communication/SerialConsole.cpp)
- [Community Controller changelog / USB fixes](https://github.com/Carvera-Community/Carvera_Controller/blob/main/CHANGELOG.md)
