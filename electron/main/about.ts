import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { app, shell } from "electron"
import { showErrorMessage } from "./diagnostics/diagnostics.ts"
import { log } from "./diagnostics/log.ts"
import { ThirdPartyNoticesSchema, creditsText } from "./third-party-notices.ts"

/** Production builds keep it in build/; packaged apps carry it among their resources. */
const noticesFile = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "third-party-notices.json")
    : fileURLToPath(
        new URL("../../build/third-party-notices.json", import.meta.url)
      )

/** The folder with Electron's licenses, as the credits name it. */
const resourcesFolder = () =>
  process.platform === "darwin"
    ? "OpenSpindle.app/Contents/Resources"
    : `the resources folder of ${path.dirname(process.execPath)}`

async function credits(): Promise<string | undefined> {
  try {
    const notices = ThirdPartyNoticesSchema.parse(
      JSON.parse(await readFile(noticesFile(), "utf8"))
    )
    return creditsText(notices, resourcesFolder())
  } catch (error) {
    log.error("The About panel has no credits", error)
    return undefined
  }
}

/**
 * The About panel's version, build number and credits. Packaged apps show the version and
 * build number in their Info.plist (docs/releasing.md). Dev and preview runs start Electron's
 * own bundle, whose Info.plist has Electron's version, so they give package.json's, as a dev
 * build. The credits list the open-source software the app includes, with its licenses.
 * Windows shows the panel as a message box, too small for them: Help › Open-Source Licenses
 * opens them there.
 */
export async function configureAboutPanel(): Promise<void> {
  const text = process.platform === "darwin" ? await credits() : undefined
  app.setAboutPanelOptions({
    ...(app.isPackaged
      ? {}
      : { applicationVersion: app.getVersion(), version: "dev" }),
    ...(text === undefined ? {} : { credits: text }),
  })
}

/** The credits as a text file, opened in the app the system opens text files with. */
export async function openCredits(): Promise<void> {
  const text = await credits()
  if (text === undefined) {
    showErrorMessage(
      "The open-source licenses could not be read",
      "OpenSpindle's log has the details."
    )
    return
  }
  const file = path.join(app.getPath("temp"), "OpenSpindle Licenses.txt")
  await writeFile(file, text)
  const error = await shell.openPath(file)
  if (error) log.error(`Opening ${file} failed: ${error}`)
}
