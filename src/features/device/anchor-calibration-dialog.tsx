import { useId, useMemo, useState } from "react"
import { createAtom, useSelector } from "@tanstack/react-store"
import { useNavigate } from "@tanstack/react-router"
import { z } from "zod"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import { ReasonButton } from "@/components/workspace/reason-button"
import { useFixtureLibrary } from "@/app/fixtures/fixture-context"
import { projectPlacement } from "@/app/fixtures/plate-profile"
import { useWorkspace } from "@/app/workspace/workspace-context"
import { kitForSetup } from "@/domain/fixtures/catalog"
import {
  anchorCalibrationParams,
  anchorCalibrationStartIssue,
} from "@/domain/anchors/calibration"
import { createPlateSetup } from "@/domain/plate/plate"
import { strategyById } from "@/domain/probing/strategies"
import { isFresh, machineId } from "@/machine/contract"
import { probeProfile } from "@/domain/tools/tool"
import { useMachineSnapshot } from "@/platform/machine"
import { strategyProbes } from "@/features/probing/probe-tools"
import { ParameterField, probingField } from "@/features/probing/probing-fields"
import { useProbingForm } from "@/features/probing/probing-form"
import { AppDialog } from "@/features/shell/app-dialog"
import { openDialog } from "@/features/shell/dialogs"
import { CalibrationIllustration } from "./calibration-illustration"
import { anchorCalibrationRun } from "./anchor-calibration-run"
import { useCalibrationRun } from "./use-calibration-run"
import { CalibrationRunPanel } from "./calibration-run-panel"
import { checkedProbeBinding, ProbeInputCheck } from "./probe-input-check"
import { ProbeSafetyNotice } from "@/features/probing/probe-safety-notice"
import { ProbeTipDiameterField } from "@/features/probing/probe-tip-diameter-field"
import { StopButton } from "@/features/job/stage-card"
import { SaveAsAnchor } from "@/features/job/save-as-anchor"
import { inspectionReport } from "@/features/job/inspection-report"
import { foundPosition } from "@/domain/probing/tasks/origin/result"
import { HeightMapFacts } from "@/components/workspace/height-map-grid"

type Draft = {
  step: number
  toolId: string
  fixtureId: string
  gap: number
  maxX: number
  maxY: number
  maxDown: number
  savedRunId?: string
  signalBindingId?: string
  signalToolId?: string
}
const draftAtom = createAtom<Draft>({
  step: 0,
  toolId: "",
  fixtureId: "",
  gap: 5,
  maxX: 6,
  maxY: 6,
  maxDown: 6,
})
const update = (patch: Partial<Draft>) =>
  draftAtom.set((draft) => ({ ...draft, ...patch }))
const SearchSchema = z
  .strictObject({
    gap: z.number().finite().min(0.1).max(5),
    maxX: z.number().finite().min(0.4).max(10),
    maxY: z.number().finite().min(0.4).max(10),
    maxDown: z.number().finite().min(0.4).max(10),
  })
  .refine((value) => value.maxDown > value.gap, {
    path: ["maxDown"],
    message: "Maximum downward search must exceed the estimated top gap.",
  })

