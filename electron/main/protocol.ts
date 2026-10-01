import { protocol } from "electron"
import { readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { APP_HOST, APP_SCHEME } from "../../src/platform/contract/channels"

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
}

/**
 * Applied to the app document. The machine, its camera and local PCB converter are
 * reached from the main process only.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
].join("; ")

/** Must run before the app is ready: gives app:// a stable, secure origin. */
export function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        codeCache: true,
      },
    },
  ])
}

const notFound = () => new Response("Not found", { status: 404 })

/** Serves the built renderer read-only from `root`, with an SPA fallback. */
export function handleAppProtocol(root: string) {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== APP_HOST || !["GET", "HEAD"].includes(request.method))
      return notFound()
    let pathname: string
    try {
      pathname = decodeURIComponent(url.pathname)
    } catch {
      return new Response("Bad request", { status: 400 })
    }
    const requested = path.resolve(root, `.${pathname}`)
    const target = path.extname(pathname)
      ? requested
      : path.join(root, "index.html")
    const relative = path.relative(root, target)
    if (relative.startsWith("..") || path.isAbsolute(relative))
      return new Response("Forbidden", { status: 403 })
    const type = MIME_TYPES[path.extname(target).toLowerCase()]
    if (!type) return notFound()
    let file: string
    try {
      file = await realpath(target)
      const resolvedRoot = await realpath(root)
      const inside = path.relative(resolvedRoot, file)
      if (inside.startsWith("..") || path.isAbsolute(inside))
        return new Response("Forbidden", { status: 403 })
      if (!(await stat(file)).isFile()) return notFound()
    } catch {
      return notFound()
    }
    const headers: Record<string, string> = {
      "content-type": type,
      "x-content-type-options": "nosniff",
      "cache-control": "no-cache",
    }
    if (type.startsWith("text/html"))
      headers["content-security-policy"] = CONTENT_SECURITY_POLICY
    if (request.method === "HEAD") return new Response(null, { headers })
    return new Response(await readFile(file), { headers })
  })
}
