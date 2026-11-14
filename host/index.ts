import { createReadStream, readFileSync, unlinkSync } from "node:fs"
import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { createHash, timingSafeEqual, randomUUID } from "node:crypto"
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rename,
  stat,
  appendFile,
  open,
  rm,
} from "node:fs/promises"
import { resolve, join, extname, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"
import { z } from "zod"
import { readFreecadHandoff } from "../src/formats/freecad/handoff.ts"
import { SharedLibrarySchema } from "../src/formats/shared-tools/library.ts"
import { JobHistory } from "./services/job-history.ts"
import { Cameras } from "./services/cameras.ts"
import {
  CameraIdSchema,
  TimelapseSettingSchema,
  CAMERA_IDS,
} from "./camera-contract.ts"
import { OwnerClient } from "./owner-client.ts"

const bind = process.env.OPENSPINDLE_HOST_BIND ?? "127.0.0.1"
const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65535)
  .parse(process.env.OPENSPINDLE_HOST_PORT ?? "3210")
const data = resolve(process.env.OPENSPINDLE_HOST_DATA ?? "./openspindle-data")
const token = process.env.OPENSPINDLE_HOST_TOKEN
if (!token || token.length < 32)
  throw new Error(
    "Set OPENSPINDLE_HOST_TOKEN to an access key of at least 32 characters."
  )
const expectedKey = createHash("sha256").update(token).digest()
const web = fileURLToPath(new URL("./web", import.meta.url))
const publicOrigin = process.env.OPENSPINDLE_HOST_ORIGIN
await mkdir(join(data, "inbox"), { recursive: true })
const warning = (message: string) => {
  process.stderr.write(message + "\n")
  void appendFile(
    join(data, "host.log"),
    `${new Date().toISOString()} ${message}\n`
  ).catch(() => {})
}
const lockPath = join(data, "host.lock")
const instance = randomUUID()
let lock
try {
  lock = await open(lockPath, "wx")
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  const previous = z
    .object({ pid: z.number().int().positive(), instance: z.string() })
    .parse(JSON.parse(await readFile(lockPath, "utf8")))
  let stale = false
  try {
    process.kill(previous.pid, 0)
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === "ESRCH") stale = true
    else throw reason
  }
  if (!stale)
    throw new Error("Another OpenSpindle host owns this data directory.")
  await rm(lockPath)
  lock = await open(lockPath, "wx")
}
await lock.writeFile(JSON.stringify({ pid: process.pid, instance }))
await lock.close()
process.on("exit", () => {
  try {
    if (JSON.parse(readFileSync(lockPath, "utf8")).instance === instance)
      unlinkSync(lockPath)
  } catch {
    /* A lock is never removed on behalf of another owner. */
  }
})
if (process.env.OPENSPINDLE_USB_ID && process.env.OPENSPINDLE_MACHINE_HOST)
  throw new Error(
    "Configure either OPENSPINDLE_USB_ID or OPENSPINDLE_MACHINE_HOST, never both."
  )
if (process.env.OPENSPINDLE_USB_ID?.startsWith("usb-path:"))
  throw new Error(
    "Path-only USB identities require manual selection with connect-usb; startup requires a unique hardware ID."
  )
