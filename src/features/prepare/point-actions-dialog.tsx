import { useId, useMemo, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Field,
  FieldLabel,
  FieldGroup,
  FieldDescription,
} from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import { ReasonButton } from "@/components/workspace/reason-button"
import { AppDialog } from "@/features/shell/app-dialog"
import { useWorkspace } from "@/app/workspace/workspace-context"
import { kitForSetup } from "@/domain/fixtures/catalog"
import { createPlate, createPlateSetup } from "@/domain/plate/plate"
import { createOperation } from "@/domain/operations/operation"
import { isProbe, probeProfile } from "@/domain/tools/tool"
import { useCachedConfiguration, useMachineSnapshot } from "@/platform/machine"
import {
  checkedProbeBinding,
  ProbeInputCheck,
} from "@/features/device/probe-input-check"
import {
  useCalibrationRun,
  useCalibrationRunRecord,
} from "@/features/device/use-calibration-run"
import { CalibrationRunPanel } from "@/features/device/calibration-run-panel"
import { zProbeRun } from "@/features/device/z-probe-run"
import { openZProbe } from "@/features/device/z-probe-dialog"
import { ProbeTipDiameterField } from "@/features/probing/probe-tip-diameter-field"
import { StopButton } from "@/features/job/stage-card"
import {
  measuredPointProbe,
  pointFrameIssue,
  pointMachineXY,
  pointMovePlan,
} from "./point-positioning"
import type { PointIntent } from "./point-intent"
import { PointProbeDraft } from "./point-probe-draft"

export function PointActionsDialog({
  intent,
  onClose,
}: {
  intent: PointIntent
  onClose: () => void
}) {
  const current = useCalibrationRunRecord()
  if (
    current?.guide === "point" &&
    current.point &&
    current.point.id !== intent.id
  )
    return (
      <PointPositioning
        key={current.point.id}
        intent={current.point}
        onClose={onClose}
      />
    )
  if (intent.action === "probe")
    return <PointProbeDraft intent={intent} onClose={onClose} />
  return <PointPositioning key={intent.id} intent={intent} onClose={onClose} />
}

