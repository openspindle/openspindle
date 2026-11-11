# Direct Simulator Jogging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add simulator-only proportional XY steering with normal release-to-stop and independent input expiry to the working GameSir prototype.

**Architecture:** Renderer input reaches a connection-bound Direct session through the existing MachineGateway and MachineController. A simulator-specific protocol drives a separate acceleration-limited velocity model; both the machine process and simulator enforce sample expiry. Foreground ownership is held until a normal end is confirmed or the connection is isolated.

**Tech Stack:** Existing TypeScript, Zod, React, Electron utility process, typed RPC, Makera framed TCP, shadcn controls and Three.js viewer. No new dependencies.

**Spec:** [Approved design](../specs/2026-10-07-direct-simulator-jog-design.md).

## Global Constraints

- Work in the existing isolated clone on `codex/gamepad-feasibility`; preserve its prototype and local commits. Do not push or create a PR without a request.
- Physical connections remain blocked. The new protocol is explicitly a simulator extension, not stock-firmware support.
- Step is the default. Direct uses LB, radial dead zone 0.20, normalized XY, selected speed ceiling 5%, 10% or 25%, and fixed Z.
- Samples are captured at up to 20 Hz and expire 150 ms after capture. No motion queue or automatic motion retry; at most one sample exchange is in flight, with only the latest pending input retained.
- Direct telemetry is published at 20 Hz. Integration uses bounded elapsed time and cannot replay a long stalled interval.
- Normal zero/end decelerates to Idle; B uses existing halt into Alarm. Session expiry requires explicit rearming.
- All motion goes through MachineController and its gateway; admission and snapshot availability remain authoritative. Keep vendor specifics in the Makera adapter or Z1 fixture kit.
- Follow AGENTS.md: do not add or run automated tests. Use meaningful manual trials and `npm run typecheck`, `npm run lint`, `npm run check`, `npm run build`.
- Read the approved spec before implementing. Use existing UI components and typography; update feature docs with actual behaviour and verification limits.

## Review Focus

1. Begin finishes after disarm or mode change: end that token before any moving sample; do not arm the replacement state.
2. A delayed sample or acknowledgement belongs to an expired/old session: it cannot extend a deadline or affect a newer session.
3. Renderer, machine process or simulator loop stalls: stop independently, do not integrate an unbounded catch-up interval, and require rearming.
4. Release/Stop races with an in-flight sample or end: newest zero takes priority over pending movement; Stop invalidates the token before halt.
5. Travel limit and changing simulator speed: outward travel is bounded, inward steering remains possible, Z is unchanged, and sample TTL stays in wall-clock milliseconds.

---

## Task 1: Typed simulator protocol and bounded velocity model

**Files:**

- Create `src/machine/contract/simulator-jog.ts`; export it from `src/machine/contract/index.ts`.
- Create `src/machine/firmware/makera/simulator-jog.ts` for simulator wire commands/replies.
- Create `tools/z1-simulator/direct-motion.ts` for velocity integration.
- Modify `tools/z1-simulator/device.ts` and `tools/z1-simulator/server.ts` for lifecycle, command routing and telemetry.

**Interfaces:**

- Contract: `BeginSimulatedJogRequest { connectionId: string }`; `SimulatedJogSession { connectionId: string; sessionId: string }`; `SimulatedJogSample extends SimulatedJogSession { sequence: number; capturedAt: number; x: number; y: number; speedScale: number }`; `SimulatedJogReceipt { sessionId: string; sequence: number }`. Derive these from strict Zod schemas. UUID ids, positive safe-integer sequence, finite integer capture time, XY within [-1,1] and vector length at most 1, speedScale within [0.05,0.25]. Use `DIRECT_INPUT_TTL_MS = 150` and `DIRECT_SAMPLE_MS = 50`.
- Wire type: `SimulatorJogWireCommand = { kind: "begin"; sessionId: string } | { kind: "sample"; sample: SimulatedJogSample } | { kind: "end"; sessionId: string }`. `simulatorJogFrame(command): OutboundFrame`, `readSimulatorJogCommand(text): SimulatorJogWireCommand | null`, and `readSimulatorJogReply(text): { sessionId: string; sequence: number; ok: boolean; reason: string | null } | null`. Begin/end use sequence 0; samples echo their sequence. Prefix all messages `sim-jog`; do not emit anonymous `ok` for these exchanges.
- Motion helper: `DirectMotion(position: Xyz, axisRates: readonly [number, number], acceleration: number, bounds: { min: readonly [number, number]; max: readonly [number, number] }, now: number)`; methods `target(vector: readonly [number, number], speedScale: number, expiresAt: number, now: number): void`, `zero(now: number): void`, `advance(now: number, speed: number): { position: Xyz; feed: number; moving: boolean; expired: boolean }`, `halt(now: number): Xyz`. Use maximum 20 ms integration slices and a maximum 50 ms catch-up span; larger gaps invalidate input before movement resumes.

