import { useId } from "react"
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
}: {
  pluginId: string
  setting: SettingDeclaration
  /** The stored path, or "" while it is not set. */
  stored: string
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
                placeholder="Not set"
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
            {setting.description && (
              <FieldDescription>{setting.description}</FieldDescription>
            )}
            {error && <FieldError>{error.message}</FieldError>}
          </Field>
        )}
      </form.Field>
    </form>
  )
}

/** The plugin's settings, which its companion receives. */
export function PluginSettings({ plugin }: { plugin: PluginSummary }) {
  return (
    <FieldSet>
      <FieldLegend variant="label">Settings</FieldLegend>
      {plugin.manifest.settings.map((setting) => {
        const stored = plugin.settings[setting.id] ?? ""
        // A newly stored value starts the field over from it.
        return (
          <ExecutableSetting
            key={`${setting.id}:${stored}`}
            pluginId={plugin.id}
            setting={setting}
            stored={stored}
          />
        )
      })}
    </FieldSet>
  )
}
