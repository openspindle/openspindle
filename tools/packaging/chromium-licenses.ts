import { readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { AfterPackContext } from "electron-builder"

/**
 * Electron's LICENSES.chromium.html credits each component of Chromium, Node.js and the rest of
 * Electron with its license: 20 MB, most of it the same texts over and over (some components'
 * notices hold the Apache License a hundred times). Packaged apps carry LICENSES.chromium.txt
 * instead, about 1.5 MB: every component with its homepage and license, where a passage that
 * recurs, a license's text mostly, is printed once at the end and cited as [Text N]. Nothing
 * is left out: the build fails unless every component's text can be put back together.
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const ELECTRON = path.join(ROOT, "node_modules/electron")
const FILE = "LICENSES.chromium.txt"

/** Paragraphs that follow each other at least this often form one passage. */
const TOGETHER = 0.75
/** Shorter passages are printed where they occur: citing them would save next to nothing. */
const SHARED_MIN_CHARS = 100
/** Runs that no passage covers are split again among themselves, this many times at most. */
const LEVELS = 6
const RULE = "-".repeat(72)

type Component = {
  readonly name: string
  readonly homepage: string | undefined
  /** Its license text's paragraphs, as keys of `Paragraphs.text`. */
  readonly keys: ReadonlyArray<string>
}

/** Paragraphs by their words: texts that differ only in white space are one paragraph. */
class Paragraphs {
  readonly text = new Map<string, string>()
  readonly notices = new Set<string>()

  add(paragraph: string): string {
    const key = paragraph.replace(/\s+/g, " ").trim()
    if (!this.text.has(key)) this.text.set(key, paragraph)
    if (isNotice(key)) this.notices.add(key)
    return key
  }
}

/** A copyright notice, not a license's placeholder for one: it stays with its component. */
const isNotice = (key: string) =>
  key.length <= 300 &&
  /^[\s*#/;-]*(?:portions\s+)?(?:copyright\b|©|\(c\)\s*\d)/i.test(key) &&
  !/\[yyyy\]|\[year\]|<year>|\{yyyy\}/i.test(key)

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

const unescape = (html: string) =>
  html.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X"))
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16))
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)))
    return ENTITIES[name.toLowerCase()] ?? entity
  })

function parse(html: string, paragraphs: Paragraphs): Component[] {
  return html
    .split('<div class="product">')
    .slice(1)
    .map((entry) => {
      const name = /<span class="title">([\s\S]*?)<\/span>/.exec(entry)?.[1]
      const license = /<pre>([\s\S]*?)<\/pre>/.exec(entry)?.[1]
      if (name === undefined || license === undefined)
        throw new Error(
          `${FILE}: a component of LICENSES.chromium.html has no name or license.`
        )
      const homepage = /<span class="homepage"><a href="([^"]*)"/.exec(entry)
      return {
        name: unescape(name.trim()),
        homepage: homepage ? unescape(homepage[1]) : undefined,
        keys: unescape(license)
          .replace(/\r\n?/g, "\n")
          .split(/\n[ \t]*\n/)
          .map((paragraph) =>
            paragraph
              .split("\n")
              .map((line) => line.trimEnd())
              .join("\n")
              .replace(/^\n+|\n+$/g, "")
          )
          .filter((paragraph) => paragraph.trim())
          .map((paragraph) => paragraphs.add(paragraph)),
      }
    })
}

/**
 * Passages by their first paragraph: runs of paragraphs that follow each other in at least
 * TOGETHER of their occurrences. A copyright notice is a passage of its own.
 */
function passages(
  runs: ReadonlyArray<ReadonlyArray<string>>,
  notices: ReadonlySet<string>
): Map<string, string[]> {
  const count = new Map<string, number>()
  const followers = new Map<string, Map<string, number>>()
  for (const run of runs)
    run.forEach((key, index) => {
      count.set(key, (count.get(key) ?? 0) + 1)
      const next = run.at(index + 1)
      if (next === undefined) return
      const counts = followers.get(key) ?? new Map<string, number>()
      counts.set(next, (counts.get(next) ?? 0) + 1)
      followers.set(key, counts)
    })
  const next = new Map<string, string>()
  const followsAnother = new Set<string>()
  for (const [key, counts] of followers) {
    if (notices.has(key)) continue
    for (const [follower, times] of counts)
      if (
        follower !== key &&
        !notices.has(follower) &&
        times >= TOGETHER * (count.get(key) ?? 0) &&
        times >= TOGETHER * (count.get(follower) ?? 0)
      ) {
        next.set(key, follower)
        followsAnother.add(follower)
      }
  }
  const byFirst = new Map<string, string[]>()
  for (const key of count.keys()) {
    if (followsAnother.has(key)) continue
    const passage = [key]
    for (
      let following = next.get(key);
      following !== undefined && !passage.includes(following);
      following = next.get(following)
    )
      passage.push(following)
    byFirst.set(key, passage)
  }
  return byFirst
}

