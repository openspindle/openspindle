import { useId } from "react"
import { useForm } from "@tanstack/react-form"
import { toast } from "sonner"
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
import {
  CHECK_RULES,
  CHECK_RULE_INFO,
  LIMIT_RULES,
  LIMIT_RULE_INFO,
  RuleSeveritySchema,
  defaultDesignRules,
  limitValueSchema,
} from "@/domain/design-rules/rules"
import type { DesignRules, RuleSeverity } from "@/domain/design-rules/rules"
import { COMMON_PROGRAM_RULES } from "@/domain/design-rules/common-rules"
import type { ProgramRule } from "@/domain/design-rules/program-rules"
import { FIXTURE_KITS } from "@/domain/fixtures/catalog"
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

/**
 * The program rules' severities as saved: only those set otherwise than the rule says, so a
 * project follows the rules' defaults where it sets nothing. Rules of machines this app does
 * not know stay as they are.
 */
function savedProgramRules(
  rules: DesignRules["programRules"]
): DesignRules["programRules"] {
  const saved = { ...rules }
  const known = [
    ...COMMON_PROGRAM_RULES,
    ...FIXTURE_KITS.flatMap((kit) => kit.programRules),
  ]
  for (const rule of known)
    if (saved[rule.id]?.severity === rule.severity) delete saved[rule.id]
  return saved
}

/**
 * The project's design rules: each rule's limit and how a broken one is reported, then each
 * machine's rules for the programs it runs. Changes apply on Save; Reset to defaults only fills
 * in the defaults.
 */
export function DesignRulesSettings({ onClose }: { onClose: () => void }) {
  const id = useId()
  const workspace = useWorkspaceStore()
  const rules = useWorkspace((state) => state.designRules)
  const form = useForm({
    defaultValues: rules,
    onSubmit: ({ value }) => {
      const result = workspace.dispatch({
        type: "designRules.set",
        rules: {
          ...value,
          programRules: savedProgramRules(value.programRules),
        },
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      onClose()
    },
  })
  const fieldId = (rule: string, part: string) => `${id}-${rule}-${part}`
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
          {LIMIT_RULES.map((rule) => {
            const info = LIMIT_RULE_INFO[rule]
            return (
              <form.Field
                key={rule}
                name={`${rule}.value`}
                validators={{ onChange: limitValueSchema(rule) }}
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
                      <FieldLabel htmlFor={fieldId(rule, "value")}>
                        <Hint text={info.description}>{info.label}</Hint>
                      </FieldLabel>
                      <MeasurementInput
                        id={fieldId(rule, "value")}
                        aria-description={info.description}
                        type="number"
                        unit={info.unit}
                        min={info.min}
                        max={info.max}
                        step="any"
                        value={Number.isNaN(value) ? "" : value}
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
                      <form.Field name={`${rule}.severity`}>
                        {(severity) => (
                          <SeveritySelect
                            id={fieldId(rule, "severity")}
                            label={`${info.label} severity`}
                            description={info.description}
                            value={severity.state.value}
                            onChange={severity.handleChange}
                          />
                        )}
                      </form.Field>
                      <FieldError className="col-span-3" errors={errors} />
                    </Field>
                  )
                }}
              </form.Field>
            )
          })}
          {CHECK_RULES.map((rule) => {
            const info = CHECK_RULE_INFO[rule]
            return (
              <form.Field key={rule} name={`${rule}.severity`}>
                {(field) => (
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor={fieldId(rule, "severity")}>
                      <Hint text={info.description}>{info.label}</Hint>
                    </FieldLabel>
                    <SeveritySelect
                      id={fieldId(rule, "severity")}
                      label={`${info.label} severity`}
                      description={info.description}
                      value={field.state.value}
                      onChange={field.handleChange}
                    />
                  </Field>
                )}
              </form.Field>
            )
          })}
          <form.Field name="programRules">
            {(field) => {
              // A program rule's row: how breaking it is reported, as the project sets it.
              const row = (rule: ProgramRule) => (
                <Field key={rule.id} orientation="horizontal">
                  <FieldLabel htmlFor={fieldId(rule.id, "severity")}>
                    <Hint text={rule.description}>{rule.label}</Hint>
                  </FieldLabel>
                  <SeveritySelect
                    id={fieldId(rule.id, "severity")}
                    label={`${rule.label} severity`}
                    description={rule.description}
                    value={
                      field.state.value[rule.id]?.severity ?? rule.severity
                    }
                    onChange={(severity) =>
                      field.handleChange({
                        ...field.state.value,
                        [rule.id]: { severity },
                      })
                    }
                  />
                </Field>
              )
              return (
                <>
                  {COMMON_PROGRAM_RULES.map(row)}
                  {FIXTURE_KITS.filter((kit) => kit.programRules.length).map(
                    (kit) => (
                      <FieldSet key={kit.name}>
                        <FieldLegend>{kit.name}</FieldLegend>
                        <FieldGroup>{kit.programRules.map(row)}</FieldGroup>
                      </FieldSet>
                    )
                  )}
                </>
              )
            }}
          </form.Field>
        </FieldGroup>
      </div>
      <DialogFooter className="shrink-0 border-t p-4">
        <Button
          type="button"
          variant="outline"
          className="sm:mr-auto"
          onClick={() => form.reset(defaultDesignRules())}
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
