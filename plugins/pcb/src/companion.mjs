import { RpcError, serveCompanion } from "@openspindle/plugin-sdk/companion"
import { InputError, MultipleToolSlotsError, generate } from "./converter.mjs"
import { RuntimeError, SetupNeededError, findRuntime } from "./runtime.mjs"

/*
 * The PCB plugin's companion. OpenSpindle starts it while a PCB view is open and calls it
 * over a private channel; the views reach it only through companion.call. It runs the
 * pcb2gcode chosen in the plugin's settings (choosing another restarts it), or while none
 * is chosen the one found where it is usually installed, one job at a time. It never talks
 * to a machine.
 */

let verification = null
/** Aborted on shutdown, so no pcb2gcode process outlives the companion. */
const lifetime = new AbortController()

const describe = (error) =>
  error instanceof Error ? error.message : String(error)

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
    return new RpcError("UNAVAILABLE", error.message)
  return error
}

/** The chosen or found pcb2gcode: checked once per start, and again after a failure. */
function runtime({ info }) {
  verification ??= findRuntime(info.settings.pcb2gcode, {
    signal: lifetime.signal,
  }).catch((error) => {
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

/** One pcb2gcode process at a time; a job cancelled while it waits leaves the queue. */
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

/** Ready once the chosen or found pcb2gcode runs, with its version and where it was found. */
async function health(context) {
  try {
    const { executable, version, found } = await runtime(context)
    return {
      status: "ready",
      message: found
        ? `pcb2gcode ${version} at ${executable}, found automatically`
        : `pcb2gcode ${version}`,
    }
  } catch (error) {
    return {
      status: error instanceof SetupNeededError ? "needs-setup" : "degraded",
      message: describe(error).slice(0, 2000),
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
  /** Looks for pcb2gcode again, after installing it for example. */
  setup(context) {
    verification = null
    return health(context)
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
        const { executable } = await runtime(context)
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
