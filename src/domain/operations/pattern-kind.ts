import { PLAIN_NC } from "../compile/nc-unit"
import { error, operationSubject } from "../diagnostics"
import { fail, ok } from "../primitives"
import type { OperationKind } from "./kinds"

export const patternKind: OperationKind<"pattern"> = {
  kind: "pattern",
  label: "Pattern / Texture",
  verbatim: false,
  generated: false,
  phase: () => "machining",
  tools: ({ source }) => [
    source.tool,
    ...(source.definition.layers ?? []).flatMap((layer) => {
      if (layer.kind === "formula") return [layer.formula.tool]
      if (layer.kind === "cutout") return [layer.tool]
      return []
    }),
  ],
  resolve: (operation, _plate, { kit }) => {
    const { nc } = operation.source
    if (nc === null)
      return fail(
        error(
          "operation-pending",
          `Generate the pattern toolpath for "${operation.name}" before running it.`,
          {
            subject: operationSubject(operation.id),
            fix: { kind: "edit-operation", operationId: operation.id },
          }
        )
      )
    if (!kit.patternApproach.length)
      return ok({ nc, policy: PLAIN_NC, reviewLines: [] })
    const lines = nc.split(/\r?\n/)
    // Both generators emit this header. Require it before inserting machine travel,
    // including for patterns already saved by older versions of OpenSpindle.
    const changes = lines.flatMap((line, index) =>
      /^T\d+ M6$/.test(line) ? [index] : []
    )
    if (
      changes[0] !== 2 ||
      lines[1] !== "G21 G90 G17 G94" ||
      changes.some(
        (index) =>
          !/^S\d+ M3$/.test(lines[index + 1] ?? "") ||
          (index !== 2 && lines[index - 1] !== "M5")
      )
    )
      return fail(
        error(
          "operation-unsafe",
          `Regenerate the pattern toolpath for "${operation.name}" to restore its tool-change approach.`,
          {
            subject: operationSubject(operation.id),
            fix: { kind: "edit-operation", operationId: operation.id },
          }
        )
      )
    for (const change of changes.reverse())
      lines.splice(change + 1, 0, ...kit.patternApproach)
    return ok({ nc: lines.join("\n"), policy: PLAIN_NC, reviewLines: [] })
  },
}
