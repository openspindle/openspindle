import { useEffect } from "react"
import {
  currentDialog,
  openDialog,
  useOpenDialog,
} from "@/features/shell/dialogs"
import { useDocumentState, usePersistence } from "@/persistence/persistence"
import { useFusionConnection } from "@/platform/fusion"

/** Pairing waits for unrelated edits and load issues to be resolved. */
export function useFusionPairing() {
  const dialog = useOpenDialog()
  const request = useFusionConnection().data?.request
  const persistence = usePersistence()
  const library = useDocumentState(persistence.library)
  const fixtures = useDocumentState(persistence.fixtures)
  const ready = library.phase === "ready" && fixtures.phase === "ready"
  useEffect(() => {
    if (!request || request.expiresAt <= Date.now() || !ready) return
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
  }, [dialog, request, ready])
}
