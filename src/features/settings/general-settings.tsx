import { useAppearance } from "@/components/appearance-provider"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { OptionSelect } from "@/components/option-select"
import { Hint } from "@/components/workspace/hint"
import { isAppearance } from "@/lib/appearance"
import { FONTS, FONT_CHOICES, isFontFor } from "@/lib/fonts"
import type { FontRole } from "@/lib/fonts"
import { useSimulatorStatus, useUpdateSimulator } from "@/platform/simulator"

const APPEARANCE_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]

const APPEARANCE_HINT = "System follows your Mac’s light or dark appearance."

const FONT_FIELDS: ReadonlyArray<{
  role: FontRole
  id: string
  label: string
  hint: string
}> = [
  {
    role: "sans",
    id: "display-font",
    label: "Display font",
    hint: "The font for text.",
  },
  {
    role: "mono",
    id: "mono-font",
    label: "Mono font",
    hint: "The font for G-code, and for the digits of numbers shown as values.",
  },
]

const fontOptions = (role: FontRole) =>
  FONT_CHOICES[role].map((id) => ({ value: id, label: FONTS[id].label }))

const simulatorHint = (host: string, port: number) =>
  `A simulated Makera Z1 that OpenSpindle runs at ${host}:${port}, to try jobs without a machine. Connect to it as to a machine.`

/** Settings › General: how the app looks, and its simulated Z1. Changes apply at once. */
export function GeneralSettings() {
  const { appearance, setAppearance, fonts, setFont, saveError } =
    useAppearance()
  const simulator = useSimulatorStatus().data
  const updateSimulator = useUpdateSimulator()
  const simulatorError = updateSimulator.error
    ? `This setting could not be saved: ${updateSimulator.error.message}`
    : simulator?.error && `The simulator is not running. ${simulator.error}`
  return (
    <FieldGroup>
      <Field orientation="horizontal">
        <FieldLabel htmlFor="appearance">
          <Hint text={APPEARANCE_HINT}>Color mode</Hint>
        </FieldLabel>
        <OptionSelect
          id="appearance"
          aria-description={APPEARANCE_HINT}
          className="w-48"
          options={APPEARANCE_OPTIONS}
          value={appearance}
          onValueChange={(value) => {
            if (isAppearance(value)) setAppearance(value)
          }}
        />
      </Field>
      {FONT_FIELDS.map(({ role, id, label, hint }) => (
        <Field key={role} orientation="horizontal">
          <FieldLabel htmlFor={id}>
            <Hint text={hint}>{label}</Hint>
          </FieldLabel>
          <OptionSelect
            id={id}
            aria-description={hint}
            className="w-48"
            options={fontOptions(role)}
            value={fonts[role]}
            onValueChange={(value) => {
              if (isFontFor(role, value)) setFont(role, value)
            }}
          />
        </Field>
      ))}
      {saveError && <FieldError>{saveError}</FieldError>}
      {simulator && (
        <Field orientation="horizontal">
          <FieldLabel htmlFor="z1-simulator">
            <Hint text={simulatorHint(simulator.host, simulator.port)}>
              Z1 Simulator device
            </Hint>
          </FieldLabel>
          <Switch
            id="z1-simulator"
            aria-description={simulatorHint(simulator.host, simulator.port)}
            checked={simulator.settings.enabled}
            onCheckedChange={(enabled) => updateSimulator.mutate({ enabled })}
          />
        </Field>
      )}
      {simulatorError && <FieldError>{simulatorError}</FieldError>}
    </FieldGroup>
  )
}
