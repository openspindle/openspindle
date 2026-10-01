import { useMemo } from "react"
import { CircleAlert, CircleCheck, Grid3X3, TriangleAlert } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { FieldError } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { ReasonButton } from "@/components/workspace/reason-button"
import {
  analyzeHeightMap,
  formatHeight,
  formatSpan,
} from "@/domain/probing/tasks/grid/analysis"
import type {
  FlatnessVerdict,
  GridSize,
  HeightMapAnalysis,
} from "@/domain/probing/tasks/grid/analysis"
import type { HeightMap } from "@/machine/contract"
import {
  HeightMapFacts,
  HeightMapGrid,
} from "@/components/workspace/height-map-grid"

export type HeightMapReviewProps = {
  /** The map read at the review pause; undefined until a read succeeds. */
  map?: HeightMap
  /** The grid the paused operation probed, when known. */
  expected?: GridSize
  /** A height-map read (M375.1) is in progress. */
  reading: boolean
  /** Why the latest read failed; null after a successful read. */
  readError: string | null
  onRetryRead: () => void
  /** Why reading again is unavailable; null enables it. */
  retryReadDisabledReason: string | null
}

const VERDICTS: Record<
  FlatnessVerdict,
  { title: string; variant: "default" | "destructive"; icon: LucideIcon }
> = {
  flat: { title: "The surface is flat", variant: "default", icon: CircleCheck },
  uneven: {
    title: "The surface is uneven",
    variant: "default",
    icon: TriangleAlert,
  },
  unreliable: {
    title: "Check the probing before resuming",
    variant: "destructive",
    icon: CircleAlert,
  },
}

const millimetres = (
  value: number | undefined,
  format: (value: number) => string
) => (value === undefined ? "—" : `${format(value)} mm`)

function reviewFacts({
  size,
  expected,
  sizeMatches,
  samples,
  statistics,
  outliers,
  surface,
}: HeightMapAnalysis) {
  const mismatch =
    sizeMatches === false && expected
      ? ` · probed ${expected.columns} × ${expected.rows}`
      : ""
  return [
    { label: "Grid", value: `${size.columns} × ${size.rows}${mismatch}` },
    { label: "Measured", value: `${samples.valid} / ${samples.total}` },
    { label: "Outliers", value: String(outliers.length) },
    { label: "Minimum", value: millimetres(statistics?.min, formatHeight) },
    { label: "Maximum", value: millimetres(statistics?.max, formatHeight) },
    { label: "Mean", value: millimetres(statistics?.mean, formatHeight) },
    { label: "Range", value: millimetres(statistics?.range, formatSpan) },
    { label: "Tilt", value: millimetres(surface?.tilt, formatSpan) },
    { label: "Flatness", value: millimetres(surface?.flatness, formatSpan) },
  ]
}

function PendingRead({
  reading,
  readError,
}: Pick<HeightMapReviewProps, "reading" | "readError">) {
  if (reading)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner />
          </EmptyMedia>
          <EmptyTitle>Reading the height map…</EmptyTitle>
          <EmptyDescription>
            M375.1 reports the heights the firmware measured.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  if (readError)
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>The height map could not be read</AlertTitle>
        <AlertDescription>{readError}</AlertDescription>
      </Alert>
    )
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Grid3X3 />
        </EmptyMedia>
        <EmptyTitle>No height map yet</EmptyTitle>
        <EmptyDescription>
          Read the height map to review the probing.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function Verdict({ analysis }: { analysis: HeightMapAnalysis }) {
  const { title, variant, icon: Icon } = VERDICTS[analysis.verdict]
  return (
    <Alert variant={variant}>
      <Icon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <ul className="flex flex-col gap-1">
          {analysis.reasons.map((reason) => (
            <li key={reason.code}>{reason.message}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

/**
 * Review of the measured height map while a job waits at its height map review pause; Resume
 * and Stop are the job's own controls.
 */
export function HeightMapReview({
  map,
  expected,
  reading,
  readError,
  onRetryRead,
  retryReadDisabledReason,
}: HeightMapReviewProps) {
  const columns = expected?.columns
  const rows = expected?.rows
  const analysis = useMemo(() => {
    if (!map) return null
    const size =
      columns === undefined || rows === undefined
        ? undefined
        : { columns, rows }
    return analyzeHeightMap(map, { expected: size })
  }, [map, columns, rows])
  return (
    <Card size="sm" role="region" aria-label="Height map review">
      <CardHeader>
        <CardTitle>Review height map</CardTitle>
        <CardDescription>
          The job is paused after probing. Check the measured heights, then
          Resume to continue or Stop.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {map && analysis ? (
          <>
            {readError && <FieldError>{readError}</FieldError>}
            <Verdict analysis={analysis} />
            <HeightMapFacts
              facts={[
                ...reviewFacts(analysis),
                {
                  label: "Read at",
                  value: (
                    <time dateTime={new Date(map.receivedAt).toISOString()}>
                      {new Date(map.receivedAt).toLocaleTimeString()}
                    </time>
                  ),
                },
              ]}
            />
            <HeightMapGrid map={map} outliers={analysis.outliers} />
          </>
        ) : (
          <PendingRead reading={reading} readError={readError} />
        )}
      </CardContent>
      <CardFooter className="flex-wrap justify-end gap-2">
        <ReasonButton
          label="Retry height map read"
          reason={retryReadDisabledReason}
          variant="outline"
          disabled={reading}
          onClick={onRetryRead}
        >
          {reading ? "Reading…" : "Retry read"}
        </ReasonButton>
      </CardFooter>
    </Card>
  )
}
