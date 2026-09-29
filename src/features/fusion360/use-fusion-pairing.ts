import { useEffect } from "react"
import { usePluginRequest } from "@/features/plugins/plugin-requests"
import {
  currentDialog,
  openDialog,
  useOpenDialog,
} from "@/features/shell/dialogs"
import { useDocumentState, usePersistence } from "@/persistence/persistence"
import { useFusionConnection } from "@/platform/fusion"

/** Pairing waits for unrelated edits, plugin requests and load issues to be resolved. */
export function useFusionPairing() {
  const dialog = useOpenDialog()
  const request = useFusionConnection().data?.request
  const pluginRequest = usePluginRequest()
  const persistence = usePersistence()
  const library = useDocumentState(persistence.library)
  const fixtures = useDocumentState(persistence.fixtures)
  const ready = library.phase === "ready" && fixtures.phase === "ready"
  useEffect(() => {
    if (!request || request.expiresAt <= Date.now() || pluginRequest || !ready)
      return
    const current = currentDialog()
    if (
      current?.kind === "fusion-pairing" &&
      current.requestId === request.requestId
    )
      return
    if (
      current &&
      current.kind !== "fusion" &&
      current.kind !== "fusion-pairing"
    )
      return
    openDialog({
      kind: "fusion-pairing",
      requestId: request.requestId,
      returnToFusion:
        current?.kind === "fusion" ||
        (current?.kind === "fusion-pairing" && current.returnToFusion),
    })
  }, [dialog, request, pluginRequest, ready])
}
