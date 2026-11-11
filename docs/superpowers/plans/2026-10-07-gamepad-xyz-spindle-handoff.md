# XYZ and spindle controller handoff

Implementation stays on the local `codex/gamepad-feasibility` branch. Both controller modes use a simulator-only owned session. Physical connections remain disabled.

## Bindings

- LB + left stick: XY Step or proportional Direct.
- LB + right-stick up/down: Z Step or proportional Direct; up raises the tool.
- RB + D-pad left/right with LB released: select 0.1, 1, 5 or 10 mm Step distance.
- X + D-pad up/down: target RPM ±1,000 per press, clamped to the adapter control range.
- X + A: spindle start at the shared displayed target, with centred sticks and LB released.
- X + Y: spindle stop.
- B: whole-machine Stop into Alarm and disarm.

Hold X and wait for fresh confirmed rest before spindle actions. Early/busy presses are refused and require another press. Ordinary stick/LB release stops Direct demand but completes an accepted finite Step. X/RB interruption cancels a Step; it never resumes. Disarm, focus/controller loss and input expiry stop both motion and the owned spindle. Return both bound sticks to neutral before resuming motion after modifiers. Right-stick horizontal, feed, latched motion, facing and metrology remain deferred.

## Independent review and rulings

One independent read-only review covered `7b28c67..c416e28`. No critical findings. Two important findings were verified and corrected in one fix pass: owner availability now publishes after lease/action transitions instead of depending on telemetry phase; pending arming now checks generation and live controller identity, neutrality, released controls, focus and visibility before enabling gestures. A minor finite-profile fidelity finding was also corrected because bounded acceleration is an approved requirement: finite motion uses an analytic rest-to-rest triangular/trapezoidal profile, giving its exact endpoint at zero velocity without a velocity snap. Modifier/expiry cancellation retains current velocity for controlled deceleration.

Review corrections are the implementer's verification responsibility; no second review was requested. Physical firmware/RPM/stopping measurements, radio-loss timing, new controller usability and fault-injection outcomes were declined as unperformed or explicitly deferred. These remain outside this source-review evidence, not silently dropped requirements.

## Evidence and remaining trials

The implementation commit passed typecheck, lint, Prettier check and production build. After correction commit f545b94, npm run typecheck, npm run lint, npm run check and npm run build each exited 0. The rebuilt app was restarted with npm start; diagnostics at 2026-10-07 18:08:02 UTC confirmed the simulator listening on 127.0.0.1:2223 and the machine process connected to Z1 Simulator. No new runtime warnings appeared in the observed startup log. Existing build warnings concern OCCT browser externalization and large bundles. No automated tests were added or run, following AGENTS.md.

Prior successful XY controller logs belong to the earlier build. New Z/spindle controller trials remain unperformed: finite Z endpoints/no repeat; partial/full and mixed XYZ Direct; release and limits/inward recovery; RPM off/on and start/stop; modifier cancellation/neutral re-entry; B; mode changes; focus/controller loss; expiry; delayed/old replies; pending-arm changes and process replacement. The implementation is ready for those simulator trials; it does not establish physical cutting support.

Joseph's later touch-probe part-detection/metrology interest is saved separately in `../specs/2026-10-07-probe-metrology-interest.md` for future exploration.

Final workflow ruling: preserve the existing local clone/branch and running app; no merge, push or PR. User pre-approval superseded spec/plan/branch approval gates. One independent review and one correction pass are complete. Source arithmetic confirms the corrected finite profile reaches its endpoint continuously at zero velocity; controller and fault trials remain unverified. Automatic approval review blocked recursive cleanup of this completed plan scratch folder with the reason blocked by policy; retain its ignored notes instead.
