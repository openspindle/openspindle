import { z } from "zod"
import { PlateAssistsSchema } from "./assists.ts"
import { HEIGHT_MAP_LIMITS } from "./height-map.ts"
import {
  COORDINATE_LIMIT,
  DisplayNameSchema,
  utf8ByteLength,
} from "./primitives.ts"
import { JobProgressSchema } from "./telemetry.ts"

const MiB = 1024 * 1024

export const RUN_LIMITS = {
  /** The largest program Run accepts, in UTF-8 bytes and source lines. */
  programBytes: 10 * MiB,
  programLines: 1_000_000,
  /**
   * The largest file sent to the machine. A longer program is sent as parts split at its tool
   * changes (`ProgramPart`), all of them before the first plays.
   */
  fileBytes: 4 * MiB,
  fileLines: 250_000,
} as const

export const RunRequestSchema = z.strictObject({
  /** A fresh UUID per Run; a used ID is never replayed. */
  id: z.uuid(),
  name: DisplayNameSchema,
  source: z
    .string()
    .min(1, "The NC program is empty.")
    .refine(
      (source) => utf8ByteLength(source) <= RUN_LIMITS.programBytes,
      `Run supports NC programs up to ${RUN_LIMITS.programBytes / MiB} MiB.`
    ),
  assists: PlateAssistsSchema.nullable(),
})
export type RunRequest = z.infer<typeof RunRequestSchema>

export const ProgramChangeSchema = z.object({
  line: z.int().positive(),
  before: z.string(),
  after: z.string(),
  reason: z.enum([
    "line-number",
    "case",
    "pause",
    "tool-number",
    "tool-change-stop",
    "spindle-speed",
  ]),
})
export type ProgramChange = z.infer<typeof ProgramChangeSchema>

/**
 * One file of a program sent as several: prepared lines from a tool change up to the next
 * part's, between lines the dialect adds so that the part plays as it would within the whole.
 */
export const ProgramPartSchema = z.object({
  /** Inclusive 1-based lines of the prepared program. */
  startLine: z.int().positive(),
  endLine: z.int().positive(),
  /** Restores the modal state the program had reached at the cut. */
  before: z.array(z.string()),
  /** Ends the part with the machine idle, as the next one expects. */
  after: z.array(z.string()),
  /** The part's file, in bytes. */
  bytes: z.int().nonnegative(),
})
export type ProgramPart = z.infer<typeof ProgramPartSchema>

/** What the machine will actually execute after dialect normalization. */
export const PreparedProgramSchema = z.object({
  text: z.string(),
  lineCount: z.int().nonnegative(),
  bytes: z.int().nonnegative(),
  /** 1-based lines holding the dialect's program pause. */
  pauseLines: z.array(z.int().positive()),
  changes: z.array(ProgramChangeSchema),
  /** Total changes; `changes` is capped. */
  changeCount: z.int().nonnegative(),
  /**
   * The files the program is sent as, in order: one with every line, or parts when it exceeds
   * a file's limits. None from a main process before parts, which sent every line as one.
   */
  parts: z.array(ProgramPartSchema).default([]),
})
export type PreparedProgram = z.infer<typeof PreparedProgramSchema>

/** The prepared program without its text, as carried in job state. */
export const programInfo = ({ text: _text, ...info }: PreparedProgram) => info

/** The files a prepared program is sent as. */
export const programParts = (
  program: Pick<PreparedProgram, "parts" | "lineCount" | "bytes">
): readonly ProgramPart[] =>
  program.parts.length
    ? program.parts
    : [
        {
          startLine: 1,
          endLine: program.lineCount,
          before: [],
          after: [],
          bytes: program.bytes,
        },
      ]

/** A part's file, from the prepared program's lines (`text` split at line feeds). */
export const partText = (lines: readonly string[], part: ProgramPart) =>
  `${[...part.before, ...lines.slice(part.startLine - 1, part.endLine), ...part.after].join("\n")}\n`

/** The lines of a part's file. */
export const partLineCount = (part: ProgramPart) =>
  part.before.length + part.endLine - part.startLine + 1 + part.after.length

/**
 * The program line a line of a part's file plays. Lines the dialect adds belong to the part's
 * ends: before its first line nothing of the part has played.
 */
export function programLineOf(part: ProgramPart, fileLine: number): number {
  const index = fileLine - part.before.length
  if (index < 1) return part.startLine - 1
  return Math.min(part.endLine, part.startLine + index - 1)
}

/** The line of a part's file that plays a program line of the part. */
export const fileLineOf = (part: ProgramPart, programLine: number) =>
  part.before.length + programLine - part.startLine + 1

export const PrepareResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), program: PreparedProgramSchema }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
    line: z.int().positive().nullable(),
  }),
])
export type PrepareResult = z.infer<typeof PrepareResultSchema>

export const JOB_PHASES = [
  "preparing",
  "uploading",
  "verifying",
  "starting",
  "running",
  "paused",
  "finishing",
  "cleaning",
  "completed",
  "stopped",
  "failed",
  "unverified",
  "lost",
] as const
export const JobPhaseSchema = z.enum(JOB_PHASES)
export type JobPhase = z.infer<typeof JobPhaseSchema>

