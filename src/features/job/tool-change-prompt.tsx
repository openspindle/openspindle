import { createAtom, useSelector } from "@tanstack/react-store"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ToolCard } from "@/components/workspace/tool-card"
import type { Operation } from "@/domain/operations/operation"
import type { Tool } from "@/domain/tools/tool"
import { useMachineSnapshot } from "@/platform/machine"
import type { MachineAction } from "./job-hooks"
import { pauseKey } from "./job-view"
import type { JobViewOf, ToolRequest } from "./job-view"
import { MachineActionButton, StageCard } from "./stage-card"

/** Product details worth checking against the tool in hand. */
function ToolDetails({ tool }: { tool: Tool }) {
  const details = [
    { label: "Kind", value: tool.kind },
    { label: "Vendor", value: tool.vendor },
    { label: "Product", value: tool.productId },
    { label: "Material", value: tool.material },
    { label: "Coating", value: tool.coating },
    { label: "Notes", value: tool.notes },
  ].filter((detail) => !!detail.value)
  if (!details.length) return null
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {details.map((detail) => (
        <div key={detail.label} className="contents">
          <dt className="text-muted-foreground">{detail.label}</dt>
          <dd className="min-w-0 break-words">{detail.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Why the plate's tool cannot be shown, when it cannot. */
function missingToolNote(
  request: ToolRequest,
  knownPlate: boolean
): string | null {
  if (!knownPlate)
    return "This job was started outside this window, so its plate's tool table is unknown."
  if (request.number === null)
    return "The machine did not report which tool it waits for."
  if (!request.entry)
    return `T${request.number} is not in the plate's tool table as it was run.`
  if (!request.tool)
    return `T${request.number} had no library tool assigned when the job was run.`
  return null
}

/** The tool change whose dialog was dismissed, by `pauseKey`: it stays closed while the job waits there. */
const dismissedAtom = createAtom<string | null>(null)

/**
 * Asks to confirm a manual tool change once the machine waits for it: the tool to install and
 * the operation the job goes on with. Dismiss leaves the job waiting for Tool installed.
 */
function ToolChangeDialog({
  view,
  slot,
  note,
  operation,
  confirm,
}: {
  view: JobViewOf<"waiting-tool">
  slot: string | null
  note: string | null
  operation: Operation | null
  confirm: MachineAction
}) {
  const key = pauseKey(view.job, view.wait)
  const dismissed = useSelector(dismissedAtom) === key
  const { tool } = view.request
  return (
    <AlertDialog
      open={!dismissed}
      onOpenChange={(open) => {
        if (!open) dismissedAtom.set(() => key)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Change tool</AlertDialogTitle>
        </AlertDialogHeader>
        {tool && <ToolCard tool={tool} slotLabel={slot ?? undefined} />}
        {note && (
          <Alert>
            <AlertDescription>{note}</AlertDescription>
          </Alert>
        )}
        <AlertDialogDescription>
          {operation
            ? `Job resumes with ${operation.name} after confirmation.`
            : "Job resumes after confirmation."}
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Dismiss</AlertDialogCancel>
          <MachineActionButton
            action={confirm}
            label="Confirm"
            pendingLabel="Confirming…"
            variant="default"
            icon={null}
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * A manual tool change: which tool to install, confirmed in a dialog as the machine starts
 * waiting, or later in the job's toolbar.
 */
export function ToolChangePrompt({
  view,
  operation,
  confirm,
}: {
  view: JobViewOf<"waiting-tool">
  /** The operation the job goes on with after the change; null when unknown. */
  operation: Operation | null
  confirm: MachineAction
}) {
  const { features } = useMachineSnapshot()
  const atc = features?.atc === true
  const { request } = view
  const slot = request.number === null ? null : `T${request.number}`
  const note = missingToolNote(request, view.session !== null)
  return (
    <>
      <StageCard
        title={slot ? `Install ${slot}` : "Change the tool"}
        description={
          atc
            ? "The machine waits for its tool changer."
            : "The machine waits with the spindle stopped. Install the tool, then choose Tool installed."
        }
      >
        {request.tool && (
          <>
            <ToolCard tool={request.tool} slotLabel={slot ?? undefined} />
            <ToolDetails tool={request.tool} />
          </>
        )}
        {note && (
          <Alert>
            <AlertDescription>{note}</AlertDescription>
          </Alert>
        )}
      </StageCard>
      {/* On tool-changer machines, confirming would loosen the tool instead. */}
      {!atc && (
        <ToolChangeDialog
          view={view}
          slot={slot}
          note={note}
          operation={operation}
          confirm={confirm}
        />
      )}
    </>
  )
}
