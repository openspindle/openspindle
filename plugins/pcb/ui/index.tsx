import { definePlugin } from "@openspindle/plugin-sdk"
import { EditorView } from "./editor"
import { ImporterView } from "./importer"
import "./styles.css"

/** The views openspindle-plugin.json declares, by ID. */
export default definePlugin({
  views: { importer: ImporterView, editor: EditorView },
})
