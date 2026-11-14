import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin, Rolldown } from "vite"
import { writeFileAtomic } from "../../electron/main/services/atomic-write.ts"
import {
  ThirdPartyNoticesSchema,
  byPackage,
} from "../../electron/main/third-party-notices.ts"
import type { ThirdPartyNotices } from "../../electron/main/third-party-notices.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const FILE = path.join(ROOT, "build/third-party-notices.json")

/**
 * What the app includes without importing it as a module: Electron, which runs it, and the
 * stylesheets src/styles.css imports, which Tailwind compiles into the app's CSS (shadcn's
 * also stands for the shadcn/ui components in src/components/ui).
 */
const UNBUNDLED: Readonly<Record<string, ReadonlyArray<string>>> = {
  electron: ["electron"],
  serial: [
    "@serialport/stream",
    "@serialport/bindings-cpp",
    "@serialport/bindings-interface",
    "@serialport/parser-readline",
    "@serialport/parser-delimiter",
    "node-addon-api",
    "node-gyp-build",
    "@serialport/bindings-cpp/node_modules/debug",
    "@serialport/stream/node_modules/debug",
    "ms",
  ],
  styles: ["shadcn", "tailwindcss", "tw-animate-css"],
}

/** Copyright notices that a package's license files leave out. */
const ATTRIBUTIONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  // Its license file is the LGPL's text alone. Its WebAssembly module contains OpenCASCADE
  // Technology, under the same license.
  "occt-import-js": [
    "By Viktor Kovacs",
    "Contains OpenCASCADE Technology, Copyright (c) OPEN CASCADE SAS",
  ],
}

const mitLicense = (copyright: string) => `MIT License

${copyright}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

/**
 * License texts for packages that publish none, only the license's name: its standard text,
 * with the package's author as copyright holder.
 */
const LICENSE_TEXTS: Readonly<Partial<Record<string, string>>> = {
  // electron-updater's. MIT by its package.json; neither the package nor its repository
  // (github.com/develar/lazy-val) has a license file.
  "lazy-val": mitLicense("Copyright (c) Vladimir Krivosheev"),
}

const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:[.\-_]|$)/i
/** A copyright notice, other than the Free Software Foundation's on the text of its licenses. */
const COPYRIGHT = /^\s*copyright\s+(?:\(c\)|©|\d{4})/i

type Notice = ThirdPartyNotices["packages"][string]
type Described = {
  readonly key: string
  readonly notice: Notice
  readonly text: string
}

const tidy = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()

/** Texts that differ only in white space share a digest. */
const digest = (text: string) =>
  createHash("sha256")
    .update(text.replace(/\s+/g, " "))
    .digest("hex")
    .slice(0, 16)

/** A repository field as a web address: "owner/name", "github:owner/name" or a git URL. */
function sourceOf(repository: unknown): string | undefined {
  const url =
    typeof repository === "string"
      ? repository
      : (repository as { url?: unknown } | undefined)?.url
  if (typeof url !== "string") return undefined
  const shorthand = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(url)
  if (shorthand) return `https://github.com/${shorthand[1]}`
  return url
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "")
}

/** The package folder a bundled file comes from, when it comes from node_modules. */
function packageFolder(file: string): string | undefined {
  const match =
    /^(.*[\\/]node_modules[\\/])(@[^\\/]+[\\/][^\\/]+|[^\\/]+)/.exec(file)
  return match ? match[1] + match[2] : undefined
}

async function describe(folder: string): Promise<Described> {
  const manifest = JSON.parse(
    await readFile(path.join(folder, "package.json"), "utf8")
  ) as {
    name: string
    version: string
    license?: unknown
    repository?: unknown
  }
  const files = (await readdir(folder))
    .filter((file) => LICENSE_FILE.test(file))
    .sort()
  const supplied = LICENSE_TEXTS[manifest.name]
  const suppliedTexts = supplied === undefined ? [] : [supplied]
  const texts =
    files.length > 0
      ? await Promise.all(
          files.map((file) => readFile(path.join(folder, file), "utf8"))
        )
      : suppliedTexts
  if (texts.length === 0)
    throw new Error(
      `${manifest.name} has no license file, so the app cannot credit it.`
    )
  const text = texts.map(tidy).join("\n\n")
  const attribution = ATTRIBUTIONS[manifest.name] ?? [
    ...new Set(
      text
        .split("\n")
        .filter(
          (line) =>
            COPYRIGHT.test(line) && !line.includes("Free Software Foundation")
        )
        .map((line) => line.trim())
    ),
  ]
  return {
    key: `${manifest.name}@${manifest.version}`,
    notice: {
      license:
        typeof manifest.license === "string"
          ? manifest.license
          : "See the license text",
      source: sourceOf(manifest.repository),
      attribution: [...attribution],
      text: digest(text),
    },
    text,
  }
}