const owner = new OwnerClient(
  {
    data,
    machineHost: process.env.OPENSPINDLE_MACHINE_HOST,
    usbId: process.env.OPENSPINDLE_USB_ID,
    cameraHost: process.env.OPENSPINDLE_CAMERA_HOST,
    machinePort: process.env.OPENSPINDLE_MACHINE_PORT
      ? Number(process.env.OPENSPINDLE_MACHINE_PORT)
      : undefined,
  },
  warning
)
const cameras = new Cameras(data, owner, warning)
await cameras.initialize()
const history = new JobHistory(data, warning)
const StateSchema = z.object({
  selected: z.uuid().nullable(),
  runInbox: z.uuid().nullable(),
  runId: z.uuid().nullable(),
})
let state: z.infer<typeof StateSchema> = {
  selected: null,
  runInbox: null,
  runId: null,
}
try {
  state = StateSchema.parse(
    JSON.parse(await readFile(join(data, "state.json"), "utf8"))
  )
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT")
    warning("Stored monitor state could not be restored.")
}
let stateQueue: Promise<unknown> = Promise.resolve()
function saveState() {
  const text = JSON.stringify(state)
  stateQueue = stateQueue
    .then(async () => {
      await writeFile(join(data, "state.json.tmp"), text)
      await rename(join(data, "state.json.tmp"), join(data, "state.json"))
    })
    .catch(() => warning("Monitor state could not be saved."))
}
const InboxSchema = z.object({
  id: z.uuid(),
  name: z.string().max(200),
  sha256: z.string().regex(/^[a-f\d]{64}$/),
  bytes: z.number(),
  createdAt: z.number(),
})
type Inbox = z.infer<typeof InboxSchema>
async function inbox() {
  const entries: Inbox[] = []
  for (const name of await readdir(join(data, "inbox"))) {
    if (!name.endsWith(".json")) continue
    try {
      entries.push(
        InboxSchema.parse(
          JSON.parse(await readFile(join(data, "inbox", name), "utf8"))
        )
      )
    } catch {
      warning("Unreadable inbox metadata.")
    }
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt)
}
async function bundle(id: string) {
  z.uuid().parse(id)
  return readFreecadHandoff(
    await readFile(join(data, "inbox", id + ".ospjob"), "utf8")
  )
}
function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  })
  response.end(JSON.stringify(value))
}
async function body(request: IncomingMessage, maximum: number) {
  const buffers: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk)
    length += bytes.length
    if (length > maximum) throw new Error("Upload exceeds its size limit.")
    buffers.push(bytes)
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.concat(buffers)
  )
}
const requests = new Map<string, { at: number; count: number }>()
let uploadBusy = false
let toolWrite: Promise<unknown> = Promise.resolve()
const mime: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
}
async function handle(request: IncomingMessage, response: ServerResponse) {
  response.setHeader("X-Content-Type-Options", "nosniff")
  response.setHeader("Referrer-Policy", "no-referrer")
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'"
  )
  const url = new URL(request.url ?? "/", "http://host.local")
  if (url.pathname === "/health" && request.method === "GET") {
    json(response, 200, { status: "ok" })
    return
  }
  if (url.pathname.startsWith("/api/")) {
    const remote = request.socket.remoteAddress ?? "unknown",
      now = Date.now()
    let rate = requests.get(remote)
    if (!rate || now - rate.at > 60000) {
      rate = { at: now, count: 0 }
      requests.set(remote, rate)
    }
    if (requests.size > 1000) requests.clear()
    if (++rate.count > 600) {
      json(response, 429, { error: "Too many requests." })
      return
    }
    const authorization = request.headers.authorization ?? ""
    if (
      !authorization.startsWith("Bearer ") ||
      !timingSafeEqual(
        createHash("sha256").update(authorization.slice(7)).digest(),
        expectedKey
      )
    ) {
      json(response, 401, { error: "Access key required." })
      return
    }
    if (
      request.headers.origin &&
      request.headers.origin !==
        (publicOrigin ?? `http://${request.headers.host}`)
    ) {
      json(response, 403, { error: "Origin refused." })
      return
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      json(response, 200, {
        ...state,
        machine: owner.snapshot,
        camera: owner.cameraStatus,
        cameras: cameras.states(),
      })
      return
    }
    if (request.method === "GET" && url.pathname === "/api/inbox") {
      json(response, 200, await inbox())
      return
    }
    const job = /^\/api\/inbox\/([a-f\d-]{36})$/.exec(url.pathname)
    if (request.method === "GET" && job) {
      json(response, 200, await bundle(job[1]))
      return
    }
    if (request.method === "POST" && url.pathname === "/api/select") {
      const { id } = z
        .object({ id: z.uuid() })
        .parse(JSON.parse(await body(request, 4096)))
      await bundle(id)
      state = { ...state, selected: id }
      saveState()
      json(response, 200, state)
      return
    }
    if (request.method === "POST" && url.pathname === "/api/inbox") {
      if (uploadBusy) {
        json(response, 409, { error: "Another upload is in progress." })
        return
      }
      uploadBusy = true
      try {
        const entries = await inbox()
        if (entries.length >= 100)
          throw new Error(
            "Inbox has 100 jobs. Archive/remove older packages on the host."
          )
        const text = await body(request, 64 * 1024 * 1024),
          received = await readFreecadHandoff(text)
        const id = randomUUID(),
          hash = createHash("sha256").update(text).digest("hex")
        const entry: Inbox = {
          id,
          name: received.reference.name,
          sha256: hash,
          bytes: Buffer.byteLength(text),
          createdAt: Date.now(),
        }
        if (
          entries.reduce((sum, e) => sum + e.bytes, entry.bytes) >
          2 * 1024 ** 3
        )
          throw new Error("Inbox exceeds its 2 GiB budget.")
        await writeFile(join(data, "inbox", id + ".ospjob"), text, {
          flag: "wx",
        })
        await writeFile(
          join(data, "inbox", id + ".json"),
          JSON.stringify(entry),
          { flag: "wx" }
        )
        state = { ...state, selected: id }
        saveState()
        json(response, 201, { ...entry, status: "received_not_started" })
      } finally {
        uploadBusy = false
      }
      return
    }
    const cameraAction =
      /^\/api\/cameras\/(machine|webcam)\/(start|stop|timelapse)$/.exec(
        url.pathname
      )
    if (request.method === "POST" && cameraAction) {
      const id = CameraIdSchema.parse(cameraAction[1])
      if (cameraAction[2] === "start") await cameras.start(id)
      if (cameraAction[2] === "stop") await cameras.stop(id)
      if (cameraAction[2] === "timelapse")
        await cameras.configure(
          id,
          TimelapseSettingSchema.parse(JSON.parse(await body(request, 4096)))
        )
      json(response, 200, cameras.states())
      return
    }
    // Existing machine-camera routes remain compatible with older monitors.
    if (
      request.method === "POST" &&
      ["/api/camera/start", "/api/camera/stop"].includes(url.pathname)
    ) {
      if (url.pathname.endsWith("/start")) await cameras.start("machine")
      else await cameras.stop("machine")
      json(response, 200, { enabled: !url.pathname.endsWith("/stop") })
      return
    }
    const cameraFrame = /^\/api\/cameras\/(machine|webcam)\/frame$/.exec(
      url.pathname
    )
    if (
      request.method === "GET" &&
      (cameraFrame || url.pathname === "/api/camera")
    ) {
      const id = CameraIdSchema.parse(cameraFrame?.[1] ?? "machine")
      const frame = cameras.frame(id)
      if (!frame || Date.now() - frame.at > 15000) {
        json(response, 404, { error: "No fresh camera frame." })
        return
      }
      response.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
        "X-Frame-Received-At": String(frame.at),
      })
      response.end(frame.jpeg)
      return
    }
    const timelapseList = /^\/api\/history\/([a-f\d-]{36})\/timelapses$/.exec(
      url.pathname
    )
    if (request.method === "GET" && timelapseList) {
      json(
        response,
        200,
        await Promise.all(
          CAMERA_IDS.map((id) => cameras.timelapses.read(timelapseList[1], id))
        )
      )
      return
    }
    const timelapseFrame =
      /^\/api\/history\/([a-f\d-]{36})\/timelapses\/(machine|webcam)\/frames\/(\d+)$/.exec(
        url.pathname
      )
    if (request.method === "GET" && timelapseFrame) {
      const bytes = await cameras.timelapses.frame(
        timelapseFrame[1],
        CameraIdSchema.parse(timelapseFrame[2]),
        Number(timelapseFrame[3])
      )
      response.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
      })
      response.end(bytes)
      return
    }
    const timelapseExport =
      /^\/api\/history\/([a-f\d-]{36})\/timelapses\/(machine|webcam)\/export$/.exec(
        url.pathname
      )
    if (request.method === "POST" && timelapseExport) {
      const cancel = new AbortController()
      const onClose = () => cancel.abort()
      response.once("close", onClose)
      const exported = await cameras.timelapses.export(
        timelapseExport[1],
        CameraIdSchema.parse(timelapseExport[2]),
        cancel.signal
      )
      try {
        if (response.destroyed) return
        response.writeHead(200, {
          "Content-Type": "video/mp4",
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="${timelapseExport[1]}-${timelapseExport[2]}.mp4"`,
        })
        await new Promise<void>((done, reject) => {
          response.setTimeout(60000, () => response.destroy())
          const stream = createReadStream(exported.file)
          stream.on("error", reject)
          response.once("finish", done)
          response.once("close", () => {
            stream.destroy()
            done()
          })
          stream.pipe(response)
        })
      } finally {
        response.off("close", onClose)
        await exported.cleanup()
      }
      return
    }
    if (request.method === "GET" && url.pathname === "/api/history") {
      json(response, 200, await history.list())
      return
    }
    const historical = /^\/api\/history\/([a-f\d-]{36})$/.exec(url.pathname)
    if (request.method === "GET" && historical) {
      json(response, 200, await history.read(historical[1]))
      return
    }
    const frame = /^\/api\/history\/([a-f\d-]{36})\/frames\/(\d+)$/.exec(
      url.pathname
    )
    if (request.method === "GET" && frame) {
      json(response, 200, {
        jpeg: await history.frame(frame[1], Number(frame[2])),
      })
      return
    }
    if (request.method === "GET" && url.pathname === "/api/tools") {
      try {
        const text = await readFile(join(data, "shared.osptools"), "utf8")
        const hash = createHash("sha256").update(text).digest("hex")
        response.setHeader("ETag", `"${hash}"`)
        json(response, 200, SharedLibrarySchema.parse(JSON.parse(text)))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          json(response, 200, {
            schema: "openspindle-shared-tools/1",
            units: "mm",
            tools: [],
          })
        else throw error
      }
      return
    }
    if (request.method === "PUT" && url.pathname === "/api/tools") {
      const text = await body(request, 16 * 1024 * 1024)
      SharedLibrarySchema.parse(JSON.parse(text))
      const update = toolWrite.then(async () => {
        let current = ""
        try {
          current = await readFile(join(data, "shared.osptools"), "utf8")
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        }
        const etag = current
          ? `"${createHash("sha256").update(current).digest("hex")}"`
          : "*"
        if (request.headers["if-match"] !== etag)
          throw new Error(
            "Library revision changed; fetch and review before saving."
          )
        await writeFile(join(data, "shared.osptools.tmp"), text)
        await rename(
          join(data, "shared.osptools.tmp"),
          join(data, "shared.osptools")
        )
      })
      toolWrite = update.catch(() => {})
      await update
      json(response, 200, { status: "saved" })
      return
    }
    json(response, 404, {
      error:
        "Unknown API route. Browser machine control is not enabled in this monitor release.",
    })
    return
  }
  if (request.method !== "GET") {
    json(response, 405, { error: "Method not allowed." })
    return
  }
  const relative =
    url.pathname === "/"
      ? "index.html"
      : decodeURIComponent(url.pathname.slice(1))
  const file = resolve(web, relative)
  if (!file.startsWith(resolve(web) + sep)) {
    json(response, 404, { error: "Not found." })
    return
  }
  try {
    const info = await stat(file)
    if (!info.isFile() || info.size > 64 * 1024 * 1024)
      throw new Error("Invalid asset.")
    response.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
    })
    response.end(await readFile(file))
  } catch {
    json(response, 404, { error: "Not found." })
  }
}
const server = createServer((request, response) => {
  void handle(request, response).catch((error) => {
    if (!response.headersSent)
      json(response, 400, {
        error: error instanceof Error ? error.message : "Request failed.",
      })
    else response.end()
  })
})
server.requestTimeout = 120000
server.headersTimeout = 10000
server.listen(port, bind, () =>
  process.stdout.write(
    `OpenSpindle monitor listening on ${bind}:${port}. Commands: status, discover, usb, connect-usb <id> [camera-IPv4], disconnect, connect <IPv4> <port>, run <inbox-id> <package-sha256>, stop, pause, resume. Browser access is monitor-only.\n`
  )
)
const terminal = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: process.stdin.isTTY,
})
terminal.on("line", (line) => {
  void (async () => {
    const [command, ...args] = line.trim().split(/\s+/)
    switch (command) {
      case "status":
        process.stdout.write(JSON.stringify(owner.snapshot) + "\n")
        return
      case "discover":
        process.stdout.write(
          JSON.stringify(await owner.call("discover")) + "\n"
        )
        return
      case "usb":
        process.stdout.write(
          JSON.stringify(await owner.call("serialDevices")) + "\n"
        )
        return
      case "connect-usb":
        await owner.call("connect", {
          transport: "serial",
          portId: args[0],
          ...(args[1] ? { cameraHost: args[1] } : {}),
        })
        return
      case "disconnect":
        await owner.call("disconnect", {})
        return
      case "connect":
        await owner.call("connect", { host: args[0], port: Number(args[1]) })
        return
      case "stop":
        await owner.call("stop")
        return
      case "pause":
      case "resume":
        await owner.call("execute", { type: command })
        return
      case "run": {
        const entry = (await inbox()).find((e) => e.id === args[0])
        if (!entry || args[1] !== entry.sha256)
          throw new Error(
            "Review the inbox package and provide its exact SHA-256 before Run."
          )
        const stored = await readFile(join(data, "inbox", entry.id + ".ospjob"))
        if (createHash("sha256").update(stored).digest("hex") !== entry.sha256)
          throw new Error(
            "Stored package changed after receipt; review and import it again."
          )
        const received = await bundle(entry.id),
          runId = randomUUID()
        if (!owner.snapshot.connection.id)
          throw new Error("No verified machine connection.")
        state = { ...state, runInbox: entry.id, runId }
        saveState()
        await owner.call("run", {
          id: runId,
          name: entry.name,
          expectedConnectionId: owner.snapshot.connection.id,
          source: received.program.nc,
          assists: null,
          archive: JSON.stringify({
            schema: "openspindle-host-run/1",
            inboxId: entry.id,
            packageSha256: entry.sha256,
            bundle: received,
          }),
        })
        return
      }
      default:
        if (command) throw new Error("Unknown command.")
    }
  })().catch((error) =>
    warning(error instanceof Error ? error.message : "Command failed.")
  )
})
const shutdown = () => {
  warning(
    "Host is exiting; any physical job may continue. No automatic Stop was sent."
  )
  server.close()
  void cameras
    .close()
    .catch((error) => warning(String(error)))
    .finally(() => owner.worker.terminate())
    .finally(() => process.exit(0))
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
