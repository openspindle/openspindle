# Always-on monitor host

The Node host keeps one machine owner in a worker thread, separately from HTTP uploads and browser clients. It shares the desktop firmware adapter, program-preparation worker and job-history service. The browser shows the persistent inbox, nominal material removal, the desired finished part, machine progress, optional camera and past jobs. Refreshing/closing a browser does not end the machine connection or erase the selected job.

This first host release is **monitor-only in the browser**. It has no HTTP endpoint for Run, jog or arbitrary NC console commands. Deliberate local terminal commands can connect, Run a reviewed package, pause/resume and Stop through the existing machine gateway. A service started without a terminal has monitoring/receiving only. Full browser control, the complete desktop preflight workflow and control leases are later roadmap milestones. Do not confuse this preview with a physically verified machining workstation.

## Build and start

Requires Node 22.18 or later and the repository's npm dependencies:

```sh
npm ci
npm run build:host
# Set OPENSPINDLE_HOST_TOKEN to a newly generated access key of >=32 characters.
# Keep it in a protected environment file, not in shell history or a project.
npm run start:host
```

| Environment variable | Purpose / default |
|---|---|
| `OPENSPINDLE_HOST_TOKEN` | Required access key; never returned by the API or printed by startup |
| `OPENSPINDLE_HOST_BIND` | Listener address; defaults to `127.0.0.1` |
| `OPENSPINDLE_HOST_PORT` | HTTP port; defaults to `3210` |
| `OPENSPINDLE_HOST_DATA` | Persistent data directory; defaults to `./openspindle-data` |
| `OPENSPINDLE_HOST_ORIGIN` | Public browser origin when served through a TLS proxy, e.g. `https://cnc.example` |
| `OPENSPINDLE_MACHINE_HOST` | Optional explicitly configured IPv4 CNC/simulator address; connects once at startup |
| `OPENSPINDLE_MACHINE_PORT` | CNC/simulator port; defaults to `2222` |

Open the host URL and enter the access key. The browser keeps the key in memory, not a URL, cookie, saved project or local storage. Use TLS through a same-origin reverse proxy for LAN access, or an SSH tunnel to the default loopback listener. There is no permissive CORS or password-in-query mode. All `/api/` routes require Bearer authentication. `/health` returns only `{status:"ok"}`. The host restricts cross-origin requests, upload size/concurrency and request rate. No API reads arbitrary host paths or executes shell commands.

The sample `host/deploy/openspindle-host.service` assumes an installed checkout in `/opt/openspindle`, a dedicated `openspindle` user, a mode-0600 `/etc/openspindle-host.env` and writable `/var/lib/openspindle`. Set `OPENSPINDLE_HOST_DATA=/var/lib/openspindle`. It is a receiving/monitoring service: stdin commands require running interactively instead. Service restart recovers records as interrupted/unknown; it never resumes a job. A data-directory owner lock prevents two hosts sharing that state directory. Do not connect a second controller to the same CNC.

## FreeCAD handoff

In Makera Bridge preferences, set **Vertsadresse** and its local access key. An empty address retains the local desktop flow. Send job/operation still publishes a complete local snapshot first, then POSTs its `.ospjob` to `/api/inbox`. HTTPS certificate validation is on; redirects are refused. HTTP is accepted only for loopback/tunnel addresses. A successful receipt includes an inbox ID, matching package SHA-256 and `received_not_started`. Failed or ambiguous writes are never automatically retried. The monitor page opens without putting credentials in its URL. The key lives in local FreeCAD preferences, not in the job or exported metadata; protect the local preferences file.

Shared-tool import/publish commands can use the same host. `GET /api/tools` returns an ETag. `PUT /api/tools` requires `If-Match` with that revision (or `*` only for an absent library). FreeCAD asks before changing an existing tool definition and merges other IDs. A concurrent change refuses the write and requires a fresh review. The desktop library's `.osptools` workflow is also available offline.

## Local control and state

Interactive stdin commands are:

- `status` and `discover` read machine state/discovery.
- `connect <IPv4> <port>` explicitly chooses one connection.
- `run <inbox-id> <package-sha256>` starts that exact reviewed package through the machine gateway. Both the stored package hash and its embedded NC hash are rechecked. The expected connection ID is bound to Run. Review work zero, installed tools, clamps and the original program first; the browser overlay is not a physical setup check.
- `pause`, `resume` and `stop` use existing verified commands and never retry motion automatically.

`state.json` keeps selected inbox ID and the association between a Run and its package. Deterministic geometry plus the owner's reported line reconstruct the nominal visualization; a server-side GPU scene is not needed. The preview is in the NC work frame, not a full machine/fixture collision scene. Three-axis flat/V-bit removal requires dimensioned tool comments; unsupported cycles, raw probing, rotary axes or unavailable geometry show a reason rather than invented removal. This monitor previews at 512 intervals along the longest stock side. Unknown/offline physical outcomes must be read as unknown.

The inbox keeps at most 100 immutable packages/2 GiB. Back up `inbox`, `state.json`, `shared.osptools` and `job-history`. Move older, inactive inbox packages and their metadata out of the data directory to free space. Job history retains its own explicit deletion controls and limits. Desktop history exports complete ZIPs including camera JPEGs; browser history downloads the full NC/context record as JSON and shows camera frames separately. Camera recording occurs only while an explicit camera subscription is active; it is never enabled by receiving a job.

## Transport and validation limits

This host currently uses the existing TCP transport. **USB is not implemented by this branch.** Follow ADR 0001 for the FTDI identity/driver, handshake, framing and 128-byte transfer work. USB control would still require a separate network camera source. No serial connection, unplug handling or physical Z1 run has been verified here.

Desktop and host builds, typechecking, lint and formatting must pass before review. Live FreeCAD round trips, browser GPU visuals, service recovery during a real run, camera timing and physical control require operator verification. No automated tests were added or run under the repository's current testing rule.
