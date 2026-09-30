import { useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { BookOpen, Download } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { exportPlateProgram } from "@/app/workspace/export-program"
import { usePlateDiagnostics } from "@/app/workspace/use-plate-diagnostics"
import { usePlateIndex, useWorkspace } from "@/app/workspace/workspace-context"
import { compileOperation, compilePlate } from "@/domain/compile/compile"
import { plateLabel } from "@/domain/plate/plate"
import type { Plate } from "@/domain/plate/plate"
import { GCodeLines } from "@/features/job/gcode-listing"
import type { ProgramCheck } from "@/features/job/program-check"
import { AppDialog } from "@/features/shell/app-dialog"
import { openDialog } from "@/features/shell/dialogs"
import { suggestedFileName } from "@/platform/contract/files"
import { useHost } from "@/platform/host-context"

type View = "nc" | "setup"

/** The source as it is written: the machine's dialect is not asked what it would change. */
const AS_WRITTEN: ProgramCheck = {
  status: "unavailable",
  reason: "The source is shown as it is written.",
}

/** The plate's setup as it is embedded in exported NC; models are shortened for reading. */
const setupText = (plate: Plate) =>
  JSON.stringify(
    { name: plate.name, setup: plate.setup, tools: plate.tools },
    (key, value: unknown) =>
      key === "url" && typeof value === "string" && value.startsWith("data:")
        ? `${value.slice(0, 35)}… (embedded GLB)`
        : value,
    2
  )

/** Exports the plate unless what blocks Run (the Prepare inspector's diagnostics) blocks it. */
function useExportProgram(plate: Plate) {
  const host = useHost()
  const tools = useWorkspace((state) => state.tools)
  const diagnostics = usePlateDiagnostics(plate)
  const label = plateLabel(plate, usePlateIndex(plate.id))
  return useMutation({
    mutationFn: async () => {
      const exported = exportPlateProgram(plate, tools, diagnostics)
      if (!exported.ok) throw new Error(exported.error)
      return host.files.save({
        kind: "program",
        suggestedName: suggestedFileName("program", label, "program"),
        contents: exported.value,
      })
    },
    onSuccess: (result) => {
      if (result.status === "canceled") return
      toast.success("Saved with the plate's setup.")
    },
  })
}

/**
 * Reads an operation's or plate's NC as the Job tab lists it, and exports the plate with its
 * setup embedded.
 */
export function ProgramSourceDialog({
  plateId,
  operationId,
  onClose,
}: {
  plateId: string
  operationId: string | null
  onClose: () => void
}) {
  const plate = useWorkspace((state) =>
    state.plates.find((item) => item.id === plateId)
  )
  const tools = useWorkspace((state) => state.tools)
  const index = usePlateIndex(plateId)
  const [view, setView] = useState<View>("nc")
  const [line, setLine] = useState(0)
  const operation = plate?.operations.find((item) => item.id === operationId)
  // An operation's own NC, or the plate's whole program.
  const compiled = useMemo(() => {
    if (!plate) return null
    return operation
      ? compileOperation(plate, operation, tools)
      : compilePlate(plate, tools)
  }, [plate, operation, tools])
  const setup = useMemo(() => (plate ? setupText(plate) : ""), [plate])
  if (!plate || !compiled) return null
  return (
    <AppDialog
      title={operation?.name ?? plateLabel(plate, index)}
      width="wide"
      onClose={onClose}
      footer={
        <SourceActions
          plate={plate}
          onGlossary={() =>
            openDialog({
              kind: "gcode-glossary",
              back: { kind: "source", plateId, operationId },
            })
          }
        />
      }
    >
      <Tabs
        value={view}
        onValueChange={(value) => setView(value === "setup" ? "setup" : "nc")}
      >
        <TabsList aria-label="Source view">
          <TabsTrigger value="nc">NC source</TabsTrigger>
          <TabsTrigger value="setup">Plate setup</TabsTrigger>
        </TabsList>
        <TabsContent value="nc">
          {compiled.mode === "empty" ? (
            <Alert>
              <AlertDescription>
                {compiled.diagnostics.at(0)?.message ??
                  "There is no program yet."}
              </AlertDescription>
            </Alert>
          ) : (
            <GCodeLines
              compiled={compiled}
              operations={plate.operations}
              check={AS_WRITTEN}
              line={line}
              onSeekLine={setLine}
              follow={false}
              label="NC source"
              className="h-[50vh] rounded-md border"
            />
          )}
        </TabsContent>
        <TabsContent value="setup">
          <Textarea
            className="h-[50vh] resize-none"
            aria-label="Plate setup"
            readOnly
            spellCheck={false}
            value={setup}
          />
        </TabsContent>
      </Tabs>
    </AppDialog>
  )
}

function SourceActions({
  plate,
  onGlossary,
}: {
  plate: Plate
  onGlossary: () => void
}) {
  const exporting = useExportProgram(plate)
  return (
    <div className="flex w-full items-center justify-end gap-2">
      {exporting.error && (
        <Alert variant="destructive" className="flex-1">
          <AlertDescription>{exporting.error.message}</AlertDescription>
        </Alert>
      )}
      <Button variant="outline" onClick={onGlossary}>
        <BookOpen />
        G-code glossary
      </Button>
      <Button disabled={exporting.isPending} onClick={() => exporting.mutate()}>
        <Download />
        {exporting.isPending ? "Saving…" : "Export NC with setup"}
      </Button>
    </div>
  )
}
