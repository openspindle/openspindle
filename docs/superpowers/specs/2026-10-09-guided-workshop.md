# Guided CNC workshop

User-approved scope: guided setup, facing wizard, feeds/speeds assistant, clearer job checks, probing into setup, reusable processes, then material-removal preview last. The existing standing spec preapproval and instruction to implement all authorize this work without renewed approval gates.

## Shared behavior

One editable project model, existing WorkspaceCommand changes, existing tool library and machine kit. Add guided entry points to Prepare; retain advanced inspectors and generated code. Creating, editing, applying measurements, loading processes and previewing never command the machine. Run remains on Job. Physical controller restrictions remain unchanged. Use existing shadcn controls and TanStack forms. No automated tests per AGENTS.md; static/build checks, one independent review and manual simulator trials.

## Deliverables, in order

1. Guided setup: stock/material, placement and origin, fixtures/workholding, tools, then review. Reuse current panels and show coordinate explanations; offer transitions to existing tools without concealing advanced parameters. Confirmations describe operator observations, not sensor verification.
2. Facing: a first-class parameterized generated operation, persisted in projects and editable in the inspector. Rectangular raster passes using a selected flat-ended cutter, entered removal/stepdown/stepover/feed/plunge/RPM and clearance; explicit generated-code preview. Start outside the rectangle, retract between depth passes, limit counts/coordinates and validate cutter, work area and spindle range. No default cutting recipe is implied safe without entered or sourced cutting data.
3. Feeds/speeds: tool/material preset selection, editable RPM/feed/plunge/stepover/stepdown, chip-load explanation and missing-data messages. Apply to facing parameters explicitly; save a named tool preset via library command. Never rewrite imported Fusion NC silently.
4. Job checks: explain existing checklist rows and limits, show what is verified versus operator/model assumptions, with existing Show/fix actions. No generic green safety certificate.
5. Probing into setup: select complete result from the frozen Run and target plate, preview XY position/span changes in bed coordinates. Apply only explicit workspace changes and retain provenance. Require matching device/anchors and refuse stale target. Synthetic measurements require explicit acknowledgement; never apply unknown absolute Z or infer stock rotation/height from a pocket/boss span.
6. Reusable processes: save named complete plate templates with ordered operations, settings and tool definitions in a versioned local document. Load a fresh plate and operation identities, resolve tools through existing workspace commands, preview/edit before Run. Preserve references and refuse unsupported/mismatched device setups. Saving a process never captures live motion or silently runs it.
7. Material removal, implemented last: opt-in visual sampled height-field approximation of three-axis flat-end milling during Job playback, using known stock and tool geometry. Show removed material as timeline advances/seeks; reset on program/setup changes. Explicit limits for unsupported cutter geometry, probing-derived coordinate changes and non-three-axis machining; not collision or physical verification. Bound sample count/work per update and keep playback responsive.

## Verification focus

Valid/invalid drafts, tool binding/preset changes, generated NC coverage and retractions, persisted project round trip, machine/bed/work conversions, stale report/target rejection, synthetic attribution, template IDs/tool conflicts/storage failure, preview seeking/resetting and unsupported geometry. User manual trials follow implementation; no machine motion is part of developer checks.
