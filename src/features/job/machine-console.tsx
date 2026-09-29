import { memo, useCallback, useLayoutEffect, useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { cn } from "cn"
import { Separator } from "@/components/ui/separator"
import type { ConsoleEntry } from "@/machine/contract"
import { useMachineConsole } from "@/platform/machine"

const MARKS: Record<ConsoleEntry["direction"], string> = {
  sent: "→",
  received: "←",
  note: "•",
}

const DIRECTIONS: Record<ConsoleEntry["direction"], string> = {
  sent: "Sent",
  received: "Received",
  note: "Note",
}

/** Scrolled this close to the end, the view follows new entries. */
const FOLLOW_PX = 16
/** Most entries are one line; a wrapped entry is measured and corrects this. */
const ROW_HEIGHT_ESTIMATE = 22

const ConsoleRow = memo(function ConsoleRow({
  entry,
}: {
  entry: ConsoleEntry
}) {
  return (
    <div
      className={cn(
        "flex gap-2 px-3 py-0.5",
        (entry.direction === "note" || entry.tone === "quiet") &&
          "text-muted-foreground",
        entry.tone === "failure" && "text-destructive"
      )}
    >
      <span className="shrink-0 font-numeric text-muted-foreground">
        {new Date(entry.at).toLocaleTimeString()}
      </span>
      <span
        className="w-3 shrink-0 text-center text-muted-foreground"
        role="img"
        aria-label={DIRECTIONS[entry.direction]}
      >
        {MARKS[entry.direction]}
      </span>
      <code className="min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap">
        {entry.text}
      </code>
    </div>
  )
})

/**
 * What the app sent the machine and what it replied, with the app's notes: connecting, Stop
 * and a job's phases. Read-only; status polling and file transfer blocks are left out.
 * Virtualized: with up to a thousand entries kept, only the rows near the viewport render.
 */
export function MachineConsole() {
  const entries = useMachineConsole()
  const viewport = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const getItemKey = useCallback(
    (index: number) => entries[index].sequence,
    [entries]
  )
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    getItemKey,
    overscan: 12,
  })
  const items = virtualizer.getVirtualItems()
  useLayoutEffect(() => {
    const element = viewport.current
    if (element && following.current) element.scrollTop = element.scrollHeight
  }, [entries, items])
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Console">
      <header className="flex flex-col px-3 py-2">
        <span>Console</span>
      </header>
      <Separator />
      <div
        ref={viewport}
        className="min-h-0 flex-1 overflow-auto py-1 text-xs"
        role="log"
        aria-label="Machine console"
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget
          following.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            FOLLOW_PX
        }}
      >
        {entries.length ? (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {items.map((item) => (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <ConsoleRow entry={entries[item.index]} />
              </div>
            ))}
          </div>
        ) : (
          <p className="px-3 py-0.5 text-muted-foreground">No messages yet</p>
        )}
      </div>
    </section>
  )
}
