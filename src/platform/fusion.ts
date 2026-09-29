import { useEffect } from "react"
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query"
import type { FusionHost } from "./host"
import { useHost } from "./host-context"

export const fusionKeys = {
  connection: ["fusion360", "connection"] as const,
  programs: ["fusion360", "programs"] as const,
}

const connectionQuery = (fusion: FusionHost) =>
  queryOptions({
    queryKey: fusionKeys.connection,
    queryFn: () => fusion.snapshot(),
    staleTime: Infinity,
    retry: false,
  })

export function useFusionConnection() {
  return useQuery(connectionQuery(useHost().fusion))
}

/** Mounted once so a pairing request is received on every app page. */
export function useFusionSync() {
  const fusion = useHost().fusion
  const client = useQueryClient()
  useEffect(
    () =>
      fusion.subscribe((snapshot) => {
        client.setQueryData(fusionKeys.connection, snapshot)
        void client.invalidateQueries({ queryKey: fusionKeys.programs })
      }),
    [fusion, client]
  )
}
