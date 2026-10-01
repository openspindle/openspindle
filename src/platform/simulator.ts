import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ConnectedDevice } from "@/machine/contract"
import type { SimulatorSettings, SimulatorStatus } from "./contract/simulator"
import { useHost } from "./host-context"

const simulatorKeys = {
  status: ["simulator", "status"] as const,
}

/** The app's simulator: its settings, where it listens and whether it does. */
export function useSimulatorStatus() {
  const simulator = useHost().simulator
  return useQuery({
    queryKey: simulatorKeys.status,
    queryFn: () => simulator.status(),
    staleTime: Infinity,
  })
}

/** Changes show at once; a change the main process could not make or keep is undone. */
export function useUpdateSimulator() {
  const simulator = useHost().simulator
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<SimulatorSettings>) => simulator.update(patch),
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: simulatorKeys.status })
      const previous = client.getQueryData<SimulatorStatus>(
        simulatorKeys.status
      )
      if (previous)
        client.setQueryData<SimulatorStatus>(simulatorKeys.status, {
          ...previous,
          settings: { ...previous.settings, ...patch },
        })
      return { previous }
    },
    onError: (_error, _patch, context) => {
      if (context?.previous)
        client.setQueryData(simulatorKeys.status, context.previous)
    },
    onSuccess: (status) => client.setQueryData(simulatorKeys.status, status),
  })
}

/** Whether a device is the app's own simulator, while it runs. */
export const isAppSimulator = (
  device: Pick<ConnectedDevice, "host" | "port"> | null,
  status: SimulatorStatus | undefined
) =>
  !!device &&
  !!status?.running &&
  device.host === status.host &&
  device.port === status.port
