import type { Plugin } from "vite"
import { APPEARANCE_INIT_SCRIPT } from "../../src/lib/appearance.ts"
import { FONTS_INIT_SCRIPT } from "../../src/lib/fonts.ts"

const FILE_NAME = "appearance-init.js"
const SCRIPT = `${APPEARANCE_INIT_SCRIPT}\n${FONTS_INIT_SCRIPT}`

/**
 * Serves the pre-paint appearance script (color mode and fonts) as a same-origin file, so the page's
 * Content-Security-Policy needs no inline-script hash and the script keeps one source.
 */
export function appearanceInit(): Plugin {
  return {
    name: "openspindle:appearance-init",
    configureServer(server) {
      server.middlewares.use(`/${FILE_NAME}`, (_request, response) => {
        response.setHeader("Content-Type", "text/javascript; charset=utf-8")
        response.end(SCRIPT)
      })
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: FILE_NAME,
        source: SCRIPT,
      })
    },
    transformIndexHtml: () => [
      { tag: "script", attrs: { src: `/${FILE_NAME}` }, injectTo: "head" },
    ],
  }
}
