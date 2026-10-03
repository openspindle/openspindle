# OpenSpindle

OpenSpindle is an Electron desktop app for preparing and running jobs on a Makera Z1 CNC machine. This file holds the project's conventions, for people and for coding agents. README.md is the user guide; `docs/` holds the feature references, the file formats and the architecture.

# Commands

- `npm ci` installs everything; `npm run dev` runs the app with the renderer dev server. The build scripts run TypeScript directly, so they need Node.js 22.18 or later.
- Before handing over a change, `npm run typecheck`, `npm run lint` and `npm run check` (Prettier; `npm run format` fixes what it finds) must pass, and `npm run build` must succeed.
- The app runs a simulated Makera Z1 on 127.0.0.1:2223 (Settings › General › Z1 Simulator device). `npm run sim:z1` starts another on 127.0.0.1:2222 to connect to without a machine; `npm run sim:z1 -- --help` lists its port, speed and fault injection options.

# Pull requests

- `main` is the trunk. Work on a short-lived branch and merge it through a pull request, which is squash-merged once CI passes; never push to `main`.
- The pull request's title becomes the commit on `main` and, for `feat`, `fix`, `perf` and `revert`, a line of the release notes installed apps show before updating. Write it as a Conventional Commit whose description says what changed for people using the app, in the present tense: `fix(job): A pause is found by the line the machine reports`. README.md's Pull requests section lists the types.
- Never edit package.json's `version`, CHANGELOG.md or `.release-please-manifest.json`: release-please's release pull request owns them (docs/releasing.md).

# Project preferences

- Do not add or run automated tests unless the user explicitly asks.
- Use the configured shadcn components for standard controls, forms, and dialogs.
- Use shadcn Select for dropdown menus so the popup follows the supplied theme. Do not substitute NativeSelect unless explicitly requested.
- Compose layouts with Tailwind utilities. Keep only the Tailwind/shadcn theme stylesheets: `src/styles.css` and its design tokens in `src/theme.css` (re-applying the shadcn preset writes tokens to `styles.css`; move them to `theme.css`). Do not add custom CSS files.
- Do not nest ternary expressions. Use early returns, named functions, or explicit branches.
- Preserve the typography: the display font for text (`font-sans`), the mono font for code (`font-mono`), and the mono font's numerals for numbers shown as values, such as fields, readouts, tables, badges and fact lines (`font-numeric` covers only digits and signs, so words and units stay in the display font). The defaults are the shadcn preset's Space Grotesk and Space Mono; Settings › General chooses others from those `src/lib/fonts.ts` offers, so use these utilities and never name a font family. Numbers in names and sentences stay in the text face. Do not switch fonts or override theme font weights to address rendering issues.
- The supplied preset is `b1tM1sQkM` (Mira / neutral / Space Grotesk, applied with `npx shadcn@latest apply --preset b1tM1sQkM`). Follow the official shadcn skill at https://github.com/shadcn-ui/ui/blob/main/skills/shadcn/SKILL.md and inspect component documentation with the shadcn CLI before composing UI. Use component variants for styling; limit layout classes to spacing, sizing, and positioning.

# Product rules

- OpenSpindle is an Electron app only. Do not add a browser build, browser fallbacks, or null checks for host services the preload always provides.
- Only an explicit user action moves the machine, changes its settings or runs a program. Importing, previewing, editing, saving and PCB generation never do, and Run lives only on the Job tab. Machine commands are verified by acknowledgement and telemetry and never retried automatically; Stop stays available.
- Keep machine and vendor specifics (anchor ids and names, factory positions, bed registration, firmware codes) in the machine's firmware adapter (`src/machine/firmware/<vendor>`) or its fixture kit (`src/domain/fixtures/<machine>`), never in generic code.
- Tools, tool catalogs and the starter library are data in `public/tool-libraries/`: `catalogs.json` lists them and `provenance.json` records their sources and corrections. Never hard-code tools, brands or vendor special cases in code.
- Reuse the component that already does a job, with the same title, labels and behaviour, instead of making a variant. Keep panels lean: no helper links, explanatory notes or decorative icons unless asked.
- Tools that act on the 3D view's selection go in the Prepare toolbar (`src/features/prepare/prepare-toolbar.tsx`), next to Probing; the viewer's left toolbar holds view options only. Prepare toolbar tools show only their icon; hovering one shows its name and what it does (`ToolbarButton` and `ToolbarToggle` in `src/components/workspace/toolbar-button.tsx`).
- When behaviour changes, update the README paragraph or the `docs/` page that describes it in the same change. Describe behaviour as it is now, without the history of earlier versions or plans.

# Code layout

See docs/architecture.md. In short:

- `src/machine` is the machine domain: host-agnostic (no React, TanStack, Electron or Node imports), relative `.ts` imports, host capabilities through `core/ports.ts`. It runs in the machine process (`electron/machine`, an Electron utility process; `electron/main` starts it) and the Z1 simulator; the renderer uses only `src/machine/contract`.
- PCB is built in: `src/features/pcb` holds its UI, `src/domain/pcb` its data and parameters, and `electron/main/pcb` its local conversion service. pcb2gcode is the user's own install; the app ships none (docs/pcb.md).
- `src/domain` is the pure workspace domain (plates, operations and their kinds, tools, fixtures and machine kits, compile, probing). Probing operations are a probe tool from the library and a strategy (`src/domain/probing`); what a machine's firmware does for probing (its cycles, the tool numbers it needs probes in) is its kit's `MachineProbing`. Every workspace change is a `WorkspaceCommand` handled by `applyCommand`; add a command rather than mutating state elsewhere. New operation sources register a kind in `src/domain/operations/kinds.ts`.
- `src/formats` holds file formats, `src/persistence` the versioned repositories, `src/platform` the Host abstraction and RPC clients, `src/app` application state (TanStack stores and diagnostics).
- `src/features/<feature>` holds UI; `src/routes` stays thin. Dialogs are opened through the typed dialog atom in `src/features/shell/dialogs.ts` and rendered by the dialog host.
- Problems the user must see are `Diagnostic`s with quick fixes, not exceptions. Machine disabled reasons come only from `snapshot.availability`.
- Log through `log` (`src/app/errors/log.ts` in the renderer, `electron/main/diagnostics/log.ts` in main), not `console`. Unexpected errors reach the user in the error dialog with their Sentry ID, and leave the computer only as the user allows (docs/architecture.md, Errors and logs).
- Validate untrusted data with Zod schemas; derive types with `z.infer`. Use TanStack Form for forms, TanStack Table/Virtual for long lists, TanStack Query mutations for async workspace work.
