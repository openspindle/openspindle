import { spawn } from "node:child_process"
import { basename } from "node:path"
import { LIMITS } from "./manifest.mjs"

/*
 * pcb2gcode is the user's own program: they install it (with Homebrew, for example) and
 * choose it in the plugin's settings, which OpenSpindle passes to the companion and checks
 * is a program they can run. Conversions run that program.
 */

/** Where the user chooses pcb2gcode. */
const SETTINGS = "the PCB plugin's settings (Plugins…)"

const bytes = (text) => Buffer.byteLength(text, "utf8")

/** pcb2gcode cannot run; the message says why. */
export class RuntimeError extends Error {}

/** No pcb2gcode is chosen, or the program chosen does not run: the settings need a look. */
export class SetupNeededError extends RuntimeError {}

/** Checks that the chosen pcb2gcode runs, and reads its version. */
export async function checkRuntime(executable, { signal } = {}) {
  if (!executable)
    throw new SetupNeededError(`Choose pcb2gcode in ${SETTINGS}.`)
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
      `The pcb2gcode chosen in ${SETTINGS} does not run: ${error.message}`
    )
  }
  const version = result.stdout.trim().split(/\r?\n/)[0]
  if (!version)
    throw new SetupNeededError(
      `The program chosen as pcb2gcode in ${SETTINGS} does not report its version.`
    )
  return {
    executable,
    version,
    output: `${result.stdout}${result.stderr}`,
  }
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
