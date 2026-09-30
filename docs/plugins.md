# OpenSpindle plugins

Plugins extend OpenSpindle with reusable NC programs, their own views and local helper programs. They run sandboxed and reach the app only through its typed API. What a plugin may do is fixed when it is installed: the user reviews the requested capabilities once, and there are no per-call prompts. No capability allows motion, spindle control, overrides, pause/resume or running programs, and plugins never start machine jobs.

The platform is `@openspindle/plugin-core` (manifests, capabilities, templates, contracts, the install pipeline), `@openspindle/plugin-sdk` (what plugin authors build against), the main-process services in `electron/main/plugins/`, the frame runtime in `src/plugin-runtime/` and the workspace side in `src/platform/` (hosts), `src/app/plugin-host/` (the broker) and `src/features/plugins/` (manager, frames, dialogs).

## What a plugin contains

A plugin is a folder (or repository) with `openspindle-plugin.json` at its root and exactly the files that manifest declares:

- **Programs**: declarative `gcode-template` programs with number and boolean parameters. Templates contain only `{{parameterId}}` placeholders.
- **Toolbar items**: icons over the viewer that open a program's form or one of the plugin's importer views. Hovering one shows its label, the plugin's name and what the program (or, for a view, the plugin) does. An item's icon also marks the operations its program or view made, in the Plates list and the G-code list.
- **Views**: React views that run in a sandboxed frame, one bundle for all of a plugin's views: importers (in Add operation) and editors (for the plugin's operations).
- **A companion**: a Node or native program the app starts and stops for the plugin's views, for work a sandboxed view cannot do (running a converter, for example). Its setup step can install what it needs, such as a converter from a package manager.
- **Settings**: values the user sets on the plugin's card, which its companion receives, such as the path of a program it runs.

