import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useHost } from "@/platform/host-context"

const STATUS_KEY = ["pcb", "status"] as const

/** The installed converter's status and the explicit actions that choose or recheck it. */
export function usePcb() {
  const host = useHost()
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => host.pcb.status(),
  })
  const check = useMutation({
    mutationFn: () => host.pcb.status(),
    onSuccess: (result) => queryClient.setQueryData(STATUS_KEY, result),
  })
  const choose = useMutation({
    mutationFn: () => host.pcb.chooseExecutable(),
    onSuccess: (result) => queryClient.setQueryData(STATUS_KEY, result),
  })
  const automatic = useMutation({
    mutationFn: () => host.pcb.setExecutable(null),
    onSuccess: (result) => queryClient.setQueryData(STATUS_KEY, result),
  })
  return { status, check, choose, automatic }
}
