import { z } from "zod"

export const HistorySummarySchema = z.object({
  id: z.uuid(),
  name: z.string().max(200),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  phase: z.string().max(40),
  activeMs: z.number().nonnegative(),
  pausedMs: z.number().nonnegative(),
  frames: z.int().min(0).max(120),
  frameTimes: z.array(z.number()).max(120),
  notes: z.array(z.string().max(1000)).max(20),
})
export type HistorySummary = z.infer<typeof HistorySummarySchema>
export const HistoryRecordSchema = z.object({
  summary: HistorySummarySchema,
  source: z.string().max(10 * 1024 * 1024),
  prepared: z.string().max(16 * 1024 * 1024),
  snapshot: z
    .string()
    .max(100 * 1024 * 1024)
    .nullable(),
  events: z
    .array(
      z.object({
        at: z.number(),
        phase: z.string(),
        line: z.number().nullable(),
      })
    )
    .max(2000),
  machine: z.string().max(4 * 1024 * 1024),
})
export type HistoryRecord = z.infer<typeof HistoryRecordSchema>
const id = z.object({ id: z.uuid() })
export const historyMethods = {
  "history.list": {
    params: z.undefined(),
    result: z.array(HistorySummarySchema).max(512),
    timeoutMs: 60000,
  },
  "history.read": { params: id, result: HistoryRecordSchema, timeoutMs: 60000 },
  "history.frame": {
    params: id.extend({ index: z.int().min(0).max(119) }),
    result: z
      .string()
      .max(6 * 1024 * 1024)
      .nullable(),
    timeoutMs: 60000,
  },
  "history.remove": { params: id, result: z.void(), timeoutMs: 60000 },
} as const
export interface HistoryStore {
  list: () => Promise<HistorySummary[]>
  read: (id: string) => Promise<HistoryRecord>
  frame: (id: string, index: number) => Promise<string | null>
  remove: (id: string) => Promise<void>
}
