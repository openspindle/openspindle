import { z } from "zod"
import type { ConnectedDevice } from "./snapshot.ts"

/**
 * A device on this computer: the Z1 simulator, which listens only on the loopback address.
 * A machine is never there.
 */
export const isSimulator = (device: Pick<ConnectedDevice, "host">) =>
  device.host.startsWith("127.")

const Coordinate = z.number().min(-10_000).max(10_000)

/**
 * What is on the simulator's bed, as the plate it runs positions it, in machine coordinates
 * (Z where the probe's tip meets it): the stock's box, else what carries it, the bed or a
 * wasteboard. The simulator probes against it.
 */
export const SimulatedBedSchema = z.object({
  stock: z
    .object({
      min: z.tuple([Coordinate, Coordinate]),
      max: z.tuple([Coordinate, Coordinate]),
      top: Coordinate,
    })
    .nullable(),
  support: Coordinate,
})
export type SimulatedBed = z.infer<typeof SimulatedBedSchema>

const number = (value: number) => String(Number(value.toFixed(4)))

/** The bed as the simulator takes it: `sim-bed support <z> [stock <x0> <y0> <x1> <y1> <top>]`. */
export function simulatedBedLine({ stock, support }: SimulatedBed): string {
  const words = ["sim-bed", "support", number(support)]
  if (stock)
    words.push("stock", ...[...stock.min, ...stock.max, stock.top].map(number))
  return words.join(" ")
}

/** The bed a `sim-bed` line describes; null for any other line or a malformed one. */
export function readSimulatedBedLine(line: string): SimulatedBed | null {
  const words = line.trim().split(/\s+/)
  if (words[0] !== "sim-bed" || words[1] !== "support") return null
  let stock: SimulatedBed["stock"] = null
  if (words.length > 3) {
    if (words[3] !== "stock" || words.length !== 9) return null
    const [x0, y0, x1, y1, top] = words.slice(4).map(Number)
    stock = { min: [x0, y0], max: [x1, y1], top }
  }
  const parsed = SimulatedBedSchema.safeParse({
    stock,
    support: Number(words[2]),
  })
  return parsed.success ? parsed.data : null
}
