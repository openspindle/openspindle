import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { sentryVitePlugin } from "@sentry/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"
import { appearanceInit } from "./tools/vite/appearance-init.ts"
import { bundledPlugins } from "./tools/vite/bundled-plugins.ts"
import { pluginFrame } from "./tools/vite/plugin-frame.ts"
import { thirdPartyNotices } from "./tools/vite/third-party.ts"

const path = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url))

const alias = { "@": path("./src") }

const { version } = JSON.parse(
  readFileSync(path("./package.json"), "utf8")
) as {
  version: string
}

const rendererNotices = thirdPartyNotices("renderer")

export default defineConfig(({ command }) => {
  // Release builds (npm run dist:mac, which reads .env, and the release workflow) have a Sentry
  // auth token in their environment: they upload their source maps, so that error reports show
  // the source, and ship without them. Other builds make none.
  const uploadSourceMaps =
    command === "build" && Boolean(process.env.SENTRY_AUTH_TOKEN)
  const sourcemap = uploadSourceMaps ? ("hidden" as const) : false
  const sentry = (target: "main" | "renderer") =>
    uploadSourceMaps
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            telemetry: false,
            // The main process names the release; see electron/main/diagnostics.
            release: { name: `openspindle@${version}`, inject: false },
            sourcemaps: {
              filesToDeleteAfterUpload: [`out/${target}/**/*.map`],
            },
            // Without its source maps a release still works; its reports show minified code.
            errorHandler: (error) => {
              console.warn(
                `Source maps were not uploaded to Sentry: ${error.message}`
              )
            },
          }),
        ]
      : []

  return {
    main: {
      plugins: [thirdPartyNotices("main"), bundledPlugins(), ...sentry("main")],
      resolve: { alias: { "@": path("./src") } },
      // The DSN error reports go to, from .env or the environment; it is not a secret. Without
      // one the app only logs errors.
      envPrefix: ["MAIN_VITE_", "VITE_", "SENTRY_DSN"],
      build: {
        // Bundle everything so the packaged app ships only out/**.
        externalizeDeps: false,
        sourcemap,
        rollupOptions: { input: { index: path("./electron/main/index.ts") } },
      },
    },
    preload: {
      plugins: [thirdPartyNotices("preload")],
      build: {
        // Sandboxed preloads must be one self-contained CommonJS file.
        externalizeDeps: false,
        rollupOptions: {
          input: { index: path("./electron/preload/index.ts") },
          output: { format: "cjs", entryFileNames: "[name].cjs" },
        },
      },
    },
    renderer: {
      root: ".",
      resolve: { alias },
      // The STEP worker's CommonJS dependency. Dependency discovery does not follow workers:
      // without this, the first conversion in development re-optimizes and reloads the page.
      optimizeDeps: { include: ["occt-import-js"] },
      plugins: [
        tanstackRouter({ target: "react", autoCodeSplitting: true }),
        viteReact(),
        tailwindcss(),
        appearanceInit(),
        pluginFrame({ alias }),
        rendererNotices,
        ...sentry("renderer"),
      ],
      worker: { plugins: () => [rendererNotices.worker()] },
      build: {
        // electron-vite leaves the renderer unminified by default.
        minify: true,
        sourcemap,
        rollupOptions: { input: { index: path("./index.html") } },
      },
    },
  }
})