Some plugins come with OpenSpindle: the [PCB plugin](pcb.md) is one. They are built and installed like any other (see [Plugins that come with OpenSpindle](#plugins-that-come-with-openspindle)).

## In the app

- **Plugin manager** (the **Plugins** menu command, Add operation's **Manage plugins**, and the fix for missing plugins). It lists installed plugins with their version, programs and size, their description and source (repository and commit, development folder, or "Comes with OpenSpindle"), and their granted permissions; each can be enabled or disabled, checked for an update (a repository's latest commit) or reloaded (a development folder), and removed. Plugins that come with OpenSpindle update with it and can only be disabled. A plugin built for another plugin API says why it **Cannot run**, and stays off until it is updated. A plugin's settings are on its card: a program's full path is stored with **Save** (an empty path clears it) or picked with **Choose…**, and OpenSpindle checks it is a program the user can run. Beside the switch of a plugin with a companion are **Restart**, **Show log** and, while the companion needs setup and has a setup step, **Run setup**. What the companion last reported shows under the plugin's settings (or on its own for a plugin without settings), in place of their descriptions: a check with its message once it is ready, or what is wrong.
- **Installing.** Enter a public GitHub repository URL, or (for development) choose **Install from folder**. The plugin is downloaded or read and checked first; a review then shows its name, version (and the installed one for updates), source, each requested permission with its explanation (new ones marked for updates, dropped ones listed), a warning for companions with the programs they run, its views, programs, files and size. Nothing is installed until the review is confirmed; cancelling or closing discards it.
- **Add operation** lists, next to NC files and the built-in probing operations (auto-level, auto Z-height, auto-scan and 3D probing), the template programs of each enabled plugin that can run (a parameter form that adds the operation) and importer views (the view runs in the dialog; the operations it creates are selected, and it closes the dialog when done). Toolbar items open the same program form or importer view directly.
- **Operations** a plugin created (`plugin` operations) open the plugin's editor view in the operation inspector. The view stays mounted while the selection moves between that plugin's operations (its context's `operationId` changes), so work it started, such as a generation, finishes instead of being discarded. Template operations show their parameter form; **Apply** regenerates them, and an installed version other than the one that generated them asks for **Update**, which the operation's right-click menu in the Plates list offers too. Operations whose plugin is not installed, or cannot run, keep their data and NC; a warning with **Manage plugins** appears on them, and Prepare shows an **Install** banner for the selected plate when its plugins are not installed.
- **Dialogs and notices** plugins ask for are the app's own: the tool library in selection mode (opening on the tool types the plugin recommends) and a cutting-preset step, and confirmations, which name the asking plugin. They stay above any open dialog; closing one cancels the plugin's request, and a view that goes away cancels its open question. Notices and progress appear as toasts naming the plugin.

## Manifest version 2

```json
{
  "manifestVersion": 2,
  "id": "pcb",
  "name": "PCB",
  "version": "0.3.0",
  "description": "Gerber and Excellon operations with pcb2gcode.",
  "apiVersion": 2,
  "apiRevision": 4,
  "permissions": ["workspace:read", "operations:write", "tools:read"],
  "ui": {
    "entry": "dist/view.js",
    "styles": "dist/view.css",
    "views": [
      { "id": "importer", "slot": "process.importer", "title": "PCB" },
      { "id": "editor", "slot": "operation.editor", "title": "PCB" }
    ]
  },
  "programs": [],
  "toolbar": [
    { "id": "pcb", "label": "PCB", "icon": "pcb", "viewId": "importer" }
  ],
  "companion": {
    "runtime": "node",
    "entry": "dist/companion.mjs",
    "activation": "on-view",
    "idleShutdownSeconds": 300
  },
  "settings": [
    {
      "id": "pcb2gcode",
      "type": "executable",
      "label": "pcb2gcode",
      "description": "The pcb2gcode program, which you install yourself."
    }
  ]
}
```

| Field                                  | Meaning                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifestVersion`                      | `2`.                                                                                                                                                                                                                                                                                                                                            |
| `id`, `name`, `version`, `description` | Lowercase kebab-case ID, `major.minor.patch` version (optionally with a prerelease suffix). The ID stays bound to the source it was first installed from.                                                                                                                                                                                       |
| `apiVersion`, `apiRevision`            | The plugin API the plugin targets. This host implements API 2, revision 4 and installs only that: a plugin for another version or revision is refused, saying whether it or OpenSpindle needs an update. A plugin installed before OpenSpindle moved to another revision stays installed with its settings, but cannot run until it is updated. |
| `permissions`                          | Capabilities the plugin asks for (below). Omitted means none.                                                                                                                                                                                                                                                                                   |
| `ui`                                   | The view bundle (`entry`, `.js`/`.mjs`), optional stylesheet (`styles`) and up to 8 views, each with an `id`, a `slot` (`process.importer` or `operation.editor`) and a `title`.                                                                                                                                                                |
| `programs`                             | Template programs (below): up to 16 programs, 20 parameters each, 256 KiB per template, 1 MiB in total.                                                                                                                                                                                                                                         |
| `toolbar`                              | Up to 16 items with `id`, `label`, `icon` (`probe`, `grid`, `path`, `tool`, `pcb`) and exactly one of `programId` or `viewId`. Only importer views appear in the toolbar.                                                                                                                                                                       |
| `companion`                            | `runtime: "node"` with an `entry` (`.mjs` for an ES module, `.js`/`.cjs` for CommonJS), or `runtime: "native"` with `executables` per platform. Optional fixed `args`, `activation` (`on-demand` or `on-view`) and `idleShutdownSeconds` (10 to 86400, default 300).                                                                            |
| `settings`                             | Up to 16 values the user sets on the plugin's card, which its companion receives (below): each with an `id`, a `type` (`executable`: a program on this computer, by its full path), a `label` and an optional `description`. Only a plugin with a companion can have settings.                                                                  |
| `files`                                | Other files the package ships (runtimes, licenses, assets). Program templates, the view bundle and styles, and the companion are included automatically.                                                                                                                                                                                        |
| `executables`                          | Files from `files` the companion runs (up to 64), installed with execute permission. Only plugins with a companion may list them. The review lists them.                                                                                                                                                                                        |
| `platforms`                            | Restricts the plugin to these platforms (`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `win32-arm64`, `win32-x64`).                                                                                                                                                                                                                 |

Every path is package-relative and POSIX: segments of ASCII letters, digits, `_`, `-`, `+` and inner dots; no absolute paths, `..`, backslashes, URL escapes, hidden segments (a leading dot) or names Windows cannot store; paths that differ only by letter case are refused. The manifest is limited to 64 KiB, a view bundle to 4 MiB and its stylesheet to 1 MiB.

A plugin needs at least one program or one view, and a companion needs a view (views are the only callers of a companion).

## Template programs

```json
{
  "id": "display-message",
  "name": "Display a number",
  "description": "Create a controller message for review.",
  "kind": "gcode-template",
  "phase": "machining",
  "file": "programs/message.nc",
  "parameters": [
    {
      "id": "number",
      "label": "Number",
      "type": "number",
      "default": 1,
      "min": 1,
      "max": 10,
      "step": 1
    }
  ],
  "requirements": ["A controller supporting M117 text messages."],
  "models": []
}
```

with `programs/message.nc`:

```gcode
M117 Number {{number}}
M2
```

- Only `{{parameterId}}` substitution exists: no expressions, loops, conditions or code. Every declared parameter must appear in its template; unknown placeholders are refused.
- Number parameters need `default`, `min`, `max` and `step` (at least 0.000001; magnitudes up to 1,000,000,000); values must be finite, in range and aligned to `min + n × step`, and are substituted as plain decimals without rounding or exponents. Optional `unit` shows a right addon and `axis` (`X`, `Y` or `Z`) a left one. Boolean parameters have a boolean `default` and substitute `1` or `0`. Both may have a `description`.
- IDs use lowercase letters, digits and hyphens; parameter IDs start with a lowercase letter and may contain letters, digits and underscores (not JavaScript property names such as `constructor`). Templates are `.nc`, `.cnc`, `.gcode`, `.tap` or `.ngc` files of UTF-8 text without control characters; `programs.import` takes file names with the same extensions.
- `phase` (`setup`, `machining` or `finish`, default `machining`) classifies the operation; it never changes, reorders or runs NC.
- `requirements` and `models` are the author's compatibility notes, not machine validation. A template is data, not a safety-certified toolpath.

Rendering happens where the verified template is: `plugins.renderProgram` in the main process, with plugin-core's `renderProgram`. Adding or applying a program never runs it.

## Capabilities

| Capability            | Grants                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace:read`      | Plates, their stock and the selection (`workspace.read`, `workspace.changed`).                                                                                                |
| `operations:write`    | The plugin's **own** operations only: list, read, create and save (`operations.*`).                                                                                           |
| `programs:import`     | Importing NC programs into the workspace (`programs.import`). Importing never runs a program.                                                                                 |
| `tools:read`          | The tool library with cutting presets, and the app's tool chooser (`tools.list`, `tools.choose`).                                                                             |
| `machine:read`        | Machine status, stored anchors and the height map (`machine.snapshot`, `machine.changed`, `machine.readAnchors`, `machine.readHeightMap`); companions get `machine.snapshot`. |
| `machine:accessories` | Switching the work light, beeper and vacuum (`machine.accessory`). Nothing that moves or cuts.                                                                                |

Besides capabilities, every view holds `view` (its own lifecycle and the app's notices, progress and confirm dialog), and plugins with a companion hold `companion` (calls to their own companion and its status). Each contract method declares the requirement it needs; the serving side's capability guard refuses anything not held before the handler runs (`PERMISSION_DENIED`), and a method without a requirement is refused as well.

Grants are the manifest's permissions, reviewed at install. An update shows which permissions are added or removed (`diffPermissions`) before it is confirmed. Machine requests are checked twice: by the guard, and again in the main process by the machine gateway, which is always constructed as `new MachineGateway(controller, { kind: "plugin", pluginId, grants })` from the installed record.

## Installing

One pipeline (`validatePackage` in `@openspindle/plugin-core`) serves every source and host:

1. **Open a source.** _GitHub_: `https://github.com/owner/repository`, optionally ending in `.git` or `/tree/<branch-or-tag>` (refs may contain slashes); private repositories, credentials, queries, fragments, other hosts and redirects are refused. The requested or default branch is resolved through the GitHub API to one immutable commit, and files are read from `raw.githubusercontent.com` at that commit with streamed size limits and request deadlines; public API rate limits and missing repositories show as errors. _Local folder_: a developer's working copy, recorded as `development: true`; files are read through symbolic links but never outside the folder. _The app_: a plugin that comes with OpenSpindle, from the app's own files (below).
2. **Read the manifest.** Plugins limited to other platforms, or without a companion for this one, are refused.
3. **Read every declared file** within the source's limits (GitHub: 64 files, 4 MiB each, 16 MiB total; folders: 1024 files, 256 MiB each, 1 GiB total), check text files are UTF-8, check each template against its program's parameters, and record a SHA-256 **inventory** of every file plus a digest over it. Files stream into a staging folder instead of being installed.
4. **Review** (see [In the app](#in-the-app)).
5. **Confirm.** The staged package moves into place and the record is written; an update keeps the enabled state and the settings the new version still declares. A plugin ID stays bound to its source (the same repository, compared case-insensitively, or the same folder), and the ID of a plugin that comes with OpenSpindle belongs to it.

Packages live in `userData/plugins/<id>/<version>/` with an `index.json` written atomically; interrupted installs leave only staging folders, which are cleared at start. Every file the app later uses (the view bundle, templates, the companion program) is read back and checked against the inventory, so a package changed after its review is refused ("reinstall the plugin"). Disabling keeps the files; removing deletes the package and the companion's data.

### Plugins that come with OpenSpindle

Their sources are in `plugins/<folder>/`, and they use only the SDK and the plugin API, as any plugin does. Every build of the app (`tools/vite/bundled-plugins.ts`, on the main process's build) builds each one as `openspindle-plugin build` would, its views from `ui/index.tsx` and its Node companion from the source that file names, into `out/plugins/<id>/`; packaged apps carry that folder among their resources, outside the app's archive.

At start, once the index is read, the app passes each of them through the same pipeline (source `bundled`) without a review: they are part of the app. A package whose digest matches the installed one is left alone; a changed one (an app update) replaces it and keeps its enabled state and settings, as does any copy of that plugin ID installed from GitHub or a folder, and installing another plugin with that ID is refused. A plugin the app no longer comes with is removed. One that fails to install is logged, and the others are unaffected. They can be disabled but not removed, and they have no update check: they update with OpenSpindle.

## Views and the sandbox

Every view runs in its own `<iframe sandbox="allow-scripts allow-forms">`: an opaque origin with no access to the app's DOM, storage, cookies or preload bridge. The frame loads the app-built `plugin-frame/index.html`, which has its own policy:

```
default-src 'none'; script-src 'self' blob:; style-src 'self' 'unsafe-inline';
img-src 'self' blob: data:; font-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'
```

(The frame document links the app's own stylesheet, so views share its theme, its fonts and the kit's styles. Fonts load with CORS and the frame's origin is opaque, so the app protocol and the dev server serve font files, and only those, with `Access-Control-Allow-Origin: *`. The app protocol and the dev server send the same policy as a header with `frame-ancestors 'self'`; the frame document also carries it in a meta tag.) A frame cannot fetch, open a WebSocket, navigate, open windows or request permissions; file inputs and dropped files work inside it. Content-Security-Policy's `connect-src` does not reach `RTCPeerConnection`, though, so the frame runtime removes `RTCPeerConnection` from the frame before any plugin code runs; a frame nested inside it is another opaque origin its script cannot reach, and the policy refuses nested frames that load anything. As a second line, the window's WebRTC use is cut to Electron's tightest settings (plugin frames share it, not a separate session, and the app itself never uses WebRTC): they stop direct and STUN peer connections, though not a relay reachable over TCP such as TURN over TLS on port 443, which Electron has no supported way to refuse. The main process additionally refuses any subframe navigation other than the frame document, cancels every request from a subframe that is not an app asset, `blob:` or `data:`, denies all permission requests and checks from subframes, and keeps Node integration off in subframes.

Startup:

1. The runtime (a classic script, `plugin-frame/runtime.js`) exposes React, ReactDOM, the UI kit, the SDK and TanStack Query on the `OpenSpindleRuntime` global, then posts a ready message to its parent.
2. The app answers from that iframe's window only, transferring a `MessagePort`; the view contract runs on it.
3. The frame calls `view.load` and receives the plugin identity, the view, its context and the bundle **as text**; the app read it from the verified package.
4. The runtime injects the plugin's styles, imports the bundle from a `blob:` URL created inside the frame, and renders the requested view inside the SDK session, with the app's light or dark appearance and the display and mono fonts chosen in Settings.

Frames report their content height (`view.resize`) and the app sizes them to it; popups (such as select lists) stay within the frame's height.

### The view contract

Served by the app to each frame (`pluginViewContract` in `@openspindle/plugin-core`). Parameters are validated against Zod schemas before any handler runs. A view has at most 64 calls running at once; more, and a call or subscription that reuses the ID of one still running, fail with `BUSY`.

| Method or event                                                                                         | Requires              | Purpose                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `view.load`, `view.resize`, `view.close`, event `view.context`                                          | `view`                | Boot data, frame height, closing (optionally showing one of the plugin's own operations), context changes (plate, operation, theme, fonts, busy). |
| `ui.notify`, `ui.progress`, `ui.confirm`                                                                | `view`                | App-rendered notices, progress and a confirm dialog.                                                                                              |
| `workspace.read`, event `workspace.changed`                                                             | `workspace:read`      | Plates, stock and selection, with an increasing revision.                                                                                         |
| `operations.list`, `operations.get`, `operations.create`, `operations.save`, event `operations.changed` | `operations:write`    | The plugin's own operations.                                                                                                                      |
| `programs.import`                                                                                       | `programs:import`     | Import NC files (up to 20): into the selected plate, or as new plates when there is none (or only the empty plate); all or nothing.               |
| `tools.list`, `tools.choose`                                                                            | `tools:read`          | Tools and presets; the app's chooser, opened on recommended tool types, and a preset step.                                                        |
| `machine.snapshot`, `machine.readAnchors`, `machine.readHeightMap`, event `machine.changed`             | `machine:read`        | Read-only machine state.                                                                                                                          |
| `machine.accessory`                                                                                     | `machine:accessories` | Light, beep or vacuum on or off.                                                                                                                  |
| `companion.call`, `companion.status`, `companion.setup`, events `companion.events`, `companion.status`  | `companion`           | The plugin's own companion.                                                                                                                       |

A tool (`tools.list`, and the chosen tool of `tools.choose`) carries its identity and vendor data (name, type, cutting diameter, flutes, vendor, product ID and URL, the vendor's description, material, grade, coating, notes and post-processor tool number), its whole geometry (lengths, diameters, angles, corner and upper radius, tips, teeth, thread pitches and profile, handedness, through-tool coolant), its shaft segments from the shoulder up, and every cutting preset (spindle and ramp speeds, cutting speed in m/min, feeds, ramp angle, feed per tooth and per revolution, stepover and stepdown, coolant). Unknown values are `null`; lengths are millimetres, angles degrees and feeds mm/min. Its `picture` is the app's thumbnail of its cutting end, which `ToolCard` shows: a PNG data URL, or `null` until the app has drawn it. The tool's photo, 3D model, holder, other post-processor settings and import source stay in the app.

`tools.choose` takes an optional `title`, the `selectedToolId`, `recommendedKinds` and a `presetStep`. The chooser always offers the whole library and catalogs: recommended tool types (matched ignoring case, dashes and spacing) become a "Recommended" type filter, which the chooser opens on unless the selected tool is of another type. With a `presetStep`, after a tool is chosen, the app asks whether to apply one of its presets, offering the chosen tool's entry in `defaultPresetIds` (else `defaultPresetId`). The answer is `{ status: "chosen", tool, presetId }` (`presetId` null keeps the operation's current cutting values) or `{ status: "canceled" }`; choosing a catalog tool copies it into the library first. `ui.confirm` resolves `true` or `false` (closing is `false`). A plugin waits on one question at a time (`BUSY` otherwise).

### Operations in the workspace

An operation is `{ id, plateId, name, revision, stopBefore, toolAssignments, data, nc }`: `data` is plugin-owned JSON (up to 8 MiB), `nc` the generated program or `null` while it awaits generation (such operations block Run; the operation inspector does not flag them, so the plugin's editor says what they still need), and `toolAssignments` maps the NC's tool slots to library tools. A plugin sees only operations it created; everything else, including other plugins' operations, stays invisible.

- **Revisions.** `revision` is a SHA-256 over the operation as the plugin sees it (name, pause, tools, data and NC). `operations.save` sends the revision it read and fails with `CONFLICT` if the operation changed meanwhile, including a rename or a tool reassigned in the app, so a plugin never overwrites edits it has not seen. A save applies only what it changes: a save without `name` keeps a name the user gave the operation.
- **Tool slots.** A slot is a tool number as written in the NC (`"1"`) or `"default"`, the tool of a program that selects none (`default` also stands for tool numbers without their own slot). Slots map onto the plate's tool table: creating binds the NC's tool numbers to entries holding the assigned tools; saving assigns them, and when a table entry is shared with other operations the plugin's operation moves to an entry of its own, so other operations keep their tools. Assignments made in the app show up in `toolAssignments`. An operation without NC has no slots yet, so save its assignments together with its program. Assigned tools must be in the library.
- **Plates.** `operations.create` on a new project's empty plate starts a plate of its own instead, as other sources do, set up and named as the empty plate was (with the default stock when it has none); the created records carry the actual plate. Created operations are machining operations, record the plugin version that wrote them, and must be valid workspace data (names without control characters). Every create or save is one atomic workspace change.

## Companions

A companion is a program on the user's computer, with the user's own file access; that is why the review names it, whether it comes from a repository or a folder. The app starts it, stops it and talks to it over a private channel: a Node companion runs in an Electron utility process and uses its parent port; a native companion is spawned with a fixed argv and no shell, and speaks newline-delimited JSON on stdin/stdout. There are no ports, tokens or URLs. Files it runs itself (a vendored converter, for example) are listed in `executables`.

- **Environment.** Only an allow-list of variables (`PATH`, `HOME`, locale and time zone, Windows system folders) plus `OPENSPINDLE_PLUGIN_ID`, `OPENSPINDLE_PLUGIN_VERSION`, `OPENSPINDLE_PLUGIN_ROOT` (the package, read-only), `OPENSPINDLE_PLUGIN_DATA` (private and persistent, also the working directory) and `OPENSPINDLE_PLUGIN_TMP` (emptied at start and stop; also `TMPDIR`/`TMP`/`TEMP`).
- **Lifecycle.** `on-demand` companions start on the first call; `on-view` companions start when a view opens, or when the plugin's card shows in the plugin manager. Open views, a showing card and running calls keep a companion alive; otherwise it stops after `idleShutdownSeconds`. Before starting, the program's bytes are checked against the inventory. Views receive every status change (`companion.status`).
- **Handshake.** The app calls `openspindle.initialize` (API version, plugin identity, grants, settings, folders, platform), which answers whether the companion has a setup step, then `health` (`ready`, `needs-setup` or `degraded`). `setup` runs only when asked (the manager's **Run setup**, offered when there is a setup step, or a view). Views call plugin-defined methods through `invoke`; an `RpcError` a method throws reaches the view with its code. `openspindle.shutdown` asks for a clean exit before the app ends the process.
- **Settings.** `openspindle.initialize` carries what the user set for the manifest's settings, by ID (a setting without a value is absent). Changing one restarts an enabled companion, so its health reflects the new value; a companion that needs a setting reports `needs-setup` until it has one that works, with a message saying where to set it.
- **What a companion may call.** `host.log`, `host.progress` (shown as app progress while a view is open), `host.emit` (events for the plugin's open views) and, with `machine:read`, `machine.snapshot`. Nothing else.
- **Failures.** A crash (the process exits or its channel closes) is counted; the next start waits 1, 2, 4 and then 8 seconds, and after 5 crashes within 10 minutes the companion stays stopped until it is restarted. Calls that were running fail with `UNAVAILABLE` and the reason. Each plugin keeps its last 500 log lines (lifecycle, `host.log`, stderr and stray stdout) for the plugin manager.
- **Native protocol.** One JSON message per line, UTF-8, at most 64 MiB per line, in the `@openspindle/rpc` message format (`{ "rpc": 1, "kind": "call" | "result" | "error" | "cancel", ... }`). Lines that are not JSON are logged and skipped. Exit when stdin closes.

## The SDK

`@openspindle/plugin-sdk` is what plugin authors build against. It is not published to npm: a plugin depends on it from a checkout of this repository, with `"@openspindle/plugin-sdk": "file:<checkout>/packages/plugin-sdk"` in its package.json, once `npm ci` in the checkout has written its type declarations.

```tsx
import {
  definePlugin,
  useChooseTool,
  useCloseView,
  useOperation,
  useViewContext,
} from "@openspindle/plugin-sdk"
import { Button, Field, FieldLabel, ToolCard } from "@openspindle/plugin-sdk/ui"

function Editor() {
  const { operationId, disabled } = useViewContext()
  const { operation, save } = useOperation(operationId)
  const chooseTool = useChooseTool()
  // ...
}

export default definePlugin({ views: { editor: Editor } })
```

- `definePlugin({ views })`: the bundle's default export, keyed by the manifest's view IDs. Views take no props.
- Hooks (TanStack Query underneath): `useOpenSpindle()` (the typed peer, identity, grants and view), `useViewContext()`, `useWorkspace()` and `useMachineSnapshot()` (kept current by events, newest revision wins), `useOperations(plateId?)`, `useOperation(id)` (with a revision-checked `save` that refetches on `CONFLICT`; pass `revision` to save against the revision a long generation started from), `useCreateOperations()`, `useTools()`, `useChooseTool()`, `useCompanion()` (live status, `setup`, `call`), `useCompanionEvents(listener)` and `useCloseView()` (`close({ select })` shows one of the plugin's operations, for example the first one an importer created). `RpcError` carries the error `code`.
- `@openspindle/plugin-sdk/ui`: the curated UI kit (the app's shadcn components, `MeasurementInput`, `ToolCard` and a few icons), provided by the frame at run time so views match the app exactly.
- Styles: the frame loads the app's stylesheet, with its theme, fonts and the kit's styles. A plugin stylesheet adds only its own utilities, against the SDK's theme (Tailwind, the kit's variants and animations and the app's design tokens from `src/theme.css`, without the app's sources):

  ```css
  @import "tailwindcss/utilities.css" layer(utilities) source(none);
  @reference "@openspindle/plugin-sdk/theme.css";
  @source "./";
  ```

  `source(none)` turns off Tailwind's automatic scanning of the whole project (its README, companion sources), so only the views' own folder is scanned. Numbers shown as values take `font-numeric`, as in the app: their digits and signs are set in the mono font (Space Mono unless Settings chooses another), while words and units stay in the display font (Space Grotesk unless Settings chooses another). Use the theme's font utilities (`font-sans`, `font-mono`, `font-numeric`) rather than naming a font, so views follow the user's choice. `MeasurementInput` and `ToolCard` already use it. The `sm` and `md` breakpoints start at 0, since the app's window is never narrower than 1000px: their variants always apply, also in a frame narrower than that, so the kit looks as it does in the app. For a layout that follows a view's own width, use container queries.

- `serveCompanion({ methods, initialize?, health?, setup?, shutdown? })` from `@openspindle/plugin-sdk/companion`: the companion side of the protocol, over the utility-process port or NDJSON stdio (stdout is reserved for the protocol, so console output goes to stderr). Methods, `health` and `setup` receive a context whose `info` is what `openspindle.initialize` sent, the settings among it. It returns the host (`log`, `progress`, `emit`, `machineSnapshot`). `RpcError` (and `RpcErrorCode`) are re-exported there for coded failures.
- Vite presets from `@openspindle/plugin-sdk/vite`: `openSpindleView({ entry, outFile, stylesFile? })` builds the views as one ES module whose React, ReactDOM, SDK, UI kit and TanStack Query come from the frame global, compiled for the frame's production React whatever `NODE_ENV` the build runs under (`frameReact()`, which the app's own frame build uses too); `openSpindleCompanion({ entry, outFile })` bundles a Node companion into one file.
- The `openspindle-plugin` CLI: `build [folder] [--view ui/index.tsx] [--companion <entry>]` (uses the plugin's own `vite.config`, for example for Tailwind CSS), `validate [folder]` (manifest, every declared file and the SHA-256 inventory; also checks an `openspindle-inventory.json` if present) and `pack [folder] [--out dist-plugin]` (copies exactly the package's files, executables with execute permission, plus `openspindle-inventory.json` into `<out>/<id>-<version>/`).

**Types.** The SDK's exports give TypeScript generated declarations (`packages/plugin-sdk/types/`, written by `npm run sdk:types` and on install) that include the plugin core, the RPC package and the UI kit, so a plugin needs no paths into this repository. Install the peer dependencies as dev dependencies: `react`, `@types/react`, `react-dom`, `@tanstack/react-query` and `zod`, and for the UI kit's types `@base-ui/react`, `class-variance-authority` and `lucide-react` (and `vite` for the presets). When the SDK is linked from a checkout (`file:`), set `"preserveSymlinks": true` so its declarations use the plugin's own React types. This repository reads the SDK's source through the `openspindle-source` condition.

## Host services

The main process serves the `plugins.*` part of the host contract (`src/platform/contract/plugin-rpc.ts`) to the app window only: managing plugins (listing them, preparing an install or update from GitHub or a folder, confirming or discarding it, enabling and removing, setting a setting, typed or chosen with a native dialog (`plugins.setSetting`, `plugins.chooseSetting`), with a `plugins.changed` event after every change), the verified view bundles and rendered template programs, and the plugin-scoped machine and companion services, each under the plugin's own principal.

What views call there (`plugins.machine.*`, and `plugins.companion.call`, `status` and `setup`, which the plugin manager's **Run setup** uses too) counts against an in-flight budget of its own in the main process: 64 calls across all plugins. A machine read may wait for a running program to end and a companion call runs as long as the companion takes, with no timeout; once plugins keep 64 waiting, further ones fail with `BUSY`. The app's other calls, managing plugins among them, count against a budget of their own, and Stop is never refused.

In the renderer, `host.plugins` (`src/platform/host.ts`) calls those services. `src/app/plugin-host/` holds the broker, the Mediator between frames and the app: it maps the view contract onto the workspace store and the main process's services for each mounted view, computes revisions and `CONFLICT`, builds the capability guard, and holds the plugin's companion while the view is mounted. `src/features/plugins/` holds the plugin frame, the host-rendered dialogs for `tools.choose` and `ui.confirm`, the plugin manager and the install review.
