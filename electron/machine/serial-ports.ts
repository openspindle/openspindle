import { createHash } from "node:crypto"
import { z } from "zod"
import { autoDetect } from "@serialport/bindings-cpp"
import { SerialPortStream } from "@serialport/stream"
import type { SerialDevice } from "../../src/machine/contract/index.ts"
import type { SerialConnector } from "../../src/machine/core/ports.ts"

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex")
const WRITE_BUDGET = 64 * 1024
const WRITE_TIMEOUT = 10000
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)
function failure(error: unknown) {
  const message = errorMessage(error)
  if (/access|permission|EACCES|EPERM/i.test(message))
    return "USB_PERMISSION: Serial permission denied. Check the FTDI driver or serial-device group permissions."
  if (/busy|lock|EBUSY|denied.*port/i.test(message))
    return "PORT_BUSY: The USB port is already in use. Close other CNC controllers."
  if (/ENOENT|ENODEV|ENXIO|EIO|disconnected|not.*found|no such/i.test(message))
    return "USB_REMOVED: The selected serial device is unavailable or was unplugged."
  return `USB_ERROR: ${message.slice(0, 300)}`
}

/** Enumerating does not open a port. Only FTDI candidates are offered; framing verifies the CNC. */
const NativePortSchema = z.object({
  path: z.string().min(1).max(512),
  vendorId: z.string().optional(),
  productId: z.string().optional(),
  manufacturer: z.string().optional(),
  serialNumber: z.string().optional(),
})
async function list(): Promise<SerialDevice[]> {
  let ports: z.infer<typeof NativePortSchema>[]
  try {
    ports = z.array(NativePortSchema).parse(await autoDetect().list())
  } catch (error) {
    throw new Error(
      `USB_DRIVER: Could not enumerate serial devices (${errorMessage(error)}).`
    )
  }
  const candidates = ports
    .filter((port) => port.vendorId?.toLowerCase() === "0403")
    .map((port) => {
      const vendorId = port.vendorId!.toLowerCase(),
        productId = (port.productId ?? "unknown").toLowerCase()
      const serialNumber = port.serialNumber?.trim() ?? ""
      const stable = serialNumber.length > 0 && /^[a-f0-9]{4}$/.test(productId)
      const id = stable
        ? `usb:${vendorId}:${productId}:${digest(serialNumber)}`
        : `usb-path:${digest(port.path)}`
      return {
        id,
        path: port.path,
        manufacturer: (port.manufacturer ?? "FTDI serial").slice(0, 200),
        vendorId,
        productId,
        stable,
      }
    })
  const counts = new Map<string, number>()
  for (const port of candidates)
    counts.set(port.id, (counts.get(port.id) ?? 0) + 1)
  return candidates
    .map((port) => {
      if (counts.get(port.id)! > 1)
        return { ...port, id: `usb-path:${digest(port.path)}`, stable: false }
      return port
    })
    .slice(0, 128)
}

/** No flush, baud probing, initialization text or explicit DTR/RTS changes. */
export const serialConnector: SerialConnector = {
  list,
  connect(target, events) {
    let port: SerialPortStream | undefined
    const state = { closed: false }
    let pending = 0
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const close = (reason: string | null) => {
      if (state.closed) return
      state.closed = true
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      if (port?.isOpen) port.close(() => {})
      events.closed(reason)
    }
    void (async () => {
      const devices = await list()
      if (state.closed) return
      const selected = devices.find((device) => device.id === target.portId)
      if (!selected)
        throw new Error(
          "USB_REMOVED: The selected FTDI device is no longer present. Scan and select it again."
        )
      port = new SerialPortStream({
        binding: autoDetect(),
        path: selected.path,
        baudRate: 115200,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        lock: true,
        rtscts: false,
        xon: false,
        xoff: false,
        xany: false,
        hupcl: false,
        autoOpen: false,
        highWaterMark: 4096,
      })
      port.on("error", (error) => close(failure(error)))
      port.on("close", () =>
        close(
          "USB_REMOVED: The serial transport closed; machine outcome is unknown."
        )
      )
      port.on("data", (bytes: Buffer) => {
        if (!state.closed)
          events.data(
            new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
          )
      })
      port.open((error) => {
        if (error) {
          close(failure(error))
          return
        }
        if (state.closed) {
          port?.close(() => {})
          return
        }
        events.open()
      })
    })().catch((error) => close(failure(error)))
    return {
      write(bytes) {
        if (state.closed || !port?.isOpen)
          throw new Error("USB_CLOSED: Serial transport is not open.")
        if (pending + bytes.length > WRITE_BUDGET) {
          close(
            "USB_BACKPRESSURE: Serial write buffer exceeded its limit; pending command outcomes are unknown."
          )
          throw new Error("Serial write buffer exceeded its limit.")
        }
        pending += bytes.length
        const timer = setTimeout(
          () =>
            close(
              "USB_WRITE_TIMEOUT: A serial write did not complete; outcome is unknown."
            ),
          WRITE_TIMEOUT
        )
        timers.add(timer)
        port.write(Buffer.from(bytes), (error) => {
          clearTimeout(timer)
          timers.delete(timer)
          pending -= bytes.length
          if (error) close(failure(error))
        })
      },
      destroy() {
        close(null)
      },
    }
  },
}