function PointPositioning({
  intent,
  onClose,
}: {
  intent: PointIntent
  onClose: () => void
}) {
  const id = useId()
  const machine = useMachineSnapshot()
  const workspace = useWorkspace((state) => state)
  const plate = workspace.plates.find((entry) => entry.id === intent.plateId)
  const kit = kitForSetup(intent.setup)
  const configuration = useCachedConfiguration(machine.connection.id)
  const navigate = useNavigate()
  const previous = useCalibrationRunRecord()
  const [step, setStep] = useState(0)
  const [chosen, setChosen] = useState(() =>
    previous?.guide === "point" && previous.point?.id === intent.id
      ? (previous.session.tools[0]?.id ?? "")
      : ""
  )
  const [signal, setSignal] = useState("")
  const [measured, setMeasured] = useState(false)
  const [risk, setRisk] = useState(false)
  const [datum, setDatum] = useState<number | null>(null)
  const tools = workspace.tools.filter(isProbe).flatMap((tool) => {
    const profile = probeProfile(tool)
    const number = profile && kit.probing?.slot(profile)
    return number !== null &&
      number !== undefined &&
      kit.zProbing?.tools.includes(number)
      ? [{ tool, number }]
      : []
  })
  const selected =
    tools.find(({ tool }) => tool.id === chosen) ??
    (!chosen ? tools[0] : undefined)
  const number = selected?.number
  const tool = selected?.tool
  const binding = checkedProbeBinding(machine)
  const verified = !!binding && binding.id === signal && binding.tool === number
  const frameIssue = pointFrameIssue(intent, plate, machine)
  const plan = binding
    ? pointMovePlan(intent, machine, binding, configuration)
    : null
  const xy = pointMachineXY(intent)
  let reason = frameIssue
  if (!kit.probePositioning || !kit.zProbing)
    reason = "This machine has no protected probe positioning."
  else if (!tool)
    reason =
      "Select a probe from the tool library. Cutters cannot use this tool."
  else if (step === 1) {
    if (!measuredPointProbe(machine, number) || !measured)
      reason = "Confirm tool-setter measurement for the fitted probe first."
    else if (!risk)
      reason = "Confirm the physical setup and risks before moving."
    else if (
      intent.action === "z" &&
      (datum === null || datum !== machine.telemetry?.workOrigin?.z)
    )
      reason = "Confirm the real work Z datum matches this plate's model."
    else if (!verified)
      reason = "Verify the fitted probe's signal at this stationary position."
    else if (!plan)
      reason =
        "For Z, first position within 0.5 mm of the picked XY and ensure the work Z reference is reported."
  }
  const inputKey = JSON.stringify({
    step,
    tool,
    number,
    binding: verified ? binding : null,
    plan,
    ready: !reason,
  })
  const candidate = useMemo(() => {
    const input = JSON.parse(inputKey) as {
      step: number
      tool: typeof tool
      number: typeof number
      binding: typeof binding
      plan: typeof plan
      ready: boolean
    }
    if (!input.tool || input.number === undefined || !kit.zProbing) return null
    const setup = createPlateSetup({
      ...intent.setup,
      stock: null,
      stockSource: "unspecified",
    })
    if (input.step === 0)
      return zProbeRun(
        setup,
        kit,
        input.tool,
        input.number,
        { gap: 5, travel: 6, clearance: 5 },
        null,
        "setter"
      )
    if (!input.ready || !input.binding || !input.plan || !kit.probePositioning)
      return null
    const temporary = createPlate({
      ...setup,
      probeBeforeRun: false,
      workOriginAnchor: null,
      assists: {
        vacuum: "off",
        blow: "off",
        bedClean: "off",
        antiStatic: "off",
      },
    })
    temporary.name =
      input.plan.mode === "xy"
        ? "Probe positioning — retract then XY"
        : "Probe positioning — Z plus 5 mm"
    temporary.tools = [{ number: input.number, toolId: input.tool.id }]
    temporary.operations = [
      createOperation(
        temporary.name,
        {
          kind: "file",
          phase: "setup",
          park: false,
          nc: kit.probePositioning.boundedNc(input.binding, input.plan),
        },
        { tools: [{ local: input.number, plate: input.number }] }
      ),
    ]
    return temporary
  }, [inputKey, intent, kit])
  const runner = useCalibrationRun(candidate, tool?.id ?? null, "point", intent)
  const close = () => {
    onClose()
    if (runner.busy) void navigate({ to: "/job" })
  }
  return (
    <AppDialog
      title={
        intent.action === "xy" ? "Jog to picked X / Y" : "Jog above picked Z"
      }
      onClose={close}
      description="Reviewed, probe-only positioning. Opening this guide moves nothing."
      toolbar={
        runner.record ? (
          <StopButton
            action={{
              reason: null,
              pending: runner.stop.isPending,
              run: () => runner.stop.mutate(),
            }}
          />
        ) : undefined
      }
    >
      <FieldGroup>
        <p className="font-numeric">
          Picked model point: X {intent.position[0].toFixed(3)}, Y{" "}
          {intent.position[1].toFixed(3)}, Z {intent.position[2].toFixed(3)} mm.
        </p>
        {xy && (
          <FieldDescription className="font-numeric">
            Machine XY target: {xy[0].toFixed(3)}, {xy[1].toFixed(3)} mm.
          </FieldDescription>
        )}
        {frameIssue && (
          <Alert variant="warning">
            <AlertDescription>{frameIssue}</AlertDescription>
          </Alert>
        )}
        {!runner.record && step === 0 && (
          <>
            <Field>
              <FieldLabel htmlFor={`${id}-probe`}>Fitted probe</FieldLabel>
              <OptionSelect
                id={`${id}-probe`}
                value={tool?.id ?? ""}
                options={tools.map(({ tool: entry }) => ({
                  value: entry.id,
                  label: entry.name,
                }))}
                onValueChange={(value) => {
                  setChosen(value)
                  setMeasured(false)
                  setSignal("")
                }}
              />
            </Field>
            {tool && <ProbeTipDiameterField tool={tool} />}
            <p>
              Fit and cable the selected probe. A cutter cannot use these moves.
              Run tool-setter detection after fitting or remounting it, or
              confirm an existing measurement for the same probe that remains
              fitted.
            </p>
            <ReasonButton
              label="Run tool-setter detection"
              reason={!tool ? "Select a supported probe." : runner.reason}
              onClick={() => runner.run.mutate("setter")}
            >
              Run tool-setter detection
            </ReasonButton>
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-measured`}
                checked={measured}
                onCheckedChange={(checked) => setMeasured(checked === true)}
              />
              <FieldLabel htmlFor={`${id}-measured`}>
                I have run tool-setter detection for this fitted probe.
              </FieldLabel>
            </Field>
            <ReasonButton
              label="Continue"
              reason={
                !measured || !measuredPointProbe(machine, number)
                  ? "Confirm the same fitted, active probe has been measured."
                  : null
              }
              onClick={() => setStep(1)}
            >
              Continue
            </ReasonButton>
          </>
        )}
        {!runner.record && step === 1 && (
          <>
            <p>
              {intent.action === "xy"
                ? "First retract to the machine's upper clearance (or keep an already higher Z), then move X and Y separately at 100% of their configured maximum speeds. Z stays retracted afterwards."
                : "Keep X and Y fixed over the picked point. Move Z at 20% of its configured maximum to 5 mm above the modeled surface. This is positioning, not a surface measurement: contact stops and fails the run without setting Z0. The 5 mm clearance depends on the real work Z reference matching the model; tool-setter detection alone does not establish that reference."}
            </p>
            {intent.action === "z" && (
              <Button
                variant="outline"
                onClick={() => openZProbe(undefined, intent)}
              >
                Probe part Z here instead…
              </Button>
            )}
            {plan && (
              <FieldDescription className="font-numeric">
                Machine endpoint: X {plan.target[0].toFixed(3)}, Y{" "}
                {plan.target[1].toFixed(3)}, Z {plan.target[2].toFixed(3)} mm.
                Speeds X {plan.feed[0].toFixed(0)}, Y {plan.feed[1].toFixed(0)},
                Z {plan.feed[2].toFixed(0)} mm/min.
              </FieldDescription>
            )}
            {intent.action === "z" && (
              <Field orientation="horizontal">
                <Checkbox
                  id={`${id}-datum`}
                  checked={
                    datum !== null && datum === machine.telemetry?.workOrigin?.z
                  }
                  onCheckedChange={(checked) =>
                    setDatum(
                      checked === true
                        ? (machine.telemetry?.workOrigin?.z ?? null)
                        : null
                    )
                  }
                />
                <FieldLabel htmlFor={`${id}-datum`}>
                  The machine's work Z0 matches this plate's modeled work
                  origin.
                </FieldLabel>
              </Field>
            )}
            <Alert variant="warning">
              <AlertDescription>
                The probe input is monitored by the firmware throughout every
                move. Detected contact stops the move and fails the run before
                any following move. A disconnected or failed probe, incorrect
                model, offsets or stopping distance can still cause damage.
                Conductive rods need an electrical path to the contacted
                surface; they cannot detect insulating objects.
              </AlertDescription>
            </Alert>
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-risk`}
                checked={risk}
                onCheckedChange={(checked) => setRisk(checked === true)}
              />
              <FieldLabel htmlFor={`${id}-risk`}>
                I have checked the fitted probe, tool measurement, model
                registration, clear travel and closed enclosure. I understand
                and accept the risks and will supervise with the E-stop
                accessible.
              </FieldLabel>
            </Field>
            {tool && (
              <ProbeInputCheck
                tool={tool}
                toolNumber={number ?? null}
                onVerified={setSignal}
              />
            )}
            <ReasonButton
              label="Run reviewed move"
              reason={reason ?? runner.reason}
              onClick={() => runner.run.mutate("contacts")}
            >
              Run reviewed move
            </ReasonButton>
            <Button
              variant="outline"
              onClick={() => {
                setStep(0)
                setSignal("")
                setRisk(false)
              }}
            >
              Back
            </Button>
          </>
        )}
        {runner.record && (
          <CalibrationRunPanel
            runner={runner}
            contactTitle="Probe positioning"
            onMeasured={() => {
              setMeasured(true)
              setStep(1)
              setSignal("")
            }}
          />
        )}
        {runner.job?.phase === "completed" &&
          runner.record?.stage === "contacts" && (
            <p>
              Positioning finished without detected contact. Work zero is
              unchanged. Dismiss this run before another action.
            </p>
          )}
      </FieldGroup>
    </AppDialog>
  )
}
