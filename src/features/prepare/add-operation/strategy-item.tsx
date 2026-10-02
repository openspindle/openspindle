import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemHeader,
  ItemTitle,
} from "@/components/ui/item"
import { Unavailable } from "./source-item"

/**
 * A probing strategy to add an operation with, as a button: a picture of how it probes over its
 * name and what it does, else its icon while there is no picture.
 */
export function StrategyItem({
  title,
  description,
  picture,
  icon,
  note = null,
  reason = null,
  onSelect,
}: {
  title: string
  description: string
  /** A picture of how it probes; null while there is none. */
  picture: string | null
  icon: ReactNode
  /** What choosing it changes besides adding, such as a tool it replaces. */
  note?: string | null
  /** Why it is unavailable; null (the default) when it is available. */
  reason?: string | null
  onSelect: () => void
}) {
  return (
    <Unavailable label={title} reason={reason}>
      <Item
        variant="outline"
        render={
          <Button
            variant="ghost"
            className="h-auto w-full whitespace-normal"
            type="button"
            disabled={reason !== null}
          />
        }
        className="h-full content-start items-start text-left"
        onClick={onSelect}
      >
        <ItemHeader>
          <div className="flex aspect-[3/2] w-full items-center justify-center overflow-hidden rounded-sm bg-muted text-muted-foreground [&_svg:not([class*='size-'])]:size-6">
            {picture ? (
              <img src={picture} alt="" className="size-full object-cover" />
            ) : (
              icon
            )}
          </div>
        </ItemHeader>
        <ItemContent>
          <ItemTitle>{title}</ItemTitle>
          <ItemDescription className="line-clamp-3">
            {description}
          </ItemDescription>
          {note !== null && <ItemDescription>{note}</ItemDescription>}
        </ItemContent>
      </Item>
    </Unavailable>
  )
}
