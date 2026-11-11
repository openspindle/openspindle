import { useId, useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { OptionSelect } from "@/components/option-select"
import {
  HeightMapFacts,
  HeightMapGrid,
} from "@/components/workspace/height-map-grid"
import { featureDistance } from "@/domain/probing/metrology"
import {
  featureRepeatability,
  measuredDimensions,
  referenceCheck,
  ReferenceInputSchema,
} from "@/domain/probing/inspection-analysis"
import { ParameterField, probingField } from "@/features/probing/probing-fields"
import { useProbingForm } from "@/features/probing/probing-form"
import type {
  InspectionFeature,
  InspectionSurface,
} from "@/domain/probing/metrology"
import { findsCorner } from "@/domain/probing/tasks/origin/params"
import { inspectionCsv, inspectionJson } from "@/formats/inspection"
import type { InspectionReport } from "@/formats/inspection"
import { useHost } from "@/platform/host-context"
import { inspectionReport } from "./inspection-report"
import type { JobSubject, JobView } from "./job-view"
import { openDialog } from "@/features/shell/dialogs"
import { useDiameterCalibrationPlate } from "@/features/device/probe-diameter-calibration-dialog"

const mm = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${value.toFixed(4)} mm`

const sides = (bounds: readonly [number, number] | null) =>
  bounds ? `${bounds[0].toFixed(4)} … ${bounds[1].toFixed(4)} mm` : "—"

function FeatureFacts({ feature }: { feature: InspectionFeature }) {
  const result = feature.result
  const position = findsCorner(feature.routine) ? "Corner" : "Center"
  return (
    <section className="flex flex-col gap-3" aria-label={feature.name}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{feature.name}</span>
        <Badge
          variant={feature.status === "complete" ? "secondary" : "outline"}
        >
          {feature.status}
        </Badge>
      </div>
      {feature.problem && (
        <Alert>
          <AlertDescription>{feature.problem}</AlertDescription>
        </Alert>
      )}
      <HeightMapFacts
        facts={[
          { label: `${position} X`, value: mm(result?.origin[0]) },
          { label: `${position} Y`, value: mm(result?.origin[1]) },
          { label: "Top Z", value: mm(result?.top) },
          {
            label: "Contacts",
            value: `${feature.contacts.length} / ${feature.expectedContacts}`,
          },
          { label: "X span", value: mm(result?.size[0]) },
          { label: "Y span", value: mm(result?.size[1]) },
          { label: "X sides", value: sides(feature.bounds[0]) },
          { label: "Y sides", value: sides(feature.bounds[1]) },
          { label: "Ball diameter", value: mm(feature.probe?.ballDiameter) },
          {
            label: "Second touch correction",
            value: mm(feature.secondTouchCorrection),
          },
        ]}
      />
    </section>
  )
}

function SurfaceFacts({ surface }: { surface: InspectionSurface }) {
  const { grid, analysis } = surface
  return (
    <section className="flex flex-col gap-3" aria-label={surface.name}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{surface.name}</span>
        <Badge
          variant={surface.status === "complete" ? "secondary" : "outline"}
        >
          {surface.status}
        </Badge>
      </div>
      {surface.problem && (
        <Alert>
          <AlertDescription>{surface.problem}</AlertDescription>
        </Alert>
      )}
      <HeightMapFacts
        facts={[
          {
            label: "Measured",
            value: `${analysis?.samples.valid ?? 0} / ${grid.columns * grid.rows}`,
          },
          { label: "Outliers", value: String(analysis?.outliers.length ?? 0) },
          { label: "Height range", value: mm(analysis?.statistics?.range) },
          {
            label: "Sampled flatness · all points",
            value: mm(surface.sampledFlatness),
          },
          {
            label: "Flatness · outliers excluded",
            value: mm(analysis?.surface?.flatness),
          },
          {
            label: "Tilt · outliers excluded",
            value: mm(analysis?.surface?.tilt),
          },
        ]}
      />
      {analysis && (
        <HeightMapGrid
          map={{
            columns: grid.columns,
            rows: grid.rows,
            heights: grid.heights,
            xCoordinates: grid.xCoordinates,
            yCoordinates: grid.yCoordinates,
            raw: "",
            receivedAt: grid.at,
            deviceId: "inspection",
          }}
          outliers={analysis.outliers}
          compact
        />
      )}
    </section>
  )
}

/** Report controls only read the current report and save it; they own no machine actions. */
function InspectionResults({ report }: { report: InspectionReport }) {
  const host = useHost()
  const id = useId()
  const [fromId, setFromId] = useState("")
  const [toId, setToId] = useState("")
  const centers = report.features.filter(
    (feature) =>
      feature.status === "complete" &&
      !findsCorner(feature.routine) &&
      feature.result !== null &&
      feature.result.origin[0] !== null &&
      feature.result.origin[1] !== null
  )
  const from =
    centers.find((feature) => feature.operationId === fromId) ?? centers.at(0)
  const targets = centers.filter((feature) => feature !== from)
  const to =
    targets.find((feature) => feature.operationId === toId) ?? targets.at(0)
  const comparison = from && to ? featureDistance(from, to) : null
  const repetitions = featureRepeatability(report.features)
  const dimensions = measuredDimensions(report.features, comparison)
  const [referenceInput, setReferenceInput] = useState({
    dimensionId: "",
    nominal: NaN,
    tolerance: 0.05,
  })
  const [referenceValid, setReferenceValid] = useState(false)
  const referenceForm = useProbingForm(
    referenceInput,
    ReferenceInputSchema,
    setReferenceInput,
    setReferenceValid
  )
  const reference = referenceValid
    ? referenceCheck(dimensions, referenceInput)
    : null
  const save = useMutation({
    mutationFn: (format: "json" | "csv") =>
      host.files.save({
        kind: format === "json" ? "inspectionJson" : "inspectionCsv",
        suggestedName: `openspindle-inspection-${report.jobId.slice(0, 8)}.${format}`,
        contents:
          format === "json"
            ? inspectionJson(report, comparison, reference)
            : inspectionCsv(report, comparison, reference),
      }),
    onSuccess: (result) => {
      if (result.status === "saved") toast.success("Inspection report saved.")
    },
    onError: (error) =>
      toast.error("Inspection report could not be saved.", {
        description: error.message,
      }),
  })
  return (
    <>
      <CardContent className="flex flex-col gap-4">
        {report.missing.map((missing) => (
          <Alert key={missing.operationId}>
            <AlertDescription>
              {missing.name}: {missing.reason}
            </AlertDescription>
          </Alert>
        ))}
        {report.features.map((feature) => (
          <FeatureFacts key={feature.operationId} feature={feature} />
        ))}
        {comparison && from && to && (
          <>
            <Separator />
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`${id}-from`}>
                  Distance from center
                </FieldLabel>
                <OptionSelect
                  id={`${id}-from`}
                  value={from.operationId}
                  options={centers.map((feature) => ({
                    value: feature.operationId,
                    label: feature.name,
                  }))}
                  onValueChange={setFromId}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-to`}>To center</FieldLabel>
                <OptionSelect
                  id={`${id}-to`}
                  value={to.operationId}
                  options={targets.map((feature) => ({
                    value: feature.operationId,
                    label: feature.name,
                  }))}
                  onValueChange={setToId}
                />
              </Field>
            </FieldGroup>
            <HeightMapFacts
              facts={[
                { label: "Δ X", value: mm(comparison.deltaX) },
                { label: "Δ Y", value: mm(comparison.deltaY) },
                {
                  label: "Center distance · XY",
                  value: mm(comparison.distanceXY),
                },
              ]}
            />
          </>
        )}
        {report.surfaces.map((surface) => (
          <SurfaceFacts key={surface.operationId} surface={surface} />
        ))}
        {repetitions.map((group) => (
          <FieldSet key={group.operationIds.join(":")}>
            <FieldLegend>Repeatability · {group.name}</FieldLegend>
            <HeightMapFacts
              facts={[
                {
                  label: "Completed / attempted",
                  value: `${group.completedOperationIds.length} / ${group.attempted}`,
                },
              ]}
            />
            {group.quantities.map(({ quantity, statistics }) => (
              <HeightMapFacts
                key={quantity}
                facts={[
                  { label: `${quantity} · mean`, value: mm(statistics.mean) },
                  { label: "Range", value: mm(statistics.range) },
                  {
                    label: "Sample standard deviation",
                    value: mm(statistics.sampleStandardDeviation),
                  },
                ]}
              />
            ))}
          </FieldSet>
        ))}
        {dimensions.length > 0 && (
          <FieldSet>
            <FieldLegend>Known-reference check</FieldLegend>
            <FieldGroup>
              {probingField(
                referenceForm,
                "dimensionId"
              )((field) => (
                <Field>
                  <FieldLabel htmlFor={`${id}-dimension`}>
                    Measured dimension
                  </FieldLabel>
                  <OptionSelect
                    id={`${id}-dimension`}
                    value={
                      dimensions.some(
                        (dimension) => dimension.id === field.value
                      )
                        ? field.value
                        : ""
                    }
                    options={dimensions.map((dimension) => ({
                      value: dimension.id,
                      label: dimension.label,
                    }))}
                    onValueChange={field.onChange}
                  />
                </Field>
              ))}
              <ParameterField
                id={`${id}-nominal`}
                parameter={{
                  label: "Known dimension",
                  unit: "mm",
                  min: 0.0001,
                  max: 10000,
                  step: 0.001,
                  default: 1,
                }}
                field={probingField(referenceForm, "nominal")}
                disabled={false}
              />
              <ParameterField
                id={`${id}-tolerance`}
                parameter={{
                  label: "Tolerance ±",
                  unit: "mm",
                  min: 0,
                  max: 10000,
                  step: 0.001,
                  default: 0.05,
                }}
                field={probingField(referenceForm, "tolerance")}
                disabled={false}
              />
            </FieldGroup>
            {reference && (
              <HeightMapFacts
                facts={[
                  { label: "Measured", value: mm(reference.measured) },
                  { label: "Signed error", value: mm(reference.error) },
                  {
                    label: "Reference result",
                    value: reference.withinTolerance
                      ? "Within tolerance"
                      : "Outside tolerance",
                  },
                ]}
              />
            )}
          </FieldSet>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={save.isPending}
          onClick={() => save.mutate("json")}
        >
          Export JSON
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={save.isPending}
          onClick={() => save.mutate("csv")}
        >
          Export CSV
        </Button>
      </CardFooter>
    </>
  )
}

