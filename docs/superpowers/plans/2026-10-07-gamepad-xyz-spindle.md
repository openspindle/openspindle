# XYZ and spindle controller implementation

Approved design: `../specs/2026-10-07-gamepad-xyz-spindle-design.md`. Joseph pre-approved the written spec and requested completion without further approval checkpoints. Implement here, then one independent review; keep the local branch. No automated tests per AGENTS.md.

## Interfaces and constraints

Extend the strict session contract with Step/Direct mode, XYZ samples and suppression, and separately numbered finite-step/spindle actions. Replies identify kind and sequence as well as session. Route actions through the existing machine gateway/RPC. The owner serializes short wire exchanges; post-condition waits release the lease and samples continue. Busy/refused actions are never queued. End cancels pending verification and confirms fresh rest and spindle-off after acknowledgement. Preserve capture deadlines and bounded clock skew.

The simulator's isolated motion model gains XYZ and finite endpoints. Use per-axis rates, bounded acceleration and existing XY/Z kit bounds. Step heartbeat does not cancel a finite move on ordinary release; modifiers do. Local expiry/disconnect/end stops owned spindle. Shared telemetry target drives the existing spindle card.

## Task 1 — Contract, protocol and bounded simulator

Edit `src/machine/contract/simulator-jog.ts`, Makera wire protocol, `tools/z1-simulator/direct-motion.ts` and `device.ts`. Add typed actions, strict reply identity, mode, XYZ/suppression, finite-step braking and spindle lifecycle. Preserve ordinary planner/admission. Inspect limits, expiry, conflicting/old requests and stop transitions. Run typecheck after dependent interfaces land.

## Task 2 — Machine ownership and RPC

Edit owner/controller/gateway, snapshot availability, host/link/RPC/handlers. Both modes acquire the same foreground owner. Actions enforce token, input age, rest barrier, expected spindle/tool state and single action. Verify endpoint/target using telemetry newer than action acknowledgement without holding the wire lease. Cancellation invalidates pending verifications. Known no-action refusals preserve connection; unknown outcomes isolate it. Run typecheck and inspect action/heartbeat/end races.

## Task 3 — Controller and existing UI

Edit controller input/gestures/hooks/cards. Add right-stick Z, competing Step rejection, combined normalized Direct XYZ. Heartbeat both modes. Add edge-triggered X+D-pad RPM, X+A start, X+Y stop with Stop priority, modifier suppression, neutral re-entry and generation-safe async notices. Existing spindle field follows connection-bound target and cannot edit while the owner reserves controls. Update binding descriptions and docs.

## Task 4 — Verification, one review, restart

Run typecheck, lint, formatting check and build. Review source for deadlines, finite endpoint semantics, rest barriers, lease release, expected spindle state and stale callbacks. Request one independent read-only review; fix material findings and repeat affected checks. Commit coherent local changes. Restart with npm start and inspect connection/log evidence. Record unperformed controller/fault trials honestly; deliver bindings and limitations without another approval request.

## Plan review

Self-review: dependencies are sequential; no implementer delegation, physical support, automatic retries, automated tests, feed or fourth-axis work. Existing approved manual trials concern XY only. User pre-approval supersedes skill review/approval gates; independent final review remains required.
