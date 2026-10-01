import { useId } from "react"
import { Badge } from "@/components/ui/badge"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import { diagnosticOperation } from "@/domain/diagnostics"
import type { KeyedDiagnostic } from "@/domain/diagnostics"
import type { Operation } from "@/domain/operations/operation"
import type { Plate } from "@/domain/plate/plate"
import type { PrepareSearch } from "@/routes/_workspace/prepare"
import { useKeyedDiagnostics } from "@/app/workspace/use-plate-diagnostics"
import { useOperationKindLabel } from "@/features/prepare/use-operation-kind-label"
import { DiagnosticsList } from "./diagnostics-list"
import { NameField } from "@/components/name-field"
import { OperationEditor } from "./operation-editors"
import { OperationToolsPanel } from "./operation-tools-panel"

/** Name and Stop before: what every operation has, whatever its kind. */
function OperationBasics({
  plate,
  operation,
}: {
  plate: Plate
  operation: Operation
}) {
  const workspace = useWorkspaceStore()
  const id = useId()
  const target = { plateId: plate.id, operationId: operation.id }
  return (
    <FieldGroup>
      <NameField
        name={operation.name}
        onRename={(name) =>
          workspace.dispatch({ type: "operation.rename", ...target, name })
        }
      />
      <Field orientation="horizontal">
        <Switch
          id={`${id}-stop`}
          checked={operation.stopBefore}
          onCheckedChange={(value) =>
            workspace.dispatch({
              type: "operation.stopBefore",
              ...target,
              value,
            })
          }
        />
        <FieldLabel htmlFor={`${id}-stop`}>
          Pause before this operation
        </FieldLabel>
      </Field>
    </FieldGroup>
  )
}

/**
 * An operation's diagnostics as its inspector shows them. A pending PCB operation is its
 * editor's to explain, and Edit would only open the operation already open.
 */
function inspectorDiagnostics(
  diagnostics: readonly KeyedDiagnostic[],
  operationId: string
): KeyedDiagnostic[] {
  return diagnostics.flatMap((keyed) => {
    const { diagnostic } = keyed
    if (
      diagnosticOperation(diagnostic) !== operationId ||
      diagnostic.code === "operation-pending"
    )
      return []
    return diagnostic.fix?.kind === "edit-operation"
      ? [{ ...keyed, diagnostic: { ...diagnostic, fix: undefined } }]
      : [keyed]
  })
}

/** The selected operation: its source, settings and tools. */
export function OperationInspector({
  plate,
  operation,
  panel,
  onPanel,
}: {
  plate: Plate
  operation: Operation
  panel: PrepareSearch["panel"]
  onPanel: (panel: PrepareSearch["panel"]) => void
}) {
  const diagnostics = inspectorDiagnostics(
    useKeyedDiagnostics(plate),
    operation.id
  )
  const kindLabel = useOperationKindLabel(operation)
  return (
    <Tabs
      value={panel === "tools" ? "tools" : "operation"}
      onValueChange={(value) =>
        onPanel(value === "tools" ? "tools" : undefined)
      }
      className="min-h-0 flex-1 gap-0 border-t"
    >
      <TabsList
        variant="line"
        className="w-full shrink-0 border-b px-2"
        aria-label="Operation settings"
      >
        <TabsTrigger value="operation">{kindLabel}</TabsTrigger>
        <TabsTrigger value="tools">
          Tools
          <Badge variant="secondary" className="font-numeric">
            {operation.tools.length}
          </Badge>
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="operation"
        className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4"
      >
        <DiagnosticsList plate={plate} diagnostics={diagnostics} />
        <OperationBasics
          key={operation.id}
          plate={plate}
          operation={operation}
        />
        <OperationEditor plate={plate} operation={operation} />
      </TabsContent>
      <TabsContent value="tools" className="min-h-0 overflow-y-auto">
        <OperationToolsPanel plate={plate} operation={operation} />
      </TabsContent>
    </Tabs>
  )
}
