import { useEffect, useRef, useState } from "react"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"

const HEX = /^#[\da-f]{6}$/i

/**
 * A colour (`#rrggbb`), chosen from the system's colour picker by its swatch or typed as hex.
 * It changes once the picker closes, or once the typed colour is committed (Enter, or leaving
 * the field); a typed colour that is not one goes back to the colour it was.
 */
export function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (color: string) => void
}) {
  const [typed, setTyped] = useState<string | null>(null)
  const [picking, setPicking] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const change = useRef(onChange)
  useEffect(() => {
    change.current = onChange
  }, [onChange])
  // The picker's input event fires as the colour is dragged; its change event once it is chosen.
  useEffect(() => {
    const input = picker.current
    if (!input) return
    const chosen = () => {
      setPicking(null)
      change.current(input.value.toLowerCase())
    }
    input.addEventListener("change", chosen)
    return () => input.removeEventListener("change", chosen)
  }, [])
  const commit = () => {
    if (typed !== null && HEX.test(typed.trim()))
      onChange(typed.trim().toLowerCase())
    setTyped(null)
  }
  const shown = picking ?? value
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupAddon>
          <label
            className="size-5 cursor-pointer rounded-sm ring-1 ring-foreground/15"
            // The colour is data (the user's own), not theme styling.
            style={{ background: shown }}
          >
            <input
              ref={picker}
              type="color"
              className="sr-only"
              aria-label={`Pick ${label.toLowerCase()}`}
              value={shown}
              onChange={(event) => setPicking(event.target.value)}
            />
          </label>
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          className="font-numeric"
          value={typed ?? shown}
          spellCheck={false}
          onChange={(event) => setTyped(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit()
            if (event.key === "Escape") setTyped(null)
          }}
        />
      </InputGroup>
    </Field>
  )
}
