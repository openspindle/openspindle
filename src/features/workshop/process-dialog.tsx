import { useId, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { z } from "zod"
import { useMutation } from "@tanstack/react-query"
import { useSelector } from "@tanstack/react-store"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import { HeightMapFacts } from "@/components/workspace/height-map-grid"
import {
  selectedPlate,
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import {
  instantiateProcess,
  ProcessesSchema,
  processToolIds,
} from "@/domain/workspace/processes"
import { newId } from "@/domain/primitives"
import { sameAnchorFrame } from "@/domain/anchors/stored-anchors"
import { usePersistence, useDocumentState } from "@/persistence/persistence"
import { AppDialog } from "@/features/shell/app-dialog"
import { usePrepareSelection } from "@/features/prepare/plate-tree/use-prepare-selection"

export function ProcessDialog({ onClose }: { onClose: () => void }) {
  const persistence = usePersistence()
  const stored = useDocumentState(persistence.processes)
  const processes = useSelector(persistence.processStore)
  const workspace = useWorkspaceStore()
  const selected = useWorkspace(selectedPlate)
  const profile = useWorkspace((state) => state.project.profile)
  const selection = usePrepareSelection()
  const [name, setName] = useState("")
  const nameId = useId()
  const nameForm = useForm({
    defaultValues: { name: "" },
    validators: {
      onChange: z.object({ name: z.string().trim().min(1).max(200) }),
    },
    listeners: {
      onChange: ({ formApi }) => setName(formApi.state.values.name),
    },
  })
  const [processId, setProcessId] = useState("")
  const process = processes.find((item) => item.id === processId)
  const save = useMutation({
    mutationFn: async () => {
      if (!selected || !name.trim() || stored.phase !== "ready")
        throw new Error(
          "Choose a plate and name; resolve storage issues before saving."
        )
      const referenced = processToolIds(selected)
      const next = ProcessesSchema.parse([
        ...processes,
        {
          id: newId(),
          name: name.trim(),
          plate: structuredClone(selected),
          tools: structuredClone(
            workspace.state.tools.filter((tool) => referenced.has(tool.id))
          ),
        },
      ])
      persistence.processStore.setState(() => next)
      await persistence.processes.flush()
      const error = persistence.processes.state.state.saveError
      if (error) throw new Error(error)
      return next.at(-1)!.id
    },
    onSuccess: (id) => {
      setProcessId(id)
      setName("")
      nameForm.reset()
      toast.success("Reusable process saved on this computer.")
    },
    onError: (error) => toast.error(error.message),
  })
  const retrySave = useMutation({
    mutationFn: async () => {
      persistence.processes.save(persistence.processStore.state)
      await persistence.processes.flush()
      const error = persistence.processes.state.state.saveError
      if (error) throw new Error(error)
    },
    onSuccess: () => toast.success("Processes saved."),
    onError: (error) => toast.error(error.message),
  })
  const mismatch =
    !!process &&
    (process.plate.setup.deviceId !== profile.deviceId ||
      !sameAnchorFrame(
        process.plate.setup.anchors,
        selected?.setup.anchors ?? profile.anchors
      ))
  const load = () => {
    if (!process || mismatch || stored.phase !== "ready") return
    const next = instantiateProcess(process, workspace.state.tools)
    const result = workspace.dispatch({
      type: "batch",
      commands: [
        { type: "library.tools", tools: next.tools },
        { type: "plates.add", plates: [next.plate], select: true },
      ],
    })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    selection.selectPlate(next.plate.id)
    toast.success(
      "Process loaded as a new plate. Review setup and operations before Run."
    )
    onClose()
  }
  return (
    <AppDialog
      title="Reusable processes"
      width="wide"
      onClose={onClose}
      footer={
        <Button
          disabled={
            !process || mismatch || stored.phase !== "ready" || save.isPending
          }
          onClick={load}
        >
          Load process as a new plate
        </Button>
      }
    >
      <FieldGroup>
        <FieldDescription>
          Save stock, workholding, work zero, ordered operations and referenced
          tool definitions. Processes stay on this computer across launches.
          Loading creates a separate editable plate and does not run it. Custom
          model files remain references to this computer's Models library.
        </FieldDescription>
        {stored.phase !== "ready" && (
          <FieldDescription>
            {stored.phase === "loading"
              ? "Loading saved processes…"
              : stored.issues.map((issue) => issue.message).join(" ")}
          </FieldDescription>
        )}
        {stored.saveError && (
          <FieldDescription>
            Could not save processes: {stored.saveError}.{" "}
            <Button
              variant="outline"
              disabled={retrySave.isPending}
              onClick={() => retrySave.mutate()}
            >
              Retry saving these processes
            </Button>
          </FieldDescription>
        )}
        <Field>
          <FieldLabel htmlFor={nameId}>
            Save selected plate as a process
          </FieldLabel>
          <nameForm.Field name="name">
            {(field) => (
              <Input
                id={nameId}
                maxLength={200}
                placeholder="For example: MDF facing setup"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
            )}
          </nameForm.Field>
        </Field>
        <Button
          variant="outline"
          disabled={
            !selected ||
            !name.trim() ||
            !!stored.saveError ||
            stored.phase !== "ready" ||
            save.isPending
          }
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save process snapshot"}
        </Button>
        <Field>
          <FieldLabel>Saved process</FieldLabel>
          <OptionSelect
            value={processId}
            options={[
              { value: "", label: "Choose a process" },
              ...processes.map((item) => ({
                value: item.id,
                label: item.name,
              })),
            ]}
            onValueChange={setProcessId}
          />
        </Field>
        {process && (
          <>
            <HeightMapFacts
              facts={[
                {
                  label: "Stock",
                  value: process.plate.setup.stock
                    ? `${process.plate.setup.stock.material} · ${process.plate.setup.stock.width} × ${process.plate.setup.stock.depth} × ${process.plate.setup.stock.height} mm`
                    : "Unspecified",
                },
                {
                  label: "Tool definitions",
                  value: String(process.tools.length),
                },
                {
                  label: "Enabled fixtures",
                  value: String(
                    process.plate.setup.fixtures.filter(
                      (fixture) => fixture.enabled
                    ).length
                  ),
                },
              ]}
            />
            <ol className="list-decimal pl-5">
              {process.plate.operations.map((operation) => (
                <li key={operation.id}>
                  {operation.name} · {operation.source.kind}
                  {operation.stopBefore ? " · pause before" : ""}
                </li>
              ))}
            </ol>
            <FieldDescription>
              Changed library tools are restored as separate copies. Missing
              saved tool definitions remain unassigned. Compiled section groups
              are cleared because the new operations have fresh IDs.
            </FieldDescription>
          </>
        )}
        {mismatch && (
          <FieldDescription>
            This process was saved with another device or anchor frame. Select
            its original device and matching setup before loading; coordinates
            are not silently transferred.
          </FieldDescription>
        )}
      </FieldGroup>
    </AppDialog>
  )
}
