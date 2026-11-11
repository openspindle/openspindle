import type { GCodeProgram } from "../nc/gcode"

/** The parser starts with placeholder T1; section metadata identifies moves before a real selection. */
export function implicitToolMoves(
  program: GCodeProgram,
  runs: readonly { readonly tool: number | null; readonly lineStart: number }[]
): number {
  const change = runs.find((run) => run.tool !== null)
  const parsed = program.segments.at(0)?.tool
  let count = 0
  for (const { line, tool } of program.segments) {
    const changed =
      !!change &&
      (line > change.lineStart ||
        (line === change.lineStart && change.tool === parsed))
    if (tool !== parsed || changed) break
    count++
  }
  return count
}
