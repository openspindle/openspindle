import type { ReactNode } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * A label or title that explains itself in a tooltip while the pointer rests on it: forms show
 * their labels, and what a setting means on demand. Without `text`, the label alone. The control
 * it labels can carry the same text as its `aria-description` for assistive technology.
 */
export function Hint({
  text,
  children,
}: {
  text?: string | null
  children: ReactNode
}) {
  if (!text) return children
  return (
    <Tooltip>
      <TooltipTrigger
        delay={300}
        render={
          <span className="cursor-help underline decoration-muted-foreground/40 decoration-dotted underline-offset-4" />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}
