import { Check, Wrench } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { isProbe } from "@/domain/tools/tool-table"
import { formatToolNumber } from "@/domain/tools/format"
import type { Tool } from "@/domain/tools/tool"
import type { ToolImageSubject } from "./tool-image"
import { CARD, ToolThumbnail } from "./tool-picture"
import type { ToolPictureSource } from "./tool-picture"

export type ToolCardProps = {
  /** Any tool with an identity, a size and dimensions, including plugin tool DTOs. */
  tool?:
    | (ToolImageSubject &
        ToolPictureSource &
        Pick<Tool, "id" | "kind" | "name" | "diameter" | "flutes">)
    | null
  id?: string
  onClick?: () => void
  disabled?: boolean
  emptyLabel?: string
  className?: string
  slotLabel?: string
  selected?: boolean
  "aria-label"?: string
}

export function ToolCard({
  tool,
  id,
  onClick,
  disabled = false,
  emptyLabel = "Choose tool",
  className,
  slotLabel,
  selected,
  "aria-label": ariaLabel,
}: ToolCardProps) {
  const name = tool?.name ?? emptyLabel
  // The slot badge is inside the button, but an aria-label replaces its content.
  const label = slotLabel ? `${slotLabel}: ${name}` : name
  let details = "Open the tool library"
  if (tool && isProbe(tool)) details = "Touch probe"
  else if (tool)
    details = `Ø ${formatToolNumber(tool.diameter, "millimeters")} mm · ${formatToolNumber(tool.flutes)} flutes`

  return (
    <Item
      id={id}
      variant="outline"
      size="sm"
      data-disabled={disabled || undefined}
      data-selected={selected || undefined}
      className={cn("min-w-0", className)}
      render={
        onClick ? (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            aria-label={ariaLabel ?? label}
            aria-pressed={selected}
            className="h-auto whitespace-normal"
            onClick={(event) => {
              event.stopPropagation()
              onClick()
            }}
          />
        ) : undefined
      }
    >
      <ItemMedia className={CARD.className} variant="icon">
        {tool ? (
          <ToolThumbnail tool={tool} size={CARD} fallback />
        ) : (
          <Wrench aria-hidden="true" />
        )}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="max-w-full truncate" title={name}>
          {name}
        </ItemTitle>
        <ItemDescription className="truncate font-numeric">
          {details}
        </ItemDescription>
      </ItemContent>
      {(slotLabel || selected) && (
        <ItemActions className="self-start">
          {slotLabel && <Badge className="font-numeric">{slotLabel}</Badge>}
          {selected && <Check aria-label="Selected tool" />}
        </ItemActions>
      )}
    </Item>
  )
}
