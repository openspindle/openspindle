import { z } from "zod"
import { Z1_SPINDLE_RANGE } from "../../../domain/fixtures/makera-z1/work-envelope.ts"
import {
  SimulatedJogSampleSchema,
  SimulatedJogReceiptSchema,
  SimulatedJogActionSchema,
} from "../../contract/simulator-jog.ts"
import type { SimulatedJogSample } from "../../contract/simulator-jog.ts"
import type { OutboundFrame } from "../adapter.ts"
import { FRAME_TYPES } from "./codec.ts"

// Z1/Z1 Pro product specifications: 13,000 RPM; Carvera's 15,000 is a different spindle.
export const SIMULATOR_SPINDLE_LIMITS = Z1_SPINDLE_RANGE

const CommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("begin"),
    sessionId: z.string().uuid(),
    mode: z.enum(["step", "direct"]),
  }),
  z.strictObject({
    kind: z.literal("sample"),
    sample: SimulatedJogSampleSchema,
  }),
  z.strictObject({ kind: z.literal("end"), sessionId: z.string().uuid() }),
  z.strictObject({
    kind: z.literal("action"),
    input: SimulatedJogActionSchema,
  }),
])
export type SimulatorJogWireCommand = z.infer<typeof CommandSchema>
const ReplySchema = SimulatedJogReceiptSchema.extend({
  ok: z.boolean(),
  reason: z.string().max(240).nullable(),
})
export type SimulatorJogReply = z.infer<typeof ReplySchema>
function readJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}
export function simulatorJogFrame(
  command: SimulatorJogWireCommand
): OutboundFrame {
  return {
    type: FRAME_TYPES.command,
    payload: `sim-jog ${JSON.stringify(command)}`,
  }
}
export function readSimulatorJogCommand(
  text: string
): SimulatorJogWireCommand | null {
  if (!text.startsWith("sim-jog ")) return null
  const result = CommandSchema.safeParse(readJson(text.slice(8)))
  return result.success ? result.data : null
}
export function readSimulatorJogReply(text: string): SimulatorJogReply | null {
  if (!text.startsWith("sim-jog-reply ")) return null
  const result = ReplySchema.safeParse(readJson(text.slice(14)))
  return result.success ? result.data : null
}
export const simulatorJogReplyLine = (reply: SimulatorJogReply) =>
  `sim-jog-reply ${JSON.stringify(reply)}`
export const simulatorJogProtocol = {
  frame: simulatorJogFrame,
  reply: readSimulatorJogReply,
}
export type SimulatorJogProtocol = typeof simulatorJogProtocol
export const sampleCommand = (
  sample: SimulatedJogSample
): SimulatorJogWireCommand => ({ kind: "sample", sample })
