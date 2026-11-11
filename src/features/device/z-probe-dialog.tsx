import { useEffect, useId, useMemo, useState } from "react"
import { createAtom, useSelector } from "@tanstack/react-store"
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import { ReasonButton } from "@/components/workspace/reason-button"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { useFixtureLibrary } from "@/app/fixtures/fixture-context"
import { projectPlacement } from "@/app/fixtures/plate-profile"
import { kitForSetup } from "@/domain/fixtures/catalog"
import { createPlateSetup } from "@/domain/plate/plate"
import { compilePlate } from "@/domain/compile/compile"
import { isProbe, probeProfile } from "@/domain/tools/tool"
import {
  isFresh,
  isHeightCompensationOff,
  machineId,
  ZProbeSettingsSchema,
} from "@/machine/contract"
import type { ZProbeSettings } from "@/machine/contract"
import {
  useCachedConfiguration,
  useMachineHost,
  useMachineSnapshot,
} from "@/platform/machine"
import { AppDialog } from "@/features/shell/app-dialog"
import { openDialog } from "@/features/shell/dialogs"
import { useRunJob } from "@/features/job/job-hooks"
import { zJobSignature, zJobIssue } from "@/features/job/z-probe-job"
import type { ZProbeJob } from "@/features/job/z-probe-job"
import { ParameterField, probingField } from "@/features/probing/probing-fields"
import { useProbingForm } from "@/features/probing/probing-form"
import { StopButton } from "@/features/job/stage-card"
import { checkedProbeBinding, ProbeInputCheck } from "./probe-input-check"
import { useCalibrationRun } from "./use-calibration-run"
import { CalibrationRunPanel } from "./calibration-run-panel"
import { zProbeRun } from "./z-probe-run"
import { ProbeSafetyNotice } from "@/features/probing/probe-safety-notice"
import { ProbeTipDiameterField } from "@/features/probing/probe-tip-diameter-field"
import type { PointIntent } from "@/features/prepare/point-intent"
import {
  pointFrameIssue,
  pointMachineXY,
  pointZProbePlan,
} from "@/features/prepare/point-positioning"

type Draft = {
  step: number
  toolId: string
  signalId: string
  signalTool: string
  settings: ZProbeSettings | null
  job?: ZProbeJob
  point?: PointIntent
  risk: boolean
}
const draftAtom = createAtom<Draft>({
  step: 0,
  toolId: "",
  signalId: "",
  signalTool: "",
  settings: null,
  risk: false,
})
const update = (patch: Partial<Draft>) =>
  draftAtom.set((value) => ({ ...value, ...patch }))

function probeLabel(profile: ReturnType<typeof probeProfile>) {
  if (profile?.touch === "z") return "Z probe"
  if (profile?.contact === "conductive") return "Conductive 3D rod"
  return "3D touch probe"
}

/** Entry points preserve an active temporary run but start a new intent explicitly. */
export function openZProbe(job?: ZProbeJob, point?: PointIntent) {
  update({ step: 0, signalId: "", signalTool: "", job, point, risk: false })
  openDialog({ kind: "z-probe" })
}

