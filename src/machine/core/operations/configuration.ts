import { ConfigurationContentSchema } from "../../contract/index.ts"
import type {
  FirmwareConfiguration,
  WriteConfigurationRequest,
} from "../../contract/index.ts"
import { FAILURE_LINES, excerpt } from "../../firmware/adapter.ts"
import type {
  DownloadProtocol,
  TransferProtocol,
} from "../../firmware/adapter.ts"
import { MachineError } from "../errors.ts"
import {
  freshDiagnosticStatus,
  freshStatus,
  requireAdmission,
} from "./context.ts"
import type { OperationContext } from "./context.ts"

type FileTransfer = DownloadProtocol | TransferProtocol
type ConfigurationHooks = {
  readonly md5: (bytes: Uint8Array) => string
  readonly operationSignal: AbortSignal
  readonly connectionId: string
  readonly transferring: (protocol: FileTransfer | null) => void
}

/** Owns the framed link until the device acknowledges closing the file. */
async function transferFile(
  context: OperationContext,
  protocol: FileTransfer,
  hooks: ConfigurationHooks
) {
  const { session, signal } = context
  hooks.transferring(protocol)
  const release = session.suspendPolling()
  try {
    await session.request<void>(
      protocol.start(),
      (event) => {
        if (event.kind === "config-error")
          return {
            fail: new MachineError(
              "rejected",
              "The device refused the configuration transfer."
            ),
          }
        if (event.kind === "line")
          return FAILURE_LINES.has(event.line.kind)
            ? {
                fail: new MachineError(
                  "rejected",
                  `Configuration transfer failed: ${excerpt(event.line.text)}`
                ),
              }
            : "ignored"
        if (event.kind !== "transfer") return "ignored"
        try {
          for (const frame of protocol.receive(event.frame)) session.send(frame)
          return protocol.finished ? { done: undefined } : "consumed"
        } catch (error) {
          return {
            fail: new MachineError(
              "unverified",
              error instanceof Error
                ? error.message
                : "Invalid configuration transfer response."
            ),
          }
        }
      },
      {
        timeoutMs: 30_000,
        timeoutMessage: "The configuration transfer timed out.",
        signal,
      }
    )
  } catch (error) {
    if (!session.closed) {
      for (const frame of protocol.cancel()) session.send(frame)
      // An interrupted Stop owns the connection. Other failed transfers close it so a late
      // block cannot be mistaken for the next read or write's reply.
      if (!hooks.operationSignal.aborted)
        session.close(
          "The configuration transfer failed. Connect again to read the saved file."
        )
    }
    throw error
  } finally {
    hooks.transferring(null)
    release()
  }
}

async function downloadConfiguration(
  context: OperationContext,
  hooks: ConfigurationHooks
): Promise<FirmwareConfiguration> {
  const configuration = context.adapter.configuration
  if (!configuration)
    throw new MachineError(
      "refused",
      "This machine does not expose a configuration file."
    )
  const protocol = configuration.createDownload()
  await transferFile(context, protocol, hooks)
  const revision = hooks.md5(protocol.bytes)
  if (protocol.md5 !== null && protocol.md5 !== revision)
    throw new MachineError(
      "unverified",
      "The configuration checksum does not match the device's file."
    )
  let content: string
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      protocol.bytes
    )
  } catch {
    throw new MachineError(
      "invalid",
      "The configuration file is not valid UTF-8 text."
    )
  }
  const parsed = ConfigurationContentSchema.safeParse(content)
  if (!parsed.success)
    throw new MachineError(
      "invalid",
      parsed.error.issues[0]?.message ?? "The configuration text is invalid."
    )
  return {
    path: configuration.path,
    content,
    vacuumDefaultPower: configuration.vacuumDefaultPower(content),
    cameraPicture: configuration.cameraPicture(content),
    dimmingLightTimer: configuration.dimmingLightTimer(content),
    revision,
    connectionId: hooks.connectionId,
    fetchedAt: context.clock.now(),
  }
}

export async function readFirmwareConfiguration(
  context: OperationContext,
  hooks: ConfigurationHooks
): Promise<FirmwareConfiguration> {
  const before = await freshStatus(
    context,
    "Waiting for device status before reading the configuration."
  )
  requireAdmission(context, { key: "readConfiguration" }, before)
  return downloadConfiguration(context, hooks)
}

/** Compare before writing; upload once and verify every byte through the firmware protocol. */
export async function writeFirmwareConfiguration(
  context: OperationContext,
  request: WriteConfigurationRequest,
  hooks: ConfigurationHooks,
  sending: () => void
): Promise<FirmwareConfiguration> {
  const configuration = context.adapter.configuration
  if (!configuration)
    throw new MachineError(
      "refused",
      "This machine does not expose a configuration file."
    )
  const before = await freshDiagnosticStatus(
    context,
    "Waiting for device status before saving the configuration."
  )
  requireAdmission(context, { key: "writeConfiguration" }, before)
  const current = await downloadConfiguration(context, hooks)
  if (current.revision !== request.revision)
    throw new MachineError(
      "refused",
      "The configuration changed on the device. Reload it before saving your edits."
    )
  let content: string
  if ("content" in request) content = request.content
  else {
    try {
      content =
        "vacuumDefaultPower" in request
          ? configuration.withVacuumDefaultPower(
              current.content,
              request.vacuumDefaultPower
            )
          : "cameraPicture" in request
            ? configuration.withCameraPicture(
                current.content,
                request.cameraPicture
              )
            : configuration.withLightTimer(
                current.content,
                request.lightTimerMinutes
              )
    } catch (error) {
      throw new MachineError(
        "refused",
        error instanceof Error ? error.message : "Cannot save the setting."
      )
    }
  }
  const parsed = ConfigurationContentSchema.safeParse(content)
  if (!parsed.success)
    throw new MachineError(
      "invalid",
      parsed.error.issues[0]?.message ?? "The configuration text is invalid."
    )
  if (current.content === content) return current
  const ready = await freshDiagnosticStatus(
    context,
    "Waiting for device status before writing the configuration."
  )
  requireAdmission(context, { key: "writeConfiguration" }, ready)
  const bytes = new TextEncoder().encode(content)
  const revision = hooks.md5(bytes)
  const protocol = configuration.createUpload(bytes, revision)
  sending()
  try {
    await transferFile(context, protocol, hooks)
  } catch (error) {
    throw new MachineError(
      "unverified",
      `${error instanceof Error ? error.message : "Save failed."} The saved configuration is unverified; read it again before making another change.`
    )
  }
  return {
    ...current,
    content,
    vacuumDefaultPower: configuration.vacuumDefaultPower(content),
    cameraPicture: configuration.cameraPicture(content),
    dimmingLightTimer: configuration.dimmingLightTimer(content),
    revision,
    fetchedAt: context.clock.now(),
  }
}
