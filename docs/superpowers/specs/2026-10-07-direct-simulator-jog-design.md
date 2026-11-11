# Direct simulator jogging

## Purpose and scope

Joseph wants his GameSir Xbox-style controller to position a Makera Z1 and eventually steer simple cuts. The working local OpenSpindle prototype already detects his controller, performs finite XY steps, changes step size with RB + D-pad, and shows the simulator's live tool in a rotatable 3D view.

This next change adds direct, proportional XY steering to that simulator prototype. Success means holding LB and steering continuously, including diagonals; centring the stick or releasing LB brings motion to rest; focus loss or stale input stops and disarms. It remains throwaway feasibility code. Physical connections remain blocked.

The user approved proceeding to direct continuous control. This document supplies the proposed ownership, stopping and verification design for review before implementation.

## Why a simulator extension

The current command path sends a finite jog and waits for its completed position. Repeating that path would pause between steps. The inspected [stock firmware jog handler](https://github.com/MakeraInc/MakeraZ1Firmware/blob/main/src/modules/utils/simpleshell/SimpleShell.cpp) accepts finite multi-axis deltas and a fraction of maximum speed, then starts the planner immediately. It does not supply a jog-cancel operation in that handler. The previously inspected halt enters Alarm; physical cancellation timing remains unmeasured.

Three approaches were considered:

| Approach                                  | Result and tradeoff                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repeat short stock `$J` moves             | Potentially portable, but finite moves remain after release. Queue duration, acceleration and cancellation need further work before claiming direct control. |
| Halt on every release                     | Uses the existing Stop, but repeatedly enters Alarm and needs Unlock. Unsuitable for the desired interaction.                                                |
| Simulator velocity extension, recommended | Lets us evaluate proportional steering and session ownership now. It does not demonstrate stock Z1 support for continuous jogging or physical stopping.      |

The extension is documented and named as simulated motion throughout. It is never described as a stock-firmware capability.

## Controller behaviour

- Add **Step / Direct** to the existing Gamepad prototype controls; Step remains the default and retains its current bindings.
- Changing mode disarms and ends any direct session before another can be armed.
- Direct arming requires a supported controller, a centred stick, released buttons, a focused app, and a connected, fresh, Idle simulator with no other operation or spindle running.
- Hold **LB** and use the left stick for simultaneous X/Y steering. Right is X positive; up is Y positive, as in the current step mode.
- Use a radial 0.20 dead zone and linearly map the remaining deflection to speed. Normalize diagonals so their combined speed does not exceed full-stick speed. The selected Jog speed, currently 5%, 10% or 25%, is the ceiling; the simulator's configured XY rates determine mm/min.
- Returning to the dead zone or releasing LB requests zero velocity and a controlled stop, leaving Direct armed for the next deliberate gesture. Normal stopping does not enter Alarm. It is not instantaneous: transport and configured deceleration take time.
- **B** retains the existing immediate halt and disarms. Z remains fixed; spindle and feed overrides have no gamepad bindings in this change.
- In Direct, D-pad directions do not move the machine. RB + D-pad still changes the Step distance, and holding RB suppresses steering. Release RB and centre the stick before steering again.
- Other machine operations are unavailable while Direct owns the connection. Disarming returns those controls after the stop is confirmed. Preview rotation and zoom remain available.

## Ownership and input expiry

The renderer samples the selected controller and sends its latest normalized input at up to 20 Hz. Every sample includes connection id, direct-session id, increasing sequence, capture time, XY vector and selected speed ceiling. Release sends zero promptly. It does not build a queue of movement requests or retry failed motion messages.

The existing MachineGateway is the only entry point. MachineController creates and owns the Direct session, reserves the existing foreground-operation slot, and starts only after normal admission succeeds. Begin, sample and end methods are added to the typed machine RPC/host surface. Begin returns the session token only after the simulator acknowledges a stationary start. There is at most one sample exchange in flight; intermediate samples are replaced by the newest. End and existing Stop bypass that sample gate.

Samples expire 150 ms after capture, not after eventual delivery. Reject expired, out-of-order, invalid or mismatched samples; none extends the deadline or starts a new session. Runtime correction from the 2026-10-07 manual trial: a renderer capture appeared 1 ms ahead of the machine process clock and was incorrectly refused. Allow a fixed maximum 5 ms future difference and clamp it to receipt time before setting the deadline or forwarding it; reject larger future differences. This does not increase the 150 ms lifetime. MachineController expires the session independently of the renderer. The simulator also enforces that absolute input deadline, so a stalled machine process cannot leave a velocity running. Expiry ends the session and requires explicit neutral-gated rearming. A late sample cannot revive it.

Focus loss, page departure, controller/connection changes, disconnect, process replacement and app shutdown invalidate the token and request stop. If begin completes after the renderer has disarmed, the returned token is ended immediately, without sending motion. Acknowledgements from an old session cannot affect a newer one. Stop invalidates Direct before sending the existing halt.

## Simulator motion and telemetry

Add a narrowly scoped simulator command protocol for stationary begin, expiring velocity samples, and end. Its frame formatting and reply handling live in the Makera simulator protocol adapter; schemas live with the machine contract. Only the connection owner sends it, over the existing simulator TCP connection. Each reply identifies session and sequence; motion is never retried after an unknown outcome.

The simulator keeps Direct motion separate from the ordinary program planner and refuses to mix the two. It accepts a begin only while Idle, stationary and with the spindle off. It slews XY velocity using its configured acceleration, keeps Z fixed, and updates the same position and feed telemetry that already drives the preview. While Direct is active, publish that real simulated position at 20 Hz so the preview follows the motion smoothly. Integration uses bounded elapsed time, checks expiry before advancing, and never catches up an unbounded interval after a process stall or sleep.

The simulator's Z1 work envelope comes from the existing fixture kit and firmware coordinate conversion. Direct motion cannot leave that XY envelope. At an edge, outward velocity is stopped; steering back into the envelope remains possible. This represents simulator travel limits, not stock collision detection or a surfacing boundary.

A zero sample or normal end decelerates to rest. End is verified using fresh Idle telemetry; foreground ownership is retained until then. A missing acknowledgement, stale telemetry, inconsistent session or failed stop ends Direct, reports an unverified outcome and closes the connection without a motion retry. The local extension must not change ordinary `$J`, job playback, homing or Stop behaviour.

## Changes and validation

Affected areas: machine simulator contracts and RPC/host mapping; MachineController session lifecycle and admission; the Makera simulator command adapter; the simulator device and a focused Direct motion helper; gamepad input/hook/controls; and the existing feature documentation. Reuse the current bed/tool preview and UI components. Add no dependencies or firmware changes.

Required checks: `npm run typecheck`, `npm run lint`, `npm run check`, `npm run build`. Follow AGENTS.md: do not add or run automated tests unless Joseph requests them.

Manual trials with the connected controller and diagnostic logs must cover:

1. Neutral arming, partial/full deflection, both XY axes, diagonals and the selected speed ceiling.
2. Stick release and LB release: zero requested, then confirmed Idle and stable position. Capture the request-to-confirm interval as simulator evidence only.
3. Holding the stick, changing direction and crossing the dead zone without repeated finite-step pauses.
4. B halt, focus loss, controller loss and mode changes; no automatic rearming.
5. Input expiry while the renderer or input stream is paused; a resumed stale sample cannot restart movement. Machine-process loss must also stop the simulator via its own deadline.
6. Travel limits and inward steering from a limit, with no Z change.
7. Step mode, RB step changes, normal jog controls and the 3D preview after Direct is ended.

Log session start/end, accepted sample sequence and age, expiry reason, zero request, and confirmed final position. Rate-limit ordinary input logs. Where a manual fault trial cannot be performed, report it as unverified rather than treating successful compilation as behavioural proof.

## Deferred work

Joseph's intended later bindings are right-stick up/down for Z and right-stick left/right for a configured fourth axis. RPM/feed adjustment uses a held modifier plus D-pad up/down; the held modifier selects which rate changes. A rate-adjustment modifier must suppress axis movement. The fourth-axis binding requires explicit support and configuration; it is not enabled merely because a controller axis exists. These preferences do not change this stage's fixed-Z XY scope.

Latched directional motion, axis snapping, facing operations, cutting and gamepad RPM/feed controls remain separate changes. Enabling physical connections requires an independently verified stock-firmware motion/cancellation strategy and measured stopping behaviour. This simulator design grants no evidence or permission to bypass that work.
