import type { ReactNode } from "react"
import { Radio } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PreviewTimelineBar } from "./timeline-bar"
import type { JobEta, JobTimeline } from "./use-job-timeline"

/** "12:34" under an hour, "1:05 h" from an hour on. */
function clockText(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const pad = (value: number) => String(value).padStart(2, "0")
  return minutes < 60
    ? `${minutes}:${pad(total % 60)}`
    : `${Math.floor(minutes / 60)}:${pad(minutes % 60)} h`
}

/** "12:34 left + 2 tool changes": how long the plan takes, and the tool changes on the way. */
function etaText({ seconds, toolChanges, remaining }: JobEta) {
  const changes =
    toolChanges === 1 ? "1 tool change" : `${toolChanges} tool changes`
  return [
    `${clockText(seconds)}${remaining ? " left" : ""}`,
    toolChanges > 0 ? `+ ${changes}` : null,
  ]
    .filter((part) => part !== null)
    .join(" ")
}

function timelineTitle({ following, target, eta }: JobTimeline): string {
  let title = "Toolpath preview"
  if (following && target)
    title = target.active ? "Live position" : "End of job"
  return eta ? `${title} · ${etaText(eta)}` : title
}

/** The timeline under the viewer: preview playback, or this window's job position. */
export function JobTimelineBar({
  timeline,
  details,
}: {
  timeline: JobTimeline
  /** What the cursor shows in detail, under the scrubber. */
  details?: ReactNode
}) {
  const { target, following } = timeline
  return (
    <PreviewTimelineBar
      timeline={timeline.timeline}
      cursor={timeline.cursor}
      playing={timeline.playing}
      onSeek={timeline.seek}
      onPlay={timeline.togglePlay}
      speed={timeline.speed}
      onSpeed={timeline.setSpeed}
      title={timelineTitle(timeline)}
      details={details}
      actions={
        target &&
        !following && (
          <Button variant="outline" size="sm" onClick={timeline.follow}>
            <Radio data-icon="inline-start" />
            {target.active ? "Back to live" : "Back to job position"}
          </Button>
        )
      }
    />
  )
}
