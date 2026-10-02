import { Download } from "lucide-react"
import { devFlags } from "@/app/job/dev-flags"
import { useJobTracking } from "@/app/job/tracking-store"
import type { JobTracking } from "@/app/job/tracking-store"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MOVE_FRAME, UNKNOWN_TOOL } from "@/domain/motion/types"
import { lastTouch } from "@/domain/tracking/hmm"
import { numberText } from "@/features/device/device-format"
import { useJobSession } from "./job-session"
import type { JobSession } from "./job-session"

const KINDS = ["rapid", "feed", "arc", "probe"] as const

/** How many of the beam's hypotheses the overlay lists, likeliest first. */
const BEAM_SHOWN = 5

/** A tool as a report or a plan's tag gives it; a question mark while unknown. */
const toolText = (tool: number | null) =>
  tool === null || tool === UNKNOWN_TOOL ? "?" : String(tool)

const vectorText = (vector: readonly number[]) =>
  vector.map((part) => numberText(part, 2)).join(" ")

/** Each hypothesis's posterior, from scores that are log-likelihoods. */
function posteriors(scores: readonly number[]) {
  const best = Math.max(...scores)
  const weights = scores.map((score) => Math.exp(score - best))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  return weights.map((weight) => weight / total)
}

/**
 * Downloads what a Run's tracking has recorded as the JSON the offline replay reads: the plate
 * and source to plan again, the limits the plan was timed by, and the observations.
 */
function saveSession(tracking: JobTracking, session: JobSession) {
  const contents = JSON.stringify({
    version: 1,
    plate: session.plate,
    source: session.compiled.program.source,
    limits: tracking.index.plan.limits,
    observations: tracking.recorded ?? [],
  })
  const url = URL.createObjectURL(
    new Blob([contents], { type: "application/json" })
  )
  const link = document.createElement("a")
  link.href = url
  link.download = `openspindle-tracking-${tracking.jobId.slice(0, 8)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * The tracker's readout over the Job viewer, for developers (`devFlags.overlay`): where it places
 * the machine and what the report it went by said against the plan's tags there, its bias and
 * pace, and its likeliest hypotheses; and the tracking session to save for the replay.
 */
export function TrackerOverlay() {
  const tracking = useJobTracking()
  const session = useJobSession()
  if (!devFlags.overlay || !tracking) return null
  const { index, state, recorded } = tracking
  const { plan } = index
  const { estimate, last, beam, bias, scale } = state
  const move = estimate?.move ?? null
  const override = last?.feed.override ?? 100
  const nominal =
    move === null
      ? null
      : plan.timing.nominal[move] *
        (plan.overridable[move] ? override / 100 : 1)
  const frame =
    move === null
      ? "—"
      : plan.frame[move] === MOVE_FRAME.machine
        ? "machine"
        : "work"
  const touch = lastTouch(state)
  const shares = posteriors(beam.map(({ score }) => score))
  const own = session?.runId === tracking.jobId ? session : null
  return (
    <Card
      size="sm"
      role="region"
      aria-label="Tracker"
      className="absolute bottom-4 left-4 z-10 w-80 shadow-lg"
    >
      <CardHeader>
        <CardTitle>Tracker · {tracking.tracker}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 [&_dd]:text-right [&_dd]:font-numeric [&_dt]:text-muted-foreground">
          <dt>Status</dt>
          <dd>
            {estimate?.status ?? "—"} · misses {state.misses}
          </dd>
          <dt title="Plan time and the plan's total, s; rate in plan s per s">
            Time
          </dt>
          <dd>
            {numberText(estimate?.time, 2)} / {numberText(index.duration, 1)} ·{" "}
            {numberText(estimate?.rate, 2)}×
          </dd>
          <dt title="Move index · kind · frame">Move</dt>
          <dd>
            {move === null
              ? "—"
              : `${move} · ${KINDS[plan.kind[move]]}${plan.routine[move] ? " (routine)" : ""} · ${frame}`}
          </dd>
          <dt title="Reported P: line · the line the plan reports there">
            Line
          </dt>
          <dd>
            {numberText(last?.line)} ·{" "}
            {move === null ? "—" : plan.reportLine[move]}
          </dd>
          <dt title="Reported active/target tool · the plan's tags there">
            Tool
          </dt>
          <dd>
            {toolText(last?.tool.active ?? null)}/
            {toolText(last?.tool.target ?? null)} ·{" "}
            {move === null
              ? "—"
              : `${toolText(plan.reportTool[move])}/${toolText(plan.reportTarget[move])}`}
          </dd>
          <dt title="Reported F: · the plan's nominal at the override, mm/min">
            Feed
          </dt>
          <dd>
            {numberText(last?.feed.current)} · {numberText(nominal)}
          </dd>
          <dt title="Reported tip from the plan, mm · frame">Residual</dt>
          <dd>
            {numberText(
              Number.isNaN(estimate?.residual) ? null : estimate?.residual,
              2
            )}{" "}
            · {frame}
          </dd>
          <dt title="Bias by machine position / by work position, mm">Bias</dt>
          <dd>
            {vectorText(bias.machine)} / {vectorText(bias.work)}
          </dd>
          <dt title="Learnt pace of feed moves / rapids and routines">Scale</dt>
          <dd>
            {numberText(scale.feed, 2)} / {numberText(scale.rapid, 2)}
          </dd>
          <dt title="Last contact from where its search ends in the plan, mm">
            Touch
          </dt>
          <dd>{touch ? `${touch.kind} ${vectorText(touch.offset)}` : "—"}</dd>
        </dl>
        <table className="w-full font-numeric [&_td]:text-right [&_th]:text-right [&_th]:font-normal [&_th]:text-muted-foreground">
          <thead>
            <tr>
              <th>t</th>
              <th>move</th>
              <th>line</th>
              <th>p</th>
            </tr>
          </thead>
          <tbody>
            {beam.slice(0, BEAM_SHOWN).map((hypothesis, at) => (
              <tr key={`${hypothesis.move}:${hypothesis.time}`}>
                <td>{numberText(hypothesis.time, 2)}</td>
                <td>{hypothesis.move}</td>
                <td>{plan.line[hypothesis.move]}</td>
                <td>{numberText(shares[at], 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button
          variant="outline"
          size="sm"
          disabled={!own || !recorded}
          title={
            recorded
              ? undefined
              : 'Recording is off: localStorage "openspindle:dev:tracker-record" = "1"'
          }
          onClick={() => own && saveSession(tracking, own)}
        >
          <Download data-icon="inline-start" />
          Save tracking session
        </Button>
      </CardContent>
    </Card>
  )
}
