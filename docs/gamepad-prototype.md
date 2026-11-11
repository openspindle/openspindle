# Gamepad controls

An Xbox-style GameSir controller uses **Device → Jog → Gamepad**. Standard Xbox mapping is required; unsupported mappings stay input-monitor only. Explicitly arm with both sticks centred and LB, RB, L3, the D-pad and action buttons released. Opening the panel never moves the machine.

## Physical Z1

Stock-firmware **Step** mode sends the normal finite, single-axis `$J` jogs and verifies each endpoint before another action. Arming checks fresh diagnostics, reads the machine anchors and checks homed axes. The owner holds the machine until disarmed. Connection, controller, focus and mode changes require rearming; lost input expires after 150 ms in the machine process. Nothing queues or retries motion.

- Hold **LB**, then use the left stick or D-pad for one XY step. Right-stick up/down gives one Z step. Return to centre before another step.
- Select **0.1, 1, 5 or 10 mm**. Normal stick/LB release lets the finite step finish. X/RB during a step interrupts and disarms it.
- Select **5, 10, 25, 50, 75 or 100%** of the axis maximum. **L3** cycles once per press. Speed changes apply to the next step.
- Release LB, hold **RB** and tap D-pad left/right to change step size without jogging.
- **B** requests the normal machine Stop and disarms.

A physical step requires spindle off, metric mode, no height compensation and Idle without a native job. The firmware adapter bounds each endpoint to the modeled work area from freshly read Anchor 1 and Z travel; an outside position can recover inward. These are travel checks, not fixture, tool or cable collision detection. Interrupted motion, input expiry during a command, or disarming with an active spindle uses realtime halt into Alarm. Unlock and home before rearming. Disarming while confirmed idle with the spindle off needs no halt.

The owner runs independently of the renderer, but a failed physical network connection cannot deliver Stop. Finite jogs limit queued travel; use the physical E-stop if the machine does not respond. Physical controller motion, cancellation distance and spindle behavior have not yet been verified on hardware in this build.

## Spindle

Hold **X** and wait for rest. **D-pad up/down** changes target by 1,000 RPM within the adapter range; **X + A** starts it and **X + Y** stops it. Start requires a cutting tool, both sticks centred and LB released. A probe tool cannot start the spindle. The physical controller keeps a target locally while off; changing it does not start the spindle. A running target change uses the normal checked spindle command. The Spindle card shares the target; its Requested readout changes only after a command applies it.

Each action needs a fresh press; conflicting, early or busy presses are consumed. Disarming stops the owned spindle. Physical jogging while cutting is not enabled.

## Direct simulator steering

**Direct** is available on the local simulator only. Hold LB to steer XY with the left stick and Z with right-stick up/down. Stick/LB release commands zero velocity. Jog percentage is the maximum at full deflection. X/RB suppress motion and require centring before movement resumes. Frames carry expiring timestamps, increasing sequences and connection/session identifiers; both renderer and owner reject stale or mismatched input.

The simulator uses its own `sim-jog` protocol; physical machines are never sent these frames. Stock [SimpleShell](https://github.com/MakeraInc/MakeraZ1Firmware/blob/main/src/modules/utils/simpleshell/SimpleShell.cpp) supplies finite `$J` moves and [SerialConsole](https://github.com/MakeraInc/MakeraZ1Firmware/blob/main/src/modules/communication/SerialConsole.cpp) supplies Ctrl-X halt. Neither establishes a smooth release-to-stop jog cancel for shipped firmware. Physical Direct and latched cutting need further firmware and stopping-distance work.

## Verification

Type checking, lint, formatting and a production build are required. Automated tests are not added or run unless requested, per AGENTS.md. Earlier simulator observations in `docs/superpowers` do not establish physical controller behavior.
