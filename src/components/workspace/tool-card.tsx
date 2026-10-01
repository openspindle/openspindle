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
import { useToolThumbnail } from "@/app/tools/tool-picture-cache"
import type { ToolPictureSource } from "@/app/tools/tool-picture-cache"
import { isProbe } from "@/domain/tools/tool"
import { formatToolNumber } from "@/domain/tools/format"
import type { Tool } from "@/domain/tools/tool"
import { ToolImage } from "./tool-image"
import type { ToolImageSubject } from "./tool-image"

/** A tool as its card shows it, with an optional cached picture. */
type CardTool = ToolImageSubject &
  ToolPictureSource &
  Pick<Tool, "id" | "kind" | "name" | "diameter" | "flutes"> & {
    readonly picture?: string | null
  }

export type ToolCardProps = {
  /** Any tool with an identity and a size, including partial records. */
  tool?: CardTool | null
  id?: string
  onClick?: () => void
  disabled?: boolean
  emptyLabel?: string
  className?: string
  slotLabel?: string
  /** What the card says under the name; by default the tool's size, or that it is a probe. */
  details?: string
  selected?: boolean
  "aria-label"?: string
}

/**
 * The tool's thumbnail as the tool library draws it (`useToolThumbnail`), else its photo, else
 * a placeholder. The card draws nothing itself, so cards share one cached drawing.
 */
function CardPicture({ tool }: { tool: CardTool }) {
  const picture = useToolThumbnail(tool)
  if (!picture) return <ToolImage tool={tool} fallback className="h-10 w-6" />
  return (
    <img
      className="h-10 w-6 shrink-0 object-contain"
      src={picture}
      alt=""
      draggable={false}
    />
  )
}

export function ToolCard({
  tool,
  id,
  onClick,
  disabled = false,
  emptyLabel = "Choose tool",
  className,
  slotLabel,
  details: shownDetails,
  selected,
  "aria-label": ariaLabel,
}: ToolCardProps) {
  const name = tool?.name ?? emptyLabel
  // The slot badge is inside the button, but an aria-label replaces its content.
  const label = slotLabel ? `${slotLabel}: ${name}` : name
  let details = "Open the tool library"
  if (shownDetails !== undefined) details = shownDetails
  else if (tool && isProbe(tool)) details = "Touch probe"
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
      <ItemMedia className="h-10 w-6" variant="icon">
        {tool ? <CardPicture tool={tool} /> : <Wrench aria-hidden="true" />}
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
