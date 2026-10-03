import { useState } from "react"
import { Check, Plus } from "lucide-react"
import { useForm } from "@tanstack/react-form"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item"
import { OptionSelect } from "@/components/option-select"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { newId } from "@/domain/primitives"
import type { WorkspaceCommand } from "@/domain/workspace/workspace"
import { AppDialog } from "@/features/shell/app-dialog"
import { STOCK_MATERIALS, StockSchema } from "@/domain/stock/stock"
import type { Stock } from "@/domain/stock/stock"
import { StockSwatch } from "./stock-swatch"

const MATERIAL_OPTIONS = STOCK_MATERIALS.map((material) => ({
  value: material,
  label: material,
}))

const CustomStockSchema = StockSchema.pick({
  name: true,
  material: true,
}).extend({
  name: StockSchema.shape.name.max(45, "Use at most 45 characters."),
})

const dimensions = (stock: Stock) =>
  [stock.width, stock.depth, stock.height]
    .map((value) =>
      value.toLocaleString("en-US", {
        useGrouping: false,
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      })
    )
    .join(" × ")

/** Adds a stock to the library; it starts at a common size, edited on the plate. */
function CustomStockForm({ onAdd }: { onAdd: (stock: Stock) => void }) {
  const form = useForm({
    defaultValues: { name: "", material: "Wood" },
    validators: { onSubmit: CustomStockSchema },
    onSubmit: ({ value, formApi }) => {
      onAdd({
        id: newId(),
        name: value.name.trim(),
        material: value.material,
        width: 100,
        depth: 80,
        height: 8,
        color: "#cbaa73",
      })
      formApi.reset()
    },
  })
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <FieldSet>
        <FieldLegend>Add custom stock</FieldLegend>
        <FieldGroup className="grid grid-cols-1 sm:grid-cols-2">
          <form.Field name="name">
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor="stock-name">Name</FieldLabel>
                <Input
                  id="stock-name"
                  maxLength={45}
                  placeholder="e.g. Walnut offcut"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
          <form.Field name="material">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="stock-material">Material</FieldLabel>
                <OptionSelect
                  id="stock-material"
                  className="w-full"
                  options={MATERIAL_OPTIONS}
                  value={field.state.value}
                  onValueChange={(value) => {
                    if (value) field.handleChange(value)
                  }}
                />
              </Field>
            )}
          </form.Field>
        </FieldGroup>
        <Button variant="outline" type="submit">
          <Plus />
          Add stock
        </Button>
      </FieldSet>
    </form>
  )
}

/**
 * Chooses the plate's stock from the library: a stock is selected here, and Use selected stock
 * assigns it to the plate and makes it the default for new plates. Where the plate has stock,
 * Replace stock does so, and Apply material gives the plate's stock the selected one's name,
 * material and colour, keeping its size.
 */
export function StockDialog({
  plateId,
  onClose,
}: {
  plateId: string
  onClose: () => void
}) {
  const workspace = useWorkspaceStore()
  const stocks = useWorkspace((state) => state.stocks)
  const current = useWorkspace(
    (state) => state.plates.find((plate) => plate.id === plateId)?.setup.stock
  )
  const [chosenId, setChosenId] = useState(current?.id)
  const chosen = stocks.find((stock) => stock.id === chosenId)
  const use = () => {
    if (!chosen) return
    const commands: WorkspaceCommand[] = [
      { type: "library.stocks", stocks, defaultStockId: chosen.id },
    ]
    // The plate keeps its own copy, sized on the plate, while its stock stays the same.
    if (chosen.id !== current?.id)
      commands.push({
        type: "plate.setup",
        plateId,
        patch: { stock: { ...chosen }, stockSource: "assigned" },
      })
    // Both apply or neither does; a refusal keeps the dialog open and says why.
    const result = workspace.dispatch({ type: "batch", commands })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    onClose()
  }
  // The plate's own stock, made of the chosen one's material: its size stays.
  const material = chosen &&
    current && {
      ...current,
      name: chosen.name,
      material: chosen.material,
      color: chosen.color,
    }
  const applyMaterial = () => {
    if (!material) return
    const result = workspace.dispatch({
      type: "plate.setup",
      plateId,
      patch: { stock: material, stockSource: "assigned" },
    })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    onClose()
  }
  const sameMaterial =
    !!chosen &&
    chosen.name === current?.name &&
    chosen.material === current.material &&
    chosen.color === current.color
  return (
    <AppDialog
      title="Stock"
      onClose={onClose}
      footer={
        current ? (
          <>
            <Button
              variant="outline"
              disabled={!chosen || sameMaterial}
              onClick={applyMaterial}
            >
              Apply material
            </Button>
            <Button disabled={!chosen} onClick={use}>
              Replace stock
            </Button>
          </>
        ) : (
          <Button disabled={!chosen} onClick={use}>
            Use selected stock
          </Button>
        )
      }
    >
      <FieldGroup>
        <div
          className="flex flex-col gap-1"
          role="list"
          aria-label="Stock library"
        >
          {stocks.map((stock) => {
            const selected = stock.id === chosenId
            return (
              <Item
                key={stock.id}
                variant={selected ? "muted" : "default"}
                render={
                  <Button
                    variant="ghost"
                    className="h-auto whitespace-normal"
                    type="button"
                  />
                }
                className="text-left"
                aria-pressed={selected}
                onClick={() => setChosenId(stock.id)}
              >
                <StockSwatch color={stock.color} size="md" />
                <ItemContent>
                  <ItemTitle>{stock.name}</ItemTitle>
                  <ItemDescription>
                    {stock.material} ·{" "}
                    <span className="font-numeric">{dimensions(stock)}</span> mm
                  </ItemDescription>
                </ItemContent>
                {selected && <Check />}
              </Item>
            )
          })}
        </div>
        <CustomStockForm
          onAdd={(stock) => {
            workspace.dispatch({
              type: "library.stocks",
              stocks: [...stocks, stock],
            })
            setChosenId(stock.id)
          }}
        />
      </FieldGroup>
    </AppDialog>
  )
}
