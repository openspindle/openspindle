import { CircleCheck } from "lucide-react"
import type { CompanionStatus } from "@openspindle/plugin-core"
import { FieldDescription, FieldError } from "@/components/ui/field"

export type CompanionNoteValue = {
  readonly ready: boolean
  readonly message: string
}

/**
 * What a plugin's companion last reported, for its card: its message once it is ready (such
 * as the program it found), or what is wrong. Null while it has nothing to say, before it
 * first started.
 */
export function companionNote(
  status: CompanionStatus | null
): CompanionNoteValue | null {
  if (!status) return null
  if (status.state === "failed" && status.lastError)
    return {
      ready: false,
      message: `Stopped after repeated failures: ${status.lastError}`,
    }
  if (status.state === "backoff" && status.lastError)
    return { ready: false, message: `Restarting soon: ${status.lastError}` }
  if (!status.health?.message) return null
  return {
    ready: status.health.status === "ready",
    message: status.health.message,
  }
}

/** A check with the companion's message once it is ready; otherwise what is wrong. */
export function CompanionNote({ note }: { note: CompanionNoteValue }) {
  if (!note.ready) return <FieldError>{note.message}</FieldError>
  return (
    <FieldDescription className="flex items-center gap-1.5">
      <CircleCheck
        aria-hidden
        className="size-4 shrink-0 fill-primary text-primary-foreground"
      />
      {note.message}
    </FieldDescription>
  )
}
