#!/usr/bin/env node
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { z } from "zod"
import {
  MANIFEST_FILE,
  PluginError,
  decodeUtf8,
  openFolderSource,
  parseJson,
  parseManifest,
  validatePackage,
} from "@openspindle/plugin-core"
import type { PackageSink, ValidatedPackage } from "@openspindle/plugin-core"
import { nodePlatform, nodeSha256, openNodeFolder } from "./node/index.ts"

const INVENTORY_FILE = "openspindle-inventory.json"

const USAGE = `Usage: openspindle-plugin <command> [folder] [options]

Commands:
  build     Bundle the views (and a Node companion) the manifest declares,
            with the plugin's own vite.config (for example Tailwind CSS).
            --view <file>        View source entry (default: ui/index.tsx)
            --companion <file>   Node companion source entry
  validate  Check the manifest and every declared file; print the inventory.
  pack      Validate, then copy exactly the package's files and an inventory
            into <out>/<id>-<version>/.
            --out <folder>       Output folder (default: dist-plugin)
`

type Options = {
  readonly view?: string
  readonly companion?: string
  readonly out?: string
}

async function readJson(file: string): Promise<unknown> {
  const name = path.basename(file)
  return parseJson(decodeUtf8(await readFile(file), name), name)
}

const readManifest = async (root: string) =>
  parseManifest(await readJson(path.join(root, MANIFEST_FILE)))

const RecordedInventorySchema = z.object({ digest: z.string() })

async function build(root: string, options: Options) {
  const manifest = await readManifest(root)
  const { build: viteBuild } = await import("vite")
  const { openSpindleCompanion, openSpindleView } = await import("./vite.ts")
  if (manifest.ui) {
    await viteBuild({
      root,
      plugins: [
        openSpindleView({
          entry: options.view ?? "ui/index.tsx",
          outFile: manifest.ui.entry,
          ...(manifest.ui.styles ? { stylesFile: manifest.ui.styles } : {}),
        }),
      ],
    })
  }
  const companion = manifest.companion
  if (options.companion) {
    if (companion?.runtime !== "node")
      throw new PluginError(
        "--companion needs a Node companion in the manifest."
      )
    await viteBuild({
      root,
      plugins: [
        openSpindleCompanion({
          entry: options.companion,
          outFile: companion.entry,
        }),
      ],
    })
  }
  if (!manifest.ui && !options.companion)
    console.log("Nothing to build: the manifest declares no views.")
}

function describe(validated: ValidatedPackage) {
  const { manifest } = validated
  console.log(`${manifest.name} ${manifest.version} (${manifest.id})`)
  console.log(
    `Permissions: ${manifest.permissions.length ? manifest.permissions.join(", ") : "none"}`
  )
  if (manifest.companion)
    console.log(`Companion: ${manifest.companion.runtime}`)
  for (const file of manifest.executables) console.log(`Executable: ${file}`)
  console.log(
    `${validated.inventory.length} files, ${validated.totalBytes} bytes, digest ${validated.digest}`
  )
  for (const entry of validated.inventory)
    console.log(`  ${entry.sha256}  ${entry.bytes}\t${entry.path}`)
}

async function validate(root: string) {
  const validated = await validatePackage(
    openFolderSource(await openNodeFolder(root)),
    { platform: nodePlatform(), sha256: nodeSha256 }
  )
  describe(validated)
  const inventoryFile = path.join(root, INVENTORY_FILE)
  if (!(await stat(inventoryFile).catch(() => null))) return
  const recorded = RecordedInventorySchema.safeParse(
    await readJson(inventoryFile)
  )
  if (!recorded.success || recorded.data.digest !== validated.digest)
    throw new PluginError(
      `The files differ from ${INVENTORY_FILE}; pack the plugin again.`
    )
  console.log(`Matches ${INVENTORY_FILE}.`)
}

async function pack(root: string, options: Options) {
  const manifest = await readManifest(root)
  const target = path.resolve(
    options.out ?? path.join(root, "dist-plugin"),
    `${manifest.id}-${manifest.version}`
  )
  if (await stat(target).catch(() => null))
    throw new PluginError(`${target} already exists.`)
  const sink: PackageSink = {
    async write(file) {
      const destination = path.join(target, ...file.path.split("/"))
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, file.bytes, {
        mode: file.executable ? 0o755 : 0o644,
        flag: "wx",
      })
    },
  }
  const validated = await validatePackage(
    openFolderSource(await openNodeFolder(root)),
    { platform: nodePlatform(), sha256: nodeSha256, sink }
  ).catch(async (error: unknown) => {
    // A package that fails its checks leaves no partial copy to block the next pack.
    await rm(target, { recursive: true, force: true })
    throw error
  })
  await writeFile(
    path.join(target, INVENTORY_FILE),
    `${JSON.stringify(
      {
        id: validated.manifest.id,
        version: validated.manifest.version,
        digest: validated.digest,
        files: validated.inventory,
      },
      null,
      2
    )}\n`
  )
  describe(validated)
  console.log(`Packed into ${target}`)
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      view: { type: "string" },
      companion: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  })
  const [command, folder = "."] = positionals
  if (values.help || !command) {
    console.log(USAGE)
    return
  }
  const root = path.resolve(folder)
  if (command === "build") await build(root, values)
  else if (command === "validate") await validate(root)
  else if (command === "pack") await pack(root, values)
  else {
    console.error(`Unknown command ${command}.\n\n${USAGE}`)
    process.exitCode = 2
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
