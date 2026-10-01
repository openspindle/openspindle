import { createSocket } from "node:dgram"
import type { Socket } from "node:dgram"
import { request as httpRequest } from "node:http"
import type { IncomingMessage } from "node:http"
import { RpcError } from "@openspindle/rpc"
import { z } from "zod"
import { hasControlCharacter } from "../../../src/machine/contract/index.ts"
import {
  FUSION_MAX_NC_BYTES,
  FusionOtpSchema,
  FusionPairingRequestSchema,
  FusionProgramIdSchema,
  FusionProgramListSchema,
  FusionProgramSchema,
} from "../../../src/platform/contract/fusion"
import type {
  FusionConnectionSnapshot,
  FusionPairingRequest,
  FusionProgram,
  FusionProgramSummary,
} from "../../../src/platform/contract/fusion"
import { log } from "../diagnostics/log"
import type { FusionCredentials } from "./fusion-credentials"

const LIST_MAX_BYTES = 256 * 1024
// JSON can escape a single byte as six characters (\u0000). The decoded NC has its own cap.
const PROGRAM_MAX_WIRE_BYTES = FUSION_MAX_NC_BYTES * 6 + LIST_MAX_BYTES
const REQUEST_TIMEOUT_MS = 10_000
const POST_TIMEOUT_MS = 125_000
const ERROR_MAX_BYTES = 4096
const PAIRING_LIFETIME_MS = 120_000
const DISCOVERY_PORT = 38765
const OFFER_MAX_BYTES = 1024
const OFFER_INTERVAL_MS = 50
const VERIFY_INTERVAL_MS = 1000
const OfferSchema = FusionPairingRequestSchema.extend({
  type: z.literal("openspindle.fusion.pairing"),
  version: z.literal(1),
})
const PairingResultSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
})
const RevokedSchema = z.strictObject({})
const BridgeErrorSchema = z.strictObject({
  error: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((message) => !hasControlCharacter(message)),
})

function invalidResponse(): RpcError {
  return new RpcError(
    "FAILED",
    "Fusion returned an invalid response. Restart OpenSpindle Bridge in Fusion and retry."
  )
}

function responseError(
  status: number | undefined,
  pairing: boolean,
  bridgeMessage?: string
): RpcError {
  if (pairing) {
    if (status === 401)
      return new RpcError(
        "PERMISSION_DENIED",
        "That code is incorrect. Enter the six-digit code shown in Fusion 360."
      )
    if (status === 410)
      return new RpcError(
        "NOT_FOUND",
        "This connection request has expired. Click Connect to OpenSpindle in Fusion 360 again."
      )
    if (status === 429)
      return new RpcError(
        "LIMIT_EXCEEDED",
        "Too many incorrect codes. Click Connect to OpenSpindle in Fusion 360 to get a new code."
      )
  }
  if (status === 401 || status === 403)
    return new RpcError(
      "PERMISSION_DENIED",
      "The Fusion connection has expired. Click Connect to OpenSpindle in Fusion 360 again."
    )
  if (!pairing && status === 404)
    return new RpcError(
      "UNAVAILABLE",
      "Update OpenSpindle Bridge from this OpenSpindle app, then restart the add-in in Fusion 360 and reconnect."
    )
  if (status === 410)
    return new RpcError(
      "NOT_FOUND",
      bridgeMessage ??
        "This Fusion program is no longer available. Refresh the program list."
    )
  if (!pairing && (status === 409 || status === 503))
    return new RpcError(
      "BUSY",
      bridgeMessage ??
        "Fusion is busy. Finish the active command in Fusion 360, then try again."
    )
  if (!pairing && status === 422)
    return new RpcError(
      "FAILED",
      bridgeMessage ??
        "Fusion could not post this NC program. Check its setup, toolpaths, and post configuration in Fusion 360."
    )
  if (!pairing && status === 504)
    return new RpcError(
      "TIMEOUT",
      bridgeMessage ??
        "Fusion did not finish in time. Check Fusion 360 before trying again."
    )
  if (!pairing && status === 500)
    return new RpcError(
      "FAILED",
      bridgeMessage ??
        "Fusion could not finish preparing this program. Check its NC program settings in Fusion 360 before trying again."
    )
  return new RpcError(
    "UNAVAILABLE",
    "OpenSpindle Bridge could not complete the request. Check Fusion 360, then try again."
  )
}

