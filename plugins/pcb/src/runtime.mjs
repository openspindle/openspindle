import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access } from "node:fs/promises"
import { basename, join } from "node:path"
import { LIMITS } from "./manifest.mjs"

/*
 * pcb2gcode comes from Homebrew: the companion's setup runs `brew install pcb2gcode`, and
 * conversions run Homebrew's copy. The app starts companions with a minimal PATH, so both
 * are found in Homebrew's prefix on Apple silicon, not on the PATH.
 */

/** Homebrew's prefix on Apple silicon. */
const HOMEBREW = "/opt/homebrew"
/** A first install downloads pcb2gcode and its libraries; later runs take seconds. */
const INSTALL_TIMEOUT = 30 * 60_000

const bytes = (text) => Buffer.byteLength(text, "utf8")

/** pcb2gcode cannot run; the message says why. */
export class RuntimeError extends Error {}

/**
 * pcb2gcode is missing or does not run. `command` is the brew command that fixes it
 * (`install` or `reinstall`), or null while Homebrew itself is missing.
 */
export class SetupNeededError extends RuntimeError {
  constructor(message, command) {
    super(message)
    this.command = command
  }
}

async function isExecutable(path) {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Finds Homebrew's pcb2gcode and checks that it runs. */
export async function findRuntime({ signal, prefix = HOMEBREW } = {}) {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new RuntimeError(
      "The PCB plugin runs pcb2gcode from Homebrew on Apple silicon Macs only."
    )
  const executable = join(prefix, "bin", "pcb2gcode")
  if (!(await isExecutable(join(prefix, "bin", "brew"))))
    throw new SetupNeededError(
      "pcb2gcode comes from Homebrew, which is not installed.",
      null
    )
  if (!(await isExecutable(executable)))
    throw new SetupNeededError("pcb2gcode is not installed.", "install")
  let result
  try {
    result = await runProcess(executable, ["--version"], {
      signal,
      timeout: 10_000,
      logLimit: 16 * 1024,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new SetupNeededError(
      `pcb2gcode does not run: ${error.message}`,
      "reinstall"
    )
  }
  const version = result.stdout.trim().split(/\r?\n/)[0]
  if (!version)
    throw new SetupNeededError(
      "pcb2gcode does not report its version.",
      "reinstall"
    )
  return {
    executable,
    version,
    output: `${result.stdout}${result.stderr}`,
  }
}

/**
 * Installs pcb2gcode with Homebrew, or reinstalls a copy that does not run, passing brew's
 * output to `onOutput` as it comes. Resolves with the runtime once it runs.
 */
export async function installRuntime({
  signal,
  onOutput,
  prefix = HOMEBREW,
} = {}) {
  let command
  try {
    return await findRuntime({ signal, prefix })
  } catch (error) {
    if (!(error instanceof SetupNeededError) || !error.command) throw error
    command = error.command
  }
  await runProcess(join(prefix, "bin", "brew"), [command, "pcb2gcode"], {
    signal,
    timeout: INSTALL_TIMEOUT,
    logLimit: 4 * 1024 * 1024,
    onOutput,
    env: { ...process.env, HOMEBREW_NO_ENV_HINTS: "1" },
  })
  return findRuntime({ signal, prefix })
}

/** Runs a program without a shell, bounded in time and output, killed on cancel. */
export async function runProcess(
  executable,
  args,
  {
    cwd,
    env,
    signal,
    timeout = LIMITS.timeout,
    logLimit = LIMITS.log,
    onOutput,
  } = {}
) {
  const name = basename(executable)
  if (signal?.aborted) throw new Error("Cancelled.")
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
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
        onOutput?.(chunk)
      })
    }
    child.once("error", (error) => {
      cleanup()
      reject(new RuntimeError(`Could not start ${name}: ${error.message}`))
    })
    child.once("close", (code, termination) => {
      cleanup()
      if (failure) reject(failure)
      else if (code !== 0)
        reject(
          new Error(
            `${name} failed (${termination ?? `exit ${code}`}): ${(stderr || stdout || "No diagnostic output.").trim().slice(-4000)}`
          )
        )
      else resolve({ stdout, stderr })
    })
  })
}
