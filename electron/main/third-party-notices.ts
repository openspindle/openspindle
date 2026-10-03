import { z } from "zod"

/**
 * build/third-party-notices.json: the open-source packages the app includes, with their
 * licenses. Production builds write it (tools/vite/third-party.ts); the About panel shows it.
 */
export const ThirdPartyNoticesSchema = z
  .object({
    version: z.literal(1),
    /** The packages ("name@version") each part of the app includes. */
    bundles: z.record(z.string(), z.array(z.string())),
    packages: z.record(
      z.string(),
      z.object({
        /** Its package.json's license (an SPDX expression). */
        license: z.string(),
        /** Its source repository. */
        source: z.string().optional(),
        /** Its copyright notices. */
        attribution: z.array(z.string()),
        /** Its license files' text, as a key of `texts`. */
        text: z.string(),
      })
    ),
    /** License texts, keyed by a digest of their words: packages with the same text share one. */
    texts: z.record(z.string(), z.string()),
  })
  .refine(
    (notices) =>
      Object.values(notices.bundles)
        .flat()
        .every((key) => Object.hasOwn(notices.packages, key)) &&
      Object.values(notices.packages).every((entry) =>
        Object.hasOwn(notices.texts, entry.text)
      ),
    "Every package a bundle lists has an entry, and every entry its license text."
  )

export type ThirdPartyNotices = z.infer<typeof ThirdPartyNoticesSchema>

const intro = (resources: string) => [
  "OpenSpindle includes the open-source software below, each under its license. The license texts follow the list.",
  `Electron also includes Chromium, Node.js and other open-source software. Their licenses are in LICENSES.chromium.txt, in ${resources}.`,
]

/** "name@version" as "name version". */
function label(key: string): string {
  const at = key.lastIndexOf("@")
  return at > 0 ? `${key.slice(0, at)} ${key.slice(at + 1)}` : key
}

/** Orders "name@version" keys by name, then version. */
export function byPackage(a: string, b: string): number {
  const [first, second] = [label(a), label(b)]
  if (first < second) return -1
  return first > second ? 1 : 0
}

/**
 * The About panel's credits: the packages, those with the same license text together, each
 * with its license and copyright notices; then the license texts. `resources` names the folder
 * that holds Electron's licenses.
 */
export function creditsText(
  notices: ThirdPartyNotices,
  resources: string
): string {
  const groups = new Map<string, Array<string>>()
  const keys = new Set(Object.values(notices.bundles).flat())
  for (const key of [...keys].sort(byPackage)) {
    const { text } = notices.packages[key]
    groups.set(text, [...(groups.get(text) ?? []), key])
  }
  const entries: Array<string> = []
  const texts: Array<string> = []
  for (const [text, group] of groups) {
    const packages = group.map((key) => notices.packages[key])
    const { license, source } = packages[0]
    const names = group.map(label).join(", ")
    const lines = [
      names,
      license,
      ...new Set(packages.flatMap((entry) => entry.attribution)),
    ]
    // Copyleft licenses entitle everyone who receives the software to its source.
    if (source && license.includes("GPL")) lines.push(`Source: ${source}`)
    entries.push(lines.join("\n"))
    texts.push(`${names}\n\n${notices.texts[text]}`)
  }
  return [...intro(resources), ...entries, "LICENSE TEXTS", ...texts].join(
    "\n\n"
  )
}
