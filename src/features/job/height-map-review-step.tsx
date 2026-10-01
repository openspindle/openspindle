import { useCallback, useEffect } from "react"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { machineId } from "@/machine/contract"
import { useMachineSnapshot, useReadHeightMap } from "@/platform/machine"
import { HeightMapReview } from "@/features/probing/height-map-review"
import { availabilityReason } from "./job-hooks"
import { jobSessionStore } from "./job-session"
import type { JobViewOf } from "./job-view"

/**
 * The height map review: reads the probed height map once per pause, keeps it in the
 * workspace, and hands the result to the presentational panel. Resume and Stop are in the
 * job's toolbar.
 */
export function HeightMapReviewStep({
  view,
}: {
  view: JobViewOf<"waiting-review">
}) {
  const { availability, connection } = useMachineSnapshot()
  const workspace = useWorkspaceStore()
  const { mutateAsync, isPending, error } = useReadHeightMap()
  const device = connection.device
  const deviceId = device ? machineId(device) : null
  const stored = useWorkspace((state) =>
    deviceId === null ? undefined : state.heightMaps[deviceId]
  )
  // Only a map read during this pause belongs to this review.
  const map = stored && stored.receivedAt >= view.wait.since ? stored : null

  const read = useCallback(() => {
    // A failed read shows through the mutation's error.
    void mutateAsync().then(
      (result) => workspace.dispatch({ type: "heightMap.store", map: result }),
      () => undefined
    )
  }, [mutateAsync, workspace])

  // A deferred read would wait for the program to end, which is too late for a review.
  const entry = availability.readHeightMap
  const ready = entry.allowed && !entry.deferred
  const { runId } = view.session
  const { pauseKey } = view
  useEffect(() => {
    if (ready && jobSessionStore.actions.claimReview(runId, pauseKey)) read()
  }, [ready, runId, pauseKey, read])

  const source = view.operation?.source
  const expected =
    source?.kind === "probing" && source.task === "grid"
      ? { columns: source.params.points[0], rows: source.params.points[1] }
      : undefined
  return (
    <HeightMapReview
      map={map ?? undefined}
      expected={expected}
      reading={isPending}
      readError={error?.message ?? null}
      onRetryRead={read}
      retryReadDisabledReason={
        entry.deferred ? entry.reason : availabilityReason(entry)
      }
    />
  )
}
