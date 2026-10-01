import type { ComponentProps } from "react"
import { cn } from "cn"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export interface Option<T extends string | number> {
  value: T
  label: string
  /** Shown but not selectable, such as a stock origin the current stock cannot reach. */
  disabled?: boolean
  /** Why a disabled option is not selectable, shown while the pointer rests on it. */
  reason?: string
}

type OptionSelectProps<T extends string | number> = Omit<
  ComponentProps<typeof SelectTrigger>,
  "children"
> & {
  options: readonly Option<T>[]
  value: T
  onValueChange: (value: T) => void
  disabled?: boolean
  /** The labels are values, such as sizes, set in the numeric face. */
  numeric?: boolean
}

/** A shadcn Select over a fixed list of labelled options. */
export function OptionSelect<T extends string | number>({
  options,
  value,
  onValueChange,
  disabled,
  numeric,
  className,
  ...triggerProps
}: OptionSelectProps<T>) {
  return (
    <Select
      items={options}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next)
      }}
    >
      <SelectTrigger
        {...triggerProps}
        className={cn(numeric && "font-numeric", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className={cn(numeric && "font-numeric")}>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              title={option.reason}
              // A disabled option takes no pointer events, which its reason needs to show.
              className={cn(
                option.reason && "data-disabled:pointer-events-auto"
              )}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
