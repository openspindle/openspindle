import { RpcError, serveCompanion } from "@openspindle/plugin-sdk/companion"
import { InputError, MultipleToolSlotsError, generate } from "./converter.mjs"
import {
  RuntimeError,
  SetupNeededError,
  findRuntime,
  installRuntime,
} from "./runtime.mjs"

/*
 * The PCB plugin's companion. OpenSpindle starts it while a PCB view is open and calls it
 * over a private channel; the views reach it only through companion.call. It runs
 * Homebrew's pcb2gcode one job at a time, and its setup installs pcb2gcode with Homebrew.
 * It never talks to a machine.
 */

let verification = null
/** Aborted on shutdown, so no pcb2gcode or brew process outlives the companion. */
const lifetime = new AbortController()

const describe = (error) =>
  error instanceof Error ? error.message : String(error)

/** A runtime problem with what setup does about it, as the plugin card and editor show it. */
function withAdvice(error) {
  if (!(error instanceof SetupNeededError)) return describe(error)
  if (!error.command)
    return `${error.message} Install Homebrew from https://brew.sh, then run setup.`
  return `${error.message} Run setup to ${error.command} it with Homebrew.`
}

/**
 * The code views receive: INVALID_PARAMS for a request or file the plugin refuses (with
 * the tool slots when a program needs several), UNAVAILABLE when pcb2gcode cannot run;
 * anything else reaches them as FAILED.
 */
function coded(error) {
  if (error instanceof RpcError) return error
  if (error instanceof MultipleToolSlotsError)
    return new RpcError("INVALID_PARAMS", error.message, {
      reason: "multiple-tool-slots",
      slots: error.slots,
    })
  if (error instanceof InputError)
    return new RpcError("INVALID_PARAMS", error.message)
  if (error instanceof RuntimeError)
    return new RpcError("UNAVAILABLE", withAdvice(error))
  return error
}

/** Homebrew's pcb2gcode: checked once per start, and again after a failure. */
function runtime() {
  verification ??= findRuntime({ signal: lifetime.signal }).catch((error) => {
    verification = null
    throw error
  })
  return verification
}

function whenAborted(signal) {
  return new Promise((_resolve, reject) => {
    const abort = () => reject(new RpcError("CANCELLED", "Cancelled."))
    if (signal.aborted) abort()
    else signal.addEventListener("abort", abort, { once: true })
  })
}

let queue = Promise.resolve()

/** One pcb2gcode or brew process at a time; a job cancelled while it waits leaves the queue. */
async function exclusive(signal, run) {
  const previous = queue
  let release
  queue = new Promise((resolve) => {
    release = resolve
  })
  try {
    await Promise.race([previous, whenAborted(signal)])
    return await run()
  } finally {
    // The next job still waits for the one before this one.
    void previous.then(release)
  }
}

/** Passes output to `write` line by line, as it comes. */
function lines(write) {
  let rest = ""
  return {
    push(chunk) {
      const parts = (rest + chunk).split(/\r?\n/)
      rest = parts.pop()
      for (const line of parts) if (line.trim()) write(line)
    },
    end() {
      if (rest.trim()) write(rest)
      rest = ""
    },
  }
}

async function health() {
  try {
    await runtime()
    return { status: "ready", message: null }
  } catch (error) {
    return {
      status: error instanceof SetupNeededError ? "needs-setup" : "degraded",
      message: withAdvice(error).slice(0, 2000),
    }
  }
}

function stopJobs() {
  lifetime.abort()
}
process.once("SIGTERM", () => {
  stopJobs()
  process.exit(0)
})

serveCompanion({
  health,
  /**
   * Installs pcb2gcode with Homebrew, or reinstalls a copy that does not run. brew's output
   * goes to the plugin's log; a failure leaves the companion needing setup, with the reason.
   */
  async setup({ host, signal }) {
    const cancel = AbortSignal.any([signal, lifetime.signal])
    const label = "Installing pcb2gcode with Homebrew"
    const output = lines((line) => host.log("info", line))
    host.progress({ label, value: null })
    verification = null
    try {
      const installed = await exclusive(cancel, () =>
        installRuntime({ signal: cancel, onOutput: output.push })
      )
      host.log("info", `pcb2gcode ${installed.version} is ready.`)
      return health()
    } catch (error) {
      if (cancel.aborted) throw new RpcError("CANCELLED", "Setup cancelled.")
      host.log("error", `Setup failed: ${describe(error)}`)
      if (error instanceof SetupNeededError) return health()
      return {
        status: "needs-setup",
        message:
          `Homebrew could not install pcb2gcode: ${describe(error)} Run setup to try again.`.slice(
            0,
            2000
          ),
      }
    } finally {
      output.end()
      host.progress({ label, value: 1, done: true })
    }
  },
  shutdown: stopJobs,
  methods: {
    /**
     * Converts one version 1 generator request ({ schemaVersion, files, parameters });
     * the views send one file per operation. Returns the programs and warnings.
     */
    async generate(params, context) {
      const signal = AbortSignal.any([context.signal, lifetime.signal])
      const started = Date.now()
      try {
        const { executable } = await runtime()
        const result = await exclusive(signal, () =>
          generate(params, { executable, signal })
        )
        context.host.log(
          "info",
          `Generated ${result.programs.map((program) => program.name).join(", ")} in ${Date.now() - started} ms.`
        )
        return {
          schemaVersion: 1,
          programs: result.programs,
          warnings: result.warnings,
        }
      } catch (error) {
        if (signal.aborted)
          throw new RpcError("CANCELLED", "Generation cancelled.")
        // pcb2gcode may have gone since it was checked: check it again next time.
        if (error instanceof RuntimeError) verification = null
        context.host.log("warn", `Generation failed: ${describe(error)}`)
        throw coded(error)
      }
    },
  },
})
