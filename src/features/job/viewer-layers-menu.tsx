import { useId, useState } from "react"
import { Layers3, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import type { ViewerLayers } from "@/components/workspace/viewer/viewer-input"
import type { Operation } from "@/domain/operations/operation"
import type { RemovalGrid } from "@/domain/tools/material-removal"

const LAYERS: readonly [keyof ViewerLayers, string][] = [
  ["past", "Completed paths"],
  ["future", "Upcoming paths"],
  ["cuts", "Cutting paths"],
  ["rapids", "Rapid moves"],
  ["probes", "Probing"],
  ["ahead", "Path ahead highlight"],
  ["tool", "Tool"],
  ["stock", "Stock"],
  ["fixtures", "Fixtures"],
  ["bed", "Machine bed"],
  ["toolSetter", "Tool setter"],
  ["axes", "Axes and origins"],
]

export function ViewerLayersMenu({
  layers,
  change,
  showRemoval,
  setShowRemoval,
  removal,
  operations,
  hidden,
  setVisible,
  setColor,
  editable,
}: {
  layers: ViewerLayers
  change: (key: keyof ViewerLayers, value: boolean) => void
  showRemoval: boolean
  setShowRemoval: (value: boolean) => void
  removal: {
    pending: boolean
    problem: string | null
    grid: RemovalGrid | null
  }
  operations: readonly Operation[]
  hidden: ReadonlySet<string>
  setVisible: (id: string, visible: boolean) => void
  setColor: (id: string, color: string | null) => void
  editable: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  return (
    <div className="absolute top-4 right-4 z-10">
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger
          render={
            <Button
              variant="secondary"
              size="icon"
              aria-label="Viewer layers"
              title="Viewer layers"
            />
          }
        >
          <Layers3 />
        </PopoverTrigger>
        <PopoverContent side="left" align="start" className="w-80">
          <PopoverHeader className="flex-row items-center justify-between">
            <PopoverTitle>Layers</PopoverTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close layers"
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
          </PopoverHeader>
          <ScrollArea
            className="h-[min(70vh,36rem)]"
            viewportClassName="h-full"
          >
            <FieldGroup className="p-1">
              <Field orientation="horizontal">
                <FieldLabel htmlFor={`${id}-removal`}>Show removal</FieldLabel>
                <Switch
                  id={`${id}-removal`}
                  checked={showRemoval}
                  onCheckedChange={setShowRemoval}
                />
              </Field>
              {showRemoval && removal.pending && (
                <FieldDescription>Updating sampled stock…</FieldDescription>
              )}
              {showRemoval && removal.problem && (
                <FieldError>{removal.problem}</FieldError>
              )}
              {showRemoval && removal.grid && (
                <FieldDescription className="font-numeric">
                  {removal.grid.columns} × {removal.grid.rows} ·{" "}
                  {removal.grid.resolution.toFixed(3)} mm
                </FieldDescription>
              )}
              <Separator />
              {LAYERS.map(([key, label]) => (
                <Field orientation="horizontal" key={key}>
                  <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
                  <Switch
                    id={`${id}-${key}`}
                    checked={layers[key]}
                    onCheckedChange={(value) => change(key, value)}
                  />
                </Field>
              ))}
              {operations.length > 0 && <Separator />}
              {operations
                .filter((operation) => !operation.suppressed)
                .map((operation) => (
                  <Field key={operation.id}>
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`${id}-${operation.id}`}
                        checked={!hidden.has(operation.id)}
                        onCheckedChange={(value) =>
                          setVisible(operation.id, value)
                        }
                      />
                      <FieldLabel
                        className="min-w-0 flex-1 truncate"
                        htmlFor={`${id}-${operation.id}`}
                      >
                        {operation.name || "Operation"}
                      </FieldLabel>
                      <Input
                        type="color"
                        className="h-7 w-9 p-0"
                        aria-label={`${operation.name} path colour`}
                        disabled={!editable}
                        value={operation.displayColor ?? "#2563eb"}
                        onChange={(event) =>
                          setColor(operation.id, event.target.value)
                        }
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!editable || !operation.displayColor}
                        onClick={() => setColor(operation.id, null)}
                      >
                        Auto
                      </Button>
                    </div>
                  </Field>
                ))}
            </FieldGroup>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  )
}
