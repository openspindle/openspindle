import { z } from "zod"
import {
  ProbeCheckBindingSchema,
  ProbeSearchTravelSchema,
  ProbeTopGapSchema,
} from "@/machine/contract"
import type { XYZ } from "../geometry/frame"
import { toMicrometre } from "../primitives"

/** Application limits for the known-width Boss-X calibration, not machine ratings. */
export const ProbeCalibrationSettingsSchema = z
  .object({
    width: z.number().finite().min(0.01).max(100),
    distance: z.number().finite().min(2).max(100),
    depth: z.number().finite().min(0.5).max(10),
    diameter: z.number().finite().min(0.5).max(10),
  })
  .superRefine((value, ctx) => {
    if (value.distance <= value.width / 2 + value.diameter / 2 + 1)
      ctx.addIssue({
        code: "custom",
        path: ["distance"],
        message:
          "Use more than half the width plus the ball radius and 1 mm clearance.",
      })
  })

export type DiameterReading = {
  readonly left: number
  readonly right: number
  readonly span: number
  readonly diameter: number
  readonly contacts: readonly XYZ<"machine">[]
}

/** GabrielMaker's method: average BOTH touches per side, then subtract the known width. */
export function bossDiameterReading(
  contacts: readonly XYZ<"machine">[],
  width: number
): DiameterReading {
  if (!Number.isFinite(width) || width <= 0 || width > 100)
    throw new Error("Enter a known reference width between 0 and 100 mm.")
  if (
    contacts.length !== 6 ||
    contacts.some((point) =>
      point.some((value) => !Number.isFinite(value) || Math.abs(value) > 10000)
    )
  )
    throw new Error(
      "One Boss-X cycle needs exactly six successful contacts: two top, two left and two right."
    )
  const sides = contacts.slice(2)
  if (
    Math.max(...sides.map((point) => point[2])) -
      Math.min(...sides.map((point) => point[2])) >
      0.01 ||
    Math.max(...sides.map((point) => point[1])) -
      Math.min(...sides.map((point) => point[1])) >
      0.01
  )
    throw new Error(
      "Side contacts must share a Z level and Y position within 0.01 mm. Use one complete Boss-X cycle."
    )
  if (
    Math.abs(sides[0][0] - sides[1][0]) > 0.1 ||
    Math.abs(sides[2][0] - sides[3][0]) > 0.1
  )
    throw new Error(
      "The two touches on a side differ by more than 0.1 mm. Check the setup and repeat."
    )
  const left = (sides[0][0] + sides[1][0]) / 2
  const right = (sides[2][0] + sides[3][0]) / 2
  const span = right - left
  const diameter = span - width
  if (!Number.isFinite(diameter) || diameter < 0.5 || diameter > 10)
    throw new Error(
      "Effective diameter must be 0.5–10 mm. Check the reference width, axis and complete log."
    )
  return { left, right, span, diameter, contacts }
}

/** Pasted logs are DATA only: never execute their commands or HTML. */
export function parseDiameterLog(text: string, width: number): DiameterReading {
  if (text.length > 256000)
    throw new Error("Paste only one complete Boss-X cycle (up to 256 kB).")
  const commands = [...text.matchAll(/\bM480\.10\b[^\r\n]*/gi)]
  if (commands.length !== 1)
    throw new Error(
      "Include exactly one M480.10 command followed by its complete contacts."
    )
  const command = commands[0]
  const words = [...command[0].matchAll(/\b([DXYZ])\s*([+-]?\d+(?:\.\d+)?)/gi)]
  const values = new Map(
    words.map((word) => [word[1].toUpperCase(), Number(word[2])])
  )
  if (
    words.length !== 4 ||
    values.size !== 4 ||
    values.get("Y") !== 0 ||
    !(values.get("X")! > 0) ||
    !(values.get("Z")! > 0) ||
    !(values.get("D")! >= 0.5 && values.get("D")! <= 10)
  )
    throw new Error(
      "Use Boss/Block-X only: M480.10 with D, positive X and Z, and Y0."
    )
  const body = text.slice(command.index + command[0].length)
  if (/\bM480(?:\.|\s)|aborted|alarm|failed|halt/i.test(body))
    throw new Error(
      "The log contains another routine or a failure. Use one successful cycle."
    )
  const reports = [...body.matchAll(/\[PRB:([^\]]*)\]/gi)]
  const contacts: XYZ<"machine">[] = reports.map((report) => {
    const match =
      /^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*:\s*1\s*$/.exec(
        report[1]
      )
    if (!match) throw new Error("A probe report failed or is malformed.")
    return [Number(match[1]), Number(match[2]), Number(match[3])]
  })
  return bossDiameterReading(contacts, width)
}

export function diameterAverage(readings: readonly DiameterReading[]) {
  if (readings.length !== 3)
    throw new Error("Collect three separate readings first.")
  const average =
    readings.reduce((sum, reading) => sum + reading.diameter, 0) / 3
  const range =
    Math.max(...readings.map((reading) => reading.diameter)) -
    Math.min(...readings.map((reading) => reading.diameter))
  if (range > 0.02)
    throw new Error(
      "Readings differ by more than 0.02 mm. Check mounting, reference alignment and cleanliness, then repeat."
    )
  return { average, range, diameter: toMicrometre(average) }
}

/** Frozen checked start and operator-selected search travel, never a probe overtravel rating. */
export const BoundedDiameterSchema = z
  .strictObject({
    binding: ProbeCheckBindingSchema,
    deviceId: z.string().min(1).max(500),
    gap: ProbeTopGapSchema,
    width: z.number().finite().min(2).max(100),
    distance: z.number().finite().min(2).max(100),
    depth: z.number().finite().min(0.5).max(10),
    diameter: z.number().finite().min(0.5).max(3.2),
    maxTravel: z.tuple([
      ProbeSearchTravelSchema,
      ProbeSearchTravelSchema,
      ProbeSearchTravelSchema,
    ]),
  })
  .superRefine((value, ctx) => {
    if (value.distance <= value.width / 2 + value.diameter / 2 + 1)
      ctx.addIssue({
        code: "custom",
        path: ["distance"],
        message:
          "Offset must exceed half the reference width plus ball radius and 1 mm clearance.",
      })
    if (value.depth < value.diameter + 0.25)
      ctx.addIssue({
        code: "custom",
        path: ["depth"],
        message:
          "Side depth must exceed the ball diameter by at least 0.25 mm.",
      })
    if (value.maxTravel[2] <= value.gap)
      ctx.addIssue({
        code: "custom",
        path: ["maxTravel", 2],
        message: "Downward search must exceed the estimated top gap.",
      })
    const sideGap = value.distance - value.width / 2 - value.diameter / 2
    if (
      value.maxTravel
        .slice(0, 2)
        .some((distance) => distance <= sideGap || distance >= value.distance)
    )
      ctx.addIssue({
        code: "custom",
        path: ["maxTravel"],
        message:
          "Each side search must exceed its estimated gap and remain shorter than the center-to-side offset.",
      })
  })
export type BoundedDiameter = z.infer<typeof BoundedDiameterSchema>
