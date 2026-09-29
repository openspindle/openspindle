import { useId } from "react"
import type { ReactNode } from "react"
import { Pause, Play, SkipBack, SkipForward } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { OptionSelect } from "@/components/option-select"
import type { PreviewStep, PreviewTimeline } from "./preview-timeline"

/** Playback runs the moves at their feeds: real time, or faster for long programs. */
const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100].map((value) => ({
  value,
  label: `${value}×`,
}))

/** "Line 12", with the probe point when the step probes; "Start" before the first step. */
function stepText(
  step: PreviewStep | undefined,
  probe: (point: number) => string
): string {
  if (!step) return "Start"
  if (step.probePoint === undefined) return `Line ${step.line}`
  return `Line ${step.line}${probe(step.probePoint + 1)}`
}

/** Scrubbing and playback over a program's timeline, with its markers. */
export function PreviewTimelineBar({
  timeline,
  cursor,
  playing,
  onSeek,
  onPlay,
  speed,
  onSpeed,
  title = "Toolpath preview",
  actions,
  details,
}: {
  timeline: PreviewTimeline
  cursor: number
  playing: boolean
  onSeek: (cursor: number) => void
  onPlay: () => void
  speed: number
  onSpeed: (speed: number) => void
  /** What the cursor shows, for example the machine's live position. */
  title?: ReactNode
  /** Extra controls beside the playback speed. */
  actions?: ReactNode
  /** What the cursor shows in detail, under the scrubber. */
  details?: ReactNode
}) {
  const id = useId()
  const count = timeline.steps.length
  const step = cursor > 0 ? timeline.steps.at(cursor - 1) : undefined
  return (
    <>
      <Separator />
      <section className="shrink-0 px-4 py-3" aria-label="Program timeline">
        <div className="mb-2 flex items-center gap-3">
          <span>{title}</span>
          <FieldDescription className="flex-1 font-numeric">
            {stepText(step, (point) => ` · Probe point ${point}`)}
          </FieldDescription>
          {actions}
          <Field orientation="horizontal" className="w-auto gap-2">
            <FieldLabel htmlFor={`${id}-speed`}>Playback</FieldLabel>
            <OptionSelect
              options={PLAYBACK_SPEEDS}
              value={speed}
              onValueChange={onSpeed}
              numeric
              id={`${id}-speed`}
              size="sm"
              aria-label="Playback speed"
            />
          </Field>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Go to program start"
            disabled={!count}
            onClick={() => onSeek(0)}
          >
            <SkipBack />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={playing ? "Pause preview" : "Play preview"}
            disabled={!count}
            onClick={onPlay}
          >
            {playing ? <Pause /> : <Play />}
          </Button>
          <div className="relative min-w-0 flex-1 pt-1 pb-3">
            <Slider
              thumbProps={{
                "aria-label": "G-code timeline",
                "aria-valuetext": stepText(
                  step,
                  (point) => `, probe point ${point}`
                ),
              }}
              min={0}
              max={Math.max(count, 1)}
              value={[cursor]}
              disabled={!count}
              step={1}
              onValueChange={(value) =>
                onSeek(typeof value === "number" ? value : value[0])
              }
            />
            <div className="absolute right-1.5 bottom-0 left-1.5 h-2">
              {timeline.ticks.map((tick, index) => (
                <Button
                  variant={tick.kind === "operation" ? "outline" : "secondary"}
                  size="icon-xs"
                  key={`${tick.line}-${tick.kind}-${index}`}
                  className="absolute h-2 w-1.5 -translate-x-1/2 p-0"
                  style={{ left: `${count ? (100 * tick.step) / count : 0}%` }}
                  title={`${tick.label} · Line ${tick.line}`}
                  aria-label={`Jump to ${tick.label} at line ${tick.line}`}
                  onClick={() => onSeek(tick.step)}
                />
              ))}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Go to program end"
            disabled={!count}
            onClick={() => onSeek(count)}
          >
            <SkipForward />
          </Button>
          <FieldDescription className="min-w-9 text-right font-numeric">
            {count ? Math.round((100 * cursor) / count) : 0}%
          </FieldDescription>
        </div>
        {details && (
          <div className="mt-2 rounded-md bg-muted/50 px-3 py-2">{details}</div>
        )}
      </section>
    </>
  )
}
