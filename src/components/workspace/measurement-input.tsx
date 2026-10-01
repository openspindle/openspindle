import type { ComponentProps } from "react"
import { useState } from "react"
import { cn } from "cn"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { toMicrometre } from "@/domain/primitives"
import type { Axis } from "@/machine/contract"
import { AXIS_COLORS } from "./axis-label"

export type MeasurementAxis = Axis
export const DIMENSION_AXES = {
  width: "X",
  depth: "Y",
  height: "Z",
} as const

/**
 * Millimetres and degrees show three decimals, a micrometre or a thousandth of a
 * degree: finer digits are float noise.
 */
const roundedUnit = (unit: string | undefined) => unit === "mm" || unit === "°"

const threeDecimalFormat = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})

function roundedText(value: ComponentProps<"input">["value"]) {
  if (typeof value !== "number" && typeof value !== "string") return value
  if (!String(value).trim()) return value
  const number = Number(value)
  if (!Number.isFinite(number)) return value
  return threeDecimalFormat.format(number)
}

/** What a rounded field starts editing from: its value to three decimals. */
function editedText(value: ComponentProps<"input">["value"]) {
  const number = Number(value)
  if (!String(value).trim() || !Number.isFinite(number)) return String(value)
  return String(toMicrometre(number))
}

export function MeasurementInput({
  axis,
  unit,
  className,
  type,
  value,
  defaultValue,
  onChange,
  onFocus,
  onBlur,
  ...inputProps
}: ComponentProps<"input"> & { axis?: MeasurementAxis; unit?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const rounded = roundedUnit(unit)
  // Controlled number fields keep the typed text while focused, so parents can ignore
  // out-of-range intermediate keystrokes (typing "12" with a minimum of 2 starts with "1").
  const localDraft = type === "number" && value !== undefined
  let displayValue = value
  if (rounded && !editing) displayValue = roundedText(value)
  if (localDraft && editing) displayValue = draft
  return (
    <InputGroup
      className="min-w-0"
      data-disabled={inputProps.disabled || undefined}
    >
      <InputGroupInput
        {...inputProps}
        type={type}
        value={displayValue}
        defaultValue={rounded ? roundedText(defaultValue) : defaultValue}
        onFocus={(event) => {
          if (rounded || localDraft) {
            const current = value ?? event.currentTarget.value
            setDraft(rounded ? editedText(current) : String(current))
            setEditing(true)
          }
          onFocus?.(event)
        }}
        onChange={(event) => {
          if (localDraft) setDraft(event.target.value)
          onChange?.(event)
        }}
        onBlur={(event) => {
          onBlur?.(event)
          setEditing(false)
          if (rounded && value === undefined) {
            event.currentTarget.value = String(
              roundedText(event.currentTarget.value)
            )
          }
        }}
        className={cn(
          "[appearance:textfield] text-right font-numeric [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          className
        )}
      />
      {axis && (
        <InputGroupAddon align="inline-start" aria-hidden="true">
          <InputGroupText className={AXIS_COLORS[axis]}>{axis}</InputGroupText>
        </InputGroupAddon>
      )}
      {unit && (
        <InputGroupAddon align="inline-end" aria-hidden="true">
          <InputGroupText>{unit}</InputGroupText>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}
