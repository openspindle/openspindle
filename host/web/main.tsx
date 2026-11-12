import { createRoot } from "react-dom/client"
import { useState } from "react"
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { OptionSelect } from "@/components/option-select"
import { FilePicker } from "@/components/file-picker"
import { CameraPanel, JobTimelapses } from "./cameras"
import type { CameraState } from "../camera-contract"
import { Preview } from "./preview"
import type { FreecadHandoff } from "@/formats/freecad/handoff"
import { isTerminalJobPhase } from "@/machine/contract"
import type { MachineSnapshot } from "@/machine/contract"
import type { HistorySummary, HistoryRecord } from "@/platform/contract/history"
import "../../src/styles.css"

type State = {
  selected: string | null
  runInbox: string | null
  runId: string | null
  machine: MachineSnapshot
  camera: string
  cameras: CameraState[]
}
type Inbox = {
  id: string
  name: string
  sha256: string
  bytes: number
  createdAt: number
}
function Monitor({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [error, setError] = useState("")
  const [recordId, setRecordId] = useState("")
  async function api<T>(
    path: string,
    method = "GET",
    body?: string
  ): Promise<T> {
    const response = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? "Request failed.")
    return data as T
  }
  const state = useQuery({
    queryKey: ["state"],
    queryFn: () => api<State>("/api/state"),
    refetchInterval: 1000,
    retry: false,
  })
  const jobs = useQuery({
    queryKey: ["inbox"],
    queryFn: () => api<Inbox[]>("/api/inbox"),
    refetchInterval: 5000,
    retry: false,
  })
  const history = useQuery({
    queryKey: ["history"],
    queryFn: () => api<HistorySummary[]>("/api/history"),
    refetchInterval: 5000,
    retry: false,
  })
  const active = state.data?.machine.job
  const selected =
    active &&
    !isTerminalJobPhase(active.phase) &&
    active.id === state.data?.runId
      ? state.data.runInbox
      : state.data?.selected
  const bundle = useQuery({
    queryKey: ["bundle", selected],
    queryFn: () => api<FreecadHandoff>(`/api/inbox/${selected}`),
    enabled: !!selected,
    retry: false,
  })
  const record = useQuery({
    queryKey: ["record", recordId],
    queryFn: () => api<HistoryRecord>(`/api/history/${recordId}`),
    enabled: !!recordId,
    retry: false,
  })
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: string }) =>
      api(path, "POST", body),
    onSuccess: () => {
      void state.refetch()
      void jobs.refetch()
    },
    onError: (err) => setError(err.message),
  })
  async function downloadRecord() {
    if (!record.data) return
    const blob = new Blob([JSON.stringify(record.data, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a")
    a.href = url
    a.download = `job-${record.data.summary.id}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-5 p-5">
      <Card>
        <CardHeader>
          <CardTitle>OpenSpindle host</CardTitle>
          <CardDescription>
            One machine owner · browser monitoring
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <FieldDescription>
            {state.data?.machine.connection.status ?? "Connecting…"} ·{" "}
            {active?.name ?? "No active job"} · {active?.phase ?? "Idle"} · line{" "}
            {active?.progress?.line ?? 0}
          </FieldDescription>
          {(error || state.error) && (
            <FieldDescription>{error || state.error?.message}</FieldDescription>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={onLogout}>
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Job inbox</CardTitle>
          <CardDescription>
            Received packages are not started automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <OptionSelect
            value={state.data?.selected ?? ""}
            options={(jobs.data ?? []).map((job) => ({
              value: job.id,
              label: job.name,
            }))}
            onValueChange={(id) =>
              action.mutate({
                path: "/api/select",
                body: JSON.stringify({ id }),
              })
            }
          />
          <FilePicker
            accept=".ospjob"
            aria-label="Upload job package"
            onSelect={(files) => {
              const file = files[0]
              if (file.size <= 64 * 1024 * 1024)
                file
                  .text()
                  .then((body) => action.mutate({ path: "/api/inbox", body }))
                  .catch((err) => setError(String(err)))
              else setError("Package exceeds 64 MB.")
            }}
          >
            {(open) => (
              <Button onClick={open} disabled={action.isPending}>
                Upload job package
              </Button>
            )}
          </FilePicker>
          {jobs.data?.find((job) => job.id === selected) && (
            <FieldDescription>
              Package SHA-256:{" "}
              {jobs.data.find((job) => job.id === selected)?.sha256}
            </FieldDescription>
          )}
          {bundle.data && (
            <Preview
              bundle={bundle.data}
              line={
                selected === state.data?.runInbox
                  ? (active?.progress?.line ?? 0)
                  : 0
              }
            />
          )}{" "}
          {bundle.error && (
            <FieldDescription>{bundle.error.message}</FieldDescription>
          )}
        </CardContent>
      </Card>
      <CameraPanel
        cameras={state.data?.cameras ?? []}
        token={token}
        refresh={() => void state.refetch()}
      />
      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <OptionSelect
            value={recordId}
            options={(history.data ?? []).map((job) => ({
              value: job.id,
              label: `${job.name} · ${job.phase} · ${new Date(job.startedAt).toLocaleString()}`,
            }))}
            onValueChange={setRecordId}
          />
          {record.data && (
            <>
              <FieldDescription>
                {record.data.summary.phase} · observed running{" "}
                {Math.round(record.data.summary.activeMs / 1000)} s · camera
                frames {record.data.summary.frames}
              </FieldDescription>
              <Button onClick={() => void downloadRecord()}>
                Download full job record
              </Button>
              <JobTimelapses key={recordId} jobId={recordId} token={token} />
              {record.data.summary.frameTimes.map((at, index) => (
                <HistoricalFrame
                  key={index}
                  id={recordId}
                  index={index}
                  at={at}
                  token={token}
                />
              ))}
            </>
          )}
          {record.error && (
            <FieldDescription>{record.error.message}</FieldDescription>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
function HistoricalFrame({
  id,
  index,
  at,
  token,
}: {
  id: string
  index: number
  at: number
  token: string
}) {
  const data = useQuery({
    queryKey: ["frame", id, index],
    queryFn: async () => {
      const response = await fetch(`/api/history/${id}/frames/${index}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error("Camera image unavailable.")
      return response.json() as Promise<{ jpeg: string | null }>
    },
    staleTime: Infinity,
  })
  return data.data?.jpeg ? (
    <figure>
      <img
        src={data.data.jpeg}
        loading="lazy"
        alt={`Archived machine camera ${new Date(at).toLocaleString()}`}
      />
      <figcaption>{new Date(at).toLocaleString()}</figcaption>
    </figure>
  ) : null
}
function App() {
  const [token, setToken] = useState(""),
    [draft, setDraft] = useState("")
  if (token)
    return (
      <QueryClientProvider client={new QueryClient()}>
        <Monitor token={token} onLogout={() => setToken("")} />
      </QueryClientProvider>
    )
  return (
    <main className="mx-auto max-w-md p-8">
      <Card>
        <CardHeader>
          <CardTitle>Connect to OpenSpindle host</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setToken(draft)
              setDraft("")
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="host-key">Access key</FieldLabel>
                <Input
                  id="host-key"
                  type="password"
                  autoComplete="off"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </Field>
              <Button type="submit" disabled={draft.length < 32}>
                Connect
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
createRoot(document.getElementById("root")!).render(<App />)