const sortedRecord = <T>(entries: Readonly<Record<string, T>>) =>
  Object.fromEntries(
    Object.entries(entries).sort(([a], [b]) => {
      if (a < b) return -1
      return a > b ? 1 : 0
    })
  )

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Replaces one bundle's packages in the notices file, keeping the other bundles'. */
async function recordBundle(bundle: string, folders: Iterable<string>) {
  const previousContents = await readFile(FILE, "utf8").catch(() => "")
  // A missing or damaged file starts over; each bundle adds itself on its next build.
  const parsed = ThirdPartyNoticesSchema.safeParse(parseJson(previousContents))
  const previous: ThirdPartyNotices = parsed.success
    ? parsed.data
    : { version: 1, bundles: {}, packages: {}, texts: {} }

  const described = new Map<string, Described>()
  const describeAll = async (list: Iterable<string>) => {
    const entries = await Promise.all([...list].map(describe))
    for (const entry of entries) described.set(entry.key, entry)
    return entries.map((entry) => entry.key).sort(byPackage)
  }
  const bundles: Record<string, Array<string>> = { ...previous.bundles }
  bundles[bundle] = await describeAll(folders)
  for (const [section, names] of Object.entries(UNBUNDLED))
    bundles[section] = await describeAll(
      names.map((name) => path.join(ROOT, "node_modules", name))
    )

  const packages: ThirdPartyNotices["packages"] = {}
  const texts: Record<string, string> = {}
  const keys = new Set(Object.values(bundles).flat())
  for (const key of [...keys].sort(byPackage)) {
    const fresh = described.get(key)
    const notice = fresh ? fresh.notice : previous.packages[key]
    packages[key] = notice
    texts[notice.text] = fresh ? fresh.text : previous.texts[notice.text]
  }
  const notices: ThirdPartyNotices = {
    version: 1,
    bundles: sortedRecord(bundles),
    packages,
    texts: sortedRecord(texts),
  }
  const contents = `${JSON.stringify(notices, null, 2)}\n`
  if (contents !== previousContents) await writeFileAtomic(FILE, contents)
}

/**
 * Keeps build/third-party-notices.json, the About panel's credits (electron/main/about.ts),
 * up to date: each production build records the open-source packages its bundle contains,
 * with their licenses and license texts, next to what the other bundles recorded. Dev and
 * watch builds leave the file alone. The renderer's plugin also counts the packages of the
 * workers it starts: put its `worker()` in the renderer's `worker.plugins`.
 */
export function thirdPartyNotices(
  bundle: string
): Plugin & { worker: () => Plugin } {
  const folders = new Set<string>()
  let root = ROOT
  let records = false
  const collect = (output: Rolldown.OutputBundle) => {
    for (const item of Object.values(output))
      for (const id of item.type === "chunk"
        ? item.moduleIds
        : item.originalFileNames) {
        const file = path.resolve(root, id.replace(/^\0/, "").split("?")[0])
        const folder = packageFolder(file)
        if (folder) folders.add(folder)
      }
  }
  return {
    name: "openspindle:third-party-notices",
    configResolved(config) {
      root = config.root
      records =
        config.command === "build" &&
        config.mode === "production" &&
        !config.build.watch
    },
    buildStart() {
      folders.clear()
    },
    async generateBundle(_options, output) {
      if (!records) return
      collect(output)
      await recordBundle(bundle, folders)
    },
    worker: () => ({
      name: "openspindle:third-party-notices-worker",
      generateBundle(_options, output) {
        collect(output)
      },
    }),
  }
}