export function ZProbeDialog({
  onClose,
  job,
}: {
  onClose: () => void
  job?: ZProbeJob
}) {
  const id = useId()
  const draft = useSelector(draftAtom)
  useEffect(() => {
    if (job)
      update({
        job,
        point: undefined,
        step: 0,
        signalId: "",
        signalTool: "",
        risk: false,
      })
  }, [job])
  const workspace = useWorkspace((value) => value)
  const workspaceStore = useWorkspaceStore()
  const fixtures = useFixtureLibrary((value) => value)
  const placement = draft.point?.setup ?? projectPlacement(workspace, fixtures)
  const kit = kitForSetup(placement)
  const maxSearch = kit.workArea[2]
  const settings = draft.settings ?? { travel: maxSearch, clearance: 5 }
  const machine = useMachineSnapshot()
  const configuration = useCachedConfiguration(machine.connection.id)
  const host = useMachineHost()
  const navigate = useNavigate()
  const cutting = useRunJob()
  const [valid, setValid] = useState(true)
  const form = useProbingForm(
    settings,
    ZProbeSettingsSchema,
    (nextSettings) => update({ settings: nextSettings, risk: false }),
    setValid
  )
  const tools = workspace.tools.filter(isProbe).flatMap((tool) => {
    const profile = probeProfile(tool)
    const number = profile && kit.probing?.slot(profile)
    return number !== null &&
      number !== undefined &&
      kit.zProbing?.tools.includes(number)
      ? [{ tool, profile, number }]
      : []
  })
  const selected =
    tools.find(({ tool }) => tool.id === draft.toolId) ??
    (!draft.toolId ? tools[0] : undefined)
  const tool = selected?.tool
  const number = selected?.number
  const binding = checkedProbeBinding(machine)
  const verified =
    !!binding &&
    binding.tool === number &&
    binding.id === draft.signalId &&
    tool?.id === draft.signalTool
  const stage: "setter" | "contacts" = draft.step === 0 ? "setter" : "contacts"
  const pointPlan =
    draft.point && pointZProbePlan(draft.point, configuration, settings)
  const input =
    tool &&
    number !== undefined &&
    (stage === "setter" || (verified && (!draft.point || pointPlan)))
      ? {
          setup: createPlateSetup({
            ...placement,
            stock: null,
            stockSource: "unspecified",
          }),
          tool,
          number,
          settings,
          binding,
          stage,
          pointPlan: stage === "contacts" ? pointPlan : undefined,
        }
      : null
  const inputKey = JSON.stringify(input)
  const candidate = useMemo(() => {
    const held = JSON.parse(inputKey) as typeof input
    if (!held) return null
    return zProbeRun(
      held.setup,
      kit,
      held.tool,
      held.number,
      held.settings,
      held.binding,
      held.stage,
      held.pointPlan ?? undefined
    )
  }, [inputKey, kit])
  const intentKey = JSON.stringify({ job: draft.job, point: draft.point })
  const runner = useCalibrationRun(
    candidate,
    tool?.id ?? null,
    "z",
    undefined,
    intentKey
  )
  const owned = runner.record
  const status = machine.telemetry
  const measured =
    number !== undefined &&
    isFresh(status, Date.now()) &&
    status.state === "Idle" &&
    status.tool === number &&
    status.toolOffset !== null &&
    status.spindleRpm === 0 &&
    status.spindleOn !== true &&
    isHeightCompensationOff(status)
  let reason: string | null = null
  if (!kit.zProbing) reason = "This machine has no bounded Z probe routine."
  else if (
    !machine.connection.device ||
    machine.connection.status !== "connected" ||
    machineId(machine.connection.device) !== placement.deviceId
  )
    reason = "Connect the project's machine first."
  else if (!tool)
    reason = "Add a Z or XYZ probe to the tool library, then select it here."
  const pickedXY = draft.point && pointMachineXY(draft.point)
  if (!reason && draft.point) {
    reason = pointFrameIssue(
      draft.point,
      workspace.plates.find((plate) => plate.id === draft.point!.plateId),
      machine
    )
    if (!reason && draft.step === 1 && !owned && !pointPlan)
      reason =
        "Read the device configuration and anchors to prepare the automatic route."
  }
  if (!reason && draft.job) {
    const target = workspace.plates.find(
      (plate) => plate.id === draft.job!.plateId
    )
    if (!target || machine.connection.id !== draft.job.connectionId)
      reason =
        "The job or device connection changed. Close this guide and press Run again."
    else {
      const compiled = compilePlate(target, workspace.tools)
      if (
        zJobSignature(target, compiled, workspace.tools) !== draft.job.signature
      )
        reason =
          "The cutting job changed. Close this guide and press Run again."
      else reason = zJobIssue(compiled, kit.zProbing?.tools ?? [])
    }
  }
  const completed =
    owned?.stage === "contacts" &&
    runner.job?.phase === "completed" &&
    !owned.error &&
    !owned.cancelled
  const finish = useMutation({
    mutationFn: async () => {
      if (!completed || !tool || reason || owned.intentKey !== intentKey)
        throw new Error(reason ?? "Complete a verified Z probe run first.")
      const fresh = await host.snapshot()
      const currentWorkspace = workspaceStore.state
      const t = fresh.telemetry
      const contacts = fresh.job?.measurements.find(
        (value) => value.kind === "contacts"
      )
      if (
        fresh.connection.id !== owned.connectionId ||
        fresh.job?.id !== owned.session.runId ||
        fresh.job.phase !== "completed" ||
        contacts?.kind !== "contacts" ||
        contacts.contacts.length !== 2 ||
        !isFresh(t, Date.now()) ||
        t.state !== "Idle" ||
        t.job !== null ||
        t.tool !== number ||
        t.toolOffset === null ||
        !t.workOrigin ||
        !t.work ||
        t.spindleRpm !== 0 ||
        t.spindleOn === true ||
        !isHeightCompensationOff(t) ||
        Math.abs(t.work.z - settings.clearance) > 0.01
      )
        throw new Error(
          "The completed contacts, measured probe and final Z clearance could not be verified. Nothing else was started."
        )
      if (
        draft.point &&
        (!pickedXY ||
          !t.machine ||
          Math.hypot(t.machine.x - pickedXY[0], t.machine.y - pickedXY[1]) >
            0.003)
      )
        throw new Error(
          "The completed Z contacts are not at the picked XY. Nothing else was started."
        )
      if (
        JSON.stringify(
          owned.session.tools.find((entry) => entry.id === tool.id)
        ) !==
        JSON.stringify(
          currentWorkspace.tools.find((entry) => entry.id === tool.id)
        )
      )
        throw new Error(
          "The probe library entry changed during this run. Repeat setup with the fitted probe."
        )
      const receipt = {
        connectionId: owned.connectionId,
        signature: draft.job?.signature ?? "",
        tool: t.tool,
        offset: t.toolOffset,
        originZ: t.workOrigin.z,
        at: Date.now(),
      }
      const intent = draft.job
      const target =
        intent &&
        currentWorkspace.plates.find((plate) => plate.id === intent.plateId)
      const compiled = target && compilePlate(target, currentWorkspace.tools)
      if (
        intent &&
        (!target ||
          !compiled ||
          zJobSignature(target, compiled, currentWorkspace.tools) !==
            intent.signature)
      )
        throw new Error(
          "The cutting job changed. Press Run again to review it."
        )
      await runner.dismiss.mutateAsync()
      update({ step: 0, signalId: "", job: undefined })
      onClose()
      if (target && compiled) {
        await navigate({ to: "/job" })
        await cutting.start(
          target,
          compiled,
          currentWorkspace.tools,
          null,
          receipt
        )
      } else toast.success("Part surface is now work Z0.")
    },
    onError: (error) => toast.error(error.message),
  })
  const close = () => {
    onClose()
    if (runner.busy) void navigate({ to: "/job" })
  }
  return (
    <AppDialog
      title="Z probe routines"
      description={
        draft.job
          ? "Probe part Z before cutting. The cutting job waits for your explicit continuation."
          : "Set the part's top surface as work Z0 using a measured Z or XYZ probe."
      }
      onClose={close}
      toolbar={
        owned ? (
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
        <FieldDescription>
          {draft.step === 0
            ? "1 · Fit and measure the probe"
            : "2 · Verify signal and probe Z"}
        </FieldDescription>
        {reason && (
          <Alert variant="warning">
            <AlertDescription>{reason}</AlertDescription>
          </Alert>
        )}
        {!owned && draft.step === 0 && (
          <>
            <Field>
              <FieldLabel htmlFor={`${id}-tool`}>Fitted probe</FieldLabel>
              <OptionSelect
                id={`${id}-tool`}
                value={tool?.id ?? ""}
                options={tools.map(({ tool: entry, profile }) => ({
                  value: entry.id,
                  label: `${entry.name} · ${probeLabel(profile)}`,
                }))}
                onValueChange={(toolId) =>
                  update({ toolId, signalId: "", signalTool: "", risk: false })
                }
              />
            </Field>
            {tool && <ProbeTipDiameterField tool={tool} />}
            <p>
              Fit the selected probe securely and connect its signal cable.
              Disconnect other probes that share that input. Run tool-setter
              detection if newly fitted; the machine will prompt you to install
              it and measure its length.
            </p>
            <Button
              variant="outline"
              onClick={() =>
                openDialog({ kind: "tools", back: { kind: "z-probe" } })
              }
            >
              Open tool library
            </Button>
            <ReasonButton
              label="Run tool-setter detection"
              reason={reason ?? runner.reason}
              onClick={() => runner.run.mutate("setter")}
            >
              Run tool-setter detection
            </ReasonButton>
            <ReasonButton
              label="Use existing measurement"
              reason={
                reason ??
                (!measured
                  ? "The selected fitted probe must be active and measured."
                  : null)
              }
              onClick={() => update({ step: 1 })}
            >
              Use existing measurement
            </ReasonButton>
          </>
        )}
        {!owned && draft.step === 1 && (
          <>
            <ProbeSafetyNotice automatic={!!draft.point} />
            {draft.point && pickedXY && (
              <FieldDescription className="font-numeric">
                Automatic target: machine X {pickedXY[0].toFixed(3)}, Y{" "}
                {pickedXY[1].toFixed(3)} mm. Model Z is not used; the contacts
                determine the surface height.
              </FieldDescription>
            )}
            <p>
              {draft.point
                ? "Verify the signal at the current stationary position. Run first raises the probe to machine clearance, moves X then Y to the picked point at full positioning speed, then probes down from that raised height. Check the entire route and choose a solid surface clear of holes, edges and clamps."
                : "Position over a solid, clear point on the part. You can start from any height above it; there is no required 5 mm gap. This routine moves only Z. Keep away from holes, edges and clamps."}{" "}
              The touched surface becomes work Z0.
            </p>
            {selected?.profile?.contact === "conductive" && (
              <Alert>
                <AlertDescription>
                  The rod needs a conductive surface connected to the machine
                  table. It cannot probe bare MDF, plastic or another insulating
                  material directly. Use a mechanical or wired Z probe for those
                  materials.
                </AlertDescription>
              </Alert>
            )}
            {(
              [
                [
                  "travel",
                  "Maximum downward search",
                  0.4,
                  maxSearch,
                  maxSearch,
                ],
                ["clearance", "Lift above measured surface", 0.5, 10, 5],
              ] as const
            ).map(([name, label, min, max, initial]) => (
              <ParameterField
                key={name}
                id={`${id}-${name}`}
                parameter={{
                  label,
                  description: label,
                  unit: "mm",
                  min,
                  max,
                  step: 0.1,
                  default: initial,
                }}
                disabled={false}
                field={probingField(form, name)}
              />
            ))}
            <FieldDescription>
              The search limit defaults to the machine's full Z work height. The
              downward search stops on contact or at the chosen maximum,
              shortened to stay above the machine's reported lower Z limit. No
              contact means failure without setting Z0. From a high start, the
              slow search can take several minutes. No tool change occurs.
            </FieldDescription>
            {draft.point && (
              <Field orientation="horizontal">
                <Checkbox
                  id={`${id}-risk`}
                  checked={draft.risk}
                  onCheckedChange={(checked) =>
                    update({ risk: checked === true })
                  }
                />
                <FieldLabel htmlFor={`${id}-risk`}>
                  I confirm the probe is fitted and measured, the enclosure is
                  closed, the complete raised route and target are clear, and I
                  accept the risks of automatic positioning and probing.
                </FieldLabel>
              </Field>
            )}
            <Button
              variant="outline"
              onClick={() => void navigate({ to: "/device" })}
            >
              Show positioning controls
            </Button>
            {tool && (
              <ProbeInputCheck
                tool={tool}
                toolNumber={number ?? null}
                onVerified={(signalId) =>
                  update({ signalId, signalTool: tool.id })
                }
              />
            )}
            <ReasonButton
              label={draft.point ? "Move to point and probe Z" : "Probe part Z"}
              reason={
                reason ??
                (!valid ? "Correct the search settings." : null) ??
                (settings.travel > maxSearch
                  ? "Maximum search cannot exceed the machine's Z work height."
                  : null) ??
                (draft.point && !draft.risk
                  ? "Confirm the automatic route and setup first."
                  : null) ??
                (!verified
                  ? "Position and verify the probe signal first."
                  : null) ??
                runner.reason
              }
              onClick={() => runner.run.mutate("contacts")}
            >
              {draft.point ? "Move to point and probe Z" : "Probe part Z"}
            </ReasonButton>
            <Button
              variant="outline"
              onClick={() => update({ step: 0, signalId: "", risk: false })}
            >
              Back
            </Button>
          </>
        )}
        {owned && (
          <CalibrationRunPanel
            runner={runner}
            contactTitle="Probe part Z"
            positioningLabel={
              draft.point ? "Continue to route review" : "Continue to Z probing"
            }
            onMeasured={() => update({ step: 1, signalId: "" })}
          />
        )}
        {completed && (
          <>
            <p>
              The surface has been set as work Z0. Leave the measured probe
              fitted until the cutting job prompts you to fit its cutter; that
              tool change measures the cutter against this reference.
            </p>
            <ReasonButton
              label={draft.job ? "Continue to cutting" : "Finish Z probing"}
              reason={reason}
              disabled={finish.isPending}
              onClick={() => finish.mutate()}
            >
              {draft.job ? "Continue to cutting" : "Finish Z probing"}
            </ReasonButton>
          </>
        )}
      </FieldGroup>
    </AppDialog>
  )
}
