import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import type { KeyboardEvent } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  ArrowDownToLine,
  LandPlot,
  Layers3,
  MessageSquare,
  Pause,
  PencilLine,
  Route,
  Settings2,
  Split,
  SquareDashed,
  Wrench,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import type { CompiledPlate } from "@/domain/compile/compile"
import type { SectionKind } from "@/domain/compile/sections"
import type { Operation } from "@/domain/operations/operation"
import type { ProgramChange } from "@/machine/contract"
import { CHANGE_LABELS, buildListingModel } from "./listing-model"
import type { ListingHeader, ListingHeaderKind } from "./listing-model"
import { preparedLines, preparedProgram } from "./program-check"
import type { ProgramCheck } from "./program-check"

const LINE_HEIGHT = 24
const HEADER_HEIGHT = 28
/** Lines moved by Page Up and Page Down. */
const PAGE_LINES = 20

const SECTION_ICONS: Partial<Record<SectionKind, LucideIcon>> = {
  setup: Settings2,
  toolpath: Route,
  "tool-change": Wrench,
  probe: LandPlot,
  "touch-off": ArrowDownToLine,
  scan: SquareDashed,
  message: MessageSquare,
}

const HEADER_BADGES: Record<
  ListingHeaderKind,
  { variant: "secondary" | "outline" | "ghost"; icon: LucideIcon }
> = {
  part: { variant: "outline", icon: Split },
  operation: { variant: "secondary", icon: Layers3 },
  pause: { variant: "outline", icon: Pause },
  section: { variant: "ghost", icon: Route },
}

const changeText = (change: ProgramChange) =>
  `${CHANGE_LABELS[change.reason]}: ${change.before} → ${change.after}`

/** A line's number, change mark and code; shared by rows and the width sizer. */
function LineContent({
  line,
  text,
  note = "",
  changed,
}: {
  line: number
  text: string
  /** Source text the machine does not receive (a comment), shown muted. */
  note?: string
  changed: boolean
}) {
  return (
    <>
      <span className="w-12 shrink-0 text-right font-numeric text-muted-foreground">
        {line}
      </span>
      <span className="flex w-4 shrink-0 justify-center">
        {changed && <PencilLine aria-hidden />}
      </span>
      {text || !note ? (
        <code className="whitespace-pre">{text || " "}</code>
      ) : (
        <code className="whitespace-pre text-muted-foreground">{note}</code>
      )}
    </>
  )
}

function HeaderRow({ header }: { header: ListingHeader }) {
  const badge = HEADER_BADGES[header.kind]
  const Icon =
    (header.sectionKind && SECTION_ICONS[header.sectionKind]) ?? badge.icon
  return (
    <div className="flex h-full items-end gap-2 px-2 pb-0.5">
      {header.kind !== "operation" && header.kind !== "part" && (
        <span className="w-20 shrink-0" aria-hidden />
      )}
      <Badge variant={badge.variant} className="max-w-full">
        <Icon data-icon="inline-start" />
        <span className="truncate">{header.label}</span>
      </Badge>
    </div>
  )
}

/**
 * The program as the machine executes it, virtualized: operation, section and pause headers,
 * lines the dialect changes, the line on show, and click-to-seek.
 */
