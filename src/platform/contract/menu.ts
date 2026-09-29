import { z } from "zod"

/** Application commands raised by the native menu. */
export const MenuCommandSchema = z.enum([
  "project.new",
  "project.open",
  "project.save",
  /** Closing with unsaved changes, the user chose Save: save, then close the window. */
  "project.saveAndClose",
  "program.import",
  "fusion.import",
  "plugins.manage",
  "models.manage",
  "tools.manage",
  "settings.open",
  /** Help › G-code Glossary. */
  "glossary.open",
  /** Edit › Undo and Redo: the focused text field's typing, else the section's edits. */
  "edit.undo",
  "edit.redo",
])
export type MenuCommand = z.infer<typeof MenuCommandSchema>
