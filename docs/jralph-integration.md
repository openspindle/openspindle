# Workshop and gamepad integration

This branch adapts selected work by Joe Ralph from
[`jralph/openspindle`, `codex/gamepad-feasibility`](https://github.com/jralph/openspindle/tree/codex/gamepad-feasibility),
reviewed at commit `87758001cae2b7041ce27e1298859cbba4d852a5`, onto
`passeride/main` at `1ff9729fa93ce56aa82dc199b5c497666e3388f9`.

## Included

- Guided stock, workholding, work-zero, tool and review steps in a resizable sidebar.
- Editable facing operations, cutting presets and a chip-load calculator, horizontal/vertical/cross-hatch passes, verified cleared-pocket entry and automatic tool-setter keep-outs.
- Locally saved reusable processes with copied tool definitions and device/anchor-frame checks.
- Worker-based sampled material removal following the Job playback cursor.
- Xbox-style gamepad Step controls on a physical Z1 and Step/Direct controls in the simulator, including XYZ steps and spindle actions.
- Controller session ownership, expiring input, stop-response draining and matching connection checks.

The source changes primarily come from commits `1c1645c`–`170c594`,
`fbf0336`, `5046074`, `be3a37f`, selected controller guards from `e407426`,
`15058b0`, `7699a69`, the facing changes in `dd0c931`, the sidebar changes in
`7c794b5`, and the gamepad changes in `340b77d`.

## Probing and metrology

The remaining source branch is now integrated: inspection reports and raw JSON/CSV
exports, repeatability experiments, measurement-to-setup proposals, probe-tip
calibration, Anchor 1 calibration, bounded probe positioning, part-Z setup and
temporary calibration runs. Existing spindle/tool-setter guards, fresh diagnostic
checks, TCP lockout/Stop behavior, V-bit removal and resolution preferences are
retained in the combined implementation.

Physical probing follows the source branch's verified-input and bounded-contact
execution policy. Native corner/center and height-map firmware searches are
simulator-only. On a physical Z1, use the Anchor 1, diameter or Z probe guides;
unknown or failed contact sequences request a halt and lock out new motion.

## Integration decisions

The branch retains our FreeCAD import, sharp axis labels, modeled tool setter,
source-line links, estimated finish clock, camera fullscreen/transfer handling,
TCP health handling and existing probing/tool-change safety rules. Fork release
workflows are retained. No release version or dependency update is included.

Physical connections remain enabled. Direct gamepad steering is simulator-only;
physical controls send finite Step jogs. An unverified physical controller action
requests a halt and keeps the connection locked out with Stop available, rather
than closing the connection and removing the Stop path. The existing 0.01 mm
screen jog step is retained. Facing uses the same setter-coordinate constants as
our model, and modeled entry recesses follow the configured bed offset.

## Limits and manual review

Material removal supports known straight, flat-ended cutters and dimensioned
V-bits on three-axis plates. Generated probing can share a preview with cutting without removing stock. Actual
height compensation, rotary machining and undercuts remain unsupported. It is a sampled preview, not a collision check or
proof of a safe program. Physical gamepad stopping behavior and generated facing paths
require hands-on verification before this branch is merged for normal use.

Review with the local simulator before using a machine:

1. Open Guided setup, resize the sidebar, navigate through its steps and confirm
   project edits can be undone. Opening a guide must not command motion.
2. Create a shallow facing operation with a known flat cutter. Review horizontal,
   vertical and cross-hatch paths, the setter exclusion, the operation's generated
   G-code and the ordinary Job checks. Change tool diameter and entry frame and
   confirm the operation requires correction or renewed entry confirmation.
3. Save and reload a reusable process, including a changed library tool. Confirm
   copied tools are preserved and a mismatched device/frame prevents loading.
4. On a machining-only plate, toggle Material removal and seek forward/backward.
   Check its resolution, the tapered cuts from V-bits, and the unsupported-program
   explanation for probing. Toggle off to restore the original stock.
5. With a standard-mapped controller, verify explicit arming, single Step gestures,
   simulator Direct release-to-stop, focus/controller loss, B Stop and rearming.
   No physical-machine motion is part of this development verification.

Required development checks are `npm run typecheck`, `npm run lint`,
`npm run check` and `npm run build`. No automated tests are added or run.

Development validation for this integration passed: typecheck, ESLint, Prettier
and production build. The build reports the existing large-chunk warning. No
automated test suite, interactive desktop trial or physical-machine trial was
run during integration.
