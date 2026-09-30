import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { frameReact, quietDirectives } from "@openspindle/plugin-sdk/vite"
import { build } from "vite"
import type { AliasOptions, InlineConfig, Plugin } from "vite"
import {
  PLUGIN_FRAME_CSP,
  PLUGIN_FRAME_CSP_HEADER,
  PLUGIN_FRAME_DIRECTORY,
} from "../../src/plugin-runtime/frame-policy.ts"
import { thirdPartyNotices } from "./third-party.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const RUNTIME = path.join(ROOT, "src/plugin-runtime")
const RUNTIME_GLOBAL = "OpenSpindleFrameRuntime"

const FILES: Readonly<Record<string, string>> = {
  "index.html": "text/html; charset=utf-8",
  "runtime.js": "text/javascript; charset=utf-8",
}

/** The app's stylesheet on the dev server; the app build names its own. */
const DEV_STYLESHEET = "/src/styles.css"
const FONT_FILE = /\.woff2?(\?|$)/

/** The stylesheet the built app document links, as a path on the app origin. */
async function appStylesheet(appDocument: string) {
  const html = await readFile(appDocument, "utf8")
  const href = /<link rel="stylesheet"[^>]*href="([^"]+)"/.exec(html)?.[1]
  if (!href) throw new Error(`No stylesheet is linked in ${appDocument}.`)
  return new URL(href, "http://app/").pathname
}

/** Emits the frame document with its policy and the app's stylesheet filled in. */
function frameDocument(stylesheet: string): Plugin {
  return {
    name: "openspindle:plugin-frame-document",
    async generateBundle() {
      const template = await readFile(path.join(RUNTIME, "index.html"), "utf8")
      this.emitFile({
        type: "asset",
        fileName: "index.html",
        source: template
          .replace("%PLUGIN_FRAME_CSP%", PLUGIN_FRAME_CSP)
          .replace("%APP_STYLESHEET%", stylesheet),
      })
    },
  }
}

/**
 * The dedicated plugin-frame build: its own document and one classic script exposing the
 * shared modules. The document links the app's own stylesheet, so views share its theme,
 * fonts and the kit's styles with the app.
 */
export function pluginFrameConfig(options: {
  readonly outDir: string
  readonly alias: AliasOptions
  /** The app's stylesheet, as a path on the app origin. */
  readonly stylesheet: string
  readonly watch?: boolean
}): InlineConfig {
  return {
    configFile: false,
    root: ROOT,
    publicDir: false,
    logLevel: "warn",
    resolve: { alias: options.alias },
    plugins: [
      frameDocument(options.stylesheet),
      frameReact(),
      quietDirectives(),
      thirdPartyNotices("frame"),
    ],
    build: {
      outDir: options.outDir,
      emptyOutDir: true,
      minify: true,
      assetsInlineLimit: () => true,
      lib: {
        entry: path.join(RUNTIME, "main.tsx"),
        formats: ["iife"],
        name: RUNTIME_GLOBAL,
        fileName: () => "runtime.js",
      },
      rolldownOptions: { output: { codeSplitting: false } },
      watch: options.watch ? {} : null,
    },
  }
}

/**
 * Builds the plugin frame into `<renderer output>/plugin-frame/` after every renderer
 * build, and serves a watched build of it during development.
 */
export function pluginFrame(options: { readonly alias: AliasOptions }): Plugin {
  let outDir = ""
  return {
    name: "openspindle:plugin-frame",
    configResolved(config) {
      outDir = path.resolve(
        config.root,
        config.build.outDir,
        PLUGIN_FRAME_DIRECTORY
      )
    },
    async closeBundle() {
      const stylesheet = await appStylesheet(
        path.join(path.dirname(outDir), "index.html")
      )
      await build(
        pluginFrameConfig({ outDir, alias: options.alias, stylesheet })
      )
    },
    configureServer(server) {
      // Frames have an opaque origin, and fonts load with CORS: the app's fonts allow any.
      server.middlewares.use((request, response, next) => {
        if (FONT_FILE.test(request.url ?? ""))
          response.setHeader("Access-Control-Allow-Origin", "*")
        next()
      })
      const cache = path.join(server.config.cacheDir, PLUGIN_FRAME_DIRECTORY)
      const watcher = build(
        pluginFrameConfig({
          outDir: cache,
          alias: options.alias,
          stylesheet: DEV_STYLESHEET,
          watch: true,
        })
      )
      watcher.catch((error: unknown) => {
        server.config.logger.error(
          `Plugin frame build failed: ${String(error)}`
        )
      })
      server.httpServer?.once("close", () => {
        void watcher.then(
          (result) => {
            if ("close" in result) void result.close()
          },
          () => undefined
        )
      })
      server.middlewares.use(
        `/${PLUGIN_FRAME_DIRECTORY}`,
        (request, response, next) => {
          const name = (request.url ?? "").split("?")[0].replace(/^\//, "")
          const type = Object.hasOwn(FILES, name) ? FILES[name] : undefined
          if (!type) {
            next()
            return
          }
          readFile(path.join(cache, name)).then(
            (contents) => {
              response.setHeader("Content-Type", type)
              response.setHeader("Cache-Control", "no-cache")
              if (name === "index.html")
                response.setHeader(
                  "Content-Security-Policy",
                  PLUGIN_FRAME_CSP_HEADER
                )
              response.end(contents)
            },
            () => {
              response.statusCode = 503
              response.end("The plugin frame is still building.")
            }
          )
        }
      )
    },
  }
}
