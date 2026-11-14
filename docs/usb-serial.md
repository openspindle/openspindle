# USB serial connection

USB serial is available in the desktop device picker and the standalone Node host. It shares the machine owner, Makera frame decoder, command admission, Stop, job execution, history and upload/readback verification with TCP. It is an experimental implementation pending physical Z1 and packaged Windows/macOS/Linux verification; it is not a verified production transport yet.

## Desktop

Open the device card in Prepare, choose **Scan USB**, then **Connect** beside the FTDI device. Scanning only enumerates ports. Close Makera Studio and other controllers first. The reported model must pass the existing framed identity handshake before commands become available; controls also require fresh telemetry.

Choose **New USB profile**, or explicitly choose the existing profile for this physical machine to retain anchors and bed setups when switching between Wi-Fi and USB. A reported-model mismatch refuses the association. A matching model alone does not prove two endpoints are the same physical machine: select the profile deliberately. A new USB profile uses the adapter's hashed hardware identity, not a changing COM/tty path. Adapters without a unique serial number use a path-based identity and must be selected again after reconnection. The application never guesses a TCP-to-USB identity association.

The optional **Camera IP address** is a separate local IPv4 address used only for the camera WebSocket. USB requires no network address for machine control. Camera recording remains opt-in through the existing camera control.

Disconnect, cable removal, I/O failure and write backpressure end the session. Pending command outcomes remain unknown; they are never replayed. The desktop does not automatically reopen a saved USB endpoint at launch, after unplugging, or after an explicit machine Reset. Select the endpoint again and inspect machine state before another action. Closing a connection is not proof that a running program stopped; use the physical emergency stop when necessary.

## Host

Run the host interactively, then use:

```text
usb
connect-usb <id-from-usb-list> [camera-IPv4]
status
disconnect
```

The host lists FTDI candidates and resolves the selected ID again immediately before opening. It never accepts an arbitrary serial path. The desktop profile association UI is not exposed by this terminal command; the host uses a stable USB profile identity.

After verifying your particular machine's behavior on open, an operator may explicitly configure `OPENSPINDLE_USB_ID` with a unique hardware ID (`usb:…`, not a path-only `usb-path:…` ID) for one connection attempt at host startup, and optionally `OPENSPINDLE_CAMERA_HOST`. Configure either this USB ID or `OPENSPINDLE_MACHINE_HOST`; setting both is refused. There is no retry, reconnect loop or job resume. A service startup opens the configured port, so verify the driver/firmware does not reset the machine on open before enabling service startup. FreeCAD continues sending packages to the host's authenticated inbox; receiving a package never starts it. Browser access remains monitor-only.

## Protocol and packaging

- 115200 baud, 8 data bits, no parity, one stop bit, no hardware/software flow control.
- No explicit DTR/RTS changes, flushing, baud probing, initialization text or reset command during connection. `hupcl` is disabled. Operating systems/drivers may still change control lines on open: absence of an application toggle does not prove absence of a hardware reset.
- The handshake sends existing read-only identity/status queries. Automatic clock setting is disabled for serial sessions. Existing automatic anchor inspection reads the saved file only when admitted.
- USB file transfers announce 128-byte blocks; TCP retains 8192. Full byte-for-byte readback and checksum validation remain mandatory before Run. Configuration downloads and uploads use the same transport limit. Overall preparation limits scale with size and a conservative serial throughput; idle transfer steps still time out. Stop can interrupt preparation.
- Serial writes have a 64 KiB outstanding-byte cap and a ten-second completion limit. Overflow, write error or removal closes the session and marks pending outcomes unknown.
- `@serialport/stream` and `@serialport/bindings-cpp` are production dependencies, kept external to desktop/host bundles. Electron packaging includes their dependencies and unpacks the native binding/prebuild directory and its loader. N-API prebuilds are used without an Electron ABI rebuild. A host installation needs production dependencies beside `dist-host`; copying the bundle alone is insufficient.

On Windows, install the FTDI VCP driver if the device does not appear. On Linux, grant the dedicated user access using the distribution's serial-device group/udev policy (often `dialout`); log in again after changing groups. Do not run the whole controller as root. macOS generally exposes `/dev/tty.*` and `/dev/cu.*` ports with its FTDI driver. Permission, busy-port and removed-device failures are reported separately.

## Verification gate

Before treating USB as ready for machining, record the Z1 firmware, OS/driver and VID/PID, then verify read-only identity/status; no reset on open/close; idle Stop; a small non-cutting upload with complete readback; controlled pause/resume/Stop; and unplug/reselect behavior with honest unknown outcomes. Verify the installed native package on Windows x64, Linux x64 and both macOS architectures. Follow the fuller matrix in [ADR 0001](../adr/0001-reliable-z1-connection-and-usb-transport.md). No physical machine is available in this development environment.
