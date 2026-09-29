import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { selectedPlate, useWorkspace } from "@/app/workspace/workspace-context"
import { combineRefusal } from "@/domain/compile/nc-unit"
import { DEFAULT_KIT, kitForPlate } from "@/domain/fixtures/catalog"
import { NC_GLOSSARY_GROUPS } from "@/domain/nc/glossary"
import type { NcGlossaryEntry, NcGlossaryGroup } from "@/domain/nc/glossary"
import { AppDialog } from "@/features/shell/app-dialog"

/** An entry with why combining operations refuses its example; null when it combines. */
type GlossaryRow = NcGlossaryEntry & { readonly refusal: string | null }

const GROUPS = Object.keys(NC_GLOSSARY_GROUPS) as NcGlossaryGroup[]

/** Whether an entry matches every word of a search, in its code, name, words or description. */
function matches(entry: NcGlossaryEntry, query: string) {
  const text =
    `${entry.code} ${entry.name} ${entry.words} ${entry.description}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((term) => text.includes(term))
}

/** A badge that explains itself on hover. */
function ExplainedBadge({
  variant,
  label,
  reason,
}: {
  variant: "secondary" | "outline"
  label: string
  reason: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={200}
        render={<Badge variant={variant} tabIndex={0} />}
      >
        {label}
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-72">
        {reason}
      </TooltipContent>
    </Tooltip>
  )
}

function MachineBadge({
  entry,
  machine,
}: {
  entry: GlossaryRow
  machine: string
}) {
  if (entry.machine === "runs") return null
  if (entry.machine === "ignored")
    return (
      <ExplainedBadge
        variant="outline"
        label="Ignored"
        reason={`The ${machine} accepts it and does nothing with it.`}
      />
    )
  return (
    <ExplainedBadge
      variant="outline"
      label="Unsupported"
      reason={`The ${machine} does not run it.`}
    />
  )
}

function GlossaryItem({
  entry,
  machine,
}: {
  entry: GlossaryRow
  machine: string
}) {
  return (
    <Item variant="outline" size="xs" role="listitem">
      <ItemContent>
        <ItemTitle>
          <code className="font-mono">{entry.code}</code>
          <span>{entry.name}</span>
        </ItemTitle>
        <ItemDescription className="line-clamp-none">
          {entry.description}
        </ItemDescription>
        <ItemDescription>
          {entry.words && (
            <>
              Words <code className="font-mono">{entry.words}</code> ·{" "}
            </>
          )}
          Example <code className="font-mono">{entry.example}</code>
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <MachineBadge entry={entry} machine={machine} />
        {entry.refusal === null ? (
          <ExplainedBadge
            variant="secondary"
            label="Combines"
            reason="Operations that use it combine into one program."
          />
        ) : (
          <ExplainedBadge
            variant="outline"
            label="Not combined"
            reason={entry.refusal}
          />
        )}
      </ItemActions>
    </Item>
  )
}

/**
 * The codes of the machine's NC: what each does, whether the machine runs it, and whether
 * operations that use it combine, as combining reads the example.
 */
export function GCodeGlossaryDialog({ onClose }: { onClose: () => void }) {
  const plate = useWorkspace(selectedPlate)
  const kit = plate ? kitForPlate(plate) : DEFAULT_KIT
  const [query, setQuery] = useState("")
  const rows = useMemo(
    () =>
      kit.glossary.map((entry): GlossaryRow => ({
        ...entry,
        refusal: combineRefusal(entry.example, (words, state) =>
          kit.readNcBlock(words, state)
        ),
      })),
    [kit]
  )
  const shown = rows.filter((row) => matches(row, query.trim()))
  return (
    <AppDialog
      title="G-code glossary"
      description={kit.name}
      width="wide"
      onClose={onClose}
      toolbar={
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search codes"
            placeholder="Search codes, names and descriptions"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
      }
    >
      {shown.length ? (
        <div className="flex flex-col gap-4">
          {GROUPS.map((group) => {
            const entries = shown.filter((row) => row.group === group)
            if (!entries.length) return null
            return (
              <section
                key={group}
                aria-label={NC_GLOSSARY_GROUPS[group]}
                className="flex flex-col gap-2"
              >
                <h3 className="text-muted-foreground">
                  {NC_GLOSSARY_GROUPS[group]}
                </h3>
                <ItemGroup className="gap-2">
                  {entries.map((entry) => (
                    <GlossaryItem
                      key={entry.code}
                      entry={entry}
                      machine={kit.name}
                    />
                  ))}
                </ItemGroup>
              </section>
            )
          })}
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No codes match</EmptyTitle>
            <EmptyDescription>
              Search by a code, such as G18, or by what it does.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </AppDialog>
  )
}
