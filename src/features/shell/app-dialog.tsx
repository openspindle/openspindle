import { createContext, useContext, useId } from "react"
import type { ReactNode } from "react"
import { cn } from "cn"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"

const WIDTHS = { default: "sm:max-w-xl", wide: "sm:max-w-3xl" } as const

export const GuidePanelContext = createContext(false)

/**
 * A workspace dialog: a title, a scrolling body and optional footer actions. A toolbar, such as
 * a search field, stays above the body as it scrolls.
 */
export function AppDialog({
  title,
  description,
  width = "default",
  onClose,
  toolbar,
  footer,
  children,
}: {
  title: string
  description?: ReactNode
  width?: keyof typeof WIDTHS
  onClose: () => void
  toolbar?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  const panel = useContext(GuidePanelContext)
  const titleId = useId()
  if (panel)
    return (
      <Card
        role="complementary"
        aria-labelledby={titleId}
        className="h-full min-h-0 rounded-none"
      >
        <CardHeader className="shrink-0">
          <CardTitle id={titleId}>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
          <CardAction>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Close ${title}`}
              onClick={onClose}
            >
              <X />
            </Button>
          </CardAction>
        </CardHeader>
        {toolbar && <div className="shrink-0 px-4">{toolbar}</div>}
        <ScrollArea
          className="min-h-0 min-w-0 flex-1"
          viewportClassName="h-full overflow-x-hidden"
        >
          <CardContent className="min-w-0 p-px px-4">{children}</CardContent>
        </ScrollArea>
        {footer && (
          <CardFooter className="shrink-0 flex-wrap gap-2">{footer}</CardFooter>
        )}
      </Card>
    )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className={cn("flex max-h-[85vh] flex-col", WIDTHS[width])}
      >
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {toolbar && <div className="shrink-0 pr-3">{toolbar}</div>}
        <ScrollArea
          className="min-h-0 min-w-0 flex-1"
          viewportClassName="max-h-[calc(85vh-5rem)] overflow-x-hidden"
        >
          {/* The padding leaves room for rings at the edges, such as cards', which the viewport clips. */}
          <div className="min-w-0 p-px pr-3">{children}</div>
        </ScrollArea>
        {footer && <DialogFooter className="shrink-0">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}
