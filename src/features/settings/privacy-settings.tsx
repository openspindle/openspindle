import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { OptionSelect } from "@/components/option-select"
import { Hint } from "@/components/workspace/hint"
import { setLogLevel } from "@/app/errors/log"
import { LogLevelSchema } from "@/platform/contract/diagnostics"
import type {
  DiagnosticsSettings,
  DiagnosticsStatus,
  LogLevel,
} from "@/platform/contract/diagnostics"
import { diagnosticsKeys, diagnosticsStatusQuery } from "@/platform/diagnostics"
import { useHost } from "@/platform/host-context"

const LOG_LEVEL_OPTIONS: ReadonlyArray<{ value: LogLevel; label: string }> = [
  { value: "error", label: "Error" },
  { value: "warn", label: "Warning" },
  { value: "info", label: "Info" },
  { value: "debug", label: "Debug" },
]

/** Changes apply at once; a change the main process could not store is undone. */
function useUpdateDiagnosticsSettings() {
  const diagnostics = useHost().diagnostics
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<DiagnosticsSettings>) =>
      diagnostics.updateSettings(patch),
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: diagnosticsKeys.status })
      const previous = client.getQueryData<DiagnosticsStatus>(
        diagnosticsKeys.status
      )
      if (previous)
        client.setQueryData<DiagnosticsStatus>(diagnosticsKeys.status, {
          ...previous,
          settings: { ...previous.settings, ...patch },
        })
      return { previous }
    },
    onError: (_error, _patch, context) => {
      if (context?.previous)
        client.setQueryData(diagnosticsKeys.status, context.previous)
    },
    onSuccess: (settings) => {
      setLogLevel(settings.logLevel)
      client.setQueryData<DiagnosticsStatus>(
        diagnosticsKeys.status,
        (status) => status && { ...status, settings }
      )
    },
  })
}

const LOG_LEVEL_HINT =
  "How much the log records (Help › Export Log). Debug records the most, to track down a problem."
const REPORT_HINT =
  "Errors go to the OpenSpindle developers as they happen, with the app version, your system and what led up to them, never your projects. Otherwise you choose in the error dialog."

/** Settings › Privacy: what the log records, and whether errors are reported without asking. */
export function PrivacySettings() {
  const host = useHost()
  const status = useQuery(diagnosticsStatusQuery(host.diagnostics))
  const update = useUpdateDiagnosticsSettings()
  if (!status.data) return null
  const { settings, reporting } = status.data
  return (
    <FieldGroup>
      <Field orientation="horizontal">
        <FieldLabel htmlFor="log-level">
          <Hint text={LOG_LEVEL_HINT}>Debug level</Hint>
        </FieldLabel>
        <OptionSelect
          id="log-level"
          aria-description={LOG_LEVEL_HINT}
          className="w-48"
          options={LOG_LEVEL_OPTIONS}
          value={settings.logLevel}
          onValueChange={(value) => {
            const level = LogLevelSchema.safeParse(value)
            if (level.success) update.mutate({ logLevel: level.data })
          }}
        />
      </Field>
      {reporting && (
        <Field orientation="horizontal">
          <FieldLabel htmlFor="report-automatically">
            <Hint text={REPORT_HINT}>Send error reports automatically</Hint>
          </FieldLabel>
          <Switch
            id="report-automatically"
            aria-description={REPORT_HINT}
            checked={settings.reportAutomatically}
            onCheckedChange={(checked) =>
              update.mutate({ reportAutomatically: checked })
            }
          />
        </Field>
      )}
      {update.error && (
        <FieldError>
          This setting could not be saved: {update.error.message}
        </FieldError>
      )}
    </FieldGroup>
  )
}
