import { Wrench } from "lucide-react"
import { cn } from "cn"
import type { Tool } from "@/domain/tools/tool"

/** What the image depends on: a full or partial library tool. */
export type ToolImageSubject = Pick<Tool, "name"> & Partial<Pick<Tool, "image">>

/** Show the tool's product photo when it has one; never infer a tool's shape. */
export function ToolImage({
  tool,
  fallback = false,
  className,
}: {
  tool: ToolImageSubject
  fallback?: boolean
  className?: string
}) {
  if (tool.image)
    return (
      <img
        className={cn(
          "h-48 w-full max-w-40 shrink-0 object-contain",
          className
        )}
        src={tool.image}
        alt={tool.name}
      />
    )
  if (!fallback) return null
  return (
    <div
      className={cn(
        "flex h-8 w-12 shrink-0 items-center justify-center",
        className
      )}
      aria-hidden="true"
    >
      <Wrench size={19} />
    </div>
  )
}
