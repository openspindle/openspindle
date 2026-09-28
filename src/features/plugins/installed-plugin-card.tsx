import { useId, useState } from "react"
import { RefreshCw, RotateCw, ScrollText, Trash2, Wrench } from "lucide-react"
import { CAPABILITY_INFO } from "@openspindle/plugin-core"
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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
import { PluginSource } from "./install-review"
import { PluginSettings } from "./plugin-settings"
import {
  useCompanionLogs,
  useCompanionSetup,
  usePrepareUpdate,
  useRemovePlugin,
  useRestartCompanion,
  useSetPluginEnabled,
} from "./use-plugin-manager"

const COMPANION_STATES: Record<CompanionStatus["state"], string> = {
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  stopping: "Stopping",
  backoff: "Restarting soon",
  failed: "Stopped after repeated failures",
}

const HEALTH: Record<NonNullable<CompanionStatus["health"]>["status"], string> =
  {
    ready: "Ready",
    "needs-setup": "Needs setup",
    degraded: "Degraded",
  }

function contents(plugin: PluginSummary): string {
  const { manifest } = plugin
  const parts: string[] = []
  if (manifest.programs.length)
    parts.push(plural(manifest.programs.length, "program"))
  const views = manifest.ui?.views.length ?? 0
  if (views) parts.push(plural(views, "view"))
  parts.push(formatBytes(plugin.bytes))
  return parts.join(" · ")
}

function CompanionLogs({ pluginId }: { pluginId: string }) {
  const [open, setOpen] = useState(false)
  const logs = useCompanionLogs(pluginId, open)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" className="self-start" />}
      >
        <ScrollText data-icon="inline-start" />
        {open ? "Hide log" : "Show log"}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pt-2">
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
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The companion's state and health, with restart, setup and its log. */
function CompanionPanel({
  plugin,
  status,
}: {
  plugin: PluginSummary
  status: CompanionStatus
}) {
  const restart = useRestartCompanion()
  const setup = useCompanionSetup()
  const busy = restart.isPending || setup.isPending
  return (
    <FieldSet>
      <FieldLegend variant="label">Companion</FieldLegend>
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={status.state === "failed" ? "destructive" : "secondary"}
        >
          {COMPANION_STATES[status.state]}
        </Badge>
        {status.health && (
          <Badge variant="outline">{HEALTH[status.health.status]}</Badge>
        )}
        {status.restarts > 0 && (
          <FieldDescription>
            Restarted {plural(status.restarts, "time")}
          </FieldDescription>
        )}
      </div>
      {status.health?.message && (
        <FieldDescription>{status.health.message}</FieldDescription>
      )}
      {status.lastError && <FieldError>{status.lastError}</FieldError>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !plugin.enabled}
          onClick={() => restart.mutate(plugin.id)}
        >
          <RotateCw data-icon="inline-start" />
          Restart
        </Button>
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
      </div>
      <CompanionLogs pluginId={plugin.id} />
    </FieldSet>
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
 * A plugin that comes with the app updates with it and can only be disabled.
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
  const development = plugin.source.kind === "folder"
  const bundled = plugin.source.kind === "bundled"
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{plugin.manifest.name}</CardTitle>
        <CardDescription>
          Version {plugin.version} ·{" "}
          <span className="font-numeric">{contents(plugin)}</span>
        </CardDescription>
        <CardAction>
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
      <CardContent className="flex flex-col gap-3">
        <FieldDescription>{plugin.manifest.description}</FieldDescription>
        <PluginSource source={plugin.source} />
        <div className="flex flex-wrap gap-1" aria-label="Permissions">
          {development && <Badge variant="outline">Development</Badge>}
          {plugin.grants.map((grant) => (
            <Badge key={grant} variant="secondary">
              {CAPABILITY_INFO[grant].title}
            </Badge>
          ))}
        </div>
        {plugin.manifest.settings.length > 0 && (
          <PluginSettings plugin={plugin} />
        )}
        {plugin.companion && (
          <CompanionPanel plugin={plugin} status={plugin.companion} />
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
