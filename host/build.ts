import { build } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"
import { builtinModules } from "node:module"

const alias = { "@": resolve("src") }
await build({
  configFile: false,
  publicDir: false,
  resolve: { alias },
  build: {
    ssr: true,
    outDir: "dist-host",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve("host/index.ts"),
        "machine-owner": resolve("host/machine-owner.ts"),
        "program-thread": resolve("electron/machine/program-thread.ts"),
      },
      external: (id) => id.startsWith("node:") || builtinModules.includes(id),
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
})
await build({
  configFile: false,
  root: resolve("host/web"),
  publicDir: resolve("public"),
  plugins: [react(), tailwindcss()],
  resolve: { alias },
  build: { outDir: resolve("dist-host/web"), emptyOutDir: true },
})
