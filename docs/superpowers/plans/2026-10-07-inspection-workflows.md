# Guided inspection workflows

Approved scope follows the user's continuing instruction and standing spec approval. Implement here, one independent review; user trials all experiments in the simulator at the end.

## Design

Prepare → Probing offers Inspection recipes: stock spans (boss), two-feature spacing (pockets), sampled surface (anchored grid), and repeatability (repeated anchored pocket). Each creates a separate plate cloned from the current setup, with only the requested probe operations. Existing parameter forms edit starts/searches and grid dimensions. Valid stored anchors and reporting routes are required. Create changes workspace only; Run stays on Job. Stock routines change work zero, grids enable compensation, and simulator geometry is synthetic.

Job reports group complete repetitions only when routine, parameters, anchored start, and probe identity/ball match. Summaries show count, mean, range and sample standard deviation for machine center/top and spans. Known-reference checks accept a measured quantity, positive nominal and nonnegative tolerance; report signed error and in/out-of-tolerance. They never alter calibration, tool geometry or machine settings. Both analyses export with raw measurements.

## Implementation

1. Add pure recipe construction and validation, typed dialog, picker choices and guided wizard using existing probing forms. Propagate form validity so Create cannot silently use stale valid parameters. Validate reporting routes before workspace batch, bind library probe, select first operation.
2. Add conservative repeated-measurement analysis and known-reference checks. Extend JSON/CSV export and Job report UI with validated reference controls.
3. Document setup and a single end-of-phase simulator trial checklist. Run required typecheck/lint/format-check/build; do not add or run automated tests (AGENTS.md). One independent review, fix consequential issues, verify changed code, commit and push to existing jralph feature branch, restart app.

## Review focus

Probe/parameter validity and stale drafts; anchored routing across changed work zero; fresh operation IDs and tool binding; no motion on Create; grouping does not combine distinct probe positions or incomplete entries; sample standard deviation denominator; tolerance units and finite inputs; exported selection matches displayed selection; synthetic simulator limitations.