async function readBridgeError(
  response: IncomingMessage,
  signal: AbortSignal
): Promise<string | undefined> {
  if (
    response.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
      "application/json" ||
    Number(response.headers["content-length"]) > ERROR_MAX_BYTES
  )
    return undefined
  try {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of response) {
      if (!Buffer.isBuffer(chunk)) return undefined
      size += chunk.byteLength
      if (size > ERROR_MAX_BYTES) return undefined
      chunks.push(chunk)
    }
    if (signal.aborted) return undefined
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, size)
    )
    const parsed = BridgeErrorSchema.safeParse(JSON.parse(text) as unknown)
    return parsed.success ? parsed.data.error : undefined
  } catch {
    // Invalid, oversized, or incomplete errors use the status-specific fallback.
    return undefined
  }
}

/**
 * Accepts loopback pairing offers, discovers live NC programs, and posts on import. The
 * connection's token is kept between app sessions (`credentials`), as Fusion keeps its pairing;
 * a token Fusion no longer accepts is dropped, and Disconnect forgets it in both.
 */
export class FusionService {
  private token: string | null = null
  /** Counts connections and disconnections, so a token read late does not undo one. */
  private changes = 0
  private session = new AbortController()
  private readonly lifetime = new AbortController()
  private busy = false
  private socket: Socket | null = null
  private discoveryError: string | null = null
  private pending: FusionPairingRequest | null = null
  private expiration: NodeJS.Timeout | null = null
  private verification: AbortController | null = null
  private verifyingOffer: FusionPairingRequest | null = null
  private nextOfferAt = 0
  private nextVerificationAt = 0
  private pairingAttempt: AbortController | null = null
  private readonly suppressed = new Map<string, number>()
  private readonly listeners = new Set<
    (snapshot: FusionConnectionSnapshot) => void
  >()

  constructor(private readonly credentials: FusionCredentials | null = null) {}

  start(): void {
    if (this.socket || this.lifetime.signal.aborted) return
    void this.restore()
    const socket = createSocket("udp4")
    this.socket = socket
    socket.on("message", (message, remote) => {
      if (remote.address === "127.0.0.1") this.receiveOffer(message)
    })
    socket.on("error", () => {
      if (this.socket !== socket) return
      this.discoveryError =
        "Cannot listen for Fusion 360 connections. Close other OpenSpindle instances, then restart OpenSpindle."
      log.warn(this.discoveryError)
      this.closeSocket()
      this.cancelVerification()
      this.clearPairing()
      this.emit()
    })
    // Binding only loopback keeps this handshake off the network and out of other computers.
    socket.bind(DISCOVERY_PORT, "127.0.0.1")
    socket.unref()
  }

  snapshot(): FusionConnectionSnapshot {
    return {
      connected: this.token !== null,
      request: this.pending ? { ...this.pending } : null,
      discoveryError: this.discoveryError,
    }
  }

