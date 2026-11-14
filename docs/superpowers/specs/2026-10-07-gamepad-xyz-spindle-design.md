# Simulator controller: XYZ and spindle

## Intent and approval

Joseph uses a GameSir Xbox-style controller through its USB wireless dock to position his Makera Z1 and eventually control simple cuts. The local OpenSpindle prototype already has finite XY Step jogging, proportional XY Direct steering, RB step-size selection, and a live 3D simulator preview. A manual trial confirmed the clock-skew fix, repeated releases, and focus-loss end.

Joseph requested Z in both Step and Direct and controller RPM adjustment plus spindle start/stop. He approved the conversational design and the bindings below on 2026-10-07. This document records the approved shared ownership, finite-move semantics and verification requirements. Joseph pre-approved the written spec and requested implementation without further approval checkpoints.

This remains a simulator-only prototype on the existing `codex/gamepad-feasibility` checkout. Physical connections remain blocked. The simulator extension does not establish stock or community Z1 firmware support for continuous jogging or cutting.

## Controls and visible behaviour

| Input while armed                       | Action                                             |
| --------------------------------------- | -------------------------------------------------- |
| LB + left stick                         | Existing XY Step or Direct movement                |
| LB + right-stick up/down                | Z positive/negative: raise/lower the tool          |
| LB + D-pad direction in Step            | Existing finite XY step                            |
| RB + D-pad left/right, with LB released | Select the existing Step distance                  |
| X + D-pad up/down                       | Raise/lower spindle target by 1,000 RPM per press  |
| X + A                                   | Start the spindle at the displayed target          |
| X + Y                                   | Stop the spindle                                   |
| B                                       | Existing whole-machine Stop into Alarm, and disarm |

Step remains the default. Its selected distance applies to Z too. A gesture sends one finite single-axis move, with no held-direction repeat. When XY and Z gestures compete, refuse the ambiguous gesture and require neutral; do not silently pick an axis. A sent Step normally reaches its selected endpoint even if the stick or LB is released. Pressing a motion-suppressing modifier, disarming or losing input explicitly interrupts it with controlled deceleration. A refused or interrupted step is never resumed automatically.

Direct maps both sticks proportionally, with the existing radial 20% XY dead zone and a 20% one-dimensional Z dead zone. Up on the right stick is positive Z. XY and Z may move together. Normalize the combined demand so simultaneous full-stick inputs cannot exceed the selected normalized ceiling. The Jog percentage uses each axis's configured rate, including Z's slower rate. Normal stick/LB release stops the corresponding demand; release of LB zeroes all axes. The session stays armed and a running spindle keeps running until explicitly stopped or the session ends.

Holding X suppresses all axis motion. RPM/start/stop presses are accepted only after fresh telemetry confirms rest following the newest stop request. An early press is refused with a reason and requires another press; there is no delayed start or queued setting change. After releasing X, both bound sticks must return to neutral before movement can re-engage. RB also suppresses movement and retains the existing neutral requirement. Conflicting modifiers/actions cause no start or axis movement. B always has priority; X + B is still whole-machine Stop.

Every discrete action is triggered on a new press. Holding a chord through arming or a mode/controller change cannot trigger it. Start requires centred sticks, released LB, a valid cutting tool and confirmed released E-stop. If start and spindle-stop chords conflict, stop takes priority. Changing RPM while off updates only the target; it never starts the spindle. When already running, an accepted target change applies and is verified. Clamp target changes to the connected adapter's spindle control range (currently 1,000–10,000 RPM), which is an application range rather than a machine rating.

Reuse the existing controller selector, Step/Direct selector, Jog distance/speed, spindle target field, spindle Actual/Requested readouts, and 3D preview. Show right-stick Z and the modifier bindings in the existing gamepad controls. A connection-bound shared target keeps controller changes and the spindle field consistent. No fourth-axis motion is bound; right-stick horizontal remains reserved. Feed-rate bindings are deferred.

## Ownership and admission

Extend the existing simulator session owner to cover controller Step, Direct and spindle actions. Arming either mode reserves one foreground activity, bound to the exact connection, machine session, controller identity and mode. Begin requires a fresh, stationary simulator with spindle off, no active job, no other operation, a supported mapping, centred bound sticks, released action buttons and app focus. Begin returns only after a stationary acknowledgement. Late begin completion after any invalidation ends its token without sending motion or starting a spindle.

Controller Step uses a session-owned finite operation. This allows simulated finite jogging with a spindle that this session explicitly started; the ordinary command gateway and physical firmware admission rules are not relaxed. Permit exactly one active Step, and verify its endpoint with fresh position and zero feed. While the owned spindle runs, stationary telemetry may say Run rather than Idle: Step completion needs the position/rest condition and expected spindle state, not Idle alone.

Direct samples may coexist with the expected session-owned spindle state. Unexpected tool, E-stop, job, spindle or connection changes end the session. Discrete spindle actions check the same connection/token, fresh diagnostics, bounds and post-zero rest barrier. The controller-specific availability comes from the machine snapshot; the renderer does not invent a bypass for busy or refused controls. Ordinary commands continue to inherit the controller session's busy reason. B/Stop bypasses normal busy admission.

