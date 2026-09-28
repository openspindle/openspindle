import { useOperation, useViewContext } from "@openspindle/plugin-sdk"
import { FieldDescription } from "@openspindle/plugin-sdk/ui"
import { readData } from "./operation-data"
import { OperationEditor } from "./operation-editor"

/** The side-panel editor of the PCB operation the app selected. */
export function EditorView() {
  const { operationId, disabled } = useViewContext()
  if (!operationId)
    return (
      <FieldDescription>
        Select a PCB operation in the process to edit it.
      </FieldDescription>
    )
  return (
    <OperationPanel
      key={operationId}
      operationId={operationId}
      disabled={disabled}
    />
  )
}

function OperationPanel({
  operationId,
  disabled,
}: {
  operationId: string
  disabled: boolean
}) {
  const { operation, isPending, error, save } = useOperation(operationId)
  if (!operation) {
    if (isPending)
      return (
        <FieldDescription role="status">
          Loading the operation…
        </FieldDescription>
      )
    return (
      <FieldDescription role="alert">
        {error?.message ?? "This operation is no longer available."}
      </FieldDescription>
    )
  }
  const saved = readData(operation.data)
  if (!saved)
    return (
      <FieldDescription>
        This operation uses an unsupported PCB settings format.
      </FieldDescription>
    )
  return (
    <OperationEditor
      operation={operation}
      saved={saved}
      save={save}
      disabled={disabled}
    />
  )
}
