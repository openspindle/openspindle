import { useEffect, useRef } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { FileText, FileUp, RefreshCw } from "lucide-react"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { FileLink } from "@/domain/file-link"
import type { FileKind, LinkedFileRead } from "@/platform/contract/files"
import type { Host } from "@/platform/host"
import { useHost } from "@/platform/host-context"

/** The link to a file the page was given where it is on disk; null for one that is not on disk. */
export function linkOf(host: Host, file: File): FileLink | null {
  const path = host.files.pathOf(file)
  return path ? { path, modifiedAt: file.lastModified } : null
}

/** SHA-256 of text, hex, as the main process hashes a linked file's text. */
async function sha256(text: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

/** How a kept file compares with the file on disk it was loaded from. */
type LinkState =
  | { readonly kind: "unlinked" | "checking" | "current" | "missing" }
  | { readonly kind: "changed"; readonly modifiedAt: number }
  | { readonly kind: "unreadable"; readonly reason: string }

/**
 * Whether `content`, kept from the file at `link`, is that file's latest: checked as the field
 * shows and each time the app comes back to the front, by its text's hash.
 */
function useLinkState(
  kind: FileKind,
  link: FileLink | undefined,
  content: string
): LinkState {
  const host = useHost()
  const query = useQuery({
    // The contents change with the link's modification time, or in length.
    queryKey: [
      "linked-file",
      kind,
      link?.path,
      link?.modifiedAt,
      content.length,
    ],
    enabled: !!link,
    refetchOnWindowFocus: "always",
    queryFn: async (): Promise<LinkState> => {
      if (!link) return { kind: "unlinked" }
      const status = await host.files.linkedStatus({ kind, path: link.path })
      if (status.status === "missing") return { kind: "missing" }
      if (status.status === "unreadable")
        return { kind: "unreadable", reason: status.reason }
      return status.sha256 === (await sha256(content))
        ? { kind: "current" }
        : { kind: "changed", modifiedAt: status.modifiedAt }
    },
  })
  // The window comes back to the front without the page having been hidden, as after saving
  // the file in another app: check again then too.
  const { refetch } = query
  const linked = !!link
  useEffect(() => {
    if (!linked) return
    const check = () => void refetch()
    window.addEventListener("focus", check)
    return () => window.removeEventListener("focus", check)
  }, [linked, refetch])
  if (!link) return { kind: "unlinked" }
  if (query.error) return { kind: "unreadable", reason: query.error.message }
  return query.data ?? { kind: "checking" }
}

const dateText = (milliseconds: number) =>
  new Date(milliseconds).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })

/**
 * A file an operation keeps, as a card: its name and `description`, a button to replace it with
 * another, and below whether it is the latest of the file on disk it was loaded from, with
 * Update to load that again (`onUpdate`).
 */
export function LinkedFileField({
  kind,
  name,
  description,
  content,
  link,
  accept,
  disabled,
  processing,
  onReplace,
  onUpdate,
}: {
  kind: FileKind
  name: string
  description: string
  content: string
  link: FileLink | undefined
  /** The extensions the file chooser offers. */
  accept: string
  disabled: boolean
  /** The file is being read or applied. */
  processing: boolean
  onReplace: (file: File) => void
  onUpdate: (read: LinkedFileRead, link: FileLink) => void
}) {
  const host = useHost()
  const input = useRef<HTMLInputElement>(null)
  const state = useLinkState(kind, link, content)
  const update = useMutation({
    mutationFn: async (from: FileLink) => {
      const read = await host.files.readLinked({ kind, path: from.path })
      onUpdate(read, { path: from.path, modifiedAt: read.modifiedAt })
    },
  })
  let status: string
  switch (state.kind) {
    case "unlinked":
      status = "Not linked to a file on disk."
      break
    case "checking":
      status = "Checking the file on disk…"
      break
    case "current":
      status = "The latest version of the file on disk."
      break
    case "changed":
      status = `Changed on disk ${dateText(state.modifiedAt)}.`
      break
    case "missing":
      status = "No longer found on disk."
      break
    case "unreadable":
      status = `Cannot read the file on disk: ${state.reason}`
  }
  return (
    <Field>
      <Attachment
        className="w-full"
        state={processing || update.isPending ? "processing" : "done"}
      >
        <AttachmentMedia>
          <FileText />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle title={link?.path ?? name}>{name}</AttachmentTitle>
          <AttachmentDescription>{description}</AttachmentDescription>
        </AttachmentContent>
        <AttachmentActions>
          <AttachmentAction
            type="button"
            aria-label="Replace file"
            title="Replace file"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            <FileUp />
          </AttachmentAction>
        </AttachmentActions>
      </Attachment>
      <Input
        ref={input}
        hidden
        type="file"
        accept={accept}
        aria-label="Replace file"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onReplace(file)
          event.target.value = ""
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <FieldDescription title={link?.path} role="status">
          {update.error ? update.error.message : status}
        </FieldDescription>
        {state.kind === "changed" && link && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={disabled || processing || update.isPending}
            onClick={() => update.mutate(link)}
          >
            <RefreshCw data-icon="inline-start" />
            Update
          </Button>
        )}
      </div>
    </Field>
  )
}