const TERMINAL_PHASES: ReadonlySet<JobPhase> = new Set([
  "completed",
  "stopped",
  "failed",
  "unverified",
  "lost",
])
export const isTerminalJobPhase = (phase: JobPhase) =>
  TERMINAL_PHASES.has(phase)

export const JobWaitSchema = z.object({
  reason: z.enum(["tool-change", "program-pause", "hold"]),
  /** The 1-based program line the player stopped at, when reported. */
  line: z.int().nonnegative().nullable(),
  requestedTool: z.int().nullable(),
  since: z.number(),
})
export type JobWait = z.infer<typeof JobWaitSchema>

export const JobFaultSchema = z.object({
  at: z.number(),
  line: z.int().nonnegative().nullable(),
  message: z.string(),
})
export type JobFault = z.infer<typeof JobFaultSchema>

const MachineXyzSchema = z.tuple([z.number(), z.number(), z.number()])
const Height = z.number().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT)

/** A probe contact the machine reported during the job, in machine coordinates. */
export const TouchMeasurementSchema = z.object({
  kind: z.literal("touch"),
  /** The stock (the machine's Z probe) or its tool sensor measuring the tool changed to. */
  target: z.enum(["surface", "tool-sensor"]),
  /** The tool a tool-sensor touch measured, when reported. */
  tool: z.int().nullable(),
  machine: MachineXyzSchema,
  /** Its work X and Y, from the work origin the machine reported with it; null without one. */
  work: z.tuple([z.number(), z.number()]).nullable().default(null),
  /** The program line the machine reported while measuring; null when it reported none. */
  line: z.int().nonnegative().nullable(),
  at: z.number(),
})

/**
 * A rectangular grid the machine probed during the job: filled in point by point as it reports
 * them, then replaced by the height map it prints. Heights are relative to the first point, rows
 * from the grid's far edge down as the machine prints them.
 */
export const GridMeasurementSchema = z.object({
  kind: z.literal("grid"),
  /** Machine X and Y of the first point. */
  start: z.tuple([z.number(), z.number()]),
  width: z.number(),
  depth: z.number(),
  columns: z.int().min(2).max(HEIGHT_MAP_LIMITS.axisSamples),
  rows: z.int().min(2).max(HEIGHT_MAP_LIMITS.axisSamples),
  heights: z.array(z.array(Height.nullable())),
  /** Millimetre offsets from the first point, in the order of `heights`. */
  xCoordinates: z.array(Height),
  yCoordinates: z.array(Height),
  /** The spread between the highest and lowest point, as the machine reported it. */
  range: z.number().nullable(),
  status: z.enum(["probing", "completed", "failed"]),
  /** The program line the machine reported when the grid started; null when it reported none. */
  line: z.int().nonnegative().nullable(),
  at: z.number(),
})

/**
 * The most contacts one 3D probing routine may report, with room to spare: it makes at most 10,
 * two on a top and two on each of two sides on each of two axes.
 */
export const MAX_ROUTINE_CONTACTS = 16

/**
 * The contacts one of the machine's 3D probing routines reported during the job, in machine
 * coordinates and in the order it made them: a top, then its sides, each touched twice.
 */
export const ContactsMeasurementSchema = z.object({
  kind: z.literal("contacts"),
  contacts: z.array(MachineXyzSchema).max(MAX_ROUTINE_CONTACTS),
  /** The program line the machine reported at the first contact; null when it reported none. */
  line: z.int().nonnegative().nullable(),
  at: z.number(),
})

export const JobMeasurementSchema = z.discriminatedUnion("kind", [
  TouchMeasurementSchema,
  GridMeasurementSchema,
  ContactsMeasurementSchema,
])
export type JobMeasurement = z.infer<typeof JobMeasurementSchema>
export type TouchMeasurement = z.infer<typeof TouchMeasurementSchema>
export type GridMeasurement = z.infer<typeof GridMeasurementSchema>
export type ContactsMeasurement = z.infer<typeof ContactsMeasurementSchema>

export const JobStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  phase: JobPhaseSchema,
  program: PreparedProgramSchema.omit({ text: true }),
  /** The part being sent or played, an index into the program's parts. */
  part: z.int().nonnegative().default(0),
  transfer: z.object({
    uploadedBytes: z.int().nonnegative(),
    verifiedBytes: z.int().nonnegative(),
    totalBytes: z.int().nonnegative(),
  }),
  progress: JobProgressSchema.nullable(),
  /**
   * The line after the last program pause the job resumed from, where the machine plays on.
   * The reported line moves only with feed moves (G1, G2, G3), so after a pause it can stay on
   * the line before it while probing, rapids and tool changes run. Null before any resume.
   */
  resumedLine: z.int().nonnegative().nullable().default(null),
  wait: JobWaitSchema.nullable(),
  faults: z.array(JobFaultSchema),
  /**
   * What the machine measured, in the order it reported it: only its own routines report.
   * Empty when a main process from before measurements sends the job.
   */
  measurements: z.array(JobMeasurementSchema).max(100).default([]),
  /** Finishing or cleaning is taking longer than expected; the job is still tracked. */
  overdue: z.boolean(),
  /** Bed cleaning after the program, as observed before play. */
  bedClean: z.boolean().nullable(),
  error: z.string().nullable(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
})
export type JobState = z.infer<typeof JobStateSchema>

export const isJobActive = (job: JobState | null | undefined) =>
  !!job && !isTerminalJobPhase(job.phase)
