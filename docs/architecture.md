# Architecture

OpenSpindle is an Electron desktop app with a React renderer. This document covers the layers, what each one owns, and the patterns that tie them together. The workspace model has its own document: [workspace-model.md](workspace-model.md).

The renderer is served from the privileged `app://openspindle` scheme with a strict content security policy. The sandboxed preload only hands the page a MessagePort; every file, menu, storage, plugin and machine request is a typed, validated RPC call to the main process (`src/platform/contract`). The renderer refuses to start outside the app.

An RPC endpoint (`packages/rpc`) serves at most 64 calls at once per budget, a method's `budget` in its contract; beyond that, and for a request whose ID is still in flight, it answers `BUSY`. The calls plugin views make in the main process count against a budget of their own, so plugins never hold up the app's calls, and Stop counts against none. The main process's host connection, the renderer's and each plugin frame's log what the peer is never told: the first of each run of events or results that fail the contract, which they drop or refuse, and every handler failure that is not an `RpcError`, with its stack.

## Layers

```
electron/main/        the main process: window, app:// protocol, menus, services, machine host, plugin host
electron/preload/     a generic bridge that hands the renderer one RPC MessagePort
packages/rpc          typed RPC: Zod contracts, endpoints, cancellation, subscriptions, transports
packages/plugin-core  plugin manifest v2, capabilities, template engine, contracts, installer pipeline
packages/plugin-sdk   the plugin author SDK: definePlugin, hooks, ui kit, companion server, CLI
src/machine/          the machine domain (host-agnostic; runs in Electron main and the simulator)
src/domain/           the workspace domain: plates, operations, tools, stock, fixtures and machine kits, stored anchors, NC reading, compile, auto-level, auto Z-height, auto-scan, 3D probing, design rules (pure)
src/formats/          file formats: plate envelope, STEP-NC project, shared base64 JSON, GLB models, the tool library
src/lib/              generic building blocks with no domain knowledge: zip reading, three.js helpers, appearance
src/persistence/      versioned repositories: the tool and stock libraries, the fixture library; the Models library
src/platform/         the Host (the main process over RPC), RPC clients, machine hooks
src/app/              application state: TanStack stores, command dispatch, diagnostics, plugin broker
src/features/         UI features: shell, prepare, job, device, tool library, models, project, plugins, design rules, workspace settings
src/routes/           thin TanStack Router file routes: /prepare, /job, /device, /settings
src/components/       shadcn ui components and shared workspace components (bed viewer)
src/plugin-runtime/   the sandboxed plugin frame (built separately into plugin-frame/)
plugins/              plugins that come with the app (the PCB plugin), built into out/plugins/
tools/z1-simulator/   a development-only Makera Z1 simulator
```

Dependencies point downward: features use app and domain; app uses domain, formats, persistence and platform; the domain uses nothing above it. ESLint enforces the boundaries that matter most:

- `src/machine` imports no React, TanStack, Electron or Node module; host capabilities are injected through `src/machine/core/ports.ts`.
- `src/domain` imports nothing from `src/app`, `src/features`, `src/components`, `src/platform`, `src/persistence`, `src/formats`, `src/routes`, `src/plugin-runtime` or `src/lib`: it is the pure domain, and file formats such as the tool library import it, not the reverse. `src/lib` imports no other layer at all: it is generic building blocks.
- `packages/*` stay host-agnostic (no DOM, no Node) unless a subpath says otherwise.
- The renderer never imports Electron or the machine core, only the machine contract.

## The machine

One `MachineController` (Facade) owns the only connection. Everything reaches it through a `MachineGateway`, a Protection Proxy per principal: the app, the system (menu Stop), or a plugin, whose grants allow reads and accessories only. The controller lives in Electron main; the renderer receives snapshots pushed into the TanStack Query cache and sends commands as mutations. Its status polling, its watchdog and Stop run on the main process's event loop, so the main process asks its questions and reports its errors in sheets on the window (`dialog.showMessageBox(window, …)`): synchronous dialogs, and on macOS any message box without a window, block that loop. Closing the window quits the app, and every quit closes it first, so the window asks before it closes: about unsaved changes, then about a running job, which quitting leaves running.

- **Firmware adapters** (Strategy): the codec, status parsing, the command catalog, the NC dialect, job protocol, completion rules, control limits, anchors (optional) and height map of one firmware family. The Makera adapter is the only one; another firmware is another adapter. The machine contract holds no machine's numbers: a command is held to the connected machine's control limits when it is admitted, and the snapshot carries those limits (null without a machine) for the controls.
- **Admission** (Chain of Responsibility): the same rules that admit a command produce `snapshot.availability`, the single source of every disabled reason in the UI.
- **Operations** (Command pattern): commands are verified by acknowledgement and telemetry; while a program streams, only job-concurrent commands are admitted and verified by telemetry alone. Reads defer until the program ends, except a height-map read at a program pause. A read asked for while one of its kind is deferred or running joins it, so one read answers the app and plugins alike.
- **Completion**: a job is complete only when the player's progress disappears after the done snapshot with the machine idle and no abort; otherwise it is stopped, failed, unverified or lost.

