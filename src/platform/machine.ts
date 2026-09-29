import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import { RpcError } from "@openspindle/rpc"
import { z } from "zod"
import {
  MachineErrorCodeSchema,
  disconnectedSnapshot,
} from "@/machine/contract"
import type {
  ConnectRequest,
  ConsoleEntry,
  DisconnectRequest,
  MachineCommand,
  MachineErrorCode,
  MachineSnapshot,
  RunRequest,
  WriteAnchorsRequest,
} from "@/machine/contract"
import { useHost } from "./host-context"
import type { MachineHost } from "./host"

export const machineKeys = {
  snapshot: ["machine", "snapshot"] as const,
  discovery: ["machine", "discovery"] as const,
  program: (key: string) => ["machine", "program", key] as const,
}

const INITIAL_SNAPSHOT = disconnectedSnapshot(0)

/** Snapshots only move forward: a slower reply never overwrites a newer push. */
function storeSnapshot(client: QueryClient, next: MachineSnapshot) {
  client.setQueryData<MachineSnapshot>(machineKeys.snapshot, (current) =>
    current && current.revision > next.revision ? current : next
  )
}

/** A failed machine request's RPC error carries the controller's code as its data. */
const MachineErrorDataSchema = z.object({ machine: MachineErrorCodeSchema })

/** Why a machine request failed, as the controller coded it; null for other failures. */
export function machineErrorCode(error: unknown): MachineErrorCode | null {
  if (!(error instanceof RpcError)) return null
  const data = MachineErrorDataSchema.safeParse(error.data)
  return data.success ? data.data.machine : null
}

const isSnapshot = (value: unknown): value is MachineSnapshot =>
  !!value &&
  typeof value === "object" &&
  "revision" in value &&
  "availability" in value

/** Mounted once: mirrors the main process's pushed machine snapshots into the query cache. */
export function useMachineSync() {
  const machine = useHost().machine
  const client = useQueryClient()
  useEffect(
    () => machine.subscribe((snapshot) => storeSnapshot(client, snapshot)),
    [machine, client]
  )
}

export function useMachineSnapshot(): MachineSnapshot {
  const machine = useHost().machine
  const { data } = useQuery({
    queryKey: machineKeys.snapshot,
    queryFn: () => machine.snapshot(),
    initialData: INITIAL_SNAPSHOT,
    staleTime: Infinity,
  })
  return data
}

/** As many as the main process keeps. */
const CONSOLE_LIMIT = 1000

/** The machine console while mounted: its backlog, then new entries as they arrive. */
export function useMachineConsole(): ConsoleEntry[] {
  const machine = useHost().machine
  const [entries, setEntries] = useState<ConsoleEntry[]>([])
  useEffect(() => {
    setEntries([])
    return machine.watchConsole((batch) =>
      setEntries((current) => {
        // A batch may repeat the end of the backlog it followed.
        const last = current.at(-1)?.sequence ?? -1
        const fresh = batch.filter((entry) => entry.sequence > last)
        if (!fresh.length) return current
        return [...current, ...fresh].slice(-CONSOLE_LIMIT)
      })
    )
  }, [machine])
  return entries
}

/** Machine requests as mutations; the controller refuses concurrent work, so nothing queues here. */
function useMachineMutation<TVariables, TResult>(
  name: string,
  run: (machine: MachineHost, variables: TVariables) => Promise<TResult>
) {
  const machine = useHost().machine
  const client = useQueryClient()
  return useMutation({
    mutationKey: ["machine", name],
    mutationFn: (variables: TVariables) => run(machine, variables),
    onSuccess: (result) => {
      if (isSnapshot(result)) storeSnapshot(client, result)
    },
  })
}

export const useMachineCommand = () =>
  useMachineMutation("execute", (machine, command: MachineCommand) =>
    machine.execute(command)
  )
export const useStopMachine = () =>
  useMachineMutation("stop", (machine, _: void) => machine.stop())
export const useResetMachine = () =>
  useMachineMutation("reset", (machine, _: void) => machine.reset())
export const useConnectMachine = () =>
  useMachineMutation("connect", (machine, request: ConnectRequest) =>
    machine.connect(request)
  )
export const useDisconnectMachine = () =>
  useMachineMutation("disconnect", (machine, request: DisconnectRequest) =>
    machine.disconnect(request)
  )
export const useRunProgram = () =>
  useMachineMutation("run", (machine, request: RunRequest) =>
    machine.run(request)
  )
export const useDismissJob = () =>
  useMachineMutation("dismissJob", (machine, _: void) => machine.dismissJob())
export const useReadAnchors = () =>
  useMachineMutation("readAnchors", (machine, _: void) => machine.readAnchors())
export const useWriteAnchors = () =>
  useMachineMutation("writeAnchors", (machine, request: WriteAnchorsRequest) =>
    machine.writeAnchors(request)
  )
export const useReadHeightMap = () =>
  useMachineMutation("readHeightMap", (machine, _: void) =>
    machine.readHeightMap()
  )

/** 53-bit string fingerprint (cyrb53) for cache keys over large program text. */
function fingerprint(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${text.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`
}

/**
 * What the connected firmware would execute for this program, or why it cannot. The check stays
 * while its program is unchanged, however long no view shows it, so opening the Job tab again
 * never prepares that program again; a new check drops the checks no view shows.
 */
export function useProgramCheck(source: string | null) {
  const machine = useHost().machine
  const client = useQueryClient()
  const key = useMemo(
    () => (source === null ? null : fingerprint(source)),
    [source]
  )
  return useQuery({
    queryKey: machineKeys.program(key ?? "none"),
    queryFn: async () => {
      const result = await machine.prepare(source ?? "")
      client.removeQueries({
        queryKey: ["machine", "program"],
        type: "inactive",
        predicate: (query) => query.queryKey[2] !== key,
      })
      return result
    },
    enabled: source !== null,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}
