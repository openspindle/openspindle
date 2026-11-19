import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@/styles.css"
import { PatternEditor } from "./pattern-editor"

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <div className="h-dvh bg-background text-foreground">
      <PatternEditor />
    </div>
  </StrictMode>
)
