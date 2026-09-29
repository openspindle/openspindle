import { useId } from "react"
import type { ReactNode } from "react"
import { useForm } from "@tanstack/react-form"
import type { SettingDeclaration } from "@openspindle/plugin-core"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import type { PluginSummary } from "@/platform/contract/plugin-rpc"
import { CompanionNote, companionNote } from "./companion-note"
import {
  useChoosePluginSetting,
  useSetPluginSetting,
} from "./use-plugin-manager"

/**
 * A program the plugin runs, by its full path. A typed path is stored on Save and an empty
 * one clears it; Choose… stores the program chosen in a dialog at once.
 */
function ExecutableSetting({
  pluginId,
  setting,
  stored,
  hint,
}: {
  pluginId: string
  setting: SettingDeclaration
  /** The stored path, or "" while it is not set. */
  stored: string
  /** Below the field: what the companion reported, or the setting's description. */
  hint: ReactNode
}) {
  const id = useId()
  const save = useSetPluginSetting()
  const choose = useChoosePluginSetting()
  const form = useForm({
    defaultValues: { path: stored },
    onSubmit: async ({ value }) => {
      // Failures show below the field (save.error).
      await save
        .mutateAsync({
          pluginId,
          settingId: setting.id,
          value: value.path.trim() || null,
        })
        .catch(() => undefined)
    },
  })
  const busy = save.isPending || choose.isPending
  const error = save.error ?? choose.error
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Field name="path">
        {(field) => (
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor={id}>{setting.label}</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id={id}
                value={field.state.value}
                placeholder={`Path to ${setting.label} binary`}
                spellCheck={false}
                disabled={busy}
                aria-invalid={!!error}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <form.Subscribe
                  selector={(state) => state.values.path.trim() !== stored}
                >
                  {(changed) =>
                    changed && (
                      <InputGroupButton type="submit" disabled={busy}>
                        Save
                      </InputGroupButton>
                    )
                  }
                </form.Subscribe>
                <InputGroupButton
                  disabled={busy}
                  onClick={() =>
                    choose.mutate({ pluginId, settingId: setting.id })
                  }
                >
                  Choose…
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {hint}
            {error && <FieldError>{error.message}</FieldError>}
          </Field>
        )}
      </form.Field>
    </form>
  )
}

/**
 * The plugin's settings, which its companion receives. Once the companion reported how it
 * fares with them (the program it found, or what is wrong), that shows below the last one
 * in place of their descriptions.
 */
export function PluginSettings({ plugin }: { plugin: PluginSummary }) {
  const { settings } = plugin.manifest
  const note = companionNote(plugin.companion)
  const hint = (setting: SettingDeclaration, index: number) => {
    if (note)
      return index === settings.length - 1 && <CompanionNote note={note} />
    return (
      setting.description && (
        <FieldDescription>{setting.description}</FieldDescription>
      )
    )
  }
  return (
    <FieldSet>
      <FieldLegend variant="label">Settings</FieldLegend>
      {settings.map((setting, index) => {
        const stored = plugin.settings[setting.id] ?? ""
        // A newly stored value starts the field over from it.
        return (
          <ExecutableSetting
            key={`${setting.id}:${stored}`}
            pluginId={plugin.id}
            setting={setting}
            stored={stored}
            hint={hint(setting, index)}
          />
        )
      })}
    </FieldSet>
  )
}
