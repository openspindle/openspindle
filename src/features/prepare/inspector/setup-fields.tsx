import { useId } from "react"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import { ASSIST_KEYS, ASSIST_LABELS } from "@/machine/contract"
import type { AssistMode } from "@/machine/contract"
import type { PlateSetup } from "@/domain/plate/plate"
import { COORDINATE_LIMIT } from "@/domain/primitives"
import type { Point3 } from "@/domain/primitives"
import {
  AnchorPlacementFields,
  RelativePointFields,
} from "./anchor-placement-fields"

type SetupFieldsProps = {
  setup: PlateSetup
  disabled?: boolean
  onChange: (patch: Partial<PlateSetup>) => void
}

const ASSIST_MODE_OPTIONS: ReadonlyArray<{ value: AssistMode; label: string }> =
  [
    { value: "device", label: "Device setting" },
    { value: "on", label: "On" },
    { value: "off", label: "Off" },
  ]

const STOCK_ORIGINS = {
  "": "Set from stock…",
  "front-left-top": "Front-left · top",
  "front-right-top": "Front-right · top",
  "back-left-top": "Back-left · top",
  "back-right-top": "Back-right · top",
  "center-top": "Center · top",
  "front-left-bottom": "Front-left · bottom",
  "center-bottom": "Center · bottom",
}
type StockOrigin = Exclude<keyof typeof STOCK_ORIGINS, "">

const isPoint = (value: readonly number[]): value is Point3 =>
  value.length === 3 &&
  value.every(
    (coordinate) =>
      Number.isFinite(coordinate) && Math.abs(coordinate) <= COORDINATE_LIMIT
  )

/** Where the stock sits on the bed, by its anchor, like each fixture. */
export function StockPlacementFields({
  setup,
  disabled,
  onChange,
}: SetupFieldsProps) {
  return (
    <AnchorPlacementFields
      name="Stock"
      value={setup.stockAnchor}
      relativeTo={setup.stockRelativeTo}
      anchorSetup={setup.anchors}
      disabled={disabled}
      onChange={(stockAnchor) => onChange({ stockAnchor })}
      onRelativeToChange={(stockRelativeTo) => onChange({ stockRelativeTo })}
    />
  )
}

function stockOrigins(setup: PlateSetup): Partial<Record<StockOrigin, Point3>> {
  if (!setup.stock) return {}
  const [x, y, z] = setup.stockAnchor
  const { width, depth, height } = setup.stock
  return {
    "front-left-top": [x, y, z + height],
    "front-right-top": [x + width, y, z + height],
    "back-left-top": [x, y + depth, z + height],
    "back-right-top": [x + width, y + depth, z + height],
    "center-top": [x + width / 2, y + depth / 2, z + height],
    "front-left-bottom": [x, y, z],
    "center-bottom": [x + width / 2, y + depth / 2, z],
  }
}

/**
 * The plate's single work origin: every operation machines from this NC zero. Its X and Y are
 * bed coordinates, or offsets from a stored anchor it is kept relative to.
 */
export function WorkOriginFields({
  setup,
  disabled,
  zLock,
  onChange,
}: SetupFieldsProps & {
  /** Why the work origin's Z is fixed; absent while it can be edited. */
  zLock?: string
}) {
  const id = useId()
  const origins = stockOrigins(setup)
  const originOf = (value: string) =>
    Object.hasOwn(origins, value) ? origins[value as StockOrigin] : undefined
  const originOptions = Object.entries(STOCK_ORIGINS).map(([value, label]) => {
    const origin = value ? originOf(value) : undefined
    return {
      value,
      label,
      disabled:
        value !== "" &&
        (!(origin && isPoint(origin)) ||
          (zLock !== undefined && value.endsWith("-bottom"))),
    }
  })
  return (
    <FieldSet aria-label="Work origin">
      <FieldLegend className="flex w-full items-baseline justify-between">
        <span>Work origin</span>
        <span title="The plate's NC zero. Set the physical work zero on Device, or keep X and Y relative to an anchor: Run then sets them.">
          NC zero
        </span>
      </FieldLegend>
      <RelativePointFields
        label="Work origin"
        value={setup.workOrigin}
        relativeTo={setup.workOriginAnchor}
        anchorSetup={setup.anchors}
        disabled={disabled}
        zLock={zLock}
        onChange={(workOrigin) => onChange({ workOrigin })}
        onRelativeToChange={(workOriginAnchor) =>
          onChange({ workOriginAnchor })
        }
      />
      <Field data-disabled={disabled || !setup.stock}>
        <FieldLabel className="sr-only" htmlFor={`${id}-origin`}>
          Set work origin from stock
        </FieldLabel>
        <OptionSelect
          id={`${id}-origin`}
          className="w-full"
          aria-label="Set work origin from stock"
          options={originOptions}
          value=""
          disabled={disabled || !setup.stock}
          onValueChange={(value) => {
            const workOrigin = value ? originOf(value) : undefined
            if (workOrigin && isPoint(workOrigin)) onChange({ workOrigin })
          }}
        />
      </Field>
    </FieldSet>
  )
}

/** Vacuum, air, bed cleaning and anti-static for the whole plate's run. */
export function AssistFields({ setup, disabled, onChange }: SetupFieldsProps) {
  const id = useId()
  return (
    <FieldSet aria-label="Plate assists">
      <FieldLegend className="flex w-full items-baseline justify-between">
        <span>Assists</span>
      </FieldLegend>
      <FieldGroup className="gap-3">
        {ASSIST_KEYS.map((key) => (
          <Field
            orientation="horizontal"
            className="grid grid-cols-2 items-center gap-3"
            key={key}
            data-disabled={disabled}
          >
            <FieldLabel htmlFor={`${id}-${key}`}>
              {ASSIST_LABELS[key]}
            </FieldLabel>
            <OptionSelect
              id={`${id}-${key}`}
              className="w-full min-w-0"
              aria-label={`${ASSIST_LABELS[key]} assist`}
              options={ASSIST_MODE_OPTIONS}
              value={setup.assists[key]}
              disabled={disabled}
              onValueChange={(value) =>
                onChange({ assists: { ...setup.assists, [key]: value } })
              }
            />
          </Field>
        ))}
      </FieldGroup>
      {setup.assists.vacuum === "on" && (
        <FieldDescription>
          Vacuum uses the spindle-linked output.
        </FieldDescription>
      )}
      {setup.assists.bedClean === "on" && (
        <FieldDescription>
          Bed clean moves XY at the program’s final Z.
        </FieldDescription>
      )}
    </FieldSet>
  )
}
