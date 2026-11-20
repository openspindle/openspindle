#!/usr/bin/env node
/**
 * The Dock and Finder name an app bundle after its folder, whatever its Info.plist says, so dev
 * and preview runs of node_modules' Electron.app show as "Electron" there. Dev and preview runs
 * launch a copy named Spinnvill.app instead (an APFS clone, which takes no extra space), made
 * again when Electron changes and started through the electron package's path.txt, which
 * electron-vite reads too. scripts/dev-app-name.mjs then brands whichever bundle that is.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const NAME = "Spinnvill.app"

/** The bundle's Electron version, or null when it is missing or incomplete. */
function electronVersion(bundle) {
  try {
    return execFileSync(
      "plutil",
      [
        "-extract",
        "CFBundleVersion",
        "raw",
        "-o",
        "-",
        join(bundle, "Contents", "Info.plist"),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim()
  } catch {
    return null
  }
}

if (process.platform === "darwin") {
  const electron = dirname(createRequire(import.meta.url).resolve("electron"))
  const source = join(electron, "dist", "Electron.app")
  const copy = join(electron, "dist", NAME)
  const version = electronVersion(source)
  // Without Electron.app the install is broken; leave it for the electron package to report.
  if (version) {
    if (electronVersion(copy) !== version) {
      rmSync(copy, { recursive: true, force: true })
      execFileSync("cp", ["-Rc", source, copy])
    }
    const pathFile = join(electron, "path.txt")
    const executable = `${NAME}/Contents/MacOS/Electron`
    if (!existsSync(pathFile) || readFileSync(pathFile, "utf8") !== executable)
      writeFileSync(pathFile, executable)
  }
}
