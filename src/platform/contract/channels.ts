/** Renderer → main: request a fresh RPC port for this page. */
export const RPC_CONNECT_CHANNEL = "openspindle:rpc-connect"
/** Main → preload: carries an RPC port, and the service at its other end. */
export const RPC_PORT_CHANNEL = "openspindle:rpc-port"
/** Preload → page (window message type) that hands the port to the main world. */
export const RPC_PORT_MESSAGE = "openspindle:rpc-port"
/**
 * The services a page has a port to: the main process, and the machine process, which sends a
 * new port when it started again.
 */
export const RPC_SERVICES = ["host", "machine"] as const
export type RpcService = (typeof RPC_SERVICES)[number]

/** The packaged renderer's origin. */
export const APP_SCHEME = "app"
export const APP_HOST = "openspindle"
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`