- [x] Add strict schemas and wire formatting/parsing, validating numbers and field counts without permissive `parseFloat` coercion. Reject malformed/expired/future or out-of-order samples without extending any deadline.
- [x] Implement velocity slewing and trapezoidal position integration. Normalize to the selected ceiling against the configured XY rates; keep Z exactly at its initial value. Wall-clock expiry is independent of the simulator speed multiplier. Zero decelerates; a large loop gap holds position and invalidates the session.
- [x] Derive bounds in the simulator from the existing Z1 kit's work envelope and firmware coordinate conversion. Clamp outward motion at an edge and retain inward steering. Do not duplicate machine dimensions in generic modules.
- [x] In SimulatedZ1, begin only while Idle, stationary, spindle-off and with no active Direct session. Freeze ordinary planner commands while Direct owns motion. Update shared position/feed/status from Direct and publish status every 50 ms while the session or its normal deceleration is active. Publish one final stationary status before stopping that cadence.
- [x] On normal end/expiry, invalidate the token before deceleration, and retire it so delayed samples cannot revive it. Existing halt, reboot, dispose and TCP client loss also invalidate Direct. Add a device hook for server disconnect; do not change ordinary job-disconnect behaviour.
- [x] Verify with `npm run typecheck`. Manually inspect begin/sample/end rejection routing and legacy `$J`/Stop paths; do not write a test script. Commit as `feat(simulator): Add expiring direct XY motion`.

## Task 2: Machine-owned Direct session and typed host surface

**Files:**

- Create `src/machine/core/simulated-jog.ts` for bounded protocol exchange, expiry and end confirmation.
- Modify `src/machine/core/controller.ts`, `src/machine/core/gateway.ts`, `src/machine/firmware/adapter.ts`, `src/machine/firmware/makera/adapter.ts`.
- Modify `src/platform/contract/machine-rpc.ts`, `src/platform/host.ts`, `src/platform/machine-link.ts`, `electron/machine/handlers.ts`.

**Interfaces:**

- Controller/gateway/host methods: `beginSimulatedJog(request: BeginSimulatedJogRequest): Promise<SimulatedJogSession>`, `sampleSimulatedJog(sample: SimulatedJogSample): Promise<SimulatedJogReceipt>`, `endSimulatedJog(session: SimulatedJogSession): Promise<MachineSnapshot>`. Add matching RPC names `machine.beginSimulatedJog`, `machine.sampleSimulatedJog`, `machine.endSimulatedJog`; use the shared schemas and give end unlimited in-flight budget like Stop.
- Adapter gets optional `simulatorJog` protocol formatting/reply hooks from Task 1. Require it and a loopback simulator before Direct admission.
- Owner module: `SimulatedJogOwner(context: OperationContext, token: SimulatedJogSession, onExpired: (reason: string) => void)`; `start(): Promise<void>`, `sample(input: SimulatedJogSample): Promise<SimulatedJogReceipt>`, `end(): Promise<void>`, `invalidate(): void`. A controller instance owns at most one owner, tied to the exact MachineSession and foreground activity.

- [x] Admit begin using the existing jog admission chain, at a representative valid finite distance/speed, then repeat admission against fresh diagnostic telemetry inside the reserved activity. Explicitly require Idle, stationary and spindle-off. Validate the supplied connection id before reserving anything.
- [x] Reserve a `command` activity labelled **Direct simulator jogging**, create a fresh UUID session id, acknowledge stationary begin, and return its token. All usual controls inherit the existing busy reason from the reserved activity; do not invent a second owner or bypass admission.
- [x] Implement labelled reply leases with session/sequence matching. Use 150 ms for a moving-sample exchange deadline, 3 s for stationary begin/end exchanges, and 3 s for fresh Idle confirmation at end. Retain only the latest pending sample, give zero priority over pending motion, and never retry a missing reply. Discard old-session replies.
- [x] Independently enforce `capturedAt + 150`: reject future, expired, mismatched or non-increasing samples. Invalid old-token requests must not cancel a newer session. Expiry invalidates and ends Direct; failure to verify end isolates the connection and reports an unverified outcome.
- [x] Hook owner cleanup into normal end, Stop, reset, connection switch, disconnect, session close and dispose. Invalidate before halt or transport close. Retain foreground ownership through normal end confirmation; release exactly that activity, never a replacement activity.
- [x] Map methods through app-only gateway, RPC handlers and both reachable/unreachable MachineHost implementations. End of an already-retired token is harmless and cannot stop a newer session. Keep errors typed and log the reason, sequence/age and final position through existing diagnostics.
- [x] Run `npm run typecheck` and `npm run lint`. Review race paths against Review Focus 1–4, then commit as `feat(machine): Own direct simulator jogging sessions`.

## Task 3: GameSir Direct mode in the existing controls

**Files:**

