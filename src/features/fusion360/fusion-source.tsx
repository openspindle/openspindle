import { useId, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { importFusionProgram } from "@/app/workspace/import-fusion-program"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  WORKSPACE_MUTATION,
  useImportContext,
  workspaceScope,
} from "@/features/shell/use-import"
import { useHost } from "@/platform/host-context"
import { fusionKeys, useFusionConnection } from "@/platform/fusion"
import { useFusionLifetime } from "./use-fusion-lifetime"
import { ArrowUpRightIcon, Link2 } from "lucide-react"

/** Discover Fusion NC programs and post the chosen one into a new workspace plate. */
export function FusionSource({ onDone }: { onDone: () => void }) {
  const fusion = useHost().fusion
  const workspace = useWorkspaceStore()
  const context = useImportContext()
  const queryClient = useQueryClient()
  const id = useId()
  const lifetime = useFusionLifetime()
  const [chosen, choose] = useState<string | null>(null)
  const connection = useFusionConnection()
  const programs = useQuery({
    queryKey: fusionKeys.programs,
    queryFn: ({ signal }) => fusion.list(signal),
    retry: false,
    refetchOnWindowFocus: false,
    gcTime: 0,
    enabled: connection.data?.connected === true,
  })
  const disconnect = useMutation({
    mutationFn: () => fusion.disconnect(),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: fusionKeys.programs })
      choose(null)
    },
  })
  const importing = useMutation({
    mutationKey: [...WORKSPACE_MUTATION, "fusion360"],
    scope: workspaceScope,
    mutationFn: async (programId: string) => {
      const signal = lifetime.current.signal
      signal.throwIfAborted()
      const program = await fusion.read(programId, signal)
      signal.throwIfAborted()
      const imported = importFusionProgram(program, context())
      if (!imported.ok) throw new Error(imported.error)
      const added = workspace.dispatch({
        type: "plates.add",
        plates: [imported.value],
        select: true,
      })
      if (!added.ok) throw new Error(added.error)
      return program.name
    },
    onSuccess: (name) => {
      if (lifetime.current.signal.aborted) return
      toast.success(`Imported ${name} from Fusion 360.`)
      onDone()
    },
  })
  const options = (programs.data ?? []).map((program) => ({
    value: program.id,
    label: `${program.documentName} · ${program.name}`,
  }))
  const selected = programs.data?.find((program) => program.id === chosen)
  const busy =
    programs.isFetching || importing.isPending || disconnect.isPending
  const error = importing.error ?? disconnect.error ?? programs.error
  if (!connection.data?.connected)
    return (
      <FieldGroup>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Link2 />
            </EmptyMedia>
            <EmptyTitle>Set up connection with Fusion 360</EmptyTitle>
            <EmptyDescription>
              In Autodesk Fusion, click OpenSpindle › Connect to OpenSpindle. A
              dialog will appear here to enter the six-digit code.
            </EmptyDescription>
          </EmptyHeader>
          <Button
            variant="link"
            className="text-muted-foreground"
            size="sm"
            nativeButton={false}
            render={
              <a href="https://github.com/openspindle/openspindle/blob/main/docs/fusion360.md">
                Learn More <ArrowUpRightIcon />
              </a>
            }
          />
        </Empty>
        {(connection.error || connection.data?.discoveryError) && (
          <Alert variant="destructive">
            <AlertDescription>
              {connection.error?.message ?? connection.data?.discoveryError}
            </AlertDescription>
          </Alert>
        )}
      </FieldGroup>
    )
  return (
    <FieldGroup>
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            choose(null)
            importing.reset()
            void programs.refetch()
          }}
        >
          {programs.isFetching ? "Refreshing…" : "Refresh"}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => disconnect.mutate()}
        >
          Disconnect
        </Button>
      </div>
      {options.length > 0 ? (
        <Field>
          <FieldLabel htmlFor={id}>NC program</FieldLabel>
          <Select
            items={options}
            value={selected?.id ?? null}
            onValueChange={(value) => {
              choose(value)
              importing.reset()
            }}
            disabled={busy}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue placeholder="Choose a program" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            Import posts the current program using its Fusion post processor and
            adds it as a new plate.
          </FieldDescription>
        </Field>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {programs.isFetching ? "Reading NC programs…" : "No NC programs"}
            </EmptyTitle>
            <EmptyDescription>
              Open a Fusion document and configure an NC program in Manufacture,
              then refresh.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      <Button
        disabled={busy || !selected || !!programs.error}
        className="self-start"
        onClick={() => {
          if (selected) importing.mutate(selected.id)
        }}
      >
        {importing.isPending ? "Posting and importing…" : "Import as new plate"}
      </Button>
    </FieldGroup>
  )
}
