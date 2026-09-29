import { useState } from "react"
import type { ReactNode } from "react"
import { ArrowLeft, Puzzle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { templateOperation } from "@/app/workspace/templates"
import { selectedPlate, useWorkspace } from "@/app/workspace/workspace-context"
import {
  findSource,
  pluginSources,
  sourceDescription,
  sourceKey,
  sourceRefOf,
} from "@/features/plugins/plugin-sources"
import type {
  PluginSource,
  PluginSourceRef,
} from "@/features/plugins/plugin-sources"
import { PluginFrame } from "@/features/plugins/plugin-frame"
import { TemplateForm } from "@/features/plugins/template-form"
import { AppDialog } from "@/features/shell/app-dialog"
import { openDialog } from "@/features/shell/dialogs"
import { useHost } from "@/platform/host-context"
import { useInstalledPlugins } from "@/platform/plugins"
import { usePrepareSelection } from "../plate-tree/use-prepare-selection"
import { useBuiltInSources } from "./built-in-sources"
import { useAddOperation } from "./use-add-operation"

function SourceItem({
  icon,
  title,
  description,
  onSelect,
}: {
  icon: ReactNode
  title: string
  description: string
  onSelect: () => void
}) {
  return (
    <Item
      render={
        <Button
          variant="ghost"
          className="h-auto whitespace-normal"
          type="button"
        />
      }
      className="text-left"
      onClick={onSelect}
    >
      <ItemMedia variant="icon">{icon}</ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
    </Item>
  )
}

/** A plugin's template program as a form that adds its operation. */
function TemplateSource({
  source,
  onAdded,
}: {
  source: Extract<PluginSource, { kind: "program" }>
  onAdded: () => void
}) {
  const plugins = useHost().plugins
  const library = useWorkspace((state) => state.tools)
  const add = useAddOperation()
  const { plugin, program } = source
  return (
    <TemplateForm
      program={program}
      submitLabel="Add operation"
      onSubmit={async (values) => {
        const created = await templateOperation(
          plugins.renderProgram,
          plugin,
          program,
          values,
          library
        )
        if (!created.ok) {
          toast.error(created.error)
          return
        }
        if (add(created.value)) onAdded()
      }}
    />
  )
}

/** A plugin's importer view: it adds operations to the selected plate itself, then closes. */
function ImporterSource({
  source,
  onClose,
}: {
  source: Extract<PluginSource, { kind: "view" }>
  onClose: () => void
}) {
  const plateId = useWorkspace((state) => selectedPlate(state)?.id ?? null)
  const selection = usePrepareSelection()
  return (
    <PluginFrame
      plugin={source.plugin}
      viewId={source.view.id}
      plateId={plateId}
      operationId={null}
      onClose={(select) => {
        if (select)
          selection.selectOperation(select.plateId, select.operationId)
        onClose()
      }}
      onCreated={(created, operationIds) => {
        const first = operationIds.at(0)
        if (first) selection.selectOperation(created, first)
      }}
    />
  )
}

const sourceTitle = (source: PluginSource) =>
  source.kind === "program" ? source.program.name : source.view.title

/** Built-in probing and plugin sources for adding an operation. */
export function AddOperationDialog({
  preset,
  onClose,
}: {
  preset?: PluginSourceRef
  onClose: () => void
}) {
  const plugins = useInstalledPlugins().data ?? []
  const builtIns = useBuiltInSources()
  const sources = pluginSources(plugins)
  const [chosen, choose] = useState<PluginSourceRef | null>(preset ?? null)
  const selected = chosen ? findSource(sources, chosen) : undefined
  if (selected)
    return (
      <AppDialog title={sourceTitle(selected)} width="wide" onClose={onClose}>
        <div className="flex flex-col gap-4">
          <Button
            variant="ghost"
            className="self-start"
            onClick={() => choose(null)}
          >
            <ArrowLeft />
            All sources
          </Button>
          {selected.kind === "program" ? (
            <TemplateSource source={selected} onAdded={onClose} />
          ) : (
            <ImporterSource source={selected} onClose={onClose} />
          )}
        </div>
      </AppDialog>
    )
  return (
    <AppDialog title="Add operation" width="wide" onClose={onClose}>
      <div className="flex flex-col gap-6">
        {builtIns.length > 0 && (
          <FieldSet>
            <FieldLegend>Built in</FieldLegend>
            {builtIns.map(({ id, icon: Icon, title, description, add }) => (
              <SourceItem
                key={id}
                icon={<Icon />}
                title={title}
                description={description}
                onSelect={() => {
                  if (add()) onClose()
                }}
              />
            ))}
          </FieldSet>
        )}
        <FieldSet>
          <FieldLegend>Plugins</FieldLegend>
          {sources.map((source) => (
            <SourceItem
              key={sourceKey(source)}
              icon={<Puzzle />}
              title={sourceTitle(source)}
              description={sourceDescription(source)}
              onSelect={() => choose(sourceRefOf(source))}
            />
          ))}
          {!sources.length && (
            <FieldDescription>
              Installed plugins add their programs and importers here.
            </FieldDescription>
          )}
          <Button
            variant="link"
            className="self-start px-0"
            onClick={() => openDialog({ kind: "plugins" })}
          >
            Manage plugins
          </Button>
        </FieldSet>
      </div>
    </AppDialog>
  )
}
