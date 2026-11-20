#!/usr/bin/env node
/**
 * macOS titles the application menu with the running bundle's name, which app.setName cannot
 * change, and the About panel shows the bundle's icon, which app.dock.setIcon does not change.
 * Dev and preview runs launch Electron's bundle from node_modules (the Spinnvill.app copy
 * that scripts/dev-app-bundle.mjs makes), so give that bundle Spinnvill's name and icon;
 * packaged builds take both from electron-builder.
 */
import { execFileSync } from "node:child_process"
import { copyFileSync, readFileSync, utimesSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ICON = fileURLToPath(new URL("../build/icon.icns", import.meta.url))

if (process.platform === "darwin") {
  // The electron package resolves to the bundle's Contents/MacOS/Electron.
  const executable = createRequire(import.meta.url)("electron")
  const contents = resolve(executable, "../..")
  const plist = resolve(contents, "Info.plist")
  for (const key of ["CFBundleName", "CFBundleDisplayName"])
    execFileSync("plutil", ["-replace", key, "-string", "Spinnvill", plist])
  const iconFile = execFileSync(
    "plutil",
    ["-extract", "CFBundleIconFile", "raw", "-o", "-", plist],
    { encoding: "utf8" }
  ).trim()
  const icon = resolve(contents, "Resources", iconFile)
  if (!readFileSync(icon).equals(readFileSync(ICON))) {
    copyFileSync(ICON, icon)
    // macOS keeps showing a bundle's cached icon until the bundle itself changes.
    const now = new Date()
    utimesSync(resolve(contents, ".."), now, now)
  }
}