- Create `src/features/device/gamepad-direct-input.ts` for radial mapping and re-engagement gating.
- Create `src/features/device/use-gamepad-direct-jog.ts` for token and sample lifecycle.
- Modify `src/features/device/gamepad-step-input.ts`, `src/features/device/use-gamepad-step-jog.ts`, `src/features/device/gamepad-step-controls.tsx` and `src/features/device/device-jog-card.tsx` as needed to share the existing controller poller without duplicate polling.

**Interfaces:**

- Mapping: `directVector(input: ControllerInput): readonly [number, number]`; apply radial 0.20 dead zone and `(min(radius, 1) - 0.20) / 0.80` magnitude after unit-direction normalization, with controller Y inverted. Return zero unless LB is held, mapping supported, RB/B released and no D-pad direction is pressed. Re-engagement after RB requires neutral first.
- Hook takes `MachineHost`, `connectionId`, speed ceiling, selected-controller identity and disarm callback; exposes `begin(): Promise<void>`, `sample(input: ControllerInput, capturedAt: number): void`, `end(reason: string): void`, and pending/active state. It owns no sockets, machine timers or motion queue.

- [x] Add `dpadHeld: boolean` to the shared ControllerInput/readController result so Direct suppresses steering during any D-pad input without confusing a stick direction with a D-pad direction.
- [x] Add shadcn **Step / Direct** selection with Step default. Change mode only after local disarm, and wait for prior Direct end before allowing another arm. Keep existing RB step selection, readouts, Z lock and Step behaviour.
- [x] Reuse one existing input poller. In Direct, forward latest captured input every 50 ms, promptly prioritize zero on stick/LB release, and never send a nonzero sample before acknowledged begin. Gate all async completions by mode/controller/connection generation; disarming while begin is pending immediately ends its returned token.
- [x] Use the typed MachineHost surface from Task 2. A sample error stops local sending and disarms without retry. Watch connection/process replacement and server activity loss so expiry is reflected even with a centred stick. Ordinary release keeps the valid session armed; expiry requires explicit rearming.
- [x] Route B through existing Stop and invalidate Direct first. Blur, visibility change, page exit, controller change/disconnection and a polling gap over 150 ms end Direct. Ignore held inputs until neutral after a mode/session transition.
- [x] Display **Hold LB to steer; release the stick or LB to stop. Jog speed is the maximum speed.** in Direct and retain Step-specific instructions in Step. Use existing snapshot reasons and busy/pending state for arm controls.
- [x] Run the required type-check, lint, formatting and build commands. Commit as `feat(gamepad): Add direct simulator steering`.

## Task 4: Manual verification, documentation and handoff

**Files:** Modify `docs/gamepad-prototype.md` and `docs/device-controls.md`; mark this plan's completed checkboxes as work proceeds.

- [x] Run `npm run typecheck`, `npm run lint`, `npm run check`, `npm run build` after the final code change, and inspect exit codes. Repeat only if later code changes or failures justify it.
- [x] Restart the prototype with the updated build and confirm its local simulator reconnects. Invite Joseph to try partial/full X and Y steering, diagonals, direction changes, stick release, LB release, B Stop, mode changes and RB step size. Observe local logs and distinguish requested zero from confirmed rest.
- [ ] During the manual trial, record zero-request and confirmed-Idle times and stable subsequent position. Confirm ordinary release needs no Unlock, B enters Alarm, Z stays fixed and the 3D preview updates smoothly. Keep timing claims simulator-only.
- [ ] Manually check focus/controller loss and travel bounds, including inward movement at an edge. Manually pause renderer input and replace the machine process to observe the simulator deadline. If native automation remains unavailable, provide precise user actions for these trials; do not replace them with an automated script or claim unperformed checks passed.
- [x] Review the final branch against all five Review Focus items and the spec. For the Native execution option, request one independent whole-branch review using the executing-plans skill; fix material findings and rerun only affected checks plus required final build checks when code changes.
- [x] Update docs with bindings, ownership, expiry, simulator-only protocol limitations and actual manual results. List any outstanding trials. Commit as `docs(gamepad): Document direct simulator control and validation`.
- [ ] Handoff with the live app state, checks performed, manual results and any limits. Do not enable physical connections or start latched/cutting features in this plan.

## Execution choice

Recommended: **Native** — implement in this chat, followed by one independent branch review. The three implementation tasks share tightly coupled contracts, and this remains an isolated simulator prototype. Subagent-driven execution is also available, with a fresh implementer and reviewer per task at greater context cost.

The approved design is the authority for behaviour. Joseph approved this plan and selected implementation in this chat followed by one independent review. Manual trials remain a separate verification gate.

Future mapping preferences recorded after design approval: right stick up/down for Z, right stick left/right for a configured fourth axis, and held modifier + D-pad up/down for RPM/feed adjustment, with the modifier selecting the rate. They are deferred from this XY stage. When implemented, rate-adjustment modifiers suppress axis movement; this plan must not pre-bind the right stick or claim fourth-axis support.
