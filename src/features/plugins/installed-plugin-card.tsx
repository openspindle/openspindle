import { useId, useState } from "react"
import { RefreshCw, RotateCw, ScrollText, Trash2, Wrench } from "lucide-react"
import type { CompanionStatus, InstallReview } from "@openspindle/plugin-core"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import type { PluginSummary } from "@/platform/contract/plugin-rpc"
import { formatBytes, plural } from "@/domain/primitives"
import { CompanionNote, companionNote } from "./companion-note"
import { Permissions, PluginSource } from "./install-review"
import { PluginSettings } from "./plugin-settings"
import {
  useCompanionLogs,
  useCompanionSetup,
  useHoldCompanion,
  usePrepareUpdate,
  useRemovePlugin,
  useRestartCompanion,
  useSetPluginEnabled,
} from "./use-plugin-manager"

function contents(plugin: PluginSummary): string {
  const { programs } = plugin.manifest
  const parts: string[] = []
  if (programs.length) parts.push(plural(programs.length, "program"))
  parts.push(formatBytes(plugin.bytes))
  return parts.join(" · ")
}

/** The companion's recent log lines, while the card shows them. */
function CompanionLog({ id, pluginId }: { id: string; pluginId: string }) {
  const logs = useCompanionLogs(pluginId, true)
  return (
    <FieldSet id={id}>
      <FieldLegend variant="label">Log</FieldLegend>
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={logs.isFetching}
        onClick={() => void logs.refetch()}
      >
        <RefreshCw data-icon="inline-start" />
        Refresh
      </Button>
      {logs.error && <FieldError>{logs.error.message}</FieldError>}
      {logs.data && !logs.data.length && (
        <FieldDescription>Nothing logged yet.</FieldDescription>
      )}
      {logs.data && logs.data.length > 0 && (
        <ScrollArea className="max-h-60">
          <ol className="flex flex-col gap-1 p-2" aria-label="Companion log">
            {logs.data.map((entry, index) => (
              <li key={index} className="flex items-start gap-2">
                <Badge
                  variant={
                    entry.level === "error" ? "destructive" : "secondary"
                  }
                  className="font-numeric"
                >
                  {new Date(entry.at).toLocaleTimeString()}
                </Badge>
                <span className="min-w-0 break-words">
                  {entry.source}: {entry.message}
                </span>
              </li>
            ))}
          </ol>
        </ScrollArea>
      )}
    </FieldSet>
  )
}

/**
 * The companion's controls beside the plugin's switch: Restart, the log, and Run setup while
 * it needs setup and has a setup step.
 */
function CompanionControls({
  plugin,
  status,
  logId,
  logOpen,
  onLogOpenChange,
}: {
  plugin: PluginSummary
  status: CompanionStatus
  logId: string
  logOpen: boolean
  onLogOpenChange: (open: boolean) => void
}) {
  const restart = useRestartCompanion()
  const setup = useCompanionSetup()
  const busy = restart.isPending || setup.isPending
  return (
    <>
      {status.setup && status.health?.status === "needs-setup" && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !plugin.enabled}
          onClick={() => setup.mutate(plugin.id)}
        >
          <Wrench data-icon="inline-start" />
          {setup.isPending ? "Setting up…" : "Run setup"}
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={busy || !plugin.enabled}
        onClick={() => restart.mutate(plugin.id)}
      >
        <RotateCw data-icon="inline-start" />
        Restart
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={logOpen}
        aria-controls={logId}
        onClick={() => onLogOpenChange(!logOpen)}
      >
        <ScrollText data-icon="inline-start" />
        {logOpen ? "Hide log" : "Show log"}
      </Button>
    </>
  )
}

function RemoveButton({ plugin }: { plugin: PluginSummary }) {
  const remove = useRemovePlugin()
  const [confirming, setConfirming] = useState(false)
  const name = plugin.manifest.name
  return (
    <>
      <Button
        variant="ghost"
        disabled={remove.isPending}
        onClick={() => setConfirming(true)}
      >
        <Trash2 data-icon="inline-start" />
        Remove
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its operations stay on your plates and keep their NC, but cannot
              be edited until it is installed again.
              {plugin.companion && " Its companion's data is deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirming(false)
                remove.mutate(plugin.id)
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * One installed plugin: what it is and may do, its settings, and enable, update and remove.
 * A companion's controls sit beside the switch, and what it reports under the settings (on
 * its own for a plugin without any). A plugin that comes with the app updates with it and
 * can only be disabled.
 */
export function InstalledPluginCard({
  plugin,
  onReview,
}: {
  plugin: PluginSummary
  onReview: (review: InstallReview) => void
}) {
  const id = useId()
  const setEnabled = useSetPluginEnabled()
  const update = usePrepareUpdate()
  const [logOpen, setLogOpen] = useState(false)
  useHoldCompanion(plugin)
  const development = plugin.source.kind === "folder"
  const bundled = plugin.source.kind === "bundled"
  const hasSettings = plugin.manifest.settings.length > 0
  const note = companionNote(plugin.companion)
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{plugin.manifest.name}</CardTitle>
        <CardDescription>
          Version {plugin.version} ·{" "}
          <span className="font-numeric">{contents(plugin)}</span>
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          {plugin.companion && (
            <CompanionControls
              plugin={plugin}
              status={plugin.companion}
              logId={`${id}-log`}
              logOpen={logOpen}
              onLogOpenChange={setLogOpen}
            />
          )}
          <Field orientation="horizontal">
            <Switch
              id={`${id}-enabled`}
              checked={plugin.enabled}
              disabled={setEnabled.isPending}
              onCheckedChange={(enabled) =>
                setEnabled.mutate({ pluginId: plugin.id, enabled })
              }
            />
            <FieldLabel htmlFor={`${id}-enabled`}>Enabled</FieldLabel>
          </Field>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldDescription className="break-words">
          {plugin.manifest.description} <PluginSource source={plugin.source} />
        </FieldDescription>
        <Permissions
          permissions={plugin.grants.map((capability) => ({ capability }))}
        />
        {hasSettings && <PluginSettings plugin={plugin} />}
        {!hasSettings && note && <CompanionNote note={note} />}
        {logOpen && plugin.companion && (
          <CompanionLog id={`${id}-log`} pluginId={plugin.id} />
        )}
      </CardContent>
      {!bundled && (
        <CardFooter className="gap-2">
          <Button
            variant="outline"
            disabled={update.isPending}
            onClick={() =>
              update.mutate(plugin.id, {
                onSuccess: (result) => {
                  if (result.status === "review") onReview(result.review)
                },
              })
            }
          >
            <RefreshCw data-icon="inline-start" />
            {development ? "Reload" : "Check for update"}
          </Button>
          <RemoveButton plugin={plugin} />
        </CardFooter>
      )}
    </Card>
  )
}
