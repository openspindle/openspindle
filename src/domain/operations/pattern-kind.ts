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
  tools: ({ source }) => [source.tool],
  resolve: (operation) => {
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
    return ok({ nc, policy: PLAIN_NC, reviewLines: [] })
  },
}
