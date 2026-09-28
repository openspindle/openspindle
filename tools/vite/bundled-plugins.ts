import { copyFile, mkdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  MANIFEST_FILE,
  decodeUtf8,
  parseJson,
  parseManifest,
} from "@openspindle/plugin-core"
import {
  openSpindleCompanion,
  openSpindleView,
} from "@openspindle/plugin-sdk/vite"
import tailwindcss from "@tailwindcss/vite"
import { build } from "vite"
import type { Plugin } from "vite"
import { thirdPartyNotices } from "./third-party.ts"

const PLUGINS = fileURLToPath(new URL("../../plugins", import.meta.url))

/**
 * The plugins that come with the app: their folders in plugins/ and the source of their Node
 * companion. Views build from `ui/index.tsx`, as `openspindle-plugin build` does by default.
 */
const BUNDLED_PLUGINS = [{ folder: "pcb", companion: "src/companion.mjs" }]

/**
 * Builds one plugin's package into `<target>/<id>/`, as `openspindle-plugin build` would:
 * the manifest, the views with Tailwind CSS, the Node companion, and the files it lists.
 */
async function buildPlugin(
  plugin: (typeof BUNDLED_PLUGINS)[number],
  target: string,
  mode: string
) {
  const root = path.join(PLUGINS, plugin.folder)
  const manifest = parseManifest(
    parseJson(
      decodeUtf8(await readFile(path.join(root, MANIFEST_FILE)), MANIFEST_FILE),
      MANIFEST_FILE
    )
  )
  if (manifest.companion?.runtime === "native")
    throw new Error(
      `${manifest.name}: plugins that come with the app have Node companions.`
    )
  const output = (file: string) =>
    path.join(target, manifest.id, ...file.split("/"))
  const copy = async (file: string) => {
    await mkdir(path.dirname(output(file)), { recursive: true })
    await copyFile(path.join(root, ...file.split("/")), output(file))
  }
  // The notices record each production build's packages, as the app's own bundles do.
  const common = { configFile: false, root, mode, logLevel: "warn" } as const
  if (manifest.ui)
    await build({
      ...common,
      plugins: [
        tailwindcss(),
        openSpindleView({
          entry: "ui/index.tsx",
          outFile: output(manifest.ui.entry),
          ...(manifest.ui.styles
            ? { stylesFile: output(manifest.ui.styles) }
            : {}),
        }),
        thirdPartyNotices(`plugin-${manifest.id}-view`),
      ],
    })
  if (manifest.companion)
    await build({
      ...common,
      plugins: [
        openSpindleCompanion({
          entry: plugin.companion,
          outFile: output(manifest.companion.entry),
        }),
        thirdPartyNotices(`plugin-${manifest.id}-companion`),
      ],
    })
  await copy(MANIFEST_FILE)
  for (const program of manifest.programs) await copy(program.file)
  for (const file of manifest.files) await copy(file)
}

/**
 * Builds the plugins that come with the app into `plugins/` beside the main process's
 * output after every build of it: the main process installs them from there at start, and
 * packaged apps carry them among their resources (electron-builder.yml).
 */
export function bundledPlugins(): Plugin {
  let target = ""
  let mode = "production"
  return {
    name: "openspindle:bundled-plugins",
    configResolved(config) {
      target = path.resolve(config.root, config.build.outDir, "../plugins")
      mode = config.mode
    },
    async closeBundle() {
      await rm(target, { recursive: true, force: true })
      for (const plugin of BUNDLED_PLUGINS)
        await buildPlugin(plugin, target, mode)
    },
  }
}