The owner alone sends simulator protocol frames. Its typed app gateway/RPC surface carries captured input and explicit actions; no renderer sockets or raw console commands are added. One foreground owner prevents a second Step, ordinary job or manual command from competing with controller motion. Mode changes end the old session, stop its spindle, confirm rest and require explicit arming of the replacement mode.

## Protocol, timing and concurrency

Preserve the existing 50 ms input sampling cadence, 150 ms capture-time deadline, and independent machine-process and simulator watchdogs. The observed clock difference allowance stays capped at 5 ms, with the owner forwarding `min(capture, receipt)` and the simulator independently clamping its deadline. Neither clamp extends input life. Larger future differences, expired input, non-increasing sequences and invalid tokens are refused. An old token or reply cannot affect a replacement session.

Extend the strict simulator contract and wire protocol for mode, Z, finite Step and explicit spindle target/start/stop actions. Each exchange must identify its session, action kind and sequence/action id so begin/end, heartbeat and action replies cannot satisfy one another. Unknown fields and invalid values are rejected. A setting action is not repeated in every heartbeat, and an uncertain action is never retried.

Motion/heartbeat and discrete actions share one short reply lease at a time. The renderer retains only its newest input capture; discrete actions are accepted immediately or refused, never queued for replay. A Step's endpoint verification and a spindle telemetry post-condition must not occupy the reply lease or prevent heartbeat sampling. B, session end and a newly requested zero invalidate or take priority over pending motion. Healthy action traffic must not starve the watchdog; lack of timely input still stops independently rather than extending the deadline for an operation.

Step heartbeats keep the session fresh without scheduling another finite move. Direct heartbeats carry the current velocity demand. Modifier suppression explicitly cancels any active finite Step before a spindle action can be admitted. Both modes log action receipt separately from telemetry-confirmed completion.

## Simulator motion and spindle lifecycle

Extend the controller motion model to XYZ, retaining acceleration limits, maximum 20 ms integration slices and the maximum 50 ms catch-up gap. A longer loop gap holds position and invalidates the session; it cannot replay travel or re-enable the spindle. Keep the ordinary job planner isolated from controller-owned motion. Finite moves use bounded endpoints and finish without overshooting; Direct uses bounded velocity demands. Both share the reported position/feed that already drives the preview, published at 20 Hz and once more after stopping.

Use XY bounds from the shared Z1 work envelope and Z bounds from the kit's existing `MACHINE_Z` (-102 to -1 mm), keeping vendor values in the kit/adapter. These are the local simulator's declared bounds, not a measurement of Joseph's machine. Refuse arming outside the controller travel envelope with an actionable reason; ordinary finite controls can reposition before arming. At a limit, outward motion is bounded and inward movement remains available. Step requests beyond a limit are refused, without moving or disconnecting on an acknowledged refusal. Do not teleport a starting position into bounds.

Spindle actions update the simulated target/on state and report it through existing telemetry. Reuse the simulator's spindle state helpers and existing Follow spindle behaviour. Controller spindle start/stop uses this local extension; simulated feedback does not validate physical RPM, spin-up, spin-down or cutting. A target/start/stop acknowledgement alone is insufficient: verify a newer matching target/on/RPM report.

On normal release, keep the session and its explicit spindle state. On disarm, mode change, focus/controller loss, input expiry, disconnect or process replacement, invalidate the token first, zero/cancel motion and switch off the session-owned spindle. The simulator enforces this locally even when the machine process cannot send end. Normal end retains foreground ownership until telemetry newer than the end acknowledgement confirms zero feed, spindle off, zero RPM and Idle. B uses existing halt into Alarm and stops both. Cleanup must release only the original activity, never a replacement activity.

An acknowledged refusal is a known no-action result and reports its reason without disconnecting unnecessarily. Missing acknowledgement, inconsistent feedback or an unverified end isolates the connection and reports an unknown outcome, with no motion or spindle retry and no automatic rearm.

## Verification and handoff

Follow AGENTS.md: do not add or run automated tests unless Joseph explicitly requests them. Run and inspect `npm run typecheck`, `npm run lint`, `npm run check` and `npm run build` after the final code change. Preserve the local clone/branch and existing prototype. Update feature docs with implemented behaviour and actual manual evidence.

Restart the prototype and inspect connection diagnostics. Subsequent controller trials can be observed through local diagnostics; do not claim unperformed trials. Verify Z Step endpoints and no hold repeat; partial/full positive/negative Z Direct; mixed XYZ; stick/LB release; upper/lower bounds and inward recovery; RPM changes while off and on; start/stop chords; modifier cancellation and neutral re-engagement; B; mode changes; and focus/controller loss. Also verify genuine input expiry stops both motion and spindle without replay, while the known small clock difference remains tolerated. Inspect delayed/old-action replies, pending-begin invalidation and ownership release races. Label fault trials that cannot be performed as unverified.

Log session identity/mode, input age/sequence, step request and verified endpoint, target/start/stop request and confirmed spindle state, zero request and confirmed rest, and end/expiry outcome. Rate-limit ordinary input diagnostics. Handoff states what passed, what was observed and what remains unverified. The prior preference for implementation in this chat plus one independent final review is the approved execution approach.