export function AnchorCalibrationDialog({ onClose }: { onClose: () => void }) {
  const id = useId()
  const draft = useSelector(draftAtom)
  const workspace = useWorkspace((state) => state)
  const fixtures = useFixtureLibrary((state) => state)
  const library = workspace.tools
  const placement = useMemo(
    () => projectPlacement(workspace, fixtures),
    [workspace, fixtures]
  )
  const kit = kitForSetup(placement)
  const reference = kit.anchorCalibration
  const machine = useMachineSnapshot()
  const navigate = useNavigate()
  const [confirmedSetup, setConfirmedSetup] = useState<string | null>(null)
  const [valid, setValid] = useState(true)
  const form = useProbingForm(
    {
      gap: draft.gap,
      maxX: draft.maxX,
      maxY: draft.maxY,
      maxDown: draft.maxDown,
    },
    SearchSchema,
    (value) => update(value),
    setValid
  )
  const strategy = strategyById("inside-corner")!
  const probes = kit.probing
    ? strategyProbes(strategy, library, kit.probing)
    : []
  const tool =
    probes.find((entry) => entry.tool.id === draft.toolId)?.tool ??
    (!draft.toolId ? probes.at(0)?.tool : undefined)
  const device = machine.connection.device
  const profile = tool && probeProfile(tool)
  const conductive = profile?.contact === "conductive"
  const selectedIssue = probes.find(
    (entry) => entry.tool.id === tool?.id
  )?.refused
  const probeNumber = profile && kit.probing?.slot(profile)
  const activeProbe =
    probeNumber !== null &&
    probeNumber !== undefined &&
    machine.telemetry?.tool === probeNumber &&
    machine.telemetry.toolOffset !== null
  const anchors = machine.anchors.value
  const anchor = anchors?.anchors.find(
    (item) => item.id === reference?.anchorId
  )
  const params = anchorCalibrationParams(kit)
  const offset =
    params?.placement.kind === "anchor" ? params.placement.offset : null
  const target: [number, number] | null =
    anchor && offset ? [anchor.x + offset[0], anchor.y + offset[1]] : null
  const references = kit.fixtures.filter((entry) =>
    reference?.fixtureIds.includes(entry.fixture.id)
  )
  const binding = checkedProbeBinding(machine)
  const signalVerified =
    !!binding &&
    draft.signalBindingId === binding.id &&
    draft.signalToolId === tool?.id
  const livePosition = isFresh(machine.telemetry, Date.now())
    ? machine.telemetry.machine
    : null
  const liveStartIssue =
    target && reference && livePosition
      ? anchorCalibrationStartIssue(
          [livePosition.x, livePosition.y],
          target,
          reference.startTolerance
        )
      : null
  const setupKey = JSON.stringify({
    deviceId: placement.deviceId,
    connectionId: machine.connection.id,
    tool,
    anchors,
    fixtureId: draft.fixtureId,
    gap: draft.gap,
    maxTravel: [draft.maxX, draft.maxY, draft.maxDown],
    binding,
  })
  const confirmed = confirmedSetup === setupKey
  const changeStep = (step: number) => {
    update({ step })
    setConfirmedSetup(null)
  }
  let reason: string | null = null
  if (!reference?.boundedNc || !reference.measurementNc)
    reason = "This machine has no supported bounded anchor calibration."
  if (
    !reason &&
    (!device ||
      machine.connection.status !== "connected" ||
      machineId(device) !== placement.deviceId)
  )
    reason = "Connect the project's device before preparing its calibration."
  if (!reason && (!anchors || !target))
    reason = "Read the device's anchors first."
  if (!reason && !machine.availability.writeAnchors.allowed)
    reason =
      machine.availability.writeAnchors.reason ??
      "Anchor calibration is unavailable."
  if (!reason && machine.connection.restartNeeded)
    reason = "Reset the machine to apply pending settings first."
  if (
    !reason &&
    (!tool ||
      tool.diameter === null ||
      tool.diameter < 0.5 ||
      tool.diameter > 3.2)
  )
    reason =
      "Choose a connected XYZ probe with its own 0.5–3.2 mm tip diameter in the library."
  if (!reason && selectedIssue) reason = selectedIssue
  if (
    !reason &&
    !references.some((entry) => entry.fixture.id === draft.fixtureId)
  )
    reason = "Select the L-bracket fitted at Anchor 1."
  let runReason = reason
  if (!runReason && !signalVerified)
    runReason =
      "Position the probe, touch it once and remove contact; wait for Probe signal verified."
  if (!runReason && binding?.tool !== probeNumber)
    runReason = "Check the selected, measured probe's live signal again."
  if (!runReason && binding && target && reference)
    runReason = anchorCalibrationStartIssue(
      binding.position,
      target,
      reference.startTolerance
    )
  if (!runReason && !valid)
    runReason =
      "Enter an estimated gap and valid maximum search distances. Downward search must exceed the gap."

  const candidateInput: Omit<
    Parameters<typeof anchorCalibrationRun>[0],
    "kit"
  > | null =
    !reason &&
    tool &&
    anchors &&
    (draft.step === 0 || (draft.step === 2 && binding))
      ? {
          setup: createPlateSetup({
            stock: null,
            stockSource: "assigned",
            ...placement,
          }),
          fixtureId: draft.fixtureId,
          tool,
          anchors,
          binding,
          gap: draft.gap,
          maxTravel: [draft.maxX, draft.maxY, draft.maxDown],
          stage: draft.step === 0 ? "setter" : "contacts",
        }
      : null
  // Telemetry clones the same proof/anchors often. Keep the reviewed plate stable by value.
  const candidateKey = JSON.stringify(candidateInput)
  const candidate = useMemo(() => {
    const input = JSON.parse(candidateKey) as typeof candidateInput
    if (!input) return { plate: null, error: null }
    try {
      return { plate: anchorCalibrationRun({ ...input, kit }), error: null }
    } catch (error) {
      return {
        plate: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }, [candidateKey, kit])
  const runner = useCalibrationRun(candidate.plate, tool?.id ?? null)
  const owned = runner.record
  const recordSource = owned?.session.plate.operations[0]?.source
  const report = owned && runner.job ? inspectionReport(runner.view) : null
  const feature = report?.features.find(
    (item) => item.operationId === owned?.session.plate.operations[0]?.id
  )
  const position =
    feature?.status === "complete" && feature.result
      ? foundPosition(feature.result)
      : null
  const saved = !!owned && draft.savedRunId === owned.session.runId
  const close = () => {
    onClose()
    if (runner.busy) void navigate({ to: "/job" })
  }
  const start = (stage: "setter" | "contacts") => {
    if (
      (stage === "setter" ? reason : runReason) ||
      candidate.error ||
      runner.reason ||
      (stage === "contacts" && !confirmed)
    )
      return
    runner.run.mutate(stage)
  }
  let nextReason = reason
  if (!nextReason && draft.step === 0 && !activeProbe)
    nextReason = "Run tool-setter detection for the fitted probe first."
  if (draft.step === 1) nextReason = liveStartIssue ?? runReason
  return (
    <AppDialog
      title={`Auto calibrate ${reference?.name ?? "anchor"}`}
      width="wide"
      onClose={close}
      description="Measure the fitted probe, position manually and verify its signal, then probe and save Anchor 1. Run buttons start temporary machine runs; opening this guide moves nothing."
      toolbar={
        runner.busy ? (
          <StopButton
            action={{
              reason: null,
              pending: runner.stop.isPending,
              run: () => runner.stop.mutate(),
            }}
          />
        ) : undefined
      }
      footer={
        <div className="flex w-full justify-between gap-2">
          <Button
            variant="outline"
            disabled={draft.step === 0 || !!owned}
            onClick={() => changeStep(draft.step - 1)}
          >
            Back
          </Button>
          {draft.step < 2 ? (
            <ReasonButton
              label={draft.step === 0 ? "Use existing measurement" : "Next"}
              reason={nextReason}
              disabled={!!owned}
              onClick={() => changeStep(draft.step + 1)}
            >
              {draft.step === 0 ? "Use existing measurement" : "Next"}
            </ReasonButton>
          ) : (
            <ReasonButton
              label="Run bounded anchor probing"
              reason={runReason ?? candidate.error ?? runner.reason}
              disabled={!confirmed || !!owned}
              onClick={() => start("contacts")}
            >
              Run bounded anchor probing
            </ReasonButton>
          )}
        </div>
      }
    >
      <FieldGroup>
        <FieldDescription>
          Step {draft.step + 1} of 3 ·{" "}
          {
            [
              "Probe and reference",
              "Manual position, limits and signal",
              "Probe and save",
            ][draft.step]
          }
          . This draft stays while the app is open.
        </FieldDescription>
        {draft.step > 0 && target && (
          <HeightMapFacts
            facts={[
              {
                label: "Target machine X",
                value: `${target[0].toFixed(3)} mm`,
              },
              {
                label: "Target machine Y",
                value: `${target[1].toFixed(3)} mm`,
              },
              {
                label: "Current machine X",
                value: livePosition
                  ? `${livePosition.x.toFixed(3)} mm`
                  : "Waiting for status",
              },
              {
                label: "Current machine Y",
                value: livePosition
                  ? `${livePosition.y.toFixed(3)} mm`
                  : "Waiting for status",
              },
              {
                label: "X to target",
                value: livePosition
                  ? `${(target[0] - livePosition.x).toFixed(3)} mm`
                  : "—",
              },
              {
                label: "Y to target",
                value: livePosition
                  ? `${(target[1] - livePosition.y).toFixed(3)} mm`
                  : "—",
              },
            ]}
          />
        )}
        {draft.step === 0 && (
          <>
            <CalibrationIllustration kind="anchor" />
            <Field>
              <FieldLabel htmlFor={`${id}-reference`}>
                Installed L-bracket
              </FieldLabel>
              <OptionSelect
                id={`${id}-reference`}
                value={draft.fixtureId}
                options={[
                  { value: "", label: "Choose the fitted bracket" },
                  ...references.map(({ fixture }) => ({
                    value: fixture.id,
                    label: `${fixture.name} · ${fixture.model.bounds.max[2] - fixture.model.bounds.min[2]} mm tall`,
                  })),
                ]}
                disabled={!!owned}
                onValueChange={(fixtureId) => {
                  update({ fixtureId })
                  setConfirmedSetup(null)
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-probe`}>
                Connected XYZ probe
              </FieldLabel>
              <OptionSelect
                id={`${id}-probe`}
                value={tool?.id ?? ""}
                options={probes.map(({ tool: probe }) => ({
                  value: probe.id,
                  label: `${probe.name}${probe.probe?.contact === "conductive" ? " · conductive rod" : ""}`,
                }))}
                disabled={!!owned}
                onValueChange={(toolId) => {
                  update({ toolId })
                  setConfirmedSetup(null)
                }}
              />
            </Field>
            {tool && <ProbeTipDiameterField tool={tool} disabled={!!owned} />}
            <Button
              variant="outline"
              disabled={!!owned}
              onClick={() =>
                openDialog({
                  kind: "tools",
                  back: { kind: "anchor-calibration" },
                })
              }
            >
              Open tool library
            </Button>
            <FieldDescription>
              For a conductive rod, save its own XYZ probe entry from the Makera
              catalog, with Contact method set to Conductive rod and its actual
              contact diameter. The catalog leaves that diameter unknown until
              entered; do not copy the ruby ball diameter. Tool-setter detection
              measures the fitted length.
            </FieldDescription>
            {conductive && (
              <Alert>
                <AlertDescription>
                  Disconnect the wired Z probe and connect the conductive rod's
                  cable. The bracket top and both inner faces must conduct to
                  the aluminium table through the pins, screws or another
                  conductive connection. Coatings can insulate them. Verify each
                  contacted face before proceeding.
                </AlertDescription>
              </Alert>
            )}
            <p>
              Secure and clean the bracket in its normal pinned position. Fit
              the selected, undamaged probe. Use the actual tip's library entry
              and diameter; do not reuse the broken probe's dimensions for a
              conductive rod.
            </p>
            <p>
              Insert the selected 3D probe securely and connect its signal
              cable. If it has just been fitted or remounted, choose Run
              tool-setter detection below. Follow the machine's prompts. If the
              same fitted probe is already measured and active, reuse that
              measurement and continue. There is no automatic bracket
              positioning.
            </p>
            <ReasonButton
              label="Run tool-setter detection"
              reason={reason ?? candidate.error ?? runner.reason}
              disabled={!!owned}
              onClick={() => start("setter")}
            >
              Run tool-setter detection
            </ReasonButton>
          </>
        )}
        {draft.step === 1 && (
          <>
            <ProbeSafetyNotice />
            <CalibrationIllustration kind="anchor" />
            <p>
              Use the Device controls beside this guide to manually jog the
              probe over the solid top at the L-bracket's front-left elbow,
              clear of screws and holes. Aim about 5 mm left and 5 mm forward of
              its inner corner, with the tip roughly 5 mm above the aluminium
              top. Leave the axes stationary when you test the signal below.
            </p>
            {target && (
              <FieldDescription>
                Expected machine XY: {target[0].toFixed(3)},{" "}
                {target[1].toFixed(3)} mm (within{" "}
                {reference!.startTolerance.toFixed(1)} mm). The bracket is at
                the front left of the bed.
              </FieldDescription>
            )}
            {liveStartIssue && (
              <Alert>
                <AlertDescription>{liveStartIssue}</AlertDescription>
              </Alert>
            )}
            <ParameterField
              id={`${id}-gap`}
              parameter={{
                label: "Estimated gap above bracket top",
                unit: "mm",
                min: 0.1,
                max: 5,
                step: 0.1,
                default: 5,
              }}
              field={probingField(form, "gap")}
              disabled={!!owned}
            />
            {(
              [
                ["maxX", "Maximum left search · X−"],
                ["maxY", "Maximum front search · Y−"],
                ["maxDown", "Maximum downward search · Z−"],
              ] as const
            ).map(([name, label]) => (
              <ParameterField
                key={name}
                id={`${id}-${name}`}
                parameter={{
                  label,
                  unit: "mm",
                  min: 0.4,
                  max: 10,
                  step: 0.1,
                  default: 6,
                }}
                field={probingField(form, name)}
                disabled={!!owned}
              />
            ))}
            <FieldDescription>
              These limits are total search travel from each search's start, not
              the probe's safe deflection. A roughly 5 mm top gap needs more
              than 5 mm downward search. Choose limits for the actual
              clearances; failure to trigger stops the job without retrying.
            </FieldDescription>
            <Button
              variant="outline"
              onClick={() => void navigate({ to: "/device" })}
            >
              Show positioning controls
            </Button>
            {tool && (
              <ProbeInputCheck
                tool={tool}
                toolNumber={probeNumber ?? null}
                disabled={!!owned}
                onVerified={(signalBindingId) =>
                  update({ signalBindingId, signalToolId: tool.id })
                }
              />
            )}
          </>
        )}
        {draft.step === 2 && (
          <>
            <p>
              The first search starts at your manually positioned,
              signal-checked pose and is limited to {draft.maxDown.toFixed(2)}{" "}
              mm down at 30 mm/min. Further top touches are limited to 0.4 mm at
              15 mm/min. It then rises 5 mm above the touched top, moves into
              the pocket and probes the two inner walls with limits of{" "}
              {draft.maxX.toFixed(2)} mm left and {draft.maxY.toFixed(2)} mm
              forward, releasing X before Y. Each successful contact must be
              received and verified before the next step. A bounded probe-away
              move checks that contact opens before moving 2 mm clear of each
              wall. The slower second side search is limited to 2.4 mm.
            </p>
            <p>
              These are maximum travel distances, not guaranteed compression
              distances. An incorrect gap, anchor position or missing contact
              signal can still cause contact with the reference. The normal
              approximately 108 mm native top search is not used.
            </p>
            <p>
              Choose Run bounded anchor probing without moving or remounting the
              probe. This temporary run stays in the guide and adds no project
              plate. After six verified contacts, review Save as Anchor 1 below.
              Saving keeps the other anchors' offsets; reset and re-home after a
              verified write.
            </p>
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-confirm`}
                checked={confirmed}
                disabled={!!owned}
                onCheckedChange={(value) =>
                  setConfirmedSetup(value === true ? setupKey : null)
                }
              />
              <FieldLabel htmlFor={`${id}-confirm`}>
                The same measured probe remains fitted and connected, it is over
                the solid bracket top, the search limits match the clearances,
                and the pocket and complete travel are clear.
                {conductive &&
                  " The bracket top and both inner faces have verified electrical contact to the table, and loose checking leads have been removed."}
              </FieldLabel>
            </Field>
          </>
        )}
        <CalibrationRunPanel
          runner={runner}
          onMeasured={() => {
            update({ step: 1 })
            setConfirmedSetup(null)
          }}
        />
        {owned?.stage === "contacts" &&
          !owned.pending &&
          !owned.error &&
          !owned.cancelled &&
          runner.connectionMatches &&
          runner.job?.phase === "completed" &&
          position &&
          recordSource?.kind === "probing" &&
          recordSource.task === "origin" &&
          recordSource.anchorCalibration && (
            <div className="flex flex-col gap-3">
              <HeightMapFacts
                facts={[
                  {
                    label: "Measured Anchor 1 X",
                    value: `${position[0].toFixed(3)} mm`,
                  },
                  {
                    label: "Measured Anchor 1 Y",
                    value: `${position[1].toFixed(3)} mm`,
                  },
                ]}
              />
              {!saved && (
                <SaveAsAnchor
                  position={position}
                  plate={owned.session.plate}
                  deviceId={owned.session.device?.id ?? null}
                  calibration={recordSource.anchorCalibration}
                  measurementRunId={owned.session.runId}
                  onSaved={() => update({ savedRunId: owned.session.runId })}
                />
              )}
              {saved && (
                <>
                  <FieldDescription>
                    Anchor 1 was written and read back. Reset and re-home before
                    the machine uses the saved location for its own moves.
                  </FieldDescription>
                  <Button
                    disabled={runner.dismiss.isPending}
                    onClick={() =>
                      runner.dismiss.mutate(undefined, { onSuccess: onClose })
                    }
                  >
                    Finish calibration
                  </Button>
                </>
              )}
            </div>
          )}
        {!owned && (draft.step === 0 ? reason : runReason) && (
          <Alert>
            <AlertDescription>
              {draft.step === 0 ? reason : runReason}
            </AlertDescription>
          </Alert>
        )}
      </FieldGroup>
    </AppDialog>
  )
}
