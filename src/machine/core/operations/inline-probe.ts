import { isHeightCompensationOff, readNcBlock } from "../../contract/index.ts"
import type {
  ContactsMeasurement,
  PreparedProgram,
  Telemetry,
  NcBlock,
} from "../../contract/index.ts"
import { FAILURE_LINES, excerpt } from "../../firmware/adapter.ts"
import { MachineError } from "../errors.ts"
import { freshStatus, PREFLIGHT_MS } from "./context.ts"
import type { OperationContext } from "./context.ts"
import type { JobRunnerHooks } from "./job-runner.ts"

const POSITION_TOLERANCE = 0.003
const xyz = (status: Telemetry) => {
  if (!status.machine)
    throw new MachineError(
      "unverified",
      "Machine coordinates are unavailable. No following step was sent."
    )
  return [status.machine.x, status.machine.y, status.machine.z] as const
}
function requireMeasuredProbe(context: OperationContext, status: Telemetry) {
  if (
    status.job !== null ||
    status.units !== "mm" ||
    !isHeightCompensationOff(status) ||
    status.tool !== context.probeTool ||
    status.toolOffset === null ||
    status.spindleRpm !== 0 ||
    status.spindleOn === true
  )
    throw new MachineError(
      "unverified",
      `The stationary measured probe could not be verified (state ${status.state}, tool ${status.tool}, units ${status.units}, compensation active ${status.compensationActive}, spindle ${status.spindleRpm} RPM). No following step was sent.`
    )
  xyz(status)
}

function requireStationaryProbe(context: OperationContext, status: Telemetry) {
  requireMeasuredProbe(context, status)
  if (status.state !== "Idle")
    throw new MachineError(
      "unverified",
      `The probe is not confirmed stationary (state ${status.state}). No following step was sent.`
    )
}

/** After a drain the bridge can retain Run or an older Idle pose. Only status is polled. */
async function stationaryProbeStatus(
  context: OperationContext,
  timeoutMessage: string,
  matches: (status: Telemetry) => boolean = () => true,
  expectedOffset: number | null = null
): Promise<Telemetry> {
  const { session, signal } = context
  const after = session.store.sequence
  const releaseBoost = session.boostPolling()
  try {
    const status = session.store.waitFor(
      (value) => value.state === "Idle" && matches(value),
      {
        after,
        timeoutMs: PREFLIGHT_MS,
        timeoutMessage,
        signal,
        failWhen: (value) => {
          try {
            requireMeasuredProbe(context, value)
            if (expectedOffset !== null && value.toolOffset !== expectedOffset)
              throw new MachineError(
                "unverified",
                "Tool offset changed during a probe search."
              )
            if (value.state !== "Idle" && value.state !== "Run")
              throw new MachineError(
                "unverified",
                `The machine entered ${value.state} while waiting for the probe to stop. No following step was sent.`
              )
            return null
          } catch (error) {
            if (error instanceof MachineError) return error
            throw error
          }
        },
      }
    )
    session.requestStatus(true)
    return await status
  } finally {
    releaseBoost()
  }
}

