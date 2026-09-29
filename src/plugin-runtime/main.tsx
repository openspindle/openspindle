import * as React from "react"
import { StrictMode, useEffect } from "react"
import * as jsxRuntime from "react/jsx-runtime"
import * as ReactDOM from "react-dom"
import * as ReactDOMClient from "react-dom/client"
import * as reactQuery from "@tanstack/react-query"
import { QueryClientProvider } from "@tanstack/react-query"
import { pluginViewContract } from "@openspindle/plugin-core"
import type { PluginViewContract } from "@openspindle/plugin-core"
import * as sdk from "@openspindle/plugin-sdk"
import {
  PluginSessionProvider,
  createPluginQueryClient,
  isPluginDefinition,
  useViewContext,
} from "@openspindle/plugin-sdk"
import type { PluginDefinition } from "@openspindle/plugin-sdk"
import { FRAME_GLOBAL } from "@openspindle/plugin-sdk/frame"
import type { FrameRuntimeGlobal } from "@openspindle/plugin-sdk/frame"
import * as ui from "@openspindle/plugin-sdk/ui"
import { createEndpoint } from "@openspindle/rpc"
import type { EmptyContract, Peer } from "@openspindle/rpc"
import { messagePortTransport } from "@openspindle/rpc/message-port"
import { Spinner } from "@/components/ui/spinner"
import {
  ViewBoundary,
  ViewFailure,
  viewErrorMessage,
} from "@/components/plugin-view-boundary"
import { applyAppearance } from "@/lib/appearance"
import { FRAME_CONNECT_MESSAGE, FRAME_READY_MESSAGE } from "./frame-policy"
import "@/styles.css"

/*
 * The plugin frame runtime: a classic script in a sandboxed, opaque-origin frame. It
 * exposes the shared modules, receives a MessagePort from the app, imports the plugin's
 * bundle from a blob URL and renders the requested view inside the SDK session.
 */

const modules: FrameRuntimeGlobal = Object.freeze({
  react: React,
  jsxRuntime,
  reactDom: ReactDOM,
  reactDomClient: ReactDOMClient,
  reactQuery,
  sdk,
  ui,
})
Object.defineProperty(globalThis, FRAME_GLOBAL, { value: modules })

/*
 * WebRTC is the one way out that the frame's policy does not close: `connect-src` does not
 * reach `RTCPeerConnection`. No plugin view needs it, so it is gone before any plugin code
 * runs; the window's WebRTC settings refuse its UDP use as well (the main process).
 */
for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection"])
  Reflect.defineProperty(globalThis, name, {
    value: undefined,
    writable: false,
    configurable: false,
  })

/** Announces the frame and resolves with the first port its parent sends. */
function receivePort(): Promise<MessagePort> {
  return new Promise((resolve) => {
    const receive = (event: MessageEvent) => {
      const data: unknown = event.data
      if (
        event.source !== window.parent ||
        !data ||
        typeof data !== "object" ||
        (data as { type?: unknown }).type !== FRAME_CONNECT_MESSAGE ||
        !event.ports[0]
      )
        return
      window.removeEventListener("message", receive)
      resolve(event.ports[0])
    }
    window.addEventListener("message", receive)
    // The announcement carries nothing; only the app answers it, with a port.
    window.parent.postMessage({ type: FRAME_READY_MESSAGE }, "*")
  })
}

/** The bundle arrives as text; it becomes a module only inside this frame. */
async function importBundle(script: string): Promise<PluginDefinition> {
  const url = URL.createObjectURL(
    new Blob([script], { type: "text/javascript" })
  )
  try {
    const module: unknown = await import(/* @vite-ignore */ url)
    const definition =
      module && typeof module === "object" && "default" in module
        ? module.default
        : undefined
    if (!isPluginDefinition(definition))
      throw new Error(
        "The plugin bundle must export definePlugin(...) as its default."
      )
    return definition
  } finally {
    URL.revokeObjectURL(url)
  }
}

function injectStyles(styles: string) {
  const element = document.createElement("style")
  element.textContent = styles
  document.head.append(element)
}

/** Follows the app's light or dark appearance. */
function Appearance() {
  const { theme } = useViewContext()
  useEffect(() => applyAppearance(theme, false), [theme])
  return null
}

/**
 * Reports the content height so the app can size the frame to it: the document's own box,
 * rounded up so no fraction of a pixel scrolls inside the frame, or the body's scrollHeight
 * when content hangs out of its parent (an input group's addon is taller than the group),
 * which the box leaves out. (The root's scrollHeight is never less than the frame's current
 * height, so the frame could not shrink.)
 */
function reportSize(peer: Peer<PluginViewContract>) {
  let frame = 0
  let last = -1
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const height = Math.max(
        Math.ceil(document.documentElement.getBoundingClientRect().height),
        document.body.scrollHeight
      )
      if (height === last) return
      last = height
      peer.call("view.resize", { height }).catch(() => undefined)
    })
  })
  observer.observe(document.documentElement)
}

async function start(root: HTMLElement) {
  const view = ReactDOMClient.createRoot(root)
  view.render(<Spinner />)
  const peer = createEndpoint<EmptyContract, PluginViewContract>({
    transport: messagePortTransport(await receivePort()),
    remote: pluginViewContract,
  })
  const close = () => {
    peer.call("view.close", undefined).catch(() => undefined)
  }
  try {
    const boot = await peer.call("view.load", undefined)
    applyAppearance(boot.context.theme, false)
    if (boot.bundle.styles) injectStyles(boot.bundle.styles)
    const definition = await importBundle(boot.bundle.script)
    const View = Object.hasOwn(definition.views, boot.view.id)
      ? definition.views[boot.view.id]
      : undefined
    if (!View)
      throw new Error(`${boot.plugin.name} has no view named ${boot.view.id}.`)
    view.render(
      <StrictMode>
        <QueryClientProvider client={createPluginQueryClient()}>
          <PluginSessionProvider peer={peer} boot={boot}>
            <Appearance />
            <ViewBoundary onClose={close}>
              <View />
            </ViewBoundary>
          </PluginSessionProvider>
        </QueryClientProvider>
      </StrictMode>
    )
  } catch (error) {
    view.render(
      <ViewFailure message={viewErrorMessage(error)} onClose={close} />
    )
  }
  reportSize(peer)
}

const root = document.getElementById("plugin-root")
if (root) void start(root)