/**
 * Each component's paragraphs as passages. Where a passage does not match, as in a rare variant
 * of a common license, the run it leaves is split again among such runs; at the last level,
 * paragraph by paragraph.
 */
function split(
  components: ReadonlyArray<Component>,
  notices: ReadonlySet<string>
): string[][][] {
  const found = components.map((): Array<[number, string[]]> => [])
  type Run = { component: number; start: number; keys: ReadonlyArray<string> }
  let pending: Run[] = components.map((component, index) => ({
    component: index,
    start: 0,
    keys: component.keys,
  }))
  for (let level = 0; pending.length > 0; level++) {
    const last = level === LEVELS - 1
    const byFirst = passages(
      pending.map((run) => run.keys),
      notices
    )
    const unmatched: Run[] = []
    for (const { component, start, keys } of pending) {
      let open = -1
      const close = (end: number) => {
        if (open < 0) return
        unmatched.push({
          component,
          start: start + open,
          keys: keys.slice(open, end),
        })
        open = -1
      }
      for (let index = 0; index < keys.length;) {
        const passage = byFirst.get(keys[index])
        const matches = passage?.every(
          (key, offset) => keys[index + offset] === key
        )
        if (passage && matches) {
          close(index)
          found[component].push([start + index, passage])
          index += passage.length
        } else if (last) {
          close(index)
          found[component].push([start + index, [keys[index]]])
          index += 1
        } else {
          if (open < 0) open = index
          index += 1
        }
      }
      close(keys.length)
    }
    pending = unmatched
  }
  return found.map((parts) =>
    parts.sort((a, b) => a[0] - b[0]).map(([, passage]) => passage)
  )
}

/** LICENSES.chromium.txt from Electron's LICENSES.chromium.html. */
export function compactCredits(html: string, electronVersion: string): string {
  const paragraphs = new Paragraphs()
  const components = parse(html, paragraphs)
  if (components.length === 0)
    throw new Error(`${FILE}: LICENSES.chromium.html lists no components.`)
  const parts = split(components, paragraphs.notices)

  components.forEach((component, index) => {
    if (parts[index].flat().join("\n") !== component.keys.join("\n"))
      throw new Error(
        `${FILE} would leave out part of ${component.name}'s license.`
      )
  })

  const uses = new Map<string, { passage: string[]; count: number }>()
  for (const passage of parts.flat()) {
    const id = passage.join("\n")
    const entry = uses.get(id) ?? { passage, count: 0 }
    entry.count += 1
    uses.set(id, entry)
  }
  const numbers = new Map<string, number>()
  for (const [id, { passage, count }] of uses)
    if (
      count > 1 &&
      passage.reduce((sum, key) => sum + key.length, 0) >= SHARED_MIN_CHARS
    )
      numbers.set(id, numbers.size + 1)
  const text = (passage: ReadonlyArray<string>) =>
    passage.map((key) => paragraphs.text.get(key)).join("\n\n")

  const title = `Open-source software in Electron ${electronVersion}`
  const lines = [
    title,
    "=".repeat(title.length),
    "",
    "OpenSpindle is built on Electron, which includes Chromium, Node.js and the other",
    "open-source components below, each with its homepage and license. Passages that several",
    "licenses share, such as the Apache License 2.0, are printed once, under Shared texts at",
    "the end, and cited as [Text N] where they occur. These are the texts of Electron's",
    "LICENSES.chromium.html, without the repetition. Electron's own license is in",
    "LICENSE.electron.txt.",
  ]
  components.forEach((component, index) => {
    lines.push("", RULE, component.name)
    if (component.homepage) lines.push(component.homepage)
    for (const passage of parts[index]) {
      const number = numbers.get(passage.join("\n"))
      lines.push("", number === undefined ? text(passage) : `[Text ${number}]`)
    }
  })
  lines.push(
    "",
    "",
    "=".repeat(RULE.length),
    "Shared texts",
    "=".repeat(RULE.length)
  )
  for (const [id, number] of numbers)
    lines.push(
      "",
      RULE,
      `Text ${number}`,
      "",
      text(uses.get(id)?.passage ?? [])
    )
  return `${lines.join("\n")}\n`
}

let credits: Promise<string> | undefined

/**
 * electron-builder's afterPack hook: LICENSES.chromium.txt among the app's resources, in place
 * of the LICENSES.chromium.html that electron-builder keeps beside the executable on Windows and
 * among the resources on macOS.
 */
export async function afterPack(context: AfterPackContext): Promise<void> {
  credits ??= Promise.all([
    readFile(path.join(ELECTRON, "dist/LICENSES.chromium.html"), "utf8"),
    readFile(path.join(ELECTRON, "package.json"), "utf8"),
  ]).then(([html, manifest]) =>
    compactCredits(html, (JSON.parse(manifest) as { version: string }).version)
  )
  const resources = context.packager.getResourcesDir(context.appOutDir)
  await writeFile(path.join(resources, FILE), await credits)
  await Promise.all(
    [resources, context.appOutDir].map((dir) =>
      rm(path.join(dir, "LICENSES.chromium.html"), { force: true })
    )
  )
}