/** A fresh hardware input read at a stationary pose, before every search and after release. */
async function probeInput(
  context: OperationContext
): Promise<{ status: Telemetry; triggered: boolean | null }> {
  const { session, adapter } = context
  const switches = adapter.switches
  if (!switches)
    throw new MachineError(
      "refused",
      "No actual probe-input query is available."
    )
  const before = await stationaryProbeStatus(
    context,
    "The machine did not report Idle within 3 seconds before the probe-input check. No following step was sent."
  )
  requireStationaryProbe(context, before)
  let triggered: boolean | null = null
  await session.request<void>(
    [switches.query],
    (event) => {
      if (event.kind !== "line") return "ignored"
      if (FAILURE_LINES.has(event.line.kind))
        return {
          fail: new MachineError(
            "rejected",
            `Probe-input check failed: ${excerpt(event.line.text)}`
          ),
        }
      const report = switches.parse(event.line.text)
      if (report) {
        if (triggered !== null || report.probe === null)
          return {
            fail: new MachineError(
              "unverified",
              "Ambiguous probe-input report. No search was sent."
            ),
          }
        triggered = report.probe
        return "consumed"
      }
      if (/\[PRB:/i.test(event.line.text))
        return {
          fail: new MachineError(
            "unverified",
            "Unexpected probe contact during the stationary input check."
          ),
        }
      if (event.line.kind === "ack") {
        if (triggered === null)
          return {
            fail: new MachineError(
              "refused",
              "The probe input was not reported. No search was sent."
            ),
          }
        return { done: undefined }
      }
      return "ignored"
    },
    {
      timeoutMs: 5000,
      timeoutMessage: "The probe input was not verified. No search was sent.",
      signal: context.signal,
    }
  )
  const after = await freshStatus(
    context,
    "No fresh status after the probe-input check."
  )
  requireStationaryProbe(context, after)
  const start = xyz(before),
    end = xyz(after)
  if (
    after.toolOffset !== before.toolOffset ||
    start.some(
      (value, axis) => Math.abs(value - end[axis]) > POSITION_TOLERANCE
    )
  )
    throw new MachineError(
      "unverified",
      "The probe moved or its offset changed during the stationary input check."
    )
  return { status: after, triggered }
}

async function releasedStart(context: OperationContext) {
  const input = await probeInput(context)
  if (input.triggered !== false)
    throw new MachineError(
      "refused",
      "The probe input is not released. No following move was sent."
    )
  return input.status
}

/** G38 bypasses ordinary soft stops on this firmware. Check the whole possible travel ourselves. */
async function verifyTravelBounds(
  context: OperationContext,
  block: NcBlock,
  before: Telemetry,
  shortenDown = false
) {
  const query = context.adapter.probeTravelBounds
  if (!query)
    throw new MachineError(
      "refused",
      "The host cannot verify probe travel limits. No move was sent."
    )
  let bounds: ReturnType<typeof query.parse> = null
  let effective = block
  await context.session.request<void>(
    [context.adapter.consoleLine(query.query)],
    (event) => {
      if (event.kind !== "line") return "ignored"
      if (FAILURE_LINES.has(event.line.kind))
        return {
          fail: new MachineError(
            "rejected",
            `Probe travel-limit check failed: ${excerpt(event.line.text)}`
          ),
        }
      const found = query.parse(event.line.text)
      if (
        (!found && /^Soft endstops are /i.test(event.line.text)) ||
        /\[PRB:/i.test(event.line.text)
      )
        return {
          fail: new MachineError(
            "unverified",
            "Invalid travel limits or unexpected probe contact during the limit check. No move was sent."
          ),
        }
      if (found) {
        if (bounds)
          return {
            fail: new MachineError(
              "unverified",
              "Ambiguous probe travel limits. No move was sent."
            ),
          }
        bounds = found
        return "consumed"
      }
      if (event.line.kind === "ack") {
        const received = bounds
        if (!received)
          return {
            fail: new MachineError(
              "unverified",
              "Enabled, homed XYZ travel limits were not reported. No move was sent."
            ),
          }
        const start = xyz(before)
        if (shortenDown) {
          const requested = block.words.find((word) => word.letter === "Z")
          if (!requested || requested.value >= 0)
            return {
              fail: new MachineError(
                "refused",
                "Only a downward Z search can be shortened."
              ),
            }
          const travel =
            Math.floor(
              Math.min(-requested.value, start[2] - received.min[2] - 0.01) *
                10000
            ) / 10000
          if (travel < 0.001)
            return {
              fail: new MachineError(
                "refused",
                "There is no downward probe travel above the reported lower Z limit. No search was sent."
              ),
            }
          effective = readNcBlock(
            block.words
              .map(
                (word) =>
                  `${word.letter}${word.letter === "Z" ? -travel : word.value}`
              )
              .join(" ")
          )
        }
        const end = [...start]
        for (const word of effective.words) {
          const axis = ["X", "Y", "Z"].indexOf(word.letter)
          if (axis >= 0) end[axis] += word.value
        }
        if (
          [start, end].some((point) =>
            point.some(
              (value, axis) =>
                value < received.min[axis] - 0.001 ||
                value > received.max[axis] + 0.001
            )
          )
        )
          return {
            fail: new MachineError(
              "refused",
              "The full probe travel would exceed a reported machine limit. Reduce the bound or reposition; no move was sent."
            ),
          }
        return { done: undefined }
      }
      return "ignored"
    },
    {
      timeoutMs: 5000,
      timeoutMessage:
        "Probe travel limits could not be verified. No move was sent.",
      signal: context.signal,
    }
  )
  const after = await freshStatus(
    context,
    "No fresh status after checking probe travel limits."
  )
  requireStationaryProbe(context, after)
  if (
    after.toolOffset !== before.toolOffset ||
    xyz(before).some(
      (value, axis) => Math.abs(value - xyz(after)[axis]) > POSITION_TOLERANCE
    )
  )
    throw new MachineError(
      "unverified",
      "The probe moved or its tool offset changed while checking travel limits. No move was sent."
    )
  return effective
}

/** A successful report must belong to this bounded axis search and agree with stopped MCS. */
async function verifyContact(
  context: OperationContext,
  block: NcBlock,
  before: Telemetry,
  contact: readonly number[],
  requireEndpoint = false
) {
  const start = xyz(before)
  const movement = block.words.filter((word) =>
    ["X", "Y", "Z"].includes(word.letter)
  )
  if (movement.length !== 1)
    throw new MachineError(
      "refused",
      "A bounded search must move exactly one axis."
    )
  const axis = ["X", "Y", "Z"].indexOf(movement[0].letter)
  const distance = movement[0].value
  const travel = (contact[axis] - start[axis]) * Math.sign(distance)
  if (
    !contact.every(Number.isFinite) ||
    travel < -POSITION_TOLERANCE ||
    travel > Math.abs(distance) + POSITION_TOLERANCE ||
    (requireEndpoint &&
      Math.abs(travel - Math.abs(distance)) > POSITION_TOLERANCE) ||
    contact.some(
      (value, index) =>
        index !== axis && Math.abs(value - start[index]) > POSITION_TOLERANCE
    )
  )
    throw new MachineError(
      "unverified",
      `Probe report does not match this search's axis and travel bounds. Start XYZ ${start.join(", ")}; command ${block.code}; reported XYZ ${contact.join(", ")}. No following step was sent.`
    )
  // The bridge can report an older Idle pose after the synchronous PRB reply
  // and acknowledged drain, especially for a short transit. Poll status only:
  // do not accept that pose, widen the tolerance or repeat the motion.
  const observed: { position: readonly number[] | null } = { position: null }
  try {
    await stationaryProbeStatus(
      context,
      "Stopped coordinates did not match the probe report within 3 seconds.",
      (status) => {
        const position = xyz(status)
        observed.position = position
        return contact.every(
          (value, index) =>
            Math.abs(value - position[index]) <= POSITION_TOLERANCE
        )
      },
      before.toolOffset
    )
  } catch (error) {
    if (!(error instanceof MachineError) || error.code !== "timeout")
      throw error
    throw new MachineError(
      "unverified",
      `Stopped coordinates did not match the probe report within 3 seconds (tolerance ${POSITION_TOLERANCE} mm). Start XYZ ${start.join(", ")}; command ${block.code}; reported XYZ ${contact.join(", ")}; last stopped XYZ ${observed.position?.join(", ") ?? "unavailable"}. No following step was sent.`
    )
  }
}

/** Console replies stay observable: played-file G38 replies go to the firmware's null stream. */
async function step(
  context: OperationContext,
  line: string,
  probing: boolean,
  transit = false
) {
  const { session, adapter } = context
  let contact: [number, number, number] | null = null
  let timeoutMs = transit ? 120000 : 30000
  if (probing && !transit) {
    const words = readNcBlock(line).words
    const distance =
      words.find((word) => ["X", "Y", "Z"].includes(word.letter))?.value ?? 0
    const feed = words.find((word) => word.letter === "F")?.value ?? 0
    if (feed > 0)
      timeoutMs = Math.min(
        300000,
        Math.max(
          timeoutMs,
          Math.ceil((Math.abs(distance) / feed) * 60000) + 10000
        )
      )
  }
  return session.request<[number, number, number] | null>(
    [adapter.consoleLine(line)],
    (event) => {
      if (event.kind !== "line") return "ignored"
      if (FAILURE_LINES.has(event.line.kind))
        return {
          fail: new MachineError(
            "rejected",
            `Bounded probing stopped: ${excerpt(event.line.text)}`
          ),
        }
      const found = adapter.probeContact?.(event.line.text)
      if (found) {
        if (transit && found.success)
          return {
            fail: new MachineError(
              "rejected",
              "The probe touched something during positioning. Motion stopped; no following move was sent."
            ),
          }
        if (!probing || contact || found.success === transit)
          return {
            fail: new MachineError(
              "rejected",
              "Unexpected, duplicate or unsuccessful probe contact. No following step was sent."
            ),
          }
        contact = found.position
        return "consumed"
      }
      if (/\[PRB:/i.test(event.line.text))
        return {
          fail: new MachineError(
            "rejected",
            "Malformed probe contact. No following step was sent."
          ),
        }
      if (event.line.kind === "ack") {
        if (probing && !contact)
          return {
            fail: new MachineError(
              "unverified",
              "Probe command acknowledged without its successful contact. No following step was sent."
            ),
          }
        return { done: contact }
      }
      return "ignored"
    },
    {
      timeoutMs,
      timeoutMessage:
        "Bounded probing timed out. No following step was sent and nothing was retried.",
      signal: context.signal,
    }
  )
}

/** One owned line at a time; every contact and drain must succeed before offsets or more travel. */
export async function runInlineProbe(
  context: OperationContext,
  program: PreparedProgram,
  hooks: JobRunnerHooks
) {
  if (
    !program.probeCheck ||
    !context.authorizeProbeCheck ||
    !context.adapter.probeContact
  )
    throw new MachineError(
      "refused",
      "This host cannot execute a verified bounded probe routine."
    )
  const authorize = context.authorizeProbeCheck
  if (!context.adapter.probeCheckTools?.includes(program.probeCheck.tool))
    throw new MachineError("refused", "This measured probe is not supported.")
  context = { ...context, probeTool: program.probeCheck.tool }
  const expectedContacts = program.text
    .split("\n")
    .filter((line) =>
      readNcBlock(line).words.some(
        (word) => word.letter === "G" && word.value === 38.2
      )
    ).length
  const transit =
    expectedContacts === 0 &&
    program.text
      .split("\n")
      .some((line) =>
        readNcBlock(line).words.some(
          (word) => word.letter === "G" && word.value === 38.3
        )
      )
  if (!transit && expectedContacts !== 2 && expectedContacts !== 6)
    throw new MachineError(
      "refused",
      "Invalid number of protected probe contacts."
    )
  const { session, adapter, clock } = context
  authorize(program.probeCheck)
  const started = clock.now()
  const contacts: ContactsMeasurement = {
    kind: "contacts",
    contacts: [],
    line: null,
    at: started,
  }
  hooks.update({
    phase: "running",
    path: "inline:verified-bounded-probing",
    transfer: { uploadedBytes: 0, verifiedBytes: 0, totalBytes: 0 },
  })
  let currentLine = "before the first command"
  try {
    for (const [index, written] of program.text.split("\n").entries()) {
      const block = readNcBlock(written)
      if (!block.code) continue
      currentLine = `line ${index + 1}: ${block.code}`
      if (context.signal.aborted) throw context.signal.reason
      const probing = block.words.some(
        (word) => word.letter === "G" && [38.2, 38.3, 38.4].includes(word.value)
      )
      const moving = block.words.some(
        (word) => word.letter === "G" && word.value === 38.3
      )
      const releasing = block.words.some(
        (word) => word.letter === "G" && word.value === 38.4
      )
      // G38.4 is the firmware's bounded probe-away operation. If the input
      // already opened at rest, no release motion is needed or sent.
      const releaseInput = releasing ? await probeInput(context) : null
      let before: Telemetry | null = releaseInput?.status ?? null
      if (probing && !releasing) before = await releasedStart(context)
      const skipRelease = releasing && releaseInput?.triggered === false
      let executed = block
      if (probing && !skipRelease && before)
        executed = await verifyTravelBounds(
          context,
          block,
          before,
          program.probeDownToLimit === true &&
            contacts.contacts.length === 0 &&
            !moving &&
            !releasing
        )
      currentLine = `line ${index + 1}: ${executed.code}`
      const contact = skipRelease
        ? null
        : await step(context, executed.code, probing, moving)
      // G38 is synchronous, and this also drains every queued ordinary move before advancing.
      await step(context, "M400", false)
      if (contact) {
        if (!before)
          throw new MachineError(
            "unverified",
            "No verified start for this contact."
          )
        await verifyContact(context, executed, before, contact, moving)
        if (!releasing && !moving) {
          contacts.contacts.push(contact)
          contacts.line ??= index + 1
          if (contacts.contacts.length > expectedContacts)
            throw new MachineError(
              "rejected",
              "Too many contacts; bounded probing stopped."
            )
        }
      }
      // A probe-away PRB is a release event, never one of the six measuring
      // contacts. Confirm Open before permitting any ordinary clearance move.
      if (releasing || moving) await releasedStart(context)
      hooks.update({
        measurements: contacts.contacts.length
          ? [{ ...contacts, contacts: [...contacts.contacts] }]
          : [],
        progress: {
          line: index + 1,
          percent: Math.min(99, ((index + 1) / program.lineCount) * 100),
          elapsedSeconds: (clock.now() - started) / 1000,
        },
      })
    }
    if (contacts.contacts.length !== expectedContacts)
      throw new MachineError(
        "unverified",
        `The routine did not produce exactly ${expectedContacts} successful contacts.`
      )
    const status = await stationaryProbeStatus(
      context,
      "The machine did not report Idle within 3 seconds after bounded probing."
    )
    if (
      status.state !== "Idle" ||
      status.job !== null ||
      status.spindleRpm !== 0
    )
      throw new MachineError(
        "unverified",
        "The device did not finish bounded probing idle with its spindle stopped."
      )
    hooks.update({
      phase: "completed",
      endedAt: clock.now(),
      progress: {
        line: program.lineCount,
        percent: 100,
        elapsedSeconds: (clock.now() - started) / 1000,
      },
    })
  } catch (error) {
    if (!context.signal.aborted && !session.closed) session.send(adapter.halt)
    if (error instanceof MachineError)
      throw new MachineError(
        error.code,
        `${error.message} At ${currentLine}; ${contacts.contacts.length} measuring contacts verified. No step was retried.`
      )
    throw error
  }
}
