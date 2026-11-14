import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { zipSync, strToU8 } from "fflate"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { FieldDescription } from "@/components/ui/field"
import { AppDialog } from "@/features/shell/app-dialog"
import { useHost } from "@/platform/host-context"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import { PlateSchema } from "@/domain/plate/plate"
import { ToolSchema } from "@/domain/tools/tool"
import { newId } from "@/domain/primitives"
import { fromBase64 } from "@/formats/base64-json"
import type { HistoryRecord, HistorySummary } from "@/platform/contract/history"
import { z } from "zod"

const date = (value: number) => new Date(value).toLocaleString()
const duration = (ms: number) =>
  `${Math.floor(ms / 60000)} min ${Math.floor(ms / 1000) % 60} s`
function Frame({ summary, index }: { summary: HistorySummary; index: number }) {
  const host = useHost()
  const frame = useQuery({
    queryKey: ["history-frame", summary.id, index],
    queryFn: () => host.history.frame(summary.id, index),
    staleTime: Infinity,
  })
  if (!frame.data) return null
  return (
    <figure>
      <img
        src={frame.data}
        alt={`Machine camera ${date(summary.frameTimes[index])}`}
        loading="lazy"
      />
      <figcaption>{date(summary.frameTimes[index])}</figcaption>
    </figure>
  )
}
function Details({ record }: { record: HistoryRecord }) {
  const host = useHost(),
    workspace = useWorkspaceStore(),
    client = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showFrames, setShowFrames] = useState(false)
  const summary = record.summary
  const exporting = useMutation({
    mutationFn: async () => {
      const files: Record<string, Uint8Array> = {
        "source.nc": strToU8(record.source),
        "prepared.nc": strToU8(record.prepared),
        "record.json": strToU8(
          JSON.stringify(
            {
              summary,
              events: record.events,
              machine: JSON.parse(record.machine),
            },
            null,
            2
          )
        ),
      }
      if (record.snapshot) files["job-snapshot.json"] = strToU8(record.snapshot)
      for (let i = 0; i < summary.frames; i++) {
        const frame = await host.history.frame(summary.id, i)
        if (frame)
          files[`camera/frame-${String(i).padStart(3, "0")}.jpg`] = fromBase64(
            frame.split(",")[1]
          )
      }
      return host.files.save({
        kind: "historyArchive",
        suggestedName: `job-${summary.id}.zip`,
        contents: zipSync(files, { level: 0 }),
      })
    },
    onError: (error) => toast.error(error.message),
  })
  const deleting = useMutation({
    mutationFn: () => host.history.remove(summary.id),
    onSuccess: () => client.invalidateQueries({ queryKey: ["history"] }),
    onError: (error) => toast.error(error.message),
  })
  function openCopy() {
    try {
      if (!record.snapshot) throw new Error("This run has no full job context.")
      const context = z
        .object({
          schema: z.literal("openspindle-run-context/1"),
          plate: PlateSchema,
          tools: z.array(ToolSchema),
        })
        .parse(JSON.parse(record.snapshot))
      const copies = context.tools.map((tool) => ({ ...tool, id: newId() }))
      const ids = new Map(
        context.tools.map((tool, index) => [tool.id, copies[index].id])
      )
      const plate = {
        ...context.plate,
        id: newId(),
        name: `${context.plate.name || summary.name} (history copy)`,
        tools: context.plate.tools.map((tool) => ({
          ...tool,
          toolId: tool.toolId ? (ids.get(tool.toolId) ?? null) : null,
        })),
        notices: [
          ...context.plate.notices,
          {
            id: newId(),
            createdAt: Date.now(),
            message:
              "Historical job copy: verify current workholding, work zero and installed tools before Run.",
          },
        ],
      }
      const result = workspace.dispatch({
        type: "batch",
        commands: [
          {
            type: "library.tools",
            tools: [...workspace.state.tools, ...copies],
          },
          { type: "plates.add", plates: [plate], select: true },
        ],
      })
      if (!result.ok) throw new Error(result.error)
      toast.success("Opened a separate historical job copy.")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to open history copy."
      )
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <FieldDescription>
        {summary.phase} · Started {date(summary.startedAt)} ·{" "}
        {summary.endedAt
          ? `Ended ${date(summary.endedAt)}`
          : "In progress / outcome unknown"}
      </FieldDescription>
      <FieldDescription>
        Observed running: {duration(summary.activeMs)} · Paused:{" "}
        {duration(summary.pausedMs)} · Camera frames: {summary.frames}
      </FieldDescription>
      {summary.notes.map((note, i) => (
        <FieldDescription key={i}>{note}</FieldDescription>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => exporting.mutate()}
          disabled={exporting.isPending}
        >
          Export full archive
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            host.files
              .save({
                kind: "program",
                suggestedName: `job-${summary.id}.nc`,
                contents: record.source,
              })
              .catch((error) => toast.error(error.message))
          }}
        >
          Save NC
        </Button>
        <Button
          variant="outline"
          onClick={openCopy}
          disabled={!record.snapshot}
        >
          Open copy
        </Button>
        <Button
          variant="outline"
          onClick={() => setShowFrames(!showFrames)}
          disabled={!summary.frames}
        >
          Camera images
        </Button>
        <Button
          variant="ghost"
          disabled={summary.endedAt === null}
          onClick={() => setConfirmDelete(true)}
        >
          Delete
        </Button>
      </div>
      {confirmDelete && (
        <div className="flex items-center gap-2">
          <FieldDescription>
            Delete this archived job and its camera images permanently?
          </FieldDescription>
          <Button
            variant="destructive"
            onClick={() => deleting.mutate()}
            disabled={deleting.isPending}
          >
            Delete archive
          </Button>
          <Button variant="outline" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
        </div>
      )}
      {showFrames && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: summary.frames }, (_, index) => (
            <Frame key={index} summary={summary} index={index} />
          ))}
        </div>
      )}
    </div>
  )
}
export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const host = useHost()
  const [selected, setSelected] = useState<string | null>(null)
  const jobs = useQuery({
    queryKey: ["history"],
    queryFn: () => host.history.list(),
    refetchInterval: 5000,
  })
  const record = useQuery({
    queryKey: ["history", "record", selected],
    queryFn: () => host.history.read(selected!),
    enabled: !!selected && !!jobs.data?.some((j) => j.id === selected),
    refetchInterval: 5000,
  })
  return (
    <AppDialog title="Job history" width="wide" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {jobs.isLoading && (
          <FieldDescription>Loading history…</FieldDescription>
        )}
        {jobs.error && (
          <FieldDescription>{jobs.error.message}</FieldDescription>
        )}
        {jobs.data?.length === 0 && (
          <FieldDescription>
            Completed and interrupted runs will appear here.
          </FieldDescription>
        )}
        <div className="flex max-h-64 flex-col gap-1 overflow-auto">
          {jobs.data?.map((job) => (
            <Button
              key={job.id}
              variant={selected === job.id ? "secondary" : "ghost"}
              onClick={() => setSelected(job.id)}
            >
              {job.name} · {date(job.startedAt)} · {job.phase}
            </Button>
          ))}
        </div>
        {selected &&
          jobs.data?.some((j) => j.id === selected) &&
          record.data && <Details key={selected} record={record.data} />}
        {record.error && (
          <FieldDescription>{record.error.message}</FieldDescription>
        )}
      </div>
    </AppDialog>
  )
}
