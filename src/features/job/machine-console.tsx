import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react"
import { revalidateLogic, useForm } from "@tanstack/react-form"
import { useVirtualizer } from "@tanstack/react-virtual"
import { SendHorizontal } from "lucide-react"
import { z } from "zod"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Field, FieldError } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Separator } from "@/components/ui/separator"
import { ReasonButton } from "@/components/workspace/reason-button"
import { useWorkspace } from "@/app/workspace/workspace-context"
import { kitForDevice } from "@/domain/fixtures/catalog"
import { rulesOf } from "@/domain/rules/rules"
import { programSubject } from "@/domain/rules/stages"
import { ConsoleLineSchema, rulesSchema } from "@/machine/contract"
import type { ConsoleEntry, RuleSettings } from "@/machine/contract"
import {
  useMachineConsole,
  useMachineSnapshot,
  useSendConsoleLine,
} from "@/platform/machine"

const MARKS: Record<ConsoleEntry["direction"], string> = {
  sent: "→",
  received: "←",
  note: "•",
}

const DIRECTIONS: Record<ConsoleEntry["direction"], string> = {
  sent: "Sent",
  received: "Received",
  note: "Note",
}

/** Scrolled this close to the end, the view follows new entries. */
const FOLLOW_PX = 16
/** Most entries are one line; a wrapped entry is measured and corrects this. */
const ROW_HEIGHT_ESTIMATE = 22

const ConsoleRow = memo(function ConsoleRow({
  entry,
}: {
  entry: ConsoleEntry
}) {
  return (
    <div
      className={cn(
        "flex gap-2 px-3 py-0.5",
        (entry.direction === "note" || entry.tone === "quiet") &&
          "text-muted-foreground",
        entry.tone === "failure" && "text-destructive"
      )}
    >
      <span className="shrink-0 font-numeric text-muted-foreground">
        {new Date(entry.at).toLocaleTimeString()}
      </span>
      <span
        className="w-3 shrink-0 text-center text-muted-foreground"
        role="img"
        aria-label={DIRECTIONS[entry.direction]}
      >
        {MARKS[entry.direction]}
      </span>
      <code className="min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap">
        {entry.text}
      </code>
    </div>
  )
})

// Validate when sending, and on every change once a send was attempted.
const VALIDATION_LOGIC = revalidateLogic()

/**
 * A console line as the connected machine takes it: one line, which none of its program rules
 * the project reports as an error breaks, as they block Run. A machine without a kit has none.
 */
function consoleLineSchema(model: string | null, settings: RuleSettings) {
  const kit = model === null ? null : kitForDevice(model)
  return z.object({
    line: kit
      ? ConsoleLineSchema.pipe(
          rulesSchema(
            z.string(),
            rulesOf("program"),
            (text) => programSubject(text),
            { settings, level: "error", machine: kit.id }
          )
        )
      : ConsoleLineSchema,
  })
}

/**
 * A line to send the machine as typed, when the connected machine admits one; what the line's
 * schema finds shows on the field. What the machine replies shows in the console.
 */
function ConsoleCommand() {
  const { availability, connection } = useMachineSnapshot()
  const settings = useWorkspace((state) => state.ruleSettings)
  const send = useSendConsoleLine()
  const model = connection.device?.model ?? null
  const schema = useMemo(
    () => consoleLineSchema(model, settings),
    [model, settings]
  )
  const entry = availability.console
  const reason = entry.allowed ? null : (entry.reason ?? "Unavailable.")
  const form = useForm({
    defaultValues: { line: "" },
    validationLogic: VALIDATION_LOGIC,
    validators: { onDynamic: schema },
    onSubmit: async ({ value, formApi }) => {
      if (reason) return
      try {
        await send.mutateAsync(value.line.trim())
        formApi.reset()
      } catch {
        // The machine's refusal stays with the mutation, under the field.
      }
    },
  })
  return (
    <form
      className="p-2"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Field name="line">
        {(field) => {
          const invalid = !field.state.meta.isValid || !!send.error
          return (
            <Field data-invalid={invalid || undefined}>
              <InputGroup>
                <InputGroupInput
                  aria-label="Command"
                  aria-invalid={invalid || undefined}
                  className="font-mono"
                  placeholder="G0 X10 Y10"
                  autoComplete="off"
                  spellCheck={false}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value)
                    send.reset()
                  }}
                />
                <InputGroupAddon align="inline-end">
                  <ReasonButton
                    type="submit"
                    label="Send"
                    aria-label="Send"
                    variant="ghost"
                    size="icon-xs"
                    reason={reason}
                    disabled={send.isPending}
                  >
                    <SendHorizontal />
                  </ReasonButton>
                </InputGroupAddon>
              </InputGroup>
              <FieldError errors={field.state.meta.errors} />
              {send.error && (
                <FieldError role="alert">{send.error.message}</FieldError>
              )}
            </Field>
          )
        }}
      </form.Field>
    </form>
  )
}

/**
 * What the app sent the machine and what it replied, with the app's notes: connecting, Stop
 * and a job's phases, and a line to send it. Status polling and file transfer blocks are left
 * out. Virtualized: with up to a thousand entries kept, only the rows near the viewport render.
 */
export function MachineConsole() {
  const { entries, clear } = useMachineConsole()
  const viewport = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const getItemKey = useCallback(
    (index: number) => entries[index].sequence,
    [entries]
  )
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    getItemKey,
    overscan: 12,
  })
  const items = virtualizer.getVirtualItems()
  useLayoutEffect(() => {
    const element = viewport.current
    if (element && following.current) element.scrollTop = element.scrollHeight
  }, [entries, items])
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Console">
      <header className="flex items-center justify-between gap-2 px-3 py-2">
        <span>Console</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!entries.length}
          onClick={clear}
        >
          Clear
        </Button>
      </header>
      <Separator />
      <div
        ref={viewport}
        className="min-h-0 flex-1 overflow-auto py-1 text-xs"
        role="log"
        aria-label="Machine console"
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget
          following.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            FOLLOW_PX
        }}
      >
        {entries.length ? (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {items.map((item) => (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <ConsoleRow entry={entries[item.index]} />
              </div>
            ))}
          </div>
        ) : (
          <p className="px-3 py-0.5 text-muted-foreground">No messages yet</p>
        )}
      </div>
      <Separator />
      <ConsoleCommand />
    </section>
  )
}
