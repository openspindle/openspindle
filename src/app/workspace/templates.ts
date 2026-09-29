import type {
  ProcessParameterValues,
  ProcessProgram,
} from "@openspindle/plugin-core"
import type { Tool } from "@/domain/tools/tool"
import { isPluginUsable } from "@/platform/contract/plugin-rpc"
import type { PluginSummary } from "@/platform/contract/plugin-rpc"
import type { PluginHost } from "@/platform/host"
import { createOperation } from "@/domain/operations/operation"
import type { SourceOf } from "@/domain/operations/operation"
import { fail, ok } from "@/domain/primitives"
import type { Result } from "@/domain/primitives"
import { libraryPreferences, localTools } from "@/domain/tools/tool-table"
import type { TransferableOperation } from "./import-files"

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

export type TemplateSource = SourceOf<"template">

/** Renders a template program from the installed package (see PluginHost.renderProgram). */
export type RenderProgram = PluginHost["renderProgram"]

export type TemplateEntry = {
  readonly plugin: PluginSummary
  readonly program: ProcessProgram
}

/** Template programs of enabled plugins that can run. */
export function templatePrograms(
  plugins: readonly PluginSummary[]
): TemplateEntry[] {
  return plugins
    .filter(isPluginUsable)
    .flatMap((plugin) =>
      plugin.manifest.programs.map((program) => ({ plugin, program }))
    )
}

/** A template program's parameters at their defaults. */
export const templateDefaults = (
  program: ProcessProgram
): ProcessParameterValues =>
  Object.fromEntries(
    program.parameters.map((parameter) => [parameter.id, parameter.default])
  )

/** The template program an operation was generated from, when its plugin still has it. */
export function templateProgram(
  plugin: PluginSummary,
  programId: string
): ProcessProgram | undefined {
  return plugin.manifest.programs.find((program) => program.id === programId)
}

/** Generates a template program's NC through the host, as an operation source. */
export async function templateSource(
  render: RenderProgram,
  plugin: PluginSummary,
  programId: string,
  values: ProcessParameterValues
): Promise<Result<TemplateSource>> {
  const program = templateProgram(plugin, programId)
  if (!program) return fail("The plugin no longer has this program.")
  try {
    const generated = await render(plugin.id, programId, values)
    return ok({
      kind: "template",
      pluginId: plugin.id,
      programId,
      version: plugin.version,
      values,
      phase: program.phase ?? "machining",
      nc: generated.source,
    })
  } catch (error) {
    return fail(message(error))
  }
}

/** A new operation from a template, with the library tools its T numbers are meant for. */
export async function templateOperation(
  render: RenderProgram,
  plugin: PluginSummary,
  program: ProcessProgram,
  values: ProcessParameterValues,
  library: readonly Tool[]
): Promise<Result<TransferableOperation>> {
  const source = await templateSource(render, plugin, program.id, values)
  if (!source.ok) return source
  return ok({
    operation: createOperation(program.name, source.value),
    preferredTools: libraryPreferences(localTools(source.value.nc), library),
  })
}