export function GCodeListing({
  compiled,
  operations,
  check,
  line,
  onSeekLine,
}: {
  compiled: CompiledPlate
  /** The plate's operations, for the operation headers. */
  operations: readonly Operation[]
  check: ProgramCheck
  /** The line on show: highlighted, and kept in view while Follow is on. */
  line: number
  onSeekLine: (line: number) => void
}) {
  const id = useId()
  const prepared = preparedProgram(check)
  const lines = useMemo(
    () => (prepared ? preparedLines(prepared) : compiled.program.lines),
    [prepared, compiled.program.lines]
  )
  const model = useMemo(
    () =>
      buildListingModel({
        lineCount: lines.length,
        compiled,
        operations,
        prepared,
      }),
    [lines.length, compiled, operations, prepared]
  )
  const widest = useMemo(
    () =>
      lines.reduce(
        (longest, text) => (text.length > longest.length ? text : longest),
        ""
      ),
    [lines]
  )
  const [follow, setFollow] = useState(true)
  const viewport = useRef<HTMLDivElement>(null)
  // A new model re-measures its rows: header rows move when the program changes.
  const getItemKey = useCallback(
    (index: number) => model.row(index).key,
    [model]
  )
  const virtualizer = useVirtualizer({
    count: model.rowCount,
    getScrollElement: () => viewport.current,
    estimateSize: (index) =>
      model.row(index).kind === "header" ? HEADER_HEIGHT : LINE_HEIGHT,
    getItemKey,
    overscan: 12,
    useFlushSync: false,
  })
  useEffect(() => {
    if (!follow || line < 1) return
    const index = model.rowOfLine(line)
    const range = virtualizer.range
    if (range && index >= range.startIndex && index <= range.endIndex) return
    virtualizer.scrollToIndex(index, { align: "center" })
  }, [follow, line, model, virtualizer])

  // The list is one tab stop: the keyboard moves the line on show, and focus never sits on
  // a row that scrolling can unmount.
  const rowId = (row: number) => `${id}-line-${row}`
  const items = virtualizer.getVirtualItems()
  const shown = items.some((item) => {
    const row = model.row(item.index)
    return row.kind === "line" && row.line === line
  })
  const seekFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const targets: Partial<Record<string, number>> = {
      ArrowDown: line + 1,
      ArrowUp: line - 1,
      PageDown: line + PAGE_LINES,
      PageUp: line - PAGE_LINES,
      Home: 1,
      End: lines.length,
    }
    const target = targets[event.key]
    if (target === undefined || !lines.length) return
    event.preventDefault()
    const next = Math.min(Math.max(target, 1), lines.length)
    onSeekLine(next)
    virtualizer.scrollToIndex(model.rowOfLine(next), { align: "auto" })
  }

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="G-code">
      <header className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="flex min-w-0 flex-col">
          <span>G-code</span>
        </div>
        <Field orientation="horizontal" className="w-auto gap-2">
          <Switch
            id={`${id}-follow`}
            size="sm"
            checked={follow}
            onCheckedChange={setFollow}
          />
          <FieldLabel htmlFor={`${id}-follow`}>Follow</FieldLabel>
        </Field>
      </header>
      {check.status === "rejected" && (
        <div className="px-3 pb-2">
          <Alert variant="destructive">
            <AlertDescription>{check.error}</AlertDescription>
          </Alert>
        </div>
      )}
      <Separator />
      <div
        ref={viewport}
        className="min-h-0 flex-1 overflow-auto"
        role="listbox"
        aria-label="G-code to run"
        aria-activedescendant={shown ? rowId(line) : undefined}
        tabIndex={0}
        onKeyDown={seekFromKeyboard}
      >
        <div
          className="relative w-max min-w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {/* Sizes the list to its widest line, so rows scroll sideways together. */}
          <div aria-hidden className="invisible flex h-0 gap-2 pr-4 pl-2">
            <LineContent line={lines.length} text={widest} changed={false} />
          </div>
          {items.map((item) => {
            const row = model.row(item.index)
            if (row.kind === "header")
              return (
                <div
                  key={item.key}
                  role="presentation"
                  className="absolute top-0 left-0 w-full"
                  style={{
                    height: item.size,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <HeaderRow header={row.header} />
                </div>
              )
            const text = lines[row.line - 1]
            // Comments stay in the source; the machine receives an empty line.
            const note = prepared
              ? compiled.program.lines[row.line - 1].trim()
              : ""
            const change = model.changes.get(row.line)
            const current = row.line === line
            return (
              <Button
                key={item.key}
                id={rowId(row.line)}
                role="option"
                aria-selected={current}
                tabIndex={-1}
                variant={current ? "secondary" : "ghost"}
                size="sm"
                className="absolute top-0 left-0 w-full justify-start gap-2 px-2"
                style={{
                  height: item.size,
                  transform: `translateY(${item.start}px)`,
                }}
                title={change ? changeText(change) : undefined}
                aria-label={`Line ${row.line}: ${text}${change ? ` (${CHANGE_LABELS[change.reason]})` : ""}`}
                onClick={() => {
                  onSeekLine(row.line)
                  viewport.current?.focus({ preventScroll: true })
                }}
              >
                <LineContent
                  line={row.line}
                  text={text}
                  note={note}
                  changed={!!change}
                />
              </Button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
