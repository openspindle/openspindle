import { useId, useState } from "react"
import { createAtom, useSelector } from "@tanstack/react-store"
import { useNavigate } from "@tanstack/react-router"
import { useMutation } from "@tanstack/react-query"
import { z } from "zod"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ReasonButton } from "@/components/workspace/reason-button"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { OptionSelect } from "@/components/option-select"
import { HeightMapFacts } from "@/components/workspace/height-map-grid"
import { useFixtureLibraryStore } from "@/app/fixtures/fixture-context"
import { projectPlacement } from "@/app/fixtures/plate-profile"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { kitForSetup } from "@/domain/fixtures/catalog"
import { createPlate, createPlateSetup } from "@/domain/plate/plate"
import { newProbingOperation, strategyById } from "@/domain/probing/strategies"
import {
  BoundedDiameterSchema,
  diameterAverage,
  parseDiameterLog,
  ProbeCalibrationSettingsSchema,
} from "@/domain/probing/probe-calibration"
import type { DiameterReading } from "@/domain/probing/probe-calibration"
import { ToolSchema, probeProfile } from "@/domain/tools/tool"
import {
  DEFAULT_PROBE_TIP_DIAMETER,
  withProbeTipDiameter,
} from "@/domain/tools/probe-diameter"
import { toMicrometre } from "@/domain/primitives"
import { machineId } from "@/machine/contract"
import { useHost } from "@/platform/host-context"
import { useMachineSnapshot } from "@/platform/machine"
import { useJobSession } from "@/features/job/job-session"
import { deriveJobView } from "@/features/job/job-view"
import { inspectionReport } from "@/features/job/inspection-report"
import { strategyProbes } from "@/features/probing/probe-tools"
import { ParameterField, probingField } from "@/features/probing/probing-fields"
import { useProbingForm } from "@/features/probing/probing-form"
import { AppDialog } from "@/features/shell/app-dialog"
import { CalibrationIllustration } from "./calibration-illustration"
import { checkedProbeBinding, ProbeInputCheck } from "./probe-input-check"
import { ProbeSafetyNotice } from "@/features/probing/probe-safety-notice"

type ReadingSource = {
  kind: "manual" | "physical" | "simulator"
  jobId?: string
  deviceId?: string
  toolId: string
}
type Draft = {
  step: number
  toolId: string
  signalBindingId?: string
  signalToolId?: string
  settings: {
    width: number
    distance: number
    depth: number
    diameter: number
    gap: number
    maxLeft: number
    maxRight: number
    maxDown: number
  }
  logs: string[]
  sources: (ReadingSource | null)[]
  originalTool: string | null
  trialToolId: string | null
  pending: {
    operationId: string
    plateId: string
    reading: number
    deviceId: string
    toolId: string
    diameter: number
    plan: string
  } | null
}
const SettingsSchema = ProbeCalibrationSettingsSchema.safeExtend({
  gap: z.number().finite().min(0.1).max(5),
  maxLeft: z.number().finite().min(0.4).max(10),
  maxRight: z.number().finite().min(0.4).max(10),
  maxDown: z.number().finite().min(0.4).max(10),
})
const empty = (): Draft => ({
  step: 0,
  toolId: "",
  settings: {
    width: 15,
    distance: 10,
    depth: 2.5,
    diameter: DEFAULT_PROBE_TIP_DIAMETER,
    gap: 5,
    maxLeft: 2.5,
    maxRight: 2.5,
    maxDown: 6,
  },
  logs: ["", "", ""],
  sources: [null, null, null],
  originalTool: null,
  trialToolId: null,
  pending: null,
})
// Closing the guide to run a reading keeps this draft. Raw readings can be exported before exit.
const draftAtom = createAtom<Draft>(empty())
export const useDiameterCalibrationPlate = () =>
  useSelector(draftAtom, (draft) => draft.pending?.plateId ?? null)
const update = (patch: Partial<Draft>) =>
  draftAtom.set((draft) => ({ ...draft, ...patch }))
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)
const mm = (value: number) => `${value.toFixed(4)} mm`

function parseReadings(logs: string[], width: number) {
  return logs.map(
    (log): { result: DiameterReading | null; error: string | null } => {
      if (!log.trim()) return { result: null, error: null }
      try {
        return { result: parseDiameterLog(log, width), error: null }
      } catch (error) {
        return { result: null, error: message(error) }
      }
    }
  )
}

