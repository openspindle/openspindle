# Guided CNC Workshop Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement inline, with one independent review at the end. Standing user preapproval authorizes spec and plan without further questions.

**Goal:** Deliver all seven approved enhancements; material-removal preview last.

**Architecture:** Compose guided UI around current workspace commands. Add a generated facing operation and a versioned local process repository; measurements update only workspace data. Implement sampled stock preview after the workflow features.

**Tech stack:** TypeScript, React, TanStack Form/Query/Store, shadcn, Three.js, Electron host persistence.

**Spec:** docs/superpowers/specs/2026-10-09-guided-workshop.md

## Global constraints

- Run stays on Job; no automatic machine commands, retries or physical support expansion.
- Keep vendor specifics in kits/adapters and tools in library data.
- No automated tests (AGENTS.md); typecheck, lint, check, build required.
- Use existing codex/gamepad-feasibility branch; publish to existing jralph fork.

## Tasks

- [x] 1. Guided setup dialog and Prepare entry point: reuse stock, placement, origin, fixtures and tool components; make steps navigable and explain entered versus confirmed facts.
- [x] 2. Facing schema/generation/registry/persistence/editor and wizard. Validate flat end tool, parameter ranges, pass counts, stock coordinates, tool assignments, machine-specific RPM bounds. Expose generated code in the existing source preview.
- [x] 3. Cutting data assistant: select library preset, edit fields with validation, compute chip load, apply explicitly to facing, save named library preset without NC rewriting.
- [x] 4. Extend existing run checklist UI with actionable explanations and model limitations.
- [x] 5. Read-only measurement proposal plus explicit guarded workspace apply: frozen anchors and target comparison, XY/spans only, simulation acknowledgement, no absolute Z guess.
- [x] 6. Process schema/repository/storage key and UI: save snapshot, load cloned identities, restore tool definitions, preserve operations/order, preview before Run.
- [x] 7. LAST: bounded sampled material-removal preview integrated into Job timeline/viewer; known flat-end tools only, honest unsupported conditions and reset on seek/setup/program changes.
- [x] 8. Required checks, one independent review, consequential fixes, documentation, publish and provide relaunch instructions (save the current project first).

## Review focus

Invalid/stale forms must not apply old values; facing covers rectangle with finite bounded pass counts and clearance before XY; project files retain parametric sources; sample preview does not pretend unsupported geometry is verified; measured coordinates use frozen matching anchors and stale target guards; templates preserve data and never overwrite changed library tools silently; storage/report errors reach the user.