  subscribe(
    listener: (snapshot: FusionConnectionSnapshot) => void
  ): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }

  async pair(
    requestId: string,
    code: string,
    signal?: AbortSignal
  ): Promise<void> {
    if (
      !z.uuid().safeParse(requestId).success ||
      !FusionOtpSchema.safeParse(code).success
    )
      throw new RpcError(
        "INVALID_PARAMS",
        "Enter the six-digit code shown in Fusion 360."
      )
    const pending = this.pending
    if (
      !pending ||
      pending.requestId !== requestId ||
      pending.expiresAt <= Date.now()
    )
      throw responseError(410, true)
    if (this.pairingAttempt)
      throw new RpcError(
        "BUSY",
        "A Fusion connection attempt is already in progress."
      )
    const attempt = new AbortController()
    this.pairingAttempt = attempt
    try {
      const { token } = await this.request(
        "/v1/pairing",
        OFFER_MAX_BYTES,
        PairingResultSchema,
        AbortSignal.any(signal ? [attempt.signal, signal] : [attempt.signal]),
        { body: JSON.stringify({ requestId, code }) }
      )
      if (attempt.signal.aborted || signal?.aborted || this.pending !== pending)
        throw new RpcError("CANCELLED", "The Fusion connection was cancelled.")
      if (pending.expiresAt <= Date.now()) throw responseError(410, true)
      // A failed replacement pairing leaves the previous connection usable.
      const previous = this.token
      this.token = token
      this.changes++
      this.clearPairing()
      this.emit()
      void this.keep(token)
      if (previous && previous !== token) void this.revoke(previous)
    } catch (error) {
      if (
        this.pending === pending &&
        error instanceof RpcError &&
        (error.code === "NOT_FOUND" || error.code === "LIMIT_EXCEEDED")
      ) {
        this.clearPairing()
        this.emit()
      }
      throw error
    } finally {
      if (this.pairingAttempt === attempt) this.pairingAttempt = null
    }
  }

  dismissPairing(requestId: string): void {
    if (this.pending?.requestId !== requestId) return
    this.cancelVerification()
    this.clearPairing()
    this.emit()
  }

  async list(signal?: AbortSignal): Promise<FusionProgramSummary[]> {
    const { programs } = await this.programRequest(
      "/v2/programs",
      LIST_MAX_BYTES,
      FusionProgramListSchema,
      signal
    )
    return programs
  }

  async read(id: string, signal?: AbortSignal): Promise<FusionProgram> {
    if (!FusionProgramIdSchema.safeParse(id).success)
      throw new RpcError("INVALID_PARAMS", "Choose a Fusion program to import.")
    const program = await this.programRequest(
      `/v2/programs/${id}/post`,
      PROGRAM_MAX_WIRE_BYTES,
      FusionProgramSchema,
      signal,
      { body: "{}", timeoutMs: POST_TIMEOUT_MS }
    )
    if (program.id !== id) throw invalidResponse()
    return program
  }

  /** Forgets the connection, here and in Fusion when it is running. */
  disconnect(): void {
    const token = this.token
    this.token = null
    this.changes++
    this.session.abort()
    this.session = new AbortController()
    this.cancelVerification(true)
    this.clearPairing()
    this.emit()
    void this.discard()
    if (token) void this.revoke(token)
  }

  /** Stops for quitting: the connection stays kept for the next session. */
  dispose(): void {
    this.token = null
    this.session.abort()
    this.cancelVerification(true)
    this.clearPairing()
    this.lifetime.abort()
    this.closeSocket()
    this.listeners.clear()
  }

  /** The token kept from an earlier session, unless this one connected or disconnected since. */
  private async restore(): Promise<void> {
    const changes = this.changes
    const token = await this.credentials?.load().catch(() => null)
    if (!token || this.changes !== changes || this.lifetime.signal.aborted)
      return
    this.token = token
    this.emit()
  }

  private async keep(token: string): Promise<void> {
    try {
      if (this.credentials && !(await this.credentials.save(token)))
        log.warn(
          "The Fusion connection lasts for this session only: the system cannot encrypt it."
        )
    } catch {
      log.warn("Could not keep the Fusion connection for the next session.")
    }
  }

  private async discard(): Promise<void> {
    try {
      await this.credentials?.clear()
    } catch {
      log.warn("Could not forget the kept Fusion connection.")
    }
  }

  /** Drops a token Fusion no longer accepts, such as one it forgot. */
  private drop(token: string): void {
    if (this.token !== token) return
    this.token = null
    this.changes++
    this.emit()
    void this.discard()
  }

  /** Asks Fusion to forget `token`. Fusion may be closed: it keeps only its newest pairings. */
  private async revoke(token: string): Promise<void> {
    try {
      await this.request(
        "/v1/pairing",
        ERROR_MAX_BYTES,
        RevokedSchema,
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        { token, method: "DELETE" }
      )
    } catch {
      // Fusion closed, or it forgot the token already.
    }
  }

  private receiveOffer(message: Buffer): void {
    const now = Date.now()
    if (
      message.byteLength > OFFER_MAX_BYTES ||
      this.verification ||
      this.lifetime.signal.aborted ||
      now < this.nextOfferAt ||
      now < this.nextVerificationAt
    )
      return
    this.nextOfferAt = now + OFFER_INTERVAL_MS
    let data: unknown
    try {
      data = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(message)
      ) as unknown
    } catch {
      return
    }
    const offer = OfferSchema.safeParse(data)
    if (!offer.success) return
    const { requestId, expiresAt } = offer.data
    for (const [id, expiry] of this.suppressed)
      if (expiry <= now) this.suppressed.delete(id)
    if (
      expiresAt <= now ||
      expiresAt > now + PAIRING_LIFETIME_MS ||
      this.suppressed.has(requestId) ||
      this.pending?.requestId === requestId
    )
      return
    this.nextVerificationAt = now + VERIFY_INTERVAL_MS
    const verification = new AbortController()
    this.verification = verification
    this.verifyingOffer = { requestId, expiresAt }
    // UDP alone never opens a dialog. Confirm the exact offer at the fixed add-in endpoint.
    void this.verifyOffer({ requestId, expiresAt }, verification)
  }

  private async verifyOffer(
    offer: FusionPairingRequest,
    verification: AbortController
  ): Promise<void> {
    try {
      const confirmed = await this.request(
        "/v1/pairing",
        OFFER_MAX_BYTES,
        FusionPairingRequestSchema,
        verification.signal
      )
      if (
        verification.signal.aborted ||
        this.verification !== verification ||
        confirmed.requestId !== offer.requestId ||
        confirmed.expiresAt !== offer.expiresAt ||
        confirmed.expiresAt <= Date.now() ||
        this.suppressed.has(confirmed.requestId)
      )
        return
      this.clearPairing()
      this.pending = confirmed
      this.expiration = setTimeout(() => {
        if (this.pending !== confirmed) return
        this.clearPairing()
        this.emit()
      }, confirmed.expiresAt - Date.now())
      this.expiration.unref()
      this.emit()
    } catch {
      // Offers can be stale or forged. They neither create dialogs nor surface network errors.
    } finally {
      if (this.verification === verification) {
        this.verification = null
        this.verifyingOffer = null
      }
    }
  }

  private clearPairing(): void {
    if (this.pending) this.suppressOffer(this.pending)
    this.pending = null
    if (this.expiration) clearTimeout(this.expiration)
    this.expiration = null
    this.pairingAttempt?.abort()
    this.pairingAttempt = null
  }

  private suppressOffer(offer: FusionPairingRequest): void {
    this.suppressed.set(offer.requestId, offer.expiresAt)
    // Verification starts at most once per second; still bound cancelled-offer storage.
    if (this.suppressed.size > 128) {
      const oldest = this.suppressed.keys().next().value
      if (oldest) this.suppressed.delete(oldest)
    }
  }

  private cancelVerification(suppress = false): void {
    if (suppress && this.verifyingOffer) this.suppressOffer(this.verifyingOffer)
    this.verification?.abort()
    this.verification = null
    this.verifyingOffer = null
  }

  private closeSocket(): void {
    const socket = this.socket
    this.socket = null
    try {
      socket?.close()
    } catch {
      // A failed bind can leave a socket that was never running.
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.snapshot())
  }

  private pairedToken(): string {
    if (!this.token)
      throw new RpcError(
        "UNAVAILABLE",
        "Click Connect to OpenSpindle in Fusion 360 to connect."
      )
    return this.token
  }

  private async programRequest<T>(
    route: string,
    maxBytes: number,
    schema: z.ZodType<T>,
    callerSignal?: AbortSignal,
    options: { body?: string; timeoutMs?: number } = {}
  ): Promise<T> {
    const token = this.pairedToken()
    if (this.busy)
      throw new RpcError(
        "BUSY",
        "A Fusion program request is already in progress."
      )
    this.busy = true
    const signals = [this.session.signal]
    if (callerSignal) signals.push(callerSignal)
    try {
      return await this.request(
        route,
        maxBytes,
        schema,
        AbortSignal.any(signals),
        { ...options, token }
      )
    } catch (error) {
      // Fusion no longer accepts the token: connecting again is the way back.
      if (error instanceof RpcError && error.code === "PERMISSION_DENIED")
        this.drop(token)
      throw error
    } finally {
      this.busy = false
    }
  }

  private async request<T>(
    route: string,
    maxBytes: number,
    schema: z.ZodType<T>,
    callerSignal: AbortSignal,
    options: {
      token?: string
      body?: string
      timeoutMs?: number
      method?: "DELETE"
    } = {}
  ): Promise<T> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS)
    const signal = AbortSignal.any([
      this.lifetime.signal,
      timeout,
      callerSignal,
    ])
    let response: IncomingMessage | undefined
    try {
      // Node HTTP uses this fixed address directly: no redirects, proxy or remote hostname.
      response = await new Promise<IncomingMessage>((resolve, reject) => {
        const headers: Record<string, string | number> = {
          Accept: "application/json",
        }
        if (options.token) headers.Authorization = `Bearer ${options.token}`
        if (options.body) {
          headers["Content-Type"] = "application/json"
          headers["Content-Length"] = Buffer.byteLength(options.body)
        }
        const request = httpRequest(
          {
            hostname: "127.0.0.1",
            port: 38764,
            path: route,
            method: options.method ?? (options.body ? "POST" : "GET"),
            agent: false,
            signal,
            headers,
          },
          resolve
        )
        request.once("error", reject)
        request.end(options.body)
      })
      const succeeded = response.statusCode === 200
      if (!succeeded)
        throw responseError(
          response.statusCode,
          route === "/v1/pairing",
          await readBridgeError(response, signal)
        )
      if (
        response.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
        "application/json"
      )
        throw invalidResponse()
      const contentLength = response.headers["content-length"]
      if (contentLength && Number(contentLength) > maxBytes)
        throw new RpcError(
          "LIMIT_EXCEEDED",
          "The Fusion response is too large."
        )
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of response) {
        if (!Buffer.isBuffer(chunk)) throw invalidResponse()
        size += chunk.byteLength
        if (size > maxBytes)
          throw new RpcError(
            "LIMIT_EXCEEDED",
            "The Fusion response is too large."
          )
        chunks.push(chunk)
      }
      if (signal.aborted)
        throw new RpcError("CANCELLED", "The Fusion request was cancelled.")
      let data: unknown
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat(chunks, size)
        )
        data = JSON.parse(text) as unknown
      } catch {
        throw invalidResponse()
      }
      const parsed = schema.safeParse(data)
      if (!parsed.success) throw invalidResponse()
      return parsed.data
    } catch (error) {
      if (timeout.aborted)
        throw new RpcError(
          "TIMEOUT",
          "Fusion did not respond in time. Check that OpenSpindle Bridge is running and retry."
        )
      if (signal.aborted)
        throw new RpcError("CANCELLED", "The Fusion request was cancelled.")
      if (error instanceof RpcError) throw error
      // Do not forward/log network exceptions: they can include request headers.
      throw new RpcError(
        "UNAVAILABLE",
        "Cannot reach Fusion. Open Fusion and start the OpenSpindle Bridge add-in."
      )
    } finally {
      response?.destroy()
    }
  }
}
