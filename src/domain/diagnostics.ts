import type { Point3 } from "./nc/gcode"

/** Errors block Run and NC export; warnings do not. */
export type Severity = "error" | "warning"

/** A fix the UI can offer next to a diagnostic. */
export type QuickFix =
  | { readonly kind: "assign-tool"; readonly toolNumber: number | null }
  | { readonly kind: "read-anchors" }
  | { readonly kind: "edit-operation"; readonly operationId: string }
  /** Changes an operation's NC as one of its machine's program rules offers (`ProgramFix`). */
  | {
      readonly kind: "resolve-rule"
      readonly operationId: string
      readonly rule: string
      readonly resolution: "drop" | "replace"
    }

/** The plate as a whole: its program, rather than one of its operations. */
export type PlateSubject = { readonly kind: "plate" }

/** A part of the plate's setup: its work origin. */
export type PlateSetupSubject = {
  readonly kind: "setup"
  readonly part: "work-origin"
}

/** One of the plate's operations. */
export type OperationSubject = {
  readonly kind: "operation"
  readonly operationId: string
}

/** An entry of the plate's tool table, by its number; null is the implicit tool's. */
export type ToolSubject = {
  readonly kind: "tool"
  readonly number: number | null
}

/** What a diagnostic is about: what the UI leads to from it, and counts it under. */
export type Subject =
  PlateSubject | PlateSetupSubject | OperationSubject | ToolSubject

export const PLATE_SUBJECT: PlateSubject = { kind: "plate" }

export const WORK_ORIGIN_SUBJECT: PlateSetupSubject = {
  kind: "setup",
  part: "work-origin",
}

export const operationSubject = (operationId: string): OperationSubject => ({
  kind: "operation",
  operationId,
})

export const toolSubject = (number: number | null): ToolSubject => ({
  kind: "tool",
  number,
})

/** A point on the plate's bed, such as where a probe starts. */
export type Point = { readonly kind: "point"; readonly at: Point3 }

/** A line through points on the bed, such as where a probe comes down. */
export type Path = {
  readonly kind: "path"
  readonly points: readonly [Point3, ...Point3[]]
}

/** The box between two corners on the bed, flat when their Z is the same, such as a probe grid. */
export type Area = {
  readonly kind: "area"
  readonly min: Point3
  readonly max: Point3
}

/** Where a diagnostic is on its plate's bed, in bed coordinates: what the 3D view marks. */
export type Place = Point | Path | Area

/** Inclusive 1-based lines of the compiled program. */
export type ProgramLines = { readonly start: number; readonly end: number }

/**
 * Something about a plate the user should see: what it is about, and where it is when it has a
 * place on the bed or in the program. Errors block Run and NC export; warnings do not.
 * Compilation reports problems this way instead of throwing.
 */
export type Diagnostic = {
  readonly severity: Severity
  readonly code: string
  readonly message: string
  readonly subject: Subject
  /** Where it is on the plate's bed. */
  readonly places?: readonly Place[]
  /** The lines of the compiled program it concerns. */
  readonly lines?: readonly ProgramLines[]
  /**
   * 1-based line, when known: in the operation's own NC for an operation's diagnostic, else in
   * the compiled program.
   */
  readonly line?: number
  readonly fix?: QuickFix
}

type DiagnosticDetails = Omit<Diagnostic, "severity" | "code" | "message">

export const error = (
  code: string,
  message: string,
  details: DiagnosticDetails
): Diagnostic => ({ severity: "error", code, message, ...details })

export const warning = (
  code: string,
  message: string,
  details: DiagnosticDetails
): Diagnostic => ({ severity: "warning", code, message, ...details })

export const blocking = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.filter((diagnostic) => diagnostic.severity === "error")

/** The operation a diagnostic is about; null when it is about something else. */
export const diagnosticOperation = ({
  subject,
}: Pick<Diagnostic, "subject">) =>
  subject.kind === "operation" ? subject.operationId : null

function subjectKey(subject: Subject): string {
  switch (subject.kind) {
    case "plate":
      return "plate"
    case "setup":
      return `setup:${subject.part}`
    case "operation":
      return `operation:${subject.operationId}`
    case "tool":
      return `tool:${subject.number ?? "implicit"}`
  }
}

/** A diagnostic and the key it keeps while it stays, through edits that change its message. */
export type KeyedDiagnostic<TDiagnostic extends Diagnostic = Diagnostic> = {
  readonly key: string
  readonly diagnostic: TDiagnostic
}

/**
 * Keys a list's diagnostics by their code and subject, numbered where a subject has a code more
 * than once. Any list holding all of a subject's diagnostics, such as an operation's part of its
 * plate's, keys them alike.
 */
export function keyDiagnostics<TDiagnostic extends Diagnostic>(
  diagnostics: readonly TDiagnostic[]
): KeyedDiagnostic<TDiagnostic>[] {
  const seen = new Map<string, number>()
  return diagnostics.map((diagnostic) => {
    const key = `${diagnostic.code}|${subjectKey(diagnostic.subject)}`
    const count = seen.get(key) ?? 0
    seen.set(key, count + 1)
    return { key: count ? `${key}|${count}` : key, diagnostic }
  })
}

/**
 * What a check finds before it is known what the finding is about, such as what stops an
 * operation's NC being generated, which its caller makes a diagnostic.
 */
export type Issue<TCode extends string = string> = {
  readonly severity: Severity
  readonly code: TCode
  /** User-facing explanation, ready to display. */
  readonly message: string
  readonly places?: readonly Place[]
}

/** The issues of one family of codes: `const probeError = issueOf<Probe3dIssueCode>("error")`. */
export const issueOf =
  <TCode extends string>(severity: Severity) =>
  (
    code: TCode,
    message: string,
    details: Pick<Issue, "places"> = {}
  ): Issue<TCode> => ({ severity, code, message, ...details })