export function ProbeDiameterCalibrationDialog({
  onClose,
}: {
  onClose: () => void
}) {
  const id = useId()
  const draft = useSelector(draftAtom)
  const workspace = useWorkspaceStore()
  const fixtures = useFixtureLibraryStore()
  const library = useWorkspace((state) => state.tools)
  const machine = useMachineSnapshot()
  const session = useJobSession()
  const host = useHost()
  const navigate = useNavigate()
  const [confirmedSetup, setConfirmedSetup] = useState<string | null>(null)
  const [valid, setValid] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const placement = projectPlacement(workspace.state, fixtures.state)
  const kit = kitForSetup(placement)
  const strategy = strategyById("boss-center")!
  const probes = kit.probing
    ? strategyProbes(strategy, library, kit.probing).filter(
        (entry) => entry.tool.id !== draft.trialToolId
      )
    : []
  const tool =
    probes.find((entry) => entry.tool.id === draft.toolId)?.tool ??
    (!draft.toolId ? probes[0]?.tool : undefined)
  const readings = parseReadings(draft.logs, draft.settings.width)
  const hasReadings = draft.logs.some((log) => log.trim())
  let summary: ReturnType<typeof diameterAverage> | null = null
  let summaryError: string | null = null
  if (readings.every((reading) => reading.result)) {
    try {
      summary = diameterAverage(readings.map((reading) => reading.result!))
    } catch (problem) {
      summaryError = message(problem)
    }
  }
  const form = useProbingForm(
    draft.settings,
    SettingsSchema,
    (settings) => update({ settings }),
    setValid
  )
  const nextIndex = readings.findIndex((reading) => reading.result === null)
  const nextDiameter =
    nextIndex > 0
      ? toMicrometre(readings[nextIndex - 1].result!.diameter)
      : draft.settings.diameter
  const setupKey = JSON.stringify({
    step: draft.step,
    tool,
    settings: draft.settings,
    logs: draft.logs,
    sources: draft.sources,
    deviceId: placement.deviceId,
    connectionId: machine.connection.id,
    proof: machine.probeCheck,
  })
  const confirmed = confirmedSetup === setupKey
  const setConfirmed = (value: boolean) =>
    setConfirmedSetup(value ? setupKey : null)
  const binding = checkedProbeBinding(machine)
  const profile = tool && probeProfile(tool)
  const probeNumber = profile && kit.probing?.slot(profile)
  const device = machine.connection.device
  let preparationIssue: string | null = null
  if (!kit.diameterCalibration)
    preparationIssue =
      "This machine has no supported bounded diameter calibration."
  else if (
    !device ||
    machine.connection.status !== "connected" ||
    machineId(device) !== placement.deviceId
  )
    preparationIssue =
      "Connect the project's device before preparing a reading."
  else if (machine.connection.restartNeeded)
    preparationIssue = "Reset the device to apply pending settings first."
  else if (!machine.availability.run.allowed)
    preparationIssue =
      machine.availability.run.reason ??
      "The device is not ready for a new job."
  const plan =
    binding && device
      ? BoundedDiameterSchema.safeParse({
          binding,
          deviceId: machineId(device),
          gap: draft.settings.gap,
          width: draft.settings.width,
          distance: draft.settings.distance,
          depth: draft.settings.depth,
          diameter: nextDiameter,
          maxTravel: [
            draft.settings.maxLeft,
            draft.settings.maxRight,
            draft.settings.maxDown,
          ],
        })
      : null
  let runIssue = preparationIssue
  if (
    !runIssue &&
    (!binding ||
      draft.signalBindingId !== binding.id ||
      draft.signalToolId !== tool?.id)
  )
    runIssue =
      "Position the probe, touch once and remove contact; wait for Probe signal verified."
  if (!runIssue && binding?.tool !== probeNumber)
    runIssue = "The checked active probe must match this library probe."
  if (!runIssue && (!plan || !plan.success))
    runIssue =
      plan?.error.issues[0]?.message ??
      "Check the reference and bounded travel settings."
  const report = inspectionReport(deriveJobView(session, machine))
  const selectTool = (toolId: string) => {
    update({
      toolId,
      originalTool: null,
      logs: ["", "", ""],
      sources: [null, null, null],
      pending: null,
    })
    setConfirmed(false)
    setError(null)
  }
  const attempt = (action: () => void) => {
    try {
      action()
      setError(null)
    } catch (problem) {
      setError(message(problem))
    }
  }
  const prepare = () =>
    attempt(() => {
      if (runIssue) throw new Error(runIssue)
      if (!plan?.success) throw new Error("Check the bounded reading settings.")
      if (!tool || !kit.probing || !valid || nextIndex < 0 || !confirmed)
        throw new Error(
          "Choose a probe, check the settings and confirm the physical setup."
        )
      const checked = ProbeCalibrationSettingsSchema.safeParse({
        ...draft.settings,
        diameter: nextDiameter,
      })
      if (!checked.success) throw new Error(checked.error.issues[0].message)
      if (
        !device ||
        machine.connection.status !== "connected" ||
        machineId(device) !== placement.deviceId
      )
        throw new Error(
          "Connect the project's device before preparing a reading."
        )
      if (!machine.availability.run.allowed)
        throw new Error(
          machine.availability.run.reason ??
            "The machine is not ready for a new job."
        )
      if (machine.connection.restartNeeded)
        throw new Error("Reset the machine to apply pending settings first.")
      if (
        draft.sources.some(
          (source) => source?.deviceId && source.deviceId !== machineId(device)
        )
      )
        throw new Error(
          "Readings from different devices cannot be combined. Start a new calibration."
        )
      if (draft.originalTool && JSON.stringify(tool) !== draft.originalTool)
        throw new Error(
          "The original probe entry changed. Start a new calibration."
        )
      const trialId = draft.trialToolId ?? crypto.randomUUID()
      const trial = {
        ...withProbeTipDiameter(tool, nextDiameter),
        id: trialId,
        name: `${tool.name} — calibration readings`,
      }
      const plate = {
        ...createPlate(
          createPlateSetup({
            stock: null,
            stockSource: "assigned",
            ...placement,
          })
        ),
        name: `Probe diameter — reading ${nextIndex + 1}`,
      }
      const added = newProbingOperation(plate, trial, strategy, kit.probing)
      const source = added.operation.source
      if (source.kind !== "probing" || source.task !== "origin")
        throw new Error("No origin probing method is available.")
      const operation = {
        ...added.operation,
        name: `Known-width Boss-X — reading ${nextIndex + 1}`,
        source: {
          ...source,
          params: {
            ...source.params,
            axes: "x" as const,
            distance: [draft.settings.distance, draft.settings.distance] as [
              number,
              number,
            ],
            depth: draft.settings.depth,
            placement: { kind: "probe-position" as const },
          },
          diameterCalibration: structuredClone(plan.data),
        },
      }
      const others = workspace.state.tools.filter(
        (entry) => entry.id !== trialId
      )
      const result = workspace.dispatch({
        type: "batch",
        commands: [
          { type: "library.tools", tools: [...others, trial] },
          { type: "plates.add", plates: [plate], select: true },
          {
            type: "operation.add",
            plateId: plate.id,
            operation,
            preferredTools: added.preferredTools,
          },
        ],
      })
      if (!result.ok) throw new Error(result.error)
      update({
        toolId: tool.id,
        originalTool: draft.originalTool ?? JSON.stringify(tool),
        trialToolId: trialId,
        pending: {
          operationId: operation.id,
          plateId: plate.id,
          reading: nextIndex,
          deviceId: machineId(device),
          toolId: trialId,
          diameter: nextDiameter,
          plan: JSON.stringify(plan.data),
        },
      })
      onClose()
      void navigate({ to: "/job" })
      toast.success(
        `Reading ${nextIndex + 1} prepared. On Job, dismiss any previous completed result, then Run this reading and reopen the guide before Dismiss.`
      )
    })
  const prepareMeasurement = () =>
    attempt(() => {
      if (preparationIssue) throw new Error(preparationIssue)
      if (!tool || !kit.probing || !kit.diameterCalibration)
        throw new Error("Choose the fitted probe.")
      const plate = {
        ...createPlate(
          createPlateSetup({
            stock: null,
            stockSource: "assigned",
            ...placement,
          })
        ),
        name: "Probe diameter — tool-setter detection",
      }
      const added = newProbingOperation(plate, tool, strategy, kit.probing)
      const operation = {
        ...added.operation,
        name: plate.name,
        source: {
          kind: "file" as const,
          nc: kit.diameterCalibration.measurementNc(),
          park: false,
          phase: "setup" as const,
        },
      }
      const result = workspace.dispatch({
        type: "batch",
        commands: [
          { type: "plates.add", plates: [plate], select: true },
          {
            type: "operation.add",
            plateId: plate.id,
            operation,
            preferredTools: added.preferredTools,
          },
        ],
      })
      if (!result.ok) throw new Error(result.error)
      onClose()
      void navigate({ to: "/job" })
      toast.success(
        "Tool-setter detection prepared. Run it on Job, dismiss its completed result, then position manually above the reference and reopen this guide."
      )
    })
  const collect = () =>
    attempt(() => {
      const pending = draft.pending
      if (!tool)
        throw new Error(
          "The selected physical probe is no longer in the library."
        )
      if (
        !pending ||
        !report ||
        report.jobPhase !== "completed" ||
        report.plateId !== pending.plateId ||
        report.device?.id !== pending.deviceId ||
        session?.runId !== report.jobId
      )
        throw new Error(
          "Complete the reading prepared by this guide, then collect it before Dismiss."
        )
      if (draft.sources.some((source) => source?.jobId === report.jobId))
        throw new Error(
          "This run was already collected. Run a separate reading."
        )
      const frozenSource = session.plate.operations.find(
        (item) => item.id === pending.operationId
      )?.source
      if (
        frozenSource?.kind !== "probing" ||
        frozenSource.task !== "origin" ||
        JSON.stringify(frozenSource.diameterCalibration) !== pending.plan
      )
        throw new Error(
          "The completed reading's checked start, reference or search plan differs from this guide's prepared reading."
        )
      const feature = report.features.find(
        (item) => item.operationId === pending.operationId
      )
      if (
        feature?.status !== "complete" ||
        feature.routine !== "boss-center" ||
        feature.params.axes !== "x" ||
        feature.params.distance[0] !== draft.settings.distance ||
        feature.params.depth !== draft.settings.depth ||
        feature.params.placement.kind !== "probe-position" ||
        feature.probe?.id !== pending.toolId ||
        feature.probe.ballDiameter !== pending.diameter
      )
        throw new Error(
          "The run's probe, routine or diameter does not match the prepared reading."
        )
      const measurement = machine.job?.measurements.filter(
        (item) => item.kind === "contacts"
      )
      if (!measurement || measurement.length !== 1)
        throw new Error(
          "The run must contain exactly one unambiguous contact measurement."
        )
      const log = `M480.10 D${pending.diameter} X${draft.settings.distance} Y0 Z${draft.settings.depth}\n${measurement[0].contacts.map((point) => `[PRB:${point.join(",")}:1]`).join("\n")}`
      parseDiameterLog(log, draft.settings.width)
      const logs = [...draft.logs],
        sources = [...draft.sources]
      logs[pending.reading] = log
      sources[pending.reading] = {
        kind: report.device.source,
        jobId: report.jobId,
        deviceId: report.device.id,
        toolId: tool.id,
      }
      update({ logs, sources, pending: null })
      setConfirmed(false)
    })
  const save = () =>
    attempt(() => {
      if (!tool || !summary || !confirmed)
        throw new Error(
          "Collect three valid readings and confirm the physical probe before saving."
        )
      if (draft.sources.some((source) => source?.kind === "simulator"))
        throw new Error(
          "Simulated measurements are practice only and cannot calibrate a physical probe."
        )
      const live = workspace.state.tools.find((entry) => entry.id === tool.id)
      if (
        !live ||
        (draft.originalTool && JSON.stringify(live) !== draft.originalTool)
      )
        throw new Error(
          "The original probe entry changed. Start a new calibration."
        )
      const note = `Effective X diameter ${summary.diameter.toFixed(3)} mm from three known-width Boss-X readings (${draft.settings.width.toFixed(3)} mm reference, range ${summary.range.toFixed(4)} mm), ${new Date().toISOString()}. GabrielMaker mean-of-two-contacts method. Scalar X-derived compensation also used for Y; Y accuracy unverified. Keep the same stylus and mounting orientation.`
      const calibrated = ToolSchema.parse({
        ...withProbeTipDiameter(live, summary.diameter),
        notes: [live.notes, note].filter(Boolean).join("\n"),
      })
      const result = workspace.dispatch({
        type: "library.tools",
        tools: workspace.state.tools.map((entry) =>
          entry.id === live.id ? calibrated : entry
        ),
      })
      if (!result.ok) throw new Error(result.error)
      update({ originalTool: JSON.stringify(calibrated) })
      toast.success(
        `Saved ${summary.diameter.toFixed(3)} mm to ${live.name}. Future probing operations reuse this library diameter.`
      )
    })
  const exportReport = useMutation({
    mutationFn: () =>
      host.files.save({
        kind: "inspectionJson",
        suggestedName: "probe-diameter-calibration.json",
        contents: JSON.stringify(
          {
            version: 1,
            method:
              "GabrielMaker known-width Boss-X, average both touches per side",
            settings: draft.settings,
            toolId: tool?.id,
            readings: readings.map((reading, index) => ({
              ...reading,
              source: draft.sources[index],
              rawLog: draft.logs[index],
            })),
            summary,
            limitations: [
              "Effective X diameter; Y response not measured",
              "Manual logs have operator-supplied provenance",
              "Mounting orientation and stylus must remain consistent",
            ],
          },
          null,
          2
        ),
      }),
    onError: (problem) => toast.error(message(problem)),
  })
  const steps = [
    "Reference",
    "Probe and travel",
    "Three readings",
    "Save diameter",
  ]
  const changeStep = (step: number) => {
    update({ step })
    setConfirmed(false)
    setError(null)
  }
  return (
    <AppDialog
      title="3D probe diameter calibration"
      width="wide"
      onClose={onClose}
      description="Known-width calibration with a measured probe, manually positioned start, live signal check and bounded contacts. Preparation moves nothing."
      footer={
        <div className="flex w-full flex-wrap justify-between gap-2">
          <Button
            variant="outline"
            disabled={draft.step === 0}
            onClick={() => changeStep(draft.step - 1)}
          >
            Back
          </Button>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                const clean = empty()
                draftAtom.set(() => clean)
                form.reset(clean.settings)
                setValid(true)
                setConfirmed(false)
                setError(null)
              }}
            >
              Start over
            </Button>
            {draft.step < 3 && (
              <Button
                disabled={!valid}
                onClick={() => changeStep(draft.step + 1)}
              >
                Next
              </Button>
            )}
          </div>
        </div>
      }
    >
      <FieldGroup>
        {preparationIssue && (
          <Alert variant="destructive">
            <AlertDescription>{preparationIssue}</AlertDescription>
          </Alert>
        )}
        <FieldDescription>
          Step {draft.step + 1} of 4 · {steps[draft.step]}. Draft readings stay
          while this app is open; export the report to keep the raw data.
        </FieldDescription>
        {draft.step === 0 && (
          <>
            <CalibrationIllustration kind="diameter" />
            <p>
              Use a boss or block with a known width along machine X. The
              supplied L-bracket is nominally 15.000 mm wide; use its measured
              width if known. Move it away from its normal Anchor 1 position and
              secure it squarely so the probe can reach both X sides. The two
              measured side faces must be perpendicular to X.
            </p>
            <ParameterField
              id={`${id}-width`}
              parameter={{
                label: "Known width along X",
                unit: "mm",
                min: 0.01,
                max: 100,
                step: 0.001,
                default: 15,
              }}
              field={probingField(form, "width")}
              disabled={hasReadings || !!draft.pending}
            />
          </>
        )}
        {draft.step === 1 && (
          <>
            <Field>
              <FieldLabel htmlFor={`${id}-tool`}>
                Physical 3D touch probe
              </FieldLabel>
              <OptionSelect
                id={`${id}-tool`}
                value={tool?.id ?? ""}
                options={probes.map(({ tool: probe }) => ({
                  value: probe.id,
                  label: probe.name,
                }))}
                disabled={hasReadings || !!draft.pending}
                onValueChange={selectTool}
              />
            </Field>
            <p>
              Fit the selected undamaged 3D probe and connect its signal cable.
              If newly fitted or remounted, prepare tool-setter detection and
              Run it on Job. Otherwise reuse the same active probe's existing
              measurement. A conductive rod needs its own library dimensions and
              conductive contact surfaces connected to the table. No tool change
              or remeasurement occurs after manual positioning.
            </p>
            <ReasonButton
              label="Prepare tool-setter detection"
              reason={preparationIssue}
              disabled={!tool || !!draft.pending}
              onClick={prepareMeasurement}
            >
              Prepare tool-setter detection
            </ReasonButton>
            <ParameterField
              id={`${id}-distance`}
              parameter={{
                label: "X offset",
                unit: "mm",
                min: 2,
                max: 100,
                step: 0.5,
                default: 10,
              }}
              field={probingField(form, "distance")}
              disabled={hasReadings || !!draft.pending}
            />
            <ParameterField
              id={`${id}-depth`}
              parameter={{
                label: "Side depth below top",
                unit: "mm",
                min: 0.5,
                max: 10,
                step: 0.5,
                default: 2.5,
              }}
              field={probingField(form, "depth")}
              disabled={hasReadings || !!draft.pending}
            />
            <ParameterField
              id={`${id}-diameter`}
              parameter={{
                label: "Initial probe tip diameter",
                unit: "mm",
                min: 0.5,
                max: 3.2,
                step: 0.001,
                default: DEFAULT_PROBE_TIP_DIAMETER,
              }}
              field={probingField(form, "diameter")}
              disabled={hasReadings || !!draft.pending}
            />
            {(
              [
                ["gap", "Estimated gap above reference top", 5],
                ["maxLeft", "Maximum inward search from left · X+", 2.5],
                ["maxRight", "Maximum inward search from right · X−", 2.5],
                ["maxDown", "Maximum downward search · Z−", 6],
              ] as const
            ).map(([name, label, defaultValue]) => (
              <ParameterField
                key={name}
                id={`${id}-${name}`}
                parameter={{
                  label,
                  unit: "mm",
                  min: name === "gap" ? 0.1 : 0.4,
                  max: name === "gap" ? 5 : 10,
                  step: 0.1,
                  default: defaultValue,
                }}
                field={probingField(form, name)}
                disabled={!!draft.pending}
              />
            ))}
            <p>
              After tool detection, dismiss its completed result. Manually
              position the tip over the solid center of the boss, approximately
              5 mm above its top, clear of holes. Align the two measured faces
              perpendicular to machine X. The side depth must put the complete
              ball below the top, and remain above the bed and all fasteners.
              The X offset must exceed half the width plus the ball radius and 1
              mm. For a 15 mm reference and 2 mm ball, 10 mm leaves clearance.
              Check travel around the whole reference, screws and clamps.
              Maximum searches are total travel, not a guaranteed safe
              deflection allowance. Choose limits for the actual gaps; missing
              contacts halt without retrying. Preview height is schematic, not a
              measured reference height.
            </p>
          </>
        )}
        {draft.step === 2 && (
          <>
            <ProbeSafetyNotice />
            <p>
              For each reading: return the same measured probe over the solid
              boss center, set the estimated top gap and search limits on the
              preceding step, then verify the live signal below. Do not move or
              remount it after checking. Confirm the setup, prepare and Run the
              job, then reopen this guide and collect the result before Dismiss.
              Each next job uses the preceding reading's effective diameter in a
              separate calibration probe entry; the original probe stays
              unchanged until Save.
            </p>
            {tool && (
              <ProbeInputCheck
                tool={tool}
                toolNumber={probeNumber ?? null}
                disabled={!!draft.pending}
                onVerified={(signalBindingId) =>
                  update({ signalBindingId, signalToolId: tool.id })
                }
              />
            )}

            {runIssue && <FieldDescription>{runIssue}</FieldDescription>}
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-setup`}
                checked={confirmed}
                onCheckedChange={(value) => setConfirmed(value === true)}
              />
              <FieldLabel htmlFor={`${id}-setup`}>
                Same measured probe fitted and connected; tip centered above the
                solid reference; gap, complete travel, search limits and
                conductive contact path checked.
              </FieldLabel>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  !tool ||
                  !!runIssue ||
                  !valid ||
                  nextIndex < 0 ||
                  !confirmed ||
                  !!draft.pending
                }
                onClick={prepare}
              >
                Prepare reading {nextIndex < 0 ? "—" : nextIndex + 1}
                {nextIndex < 0 ? "" : ` · D${nextDiameter.toFixed(3)}`}
              </Button>
              <Button
                variant="outline"
                disabled={!draft.pending}
                onClick={collect}
              >
                Collect completed reading
              </Button>
              {draft.pending && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    update({ pending: null })
                    setConfirmed(false)
                  }}
                >
                  Discard pending reading
                </Button>
              )}
            </div>
            {draft.pending && (
              <FieldDescription>
                Reading {draft.pending.reading + 1} is prepared. Run it on Job,
                or discard it here before preparing another. Discarding this
                draft does not stop a running job.
              </FieldDescription>
            )}
            {readings.map((reading, index) => (
              <Field key={index} data-invalid={!!reading.error}>
                <FieldLabel htmlFor={`${id}-log-${index}`}>
                  Reading {index + 1} ·{" "}
                  {draft.sources[index]?.kind ?? "pasted MDI output"}
                </FieldLabel>
                <Textarea
                  id={`${id}-log-${index}`}
                  aria-invalid={!!reading.error}
                  value={draft.logs[index]}
                  maxLength={256000}
                  placeholder="Paste one M480.10 D… X… Y0 Z… command and all six [PRB:…:1] reports"
                  onChange={(event) => {
                    const logs = [...draft.logs],
                      sources = [...draft.sources]
                    logs[index] = event.target.value
                    sources[index] = tool
                      ? {
                          kind:
                            sources[index]?.kind === "simulator"
                              ? "simulator"
                              : "manual",
                          toolId: tool.id,
                        }
                      : null
                    update({
                      logs,
                      sources,
                      toolId: tool?.id ?? "",
                      originalTool:
                        draft.originalTool ??
                        (tool ? JSON.stringify(tool) : null),
                    })
                  }}
                />
                {reading.error && (
                  <Alert>
                    <AlertDescription>{reading.error}</AlertDescription>
                  </Alert>
                )}
                {reading.result && (
                  <FieldDescription>
                    Left mean {mm(reading.result.left)} · right mean{" "}
                    {mm(reading.result.right)} · span {mm(reading.result.span)}{" "}
                    · effective diameter {mm(reading.result.diameter)}. Next
                    input D{toMicrometre(reading.result.diameter).toFixed(3)}.
                  </FieldDescription>
                )}
              </Field>
            ))}
          </>
        )}
        {draft.step === 3 && (
          <>
            <p>
              Contact span = right mean − left mean. Effective diameter =
              contact span − known width. Average the three effective diameters
              and round to 0.001 mm.
            </p>
            {summary && (
              <HeightMapFacts
                facts={[
                  {
                    label: "Three-reading average",
                    value: mm(summary.average),
                  },
                  { label: "Reading range", value: mm(summary.range) },
                  {
                    label: "Save effective diameter",
                    value: `${summary.diameter.toFixed(3)} mm`,
                  },
                  { label: "Probe", value: tool?.name ?? "Select a probe" },
                ]}
              />
            )}
            {!summary && (
              <Alert>
                <AlertDescription>
                  {summaryError ??
                    "Collect three valid, separate readings before saving. A range over 0.02 mm requires a repeat."}
                </AlertDescription>
              </Alert>
            )}
            <p>
              This is scalar compensation measured along X; the firmware also
              uses it for Y. It does not prove Y accuracy or physically change
              the ball. Keep the same stylus, mounting orientation and probing
              conditions. Recalibrate after changing them.
            </p>
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-physical`}
                checked={confirmed}
                onCheckedChange={(value) => setConfirmed(value === true)}
              />
              <FieldLabel htmlFor={`${id}-physical`}>
                These are three separate physical cycles on the selected probe
                and reference. I have reviewed the results.
              </FieldLabel>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  !summary ||
                  !tool ||
                  !confirmed ||
                  draft.sources.some((source) => source?.kind === "simulator")
                }
                onClick={save}
              >
                Save effective diameter to probe
              </Button>
              <Button
                variant="outline"
                disabled={exportReport.isPending || !hasReadings}
                onClick={() => exportReport.mutate()}
              >
                Export calibration report
              </Button>
            </div>
            <FieldDescription>
              Saving updates the probe's library diameter and notes. Future
              generated probing cycles reuse it; already exported NC files and a
              running job keep their original values.
            </FieldDescription>
          </>
        )}
        {!tool && (
          <Alert>
            <AlertDescription>
              Add a compatible 3D touch probe to this project's tool library.
            </AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </FieldGroup>
    </AppDialog>
  )
}
