import { useIsMutating } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import { WORKSPACE_MUTATION } from "@/features/shell/use-import"
import { isJobActive } from "@/machine/contract"
import type { MachineSnapshot } from "@/machine/contract"
import { machineKeys, useMachineSnapshot } from "@/platform/machine"

/** PCB edits wait while an import changes the workspace or a job uses it. */
export function usePcbLocked(): boolean {
  const imports = useIsMutating({ mutationKey: WORKSPACE_MUTATION })
  const { job } = useMachineSnapshot()
  return imports > 0 || isJobActive(job)
}

/** Check again when an asynchronous file read or conversion is about to save. */
export function pcbLocked(client: QueryClient): boolean {
  return (
    client.isMutating({ mutationKey: WORKSPACE_MUTATION }) > 0 ||
    pcbJobActive(client)
  )
}

/** A queued PCB import already holds the workspace scope; only the job can block it. */
export function pcbJobActive(client: QueryClient): boolean {
  const snapshot = client.getQueryData<MachineSnapshot>(machineKeys.snapshot)
  return snapshot !== undefined && isJobActive(snapshot.job)
}
