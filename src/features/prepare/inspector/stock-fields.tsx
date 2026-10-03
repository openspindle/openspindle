import { Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ColorField } from "@/components/color-field"
import { OptionSelect } from "@/components/option-select"
import { BoundedMeasurementInput } from "@/components/workspace/coordinate-input"
import { DIMENSION_AXES } from "@/components/workspace/measurement-input"
import { kitForSetup } from "@/domain/fixtures/catalog"
import type { PlateSetup } from "@/domain/plate/plate"
import { STOCK_MATERIALS, UNSPECIFIED_STOCK_NAME } from "@/domain/stock/stock"
import type { Stock } from "@/domain/stock/stock"
import { openDialog } from "@/features/shell/dialogs"
import { StockSwatch } from "../stock/stock-swatch"

/** The stock's size, each at most the machine's work area along its axis. */
const DIMENSIONS = [
  { key: "width", label: "Width", axis: 0 },
  { key: "depth", label: "Depth", axis: 1 },
  { key: "height", label: "Height", axis: 2 },
] as const

/** A colour as the colour picker takes it: #rrggbb, a three-digit colour spelt out. */
const fullHex = (color: string) =>
  /^#[\da-f]{3}$/i.test(color)
    ? `#${[...color.slice(1)].map((digit) => digit + digit).join("")}`
    : color

/**
 * The stock's material and colour, from its swatch: its block stays as it is. A stock still
 * called for its unknown material takes the material's name.
 */
function StockMaterial({
  stock,
  disabled,
  onChange,
}: {
  stock: Stock
  disabled?: boolean
  onChange: (stock: Stock) => void
}) {
  const known = STOCK_MATERIALS.some((material) => material === stock.material)
  const options = [
    ...(known ? [] : [{ value: stock.material, label: stock.material }]),
    ...STOCK_MATERIALS.map((material) => ({
      value: material,
      label: material,
    })),
  ]
  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            className="flex shrink-0 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            aria-label="Stock material and colour"
            title="Material and colour"
          />
        }
      >
        <StockSwatch color={stock.color} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="stock-swatch-material">Material</FieldLabel>
            <OptionSelect
              id="stock-swatch-material"
              aria-label="Stock material"
              options={options}
              value={stock.material}
              onValueChange={(material) =>
                onChange({
                  ...stock,
                  material,
                  name:
                    stock.name === UNSPECIFIED_STOCK_NAME
                      ? material
                      : stock.name,
                })
              }
              className="w-full"
            />
          </Field>
          <ColorField
            id="stock-swatch-color"
            label="Colour"
            value={fullHex(stock.color)}
            onChange={(color) => onChange({ ...stock, color })}
          />
        </FieldGroup>
      </PopoverContent>
    </Popover>
  )
}

/** The plate's stock: which material block, and its size. */
export function StockFields({
  plateId,
  setup,
  disabled,
  onChange,
}: {
  plateId: string
  setup: PlateSetup
  disabled?: boolean
  onChange: (patch: Partial<PlateSetup>) => void
}) {
  const stock = setup.stock
  const { workArea } = kitForSetup(setup)
  return (
    <FieldSet aria-label="Stock">
      <FieldLegend className="w-full">
        <div className="flex items-center gap-3">
          {stock ? (
            <StockMaterial
              stock={stock}
              disabled={disabled}
              onChange={(next) =>
                onChange({ stock: next, stockSource: "assigned" })
              }
            />
          ) : (
            <StockSwatch />
          )}
          <span className="min-w-0 flex-1 truncate">
            {stock?.name ?? "No stock"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Choose stock"
            title="Choose stock"
            disabled={disabled}
            onClick={() => openDialog({ kind: "stock", plateId })}
          >
            <Pencil />
          </Button>
          {stock && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove stock"
              title="Remove stock"
              disabled={disabled}
              onClick={() =>
                onChange({ stock: null, stockSource: "unspecified" })
              }
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </FieldLegend>
      {stock && (
        <FieldGroup>
          {DIMENSIONS.map(({ key, label, axis }) => (
            <Field key={key} orientation="horizontal">
              <FieldLabel htmlFor={`stock-${key}`} className="w-20 shrink-0">
                {label}
              </FieldLabel>
              <BoundedMeasurementInput
                id={`stock-${key}`}
                axis={DIMENSION_AXES[key]}
                unit="mm"
                label={`Stock ${key}`}
                min={0.01}
                max={workArea[axis]}
                disabled={disabled}
                value={stock[key]}
                onCommit={(value) =>
                  onChange({
                    stock: { ...stock, [key]: value },
                    stockSource: "assigned",
                  })
                }
              />
            </Field>
          ))}
        </FieldGroup>
      )}
    </FieldSet>
  )
}
