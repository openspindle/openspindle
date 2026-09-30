import { useId, useMemo } from "react"
import { useForm } from "@tanstack/react-form"
import { toast } from "sonner"
import type { z } from "zod"
import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import { Hint } from "@/components/workspace/hint"
import { MeasurementInput } from "@/components/workspace/measurement-input"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { RuleSeveritySchema } from "@/machine/contract"
import type { RuleSeverity } from "@/machine/contract"
import { FIXTURE_KITS } from "@/domain/fixtures/catalog"
import { RULES } from "@/domain/rules/rules"
import { ruleLimitSchema, settingsForm } from "@/domain/rules/settings"
import type { AnyRule } from "@/domain/rules/stages"
import { visibleErrors } from "@/features/auto-level/auto-level-settings"

const SEVERITY_OPTIONS: ReadonlyArray<{ value: RuleSeverity; label: string }> =
  [
    { value: "error", label: "Error" },
    { value: "warning", label: "Warning" },
    { value: "ignore", label: "Ignore" },
  ]

/** How a broken rule is reported: as an error, as a warning, or not at all. */
function SeveritySelect({
  id,
  label,
  description,
  value,
  onChange,
}: {
  id: string
  label: string
  description?: string
  value: RuleSeverity
  onChange: (value: RuleSeverity) => void
}) {
  return (
    <OptionSelect
      id={id}
      aria-label={label}
      aria-description={description}
      className="w-28 shrink-0"
      options={SEVERITY_OPTIONS}
      value={value}
      onValueChange={(next) => {
        const severity = RuleSeveritySchema.safeParse(next)
        if (severity.success) onChange(severity.data)
      }}
    />
  )
}

/** A limit's row: its label, the limit, and how breaking it is reported; an error under them. */
const LIMIT_ROW = "grid grid-cols-[minmax(0,1fr)_8rem_7rem] items-center"

/** The rules a project sets for every machine, in list order. */
const COMMON_RULES = RULES.filter((rule) => rule.configurable && !rule.machines)

/**
 * Each machine's own rules a project sets, in list order, under its kit; kits without any are
 * left out.
 */
const KIT_RULES = FIXTURE_KITS.map((kit) => ({
  kit,
  rules: RULES.filter(
    (rule) => rule.configurable && rule.machines?.includes(kit.id)
  ),
})).filter(({ rules }) => rules.length)

/**
 * The project's rule settings: how each rule a project sets is reported, and its limit for a rule
 * with one; the rules for every machine, then each machine's own. Changes apply on Save; Reset to
 * defaults only fills in the defaults.
 */
export function DesignRulesSettings({ onClose }: { onClose: () => void }) {
  const id = useId()
  const workspace = useWorkspaceStore()
  const settings = useWorkspace((state) => state.ruleSettings)
  const defaultValues = useMemo(() => settingsForm(settings), [settings])
  const form = useForm({
    defaultValues,
    onSubmit: ({ value }) => {
      const result = workspace.dispatch({
        type: "ruleSettings.set",
        settings: value,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      onClose()
    },
  })
  const fieldId = (rule: string, part: string) => `${id}-${rule}-${part}`
  // A rule's row: its limit, for a rule with one, and how breaking it is reported.
  const row = (rule: AnyRule) => {
    const severity = (
      <form.Field name={`${rule.id}.severity`}>
        {(field) => (
          <SeveritySelect
            id={fieldId(rule.id, "severity")}
            label={`${rule.label} severity`}
            description={rule.description}
            value={field.state.value}
            onChange={field.handleChange}
          />
        )}
      </form.Field>
    )
    const { limit } = rule
    if (!limit)
      return (
        <Field key={rule.id} orientation="horizontal">
          <FieldLabel htmlFor={fieldId(rule.id, "severity")}>
            <Hint text={rule.description}>{rule.label}</Hint>
          </FieldLabel>
          {severity}
        </Field>
      )
    // Typed as one schema: the field cannot infer its validator from a union of schemas.
    const limitSchema: z.ZodType<number | undefined, number | undefined> =
      ruleLimitSchema(rule)
    return (
      <form.Field
        key={rule.id}
        name={`${rule.id}.limit`}
        validators={{ onChange: limitSchema }}
      >
        {(field) => {
          const errors = visibleErrors(field.state.meta)
          const invalid = !!errors?.length
          const value = field.state.value
          return (
            <Field
              orientation="horizontal"
              className={LIMIT_ROW}
              data-invalid={invalid}
            >
              <FieldLabel htmlFor={fieldId(rule.id, "limit")}>
                <Hint text={rule.description}>{rule.label}</Hint>
              </FieldLabel>
              <MeasurementInput
                id={fieldId(rule.id, "limit")}
                aria-description={rule.description}
                type="number"
                unit={limit.unit}
                min={limit.min}
                max={limit.max}
                step="any"
                value={value === undefined || Number.isNaN(value) ? "" : value}
                aria-invalid={invalid}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.target.value.trim()
                      ? Number(event.target.value)
                      : Number.NaN
                  )
                }
              />
              {severity}
              <FieldError className="col-span-3" errors={errors} />
            </Field>
          )
        }}
      </form.Field>
    )
  }
  return (
    <form
      // The rules' schemas check the limits and say why; the browser's own check would stop Save
      // without a word.
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <FieldGroup>
          {COMMON_RULES.map(row)}
          {KIT_RULES.map(({ kit, rules }) => (
            <FieldSet key={kit.id}>
              <FieldLegend>{kit.name}</FieldLegend>
              <FieldGroup>{rules.map(row)}</FieldGroup>
            </FieldSet>
          ))}
        </FieldGroup>
      </div>
      <DialogFooter className="shrink-0 border-t p-4">
        <Button
          type="button"
          variant="outline"
          className="sm:mr-auto"
          onClick={() => form.reset(settingsForm({}))}
        >
          Reset to defaults
        </Button>
        <form.Subscribe selector={(state) => state.canSubmit}>
          {(canSubmit) => (
            <Button type="submit" disabled={!canSubmit}>
              Save
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  )
}
