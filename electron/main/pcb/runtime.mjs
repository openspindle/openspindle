import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access, stat } from "node:fs/promises"
import { basename } from "node:path"
import { LIMITS } from "../../../src/domain/pcb/manifest.mjs"

/*
 * pcb2gcode is the user's own program. They install it and, unless it is where Homebrew
 * installs it, choose it in PCB settings. OpenSpindle checks it is a program they can run.
 * Conversions run that program.
 */

/** Where the user chooses pcb2gcode. */
const SETTINGS = "PCB settings"

/**
 * Where pcb2gcode is looked for while the settings name none, in this order: Homebrew's on
 * Apple silicon, then Homebrew's on Intel Macs, where builds from source install it too.
 * Nothing else is searched: not the PATH, of which apps opened from the Dock get only the
 * system's part, and not Homebrew's versioned folders.
 */
const INSTALLED = ["/opt/homebrew/bin/pcb2gcode", "/usr/local/bin/pcb2gcode"]

const bytes = (text) => Buffer.byteLength(text, "utf8")

/** pcb2gcode cannot run; the message says why. */
export class RuntimeError extends Error {}

/** No pcb2gcode is chosen or found, or the one there does not run. */
export class SetupNeededError extends RuntimeError {}

/** The first line `pcb2gcode --version` prints, or null when it prints nothing. */
async function reportedVersion(executable, signal) {
  const { stdout } = await runProcess(executable, ["--version"], {
    signal,
    timeout: 10_000,
    logLimit: 16 * 1024,
  })
  return stdout.trim().split(/\r?\n/)[0] || null
}

/** The pcb2gcode the settings name, once it runs and reports its version. */
async function chosenRuntime(executable, signal) {
  let version
  try {
    version = await reportedVersion(executable, signal)
  } catch (error) {
    if (signal?.aborted) throw error
    throw new SetupNeededError(
      `The pcb2gcode chosen in ${SETTINGS} does not run: ${error.message}`
    )
  }
  if (!version)
    throw new SetupNeededError(
      `The program chosen as pcb2gcode in ${SETTINGS} does not report its version.`
    )
  return { executable, version, found: false }
}

/**
 * Why a program found without the user naming it is not used, or null when it is. It must be
 * theirs or the system's (owned by them or root), unchangeable by anyone else, and runnable,
 * so another account's install is never picked up.
 */
async function unusable(executable, info) {
  if (info.uid !== 0 && info.uid !== process.getuid?.())
    return "it belongs to another user"
  if (info.mode & 0o022) return "other users can change it"
  try {
    await access(executable, constants.X_OK)
    return null
  } catch {
    return "it cannot be run"
  }
}

/** The first pcb2gcode where it is usually installed that passes the checks and runs. */
async function foundRuntime(installed, signal) {
  let problem = `Install pcb2gcode, with Homebrew for example (brew install pcb2gcode), or choose it in ${SETTINGS}.`
  for (const executable of installed) {
    // Follows a link, such as Homebrew's, to the program itself.
    const info = await stat(executable).catch(() => null)
    if (!info?.isFile()) continue
    const reason = await unusable(executable, info)
    if (reason) {
      problem = `Choose pcb2gcode in ${SETTINGS}. The one at ${executable} is not used because ${reason}.`
      continue
    }
    try {
      const version = await reportedVersion(executable, signal)
      if (version) return { executable, version, found: true }
      problem = `Reinstall pcb2gcode, or choose it in ${SETTINGS}. The program at ${executable} does not report its version.`
    } catch (error) {
      if (signal?.aborted) throw error
      problem = `Reinstall pcb2gcode, or choose it in ${SETTINGS}. The one at ${executable} does not run: ${error.message}`
    }
  }
  throw new SetupNeededError(problem)
}

/**
 * The pcb2gcode to run, once it runs and reports its version: the one the settings name, or
 * while they name none, one found where it is usually installed (`found`).
 */
export function findRuntime(setting, { signal, installed = INSTALLED } = {}) {
  return setting
    ? chosenRuntime(setting, signal)
    : foundRuntime(installed, signal)
}

/** Runs a program without a shell, bounded in time and output, killed on cancel. */
export async function runProcess(
  executable,
  args,
  { cwd, signal, timeout = LIMITS.timeout, logLimit = LIMITS.log } = {}
) {
  const name = basename(executable)
  if (signal?.aborted) throw new Error("Cancelled.")
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let length = 0
    let stdout = ""
    let stderr = ""
    let failure
    const stop = (message) => {
      failure ??= new Error(message)
      child.kill("SIGKILL")
    }
    const abort = () => stop("Cancelled.")
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
    const timer = setTimeout(
      () => stop(`${name} exceeded its time limit.`),
      timeout
    )
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
    }
    for (const [stream, target] of [
      [child.stdout, "stdout"],
      [child.stderr, "stderr"],
    ]) {
      stream.setEncoding("utf8")
      stream.on("data", (chunk) => {
        length += bytes(chunk)
        if (length > logLimit) {
          stop(`${name} diagnostic output exceeded its limit.`)
          return
        }
        if (target === "stdout") stdout += chunk
        else stderr += chunk
      })
    }
    child.once("error", (error) => {
      cleanup()
      reject(new RuntimeError(`Could not start ${name}: ${error.message}`))
    })
    child.once("close", (code, termination) => {
      cleanup()
      const output = (stderr || stdout).trim().slice(-4000)
      if (failure) reject(failure)
      // What a crashed program printed last is often an unrelated warning, not the reason.
      else if (termination)
        reject(
          new Error(
            `${name} crashed (${termination}).${output ? ` Its last output: ${output}` : ""}`
          )
        )
      else if (code !== 0)
        reject(
          new Error(
            `${name} failed (exit ${code}): ${output || "No diagnostic output."}`
          )
        )
      else resolve({ stdout, stderr })
    })
  })
}
