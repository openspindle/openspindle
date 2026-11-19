import { createContext, useContext, useEffect, useRef } from "react"
import type { ReactNode } from "react"
import type { EndpointLog } from "@openspindle/rpc"
import type { MenuCommand } from "./contract/menu"
import { connectElectronHost } from "./electron-host"
import type { Host } from "./host"

/**
 * The renderer runs only in the desktop app, whose preload exposes the bridge. `log` is the
 * app's log, for what the connection refuses.
 */
export async function createHost(log: EndpointLog): Promise<Host> {
  if (!window.openSpindleBridge)
    throw new Error("OpenSpindle runs only as its desktop app.")
  return connectElectronHost(window.openSpindleBridge, log)
}

const HostContext = createContext<Host | null>(null)

export function HostProvider({
  host,
  children,
}: {
  host: Host
  children: ReactNode
}) {
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>
}

export const useOptionalHost = () => useContext(HostContext)

export function useHost(): Host {
  const host = useOptionalHost()
  if (!host) throw new Error("HostProvider is missing.")
  return host
}

/** Subscribes to native menu commands with a stable handler. */
export function useMenuCommands(handle: (command: MenuCommand) => void) {
  const host = useHost()
  const latest = useRef(handle)
  useEffect(() => {
    latest.current = handle
  })
  useEffect(
    () => host.menu.subscribe((command) => latest.current(command)),
    [host]
  )
}
