import { useId } from "react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * A choice in a list that is unavailable, with why: disabled controls receive no pointer or
 * focus events, so the reason shows from a focusable wrapper. Without a reason, the choice alone.
 */
export function Unavailable({
  label,
  reason,
  children,
}: {
  /** The choice's name, as assistive technology announces it unavailable. */
  label: string
  reason: string | null
  children: ReactNode
}) {
  const id = useId()
  if (reason === null) return children
  return (
    <Tooltip>
      <TooltipTrigger
        delay={200}
        closeOnClick={false}
        render={
          <div
            role="group"
            aria-label={`${label} unavailable`}
            aria-describedby={id}
            tabIndex={0}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent id={id} side="bottom" sideOffset={8}>
        {reason}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * A source to add an operation from, or a step towards one, as a list item that is a button.
 * Without `onSelect`, it only shows, such as the step already taken.
 */
export function SourceItem({
  icon,
  title,
  description,
  note = null,
  reason = null,
  onSelect,
}: {
  icon: ReactNode
  title: string
  description: string
  /** What choosing it changes besides adding, such as a tool it replaces, under the description. */
  note?: string | null
  /** Why it is unavailable; null (the default) when it is available. */
  reason?: string | null
  onSelect?: () => void
}) {
  return (
    <Unavailable label={title} reason={reason}>
      <Item
        variant={onSelect ? "default" : "outline"}
        render={
          onSelect ? (
            <Button
              variant="ghost"
              className="h-auto whitespace-normal"
              type="button"
              disabled={reason !== null}
            />
          ) : undefined
        }
        className="text-left"
        onClick={onSelect}
      >
        <ItemMedia variant="icon">{icon}</ItemMedia>
        <ItemContent>
          <ItemTitle>{title}</ItemTitle>
          <ItemDescription>{description}</ItemDescription>
          {note !== null && <ItemDescription>{note}</ItemDescription>}
        </ItemContent>
      </Item>
    </Unavailable>
  )
}
