import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import { createAtom } from "@tanstack/react-store"
import type { ViewContext } from "@openspindle/plugin-core"
import { Spinner } from "@/components/ui/spinner"
import {
  ViewFailure,
  viewErrorMessage,
} from "@/components/plugin-view-boundary"
import { openViewBroker } from "@/app/plugin-host/broker"
import type { OperationSelection, ViewHost } from "@/app/plugin-host/broker"
import {
  PLUGIN_FRAME_ATTRIBUTES,
  connectPluginFrame,
} from "@/app/plugin-host/frame-channel"
import { createWorkspaceMediator } from "@/app/plugin-host/workspace-mediator"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import {
  WORKSPACE_MUTATION,
  useImportContext,
} from "@/features/shell/use-import"
import { isJobActive } from "@/machine/contract"
import { isPluginUsable } from "@/platform/contract/plugin-rpc"
import type {
  PluginBundle,
  PluginSummary,
} from "@/platform/contract/plugin-rpc"
import { useHost } from "@/platform/host-context"
import { useMachineSnapshot } from "@/platform/machine"
import { pluginKeys } from "@/platform/plugins"
import { pluginDialogs } from "./plugin-requests"

export type PluginFrameProps = {
  readonly plugin: PluginSummary
  readonly viewId: string
  readonly plateId: string | null
  readonly operationId: string | null
  /**
   * The view asked to close (showing one of its own operations when `select` is set), or
   * failed to load and the user dismissed it.
   */
  readonly onClose: (select: OperationSelection | null) => void
  /** Operations the view created (importers select the first). */
  readonly onCreated?: (plateId: string, operationIds: string[]) => void
}

/** The app's light or dark appearance: the `dark` class on the document element. */
function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  })
  return () => observer.disconnect()
}
const readTheme = () =>
  document.documentElement.classList.contains("dark") ? "dark" : "light"

const sameContext = (a: ViewContext, b: ViewContext) =>
  a.viewId === b.viewId &&
  a.slot === b.slot &&
  a.plateId === b.plateId &&
  a.operationId === b.operationId &&
  a.theme === b.theme &&
  a.disabled === b.disabled

/** The installed plugin while it can serve; operations record the version that wrote them. */
function enabledPlugin(client: QueryClient, pluginId: string) {
  const plugin = client
    .getQueryData<PluginSummary[]>(pluginKeys.installed)
    ?.find((item) => item.id === pluginId && isPluginUsable(item))
  return plugin ? { name: plugin.manifest.name, version: plugin.version } : null
}

/** One mounted view: its broker, the frame's port and the context pushed to it. */
function MountedFrame({
  bundle,
  viewId,
  plateId,
  operationId,
  onClose,
  onCreated,
}: Omit<PluginFrameProps, "plugin"> & { bundle: PluginBundle }) {
  const view = bundle.views.find((item) => item.id === viewId)
  const iframe = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  const workspace = useWorkspaceStore()
  const services = useHost().plugins.services
  const client = useQueryClient()
  const importContext = useImportContext()
  const theme = useSyncExternalStore(subscribeTheme, readTheme)
  const imports = useIsMutating({ mutationKey: WORKSPACE_MUTATION })
  const job = isJobActive(useMachineSnapshot().job)
  const context: ViewContext = {
    viewId,
    slot: view?.slot ?? "process.importer",
    plateId,
    operationId,
    theme,
    disabled: imports > 0 || job,
  }
  const [contextAtom] = useState(() =>
    createAtom(context, { compare: sameContext })
  )
  useEffect(() => contextAtom.set(context))
  // The broker lives as long as the frame; callbacks reach it through this ref.
  const latest = useRef({ onClose, onCreated, importContext })
  useEffect(() => {
    latest.current = { onClose, onCreated, importContext }
  })

  // A layout effect: the port listener is in place before the frame can announce itself.
  useLayoutEffect(() => {
    const frame = iframe.current
    if (!frame || !view) return
    const mediator = createWorkspaceMediator({
      workspace,
      plugin: (pluginId) => enabledPlugin(client, pluginId),
      importContext: () => latest.current.importContext(),
      dialogs: pluginDialogs,
      onCreated: (created, operationIds) =>
        latest.current.onCreated?.(created, operationIds),
    })
    const host: ViewHost = {
      view,
      context: () => contextAtom.get(),
      subscribeContext: (listener) => {
        const subscription = contextAtom.subscribe(listener)
        return () => subscription.unsubscribe()
      },
      resize: (next) => setHeight(Math.ceil(next)),
      close: (select) => latest.current.onClose(select),
    }
    const broker = openViewBroker({
      bundle,
      host,
      workspace: mediator,
      services,
    })
    const disconnect = connectPluginFrame({ iframe: frame, broker })
    return () => {
      disconnect()
      broker.dispose()
    }
  }, [bundle, view, workspace, services, client, contextAtom])

  if (!view)
    return (
      <ViewFailure
        message={`${bundle.plugin.name} no longer has this view.`}
        onClose={() => onClose(null)}
      />
    )
  // The frame is as tall as its content: in a scrolling flex column (the inspector) it must
  // not shrink, or its content scrolls inside it instead of with the panel.
  return (
    <iframe
      ref={iframe}
      {...PLUGIN_FRAME_ATTRIBUTES}
      title={`${bundle.plugin.name}: ${view.title}`}
      className="w-full shrink-0"
      style={height === null ? undefined : { height }}
    />
  )
}

/**
 * A plugin view in its sandboxed frame. The bundle is read (and verified) once per
 * installed package; an update remounts the view with the new package.
 */
export function PluginFrame({ plugin, ...props }: PluginFrameProps) {
  const plugins = useHost().plugins
  const bundle = useQuery({
    queryKey: pluginKeys.bundle(plugin.id, plugin.digest),
    queryFn: () => plugins.readBundle(plugin.id),
    staleTime: Infinity,
    gcTime: 60_000,
  })
  if (bundle.error)
    return (
      <ViewFailure
        message={viewErrorMessage(bundle.error)}
        onClose={() => props.onClose(null)}
      />
    )
  if (!bundle.data) return <Spinner />
  return <MountedFrame key={plugin.digest} bundle={bundle.data} {...props} />
}
