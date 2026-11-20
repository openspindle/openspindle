import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const root = fileURLToPath(new URL("../../", import.meta.url))
export default defineConfig({
  root,
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "spinnvill-license",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "LICENSE",
          source: readFileSync(new URL("../../LICENSE", import.meta.url)),
        })
      },
    },
  ],
  build: {
    outDir: "dist-patterns",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        standalone: fileURLToPath(
          new URL("../../standalone.html", import.meta.url)
        ),
      },
    },
  },
})