See [device-controls.md](device-controls.md), [device-jobs.md](device-jobs.md) and [device-height-map.md](device-height-map.md).

## The workspace

The workspace is plain immutable data (`WorkspaceState`) held in a TanStack Store. Every change is a typed `WorkspaceCommand` applied by one pure function, `applyCommand`, which returns the next state or a reason for refusing. Components read slices with `useWorkspace(selector)` and dispatch commands; nothing mutates state in place.

Compiling a plate is pure and cached per plate object (a WeakMap), and so are its diagnostics (`plateDiagnostics`), so any component can ask for a compiled program without coordinating. Problems are `Diagnostic`s, never exceptions: errors block Run and export, warnings inform, and each says what it is about (the plate, its setup, an operation or a tool) and, when it has one, its place on the bed or its lines in the program, which the 3D view marks; each can carry a quick fix ([workspace-model.md](workspace-model.md#diagnostics)).

A plate is compiled for its machine: the kit of the device it is set up for, else the kit its fixtures come from, else the default kit a new workspace starts from (`kitForPlate`, `src/domain/fixtures/catalog.ts`). Compiling and the operation kinds ask the kit for what is the machine's own: its clearance retract, the NC that sets a work offset, which of its blocks an operation may hold beyond plain three-axis machining, the park its CAM ends programs with, its probe's grids and touch-offs, and its CAM's toolpath markers. The 3D view draws each plate on its own machine's bed, with its probe's grids and touches. Every reader of NC, the preview, combining and Run's dialect, takes a line's words from one lexer in the machine contract (`readNcBlock`, `src/machine/contract/nc-block.ts`), so they refuse the same lines.

Operation kinds form a registry (Strategy): how a kind becomes NC, its phase, what it validates while editing and what it checks before Run. Auto-level, auto Z-height, auto-scan and 3D probing are kinds whose NC is generated from their parameters (and, for auto-scan, the plate's toolpath bounds) when compiling. They plan in machine-neutral terms and ask the machine's `Probe` (Strategy, `src/domain/probing/probe.ts`), which its fixture kit provides, for their defaults, ranges and NC; the Makera Z1's wired Probe 2.0 is in `src/domain/fixtures/makera-z1/wired-probe/` and its 3D Probe's routines in `src/domain/fixtures/makera-z1/3d-probe/`. A machine without a probe offers no probing operations.

The compiled program is the NC as written, in work coordinates. How the machine's firmware moves for what the NC leaves to it (tool changes, probing routines, machine coordinates) is its kit's `FirmwareModel` (Strategy, `src/domain/firmware/firmware-model.ts`); the 3D view draws each plate's machine program, the NC parsed with it and placed by the plate's setup ([firmware-preview.md](firmware-preview.md)).

## State and persistence

- **Stores**: the workspace and the fixture library are TanStack stores created at startup and shared through `createStoreContext`. The workspace starts as a new project on every launch, on the stored libraries (`libraryTarget` binds only them); a project is kept only by saving it as a file, and the host asks before a window with unsaved changes closes. A reload of the page (⌘R, or the dev server's after a code change) keeps the workspace: as the page goes away it hands its project to the main process, which holds it in memory only (`KeptWorkspace`), and the next page restores it with its unsaved state (`keepWorkspaceAcrossReloads`). A crashed page kept nothing newer, so its reload starts a new project; a page whose crash repeats (three times within a minute) is not reloaded again, and shows an error instead. UI state that crosses components (the open dialog, the tree's section selection, the Job session) lives in small atoms or stores next to its feature.
- **History**: the workspace and the fixture library each record the user's edits in a `History` (`src/app/workspace/history.ts`) as the states before and after each edit, which share what the edit left alone; changes that are not edits (the selection, what a device reports, saving) are noted and outlast undo and redo. **Edit › Undo** and **Redo** raise `edit.undo` and `edit.redo`: the renderer undoes the focused text field's typing, else the history of the section on show, and a plugin view or the developer tools undo their own typing in the main process ([workspace-model.md](workspace-model.md#undo-and-redo)). A reload keeps the workspace but starts a new history.
- **Persistence**: each stored document (the tool and stock libraries, the fixture library) is a `Repository` (a versioned `{version, data}` envelope that reads only its own version, per-item decoding, and a save checked item by item the same way before it is written) behind a `PersistedDocument` (load once, save debounced, never while load issues are unresolved). `bindDocument` hydrates a store from its document and saves every later change. The fixture library reads each device profile with its schema (`FixtureProfilesSchema`), optimistically: a profile it cannot read is dropped with the reason, and fields a profile has that the schema does not keep are left out, both named in the load issues. The main process writes JSON files atomically in the user data folder.
- **Load issues**: anything that cannot be restored blocks saving and opens a dialog: save a copy, continue without it, or clear and start fresh (both back up first).
- **Models library**: uploaded CAD models live beside the documents, behind `host.models` (`ModelLibrary` over a folder per model in the app's data folder). A model is identified by its mesh's SHA-256 and every entry is verified by the store itself, which never overwrites a record it cannot read; STEP files are tessellated in a worker, loaded only when needed. See [models.md](models.md).

## UI

- **Routes**: `/prepare`, `/job` and `/device` share the `_workspace` layout (tabs, the job indicator, the dialog host, window-wide drop import, menu commands). Search params hold UI selection (the selected operation, the inspector panel); the selected plate lives in the workspace.
- **Dialogs**: one typed dialog atom and one host that renders it; features open dialogs by value.
- **Async work**: TanStack Query mutations with a shared workspace scope serialize imports, project open and save; errors surface as sonner toasts or inline alerts.
- **Components**: shadcn (Base UI) components with their variants; forms use TanStack Form with Zod schemas; long lists use TanStack Table and TanStack Virtual; layout uses Tailwind utilities only.

## Errors and logs

Problems the user can act on are `Diagnostic`s. An error in the app's own code is a bug: it reaches the user with an ID, the log and a way to report it.

- **The log** is one file in `~/Library/Logs/OpenSpindle` (a dev run's in `logs` in its data folder), written by the main process (`electron/main/diagnostics/log.ts`) for both processes. Past 4 MB it becomes `openspindle.1.log` and a new file starts. The renderer's `log` (`src/app/errors/log.ts`) sends its records in batches (`diagnostics.log`). Settings › Debug level leaves out the records below it: machine connection and job changes, update checks, window crashes and failed queries and mutations are recorded at Info and Warning; at Debug the renderer also records Sentry's breadcrumbs (clicks, navigation, fetches, console messages). Every line the log writes, other than debug lines, is also a Sentry breadcrumb (its first line), so error reports carry the log's last lines. Code logs through these, not `console`.
- **Error reports** go to Sentry when the build has a DSN (`SENTRY_DSN`, built into the main process; [releasing.md](releasing.md#error-reports)); without one, errors are logged with a local ID and the rest works alike. The renderer's SDK (`@sentry/electron/renderer` with `@sentry/react`, started first by `src/app/errors/instrument.ts`) hands its events to the main process's over the bridge the preload exposes, in IPC mode Classic: no privileged `sentry-ipc://` scheme, whose fetches would bypass the page's content security policy. The main process decides what leaves the Mac (`ErrorReports`, a gate on Sentry's transport). With Settings › Send error reports automatically on, as it is until the user turns it off, everything goes. Otherwise an error is kept back, the last 20 of them, until the error dialog's **Send report** releases it by its event ID; feedback, which only the user sends, always goes, with its attachments (the log, the project); sessions are dropped. Sent reports wait in Sentry's queue while the Mac is offline. Reports carry no user, IP address or host name (`sendDefaultPii: false`).
- **Where errors show**: a route that throws shows `ErrorFallback` in its place (TanStack Router's `defaultErrorComponent`, reported by `defaultOnCatch` with its component stack): in a workspace section the tabs stay, elsewhere it fills the window. `AppErrorBoundary`, around the router, catches the rest. Unhandled errors of the window (Sentry's global handlers and its wrappers of timers and event listeners) and of the main process (its `uncaughtException` and `unhandledRejection` handlers, sent as `diagnostics.mainError`) show in a toast. A failure before the window exists, during startup, has nowhere to show a toast: it is logged and shown in a dialog box, and the app quits. The fallback and the toast's **Report…** open the same dialog (`src/features/error-report`): the error and its event ID, which the log records beside the error, a description, the attachments, **Download log** and **Open GitHub issue**.

## Plugins

Plugins run in sandboxed frames (opaque origin, strict CSP) and reach the app only through a typed RPC API whose methods each require a capability granted at install. A broker (Mediator) maps plugin calls onto the same workspace commands and machine gateway the app uses. Companions are local helper programs that the app starts and stops for a plugin's views. The plugins that come with the app are built with it and installed from its own files at start, through the same pipeline. See [plugins.md](plugins.md).

## Patterns at a glance

| Pattern                 | Where                                                                  |
| ----------------------- | ---------------------------------------------------------------------- |
| Facade                  | `MachineController`                                                    |
| Protection Proxy        | `MachineGateway` principals; plugin capability guard                   |
| Strategy                | firmware adapters; operation kinds; machine probes and firmware models |
| Chain of Responsibility | machine admission                                                      |
| Command                 | machine operations; workspace commands (`applyCommand`)                |
| Observer                | telemetry store; TanStack stores and atoms                             |
| Mediator                | plugin broker                                                          |
| Specification           | the Job tab's run checklist                                            |
| State                   | the job view (`deriveJobView`)                                         |
| Repository              | persisted documents                                                    |