export function InspectionReportCard({
  view,
  subject,
}: {
  view: JobView
  subject: JobSubject | null
}) {
  const report = useMemo(() => inspectionReport(view), [view])
  const calibrationPlate = useDiameterCalibrationPlate()
  const hasInspection = subject?.plate.operations.some(
    ({ source }) =>
      source.kind === "probing" &&
      (source.task === "origin" || source.task === "grid")
  )
  if (!hasInspection && !report) return null
  let provenance = "Awaiting measurements"
  if (report) {
    provenance = "Unknown measurement source"
    if (report.device?.source === "simulator")
      provenance = "Simulated measurements"
    if (report.device?.source === "physical")
      provenance = "Machine measurements"
  }
  return (
    <Card size="sm" role="region" aria-label="Inspection report">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          Inspection report <Badge variant="secondary">{provenance}</Badge>
        </CardTitle>
        <CardDescription>
          Machine-coordinate spans and centers; sampled surface flatness.
          Calibration unverified. Export before Dismiss. Origin routines change
          the work origin; height grids enable compensation.
        </CardDescription>
      </CardHeader>
      {report ? (
        <InspectionResults key={report.jobId} report={report} />
      ) : (
        <CardContent>
          Use Boss center for stock spans, Pocket center for holes or pockets,
          and Height map for surfaces. Run a probing plate to collect results.
        </CardContent>
      )}
      {report &&
        view.kind === "ended" &&
        view.outcome === "completed" &&
        view.session && (
          <CardFooter className="flex flex-wrap gap-2">
            {calibrationPlate === report.plateId && (
              <Button
                variant="outline"
                onClick={() =>
                  openDialog({ kind: "probe-diameter-calibration" })
                }
              >
                Continue diameter calibration
              </Button>
            )}
            {report.features
              .filter(
                (feature) =>
                  feature.status === "complete" &&
                  feature.result?.origin.some((value) => value !== null)
              )
              .map((feature) => (
                <Button
                  key={feature.operationId}
                  variant="outline"
                  onClick={() => {
                    if (view.session)
                      openDialog({
                        kind: "measurement-setup",
                        session: view.session,
                        feature,
                      })
                  }}
                >
                  Use {feature.name} in setup
                </Button>
              ))}
          </CardFooter>
        )}
    </Card>
  )
}
