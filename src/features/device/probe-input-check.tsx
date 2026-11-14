import { useEffect, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { FieldDescription } from "@/components/ui/field"
import { StageCard } from "@/features/job/stage-card"
import { probeProfile } from "@/domain/tools/tool"
import type { Tool } from "@/domain/tools/tool"
import { isFresh, isHeightCompensationOff } from "@/machine/contract"
import type { MachineSnapshot, ProbeCheckBinding } from "@/machine/contract"
import { useMachineHost, useMachineSnapshot } from "@/platform/machine"
import { log } from "@/app/errors/log"

// UI scoping only; the host owns expiry, tool identity and the one-use input proof.
let verifiedToolKey: string | null = null

/** Only a released input checked at the current stationary pose can enable Run. */
export function checkedProbeBinding(machine: MachineSnapshot) {
  const check = machine.probeCheck
  if (
    check?.phase !== "verified" ||
    check.connectionId !== machine.connection.id ||
    check.expiresAt <= Date.now()
  )
    return null
  try {
    checkPose(machine, check.connectionId, check.binding)
    return check.binding
  } catch {
    return null
  }
}

function signalWaitingReason(
  machine: MachineSnapshot,
  toolNumber: number | null,
  disabled: boolean
): string | null {
  if (disabled) return "Finish or dismiss the current calibration run first."
  if (machine.connection.status !== "connected")
    return "Connect the machine before checking the probe signal."
  const status = machine.telemetry
  if (!isFresh(status, Date.now())) return "Waiting for fresh machine status."
  if (status.state !== "Idle")
    return `The machine reports ${status.state}; the signal check starts when it is Idle.`
  if (status.job !== null) return "Wait for the machine's program to finish."
  if (toolNumber === null)
    return "Select a supported Z or XYZ probe in this guide."
  if (status.tool !== toolNumber)
    return `The active tool is ${status.tool === null ? "unknown" : `T${status.tool}`}; select and measure the fitted probe as T${toolNumber}.`
  if (status.toolOffset === null)
    return "The probe has no reported tool offset. Run tool-setter detection first."
  if (!status.machine) return "Waiting for reported machine coordinates."
  if (status.spindleRpm !== 0 || status.spindleOn === true)
    return "Wait for the spindle to report stopped before touching the probe."
  if (!isHeightCompensationOff(status)) {
    if (status.compensationActive === true)
      return "Height compensation is active. Clear the height map before calibration."
    return "Waiting for the machine to confirm height compensation is off."
  }
  if (status.units !== "mm") return "Select millimetre mode before calibration."
  return null
}

function requireActive(signal: AbortSignal) {
  if (signal.aborted)
    throw new DOMException("Signal watch ended.", "AbortError")
}

function waitForNextRead(signal: AbortSignal, milliseconds = 500) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener("abort", finish, { once: true })
    if (signal.aborted) finish()
  })
}

function checkPose(
  snapshot: MachineSnapshot,
  connectionId: string,
  binding: ProbeCheckBinding
) {
  const status = snapshot.telemetry
  if (
    snapshot.connection.id !== connectionId ||
    snapshot.connection.status !== "connected" ||
    !isFresh(status, Date.now()) ||
    status.state !== "Idle" ||
    status.job !== null ||
    status.tool !== binding.tool ||
    status.toolOffset !== binding.toolOffset ||
    status.spindleRpm !== 0 ||
    status.spindleOn === true ||
    !isHeightCompensationOff(status) ||
    status.units !== "mm" ||
    !status.machine ||
    binding.position.some(
      (value, axis) =>
        Math.abs(
          value -
            [status.machine!.x, status.machine!.y, status.machine!.z][axis]
        ) > 0.001
    )
  )
    throw new Error(
      "Position, tool or connection changed. Keep the probe stationary while testing its signal."
    )
}

/** Watches only while this guide's positioning step is visible. Never sends axis motion. */
export function ProbeInputCheck({
  tool,
  toolNumber,
  disabled = false,
  onVerified,
}: {
  tool: Tool
  toolNumber: number | null
  disabled?: boolean
  onVerified: (bindingId: string) => void
}) {
  const machine = useMachineSnapshot()
  const status = machine.telemetry
  const waitingMessage = signalWaitingReason(machine, toolNumber, disabled)
  const ready = waitingMessage === null
  useEffect(() => {
    log.info("Probe signal watch readiness", {
      reason: waitingMessage ?? "ready",
      toolNumber,
    })
  }, [waitingMessage, toolNumber])
  const poseKey =
    ready && status?.machine
      ? JSON.stringify({
          connectionId: machine.connection.id,
          tool: status.tool,
          toolOffset: status.toolOffset,
          position: [status.machine.x, status.machine.y, status.machine.z].map(
            (value) => Number(value.toFixed(3))
          ),
        })
      : "waiting"
  return (
    <SignalWatch
      key={`${JSON.stringify(tool)}:${poseKey}`}
      tool={tool}
      toolNumber={toolNumber}
      ready={ready}
      waitingMessage={waitingMessage ?? "Waiting for probe status."}
      onVerified={onVerified}
    />
  )
}

function SignalWatch({
  tool,
  toolNumber,
  ready,
  waitingMessage,
  onVerified,
}: {
  tool: Tool
  toolNumber: number | null
  ready: boolean
  waitingMessage: string
  onVerified: (bindingId: string) => void
}) {
  const host = useMachineHost()
  const machine = useMachineSnapshot()
  const callback = useRef(onVerified)
  const quietUntil = useRef(0)
  const [message, setMessage] = useState(
    ready
      ? "Checking probe signal…"
      : "Finish tool setting and positioning; keep the spindle stopped"
  )
  const [verifiedId, setVerifiedId] = useState<string | null>(null)
  const [readout, setReadout] = useState<{
    reads: number
    triggered: boolean
  } | null>(null)
  useEffect(() => {
    callback.current = onVerified
  }, [onVerified])
  useEffect(() => {
    const manualIntent = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-machine-controls]")
      )
        quietUntil.current = Date.now() + 2000
    }
    const events = ["pointermove", "pointerdown", "keydown", "focusin"] as const
    for (const event of events)
      document.addEventListener(event, manualIntent, true)
    return () => {
      for (const event of events)
        document.removeEventListener(event, manualIntent, true)
    }
  }, [])
  const watch = useMutation({
    mutationFn: async (signal: AbortSignal) => {
      try {
        await waitForNextRead(signal, 1500)
        requireActive(signal)
        const initial = await host.snapshot()
        requireActive(signal)
        const telemetry = initial.telemetry
        const connectionId = initial.connection.id
        if (
          !isFresh(telemetry, Date.now()) ||
          !telemetry.machine ||
          telemetry.toolOffset === null ||
          toolNumber === null ||
          !connectionId ||
          telemetry.tool !== toolNumber
        )
          throw new Error(
            "Run tool-setter detection for the fitted probe first."
          )
        const binding: ProbeCheckBinding = {
          id: crypto.randomUUID(),
          tool: toolNumber,
          toolOffset: telemetry.toolOffset,
          position: [
            telemetry.machine.x,
            telemetry.machine.y,
            telemetry.machine.z,
          ],
        }
        let proofId: string | null = null
        const previous = initial.probeCheck
        const retainSignal =
          verifiedToolKey === JSON.stringify(tool) &&
          previous?.phase === "verified" &&
          previous.connectionId === connectionId &&
          previous.expiresAt > Date.now() &&
          previous.binding.tool === toolNumber &&
          previous.binding.toolOffset === telemetry.toolOffset
        let firstRead = true
        while (!signal.aborted) {
          if (Date.now() < quietUntil.current) {
            setMessage(
              "Positioning controls in use—signal watch resumes when you stop"
            )
            await waitForNextRead(signal)
            continue
          }
          const before = await host.snapshot()
          requireActive(signal)
          checkPose(before, connectionId, binding)
          if (proofId && before.probeCheck?.binding.id !== proofId)
            throw new Error(
              "The signal check changed. Return to the previous step and Next to check again."
            )
          if (!before.availability.readSwitches.allowed) {
            setMessage(
              before.availability.readSwitches.reason ??
                "Waiting for the machine to allow a probe signal read"
            )
            await waitForNextRead(signal)
            continue
          }
          // Input may have arrived while the snapshot was in flight. Finish any
          // existing read normally, but do not claim another lease while positioning.
          if (Date.now() < quietUntil.current) continue
          const report = await host.readSwitches({
            expectedConnectionId: connectionId,
            startProbeCheck: firstRead && !retainSignal,
          })
          firstRead = false
          requireActive(signal)
          if (report.probe === null)
            throw new Error(
              "The machine did not report its probe input. Check the cable, then return to the previous step and Next."
            )
          const triggered = report.probe
          setReadout((current) => ({
            reads: (current?.reads ?? 0) + 1,
            triggered,
          }))
          const after = await host.snapshot()
          requireActive(signal)
          checkPose(after, connectionId, binding)
          const check = after.probeCheck
          if (!proofId && report.probe) {
            setMessage(
              "Remove the contact first; the input is already touching"
            )
          } else {
            if (
              !check ||
              check.connectionId !== connectionId ||
              (proofId && check.binding.id !== proofId)
            )
              throw new Error(
                "Signal check interrupted. Keep the probe still, then return to the previous step and Next."
              )
            proofId = check.binding.id
            if (check.phase === "verified") return proofId
            setMessage(
              check.phase === "triggered"
                ? "Contact detected—remove it now"
                : "Ready—touch the probe once, then remove the contact"
            )
          }
          await waitForNextRead(signal)
        }
        requireActive(signal)
        throw new DOMException("Signal watch ended.", "AbortError")
      } catch (error) {
        requireActive(signal)
        throw error
      }
    },
    onSuccess: (id) => {
      verifiedToolKey = JSON.stringify(tool)
      setVerifiedId(id)
      setMessage("Probe signal verified")
      callback.current(id)
    },
    onError: (error) => {
      if (error.name === "AbortError") return
      setMessage(error.message)
      toast.error(error.message)
    },
  })
  const { mutate } = watch
  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    mutate(controller.signal)
    return () => controller.abort()
  }, [ready, mutate])
  const check = machine.probeCheck
  const verified =
    check?.phase === "verified" &&
    check.binding.id === verifiedId &&
    check.expiresAt > Date.now()
  const conductive = probeProfile(tool)?.contact === "conductive"
  let shown = message
  if (!ready) shown = waitingMessage
  else if (verifiedId && !verified)
    shown = "Signal check expired—return to the previous step and Next"
  let badge = "Waiting"
  if (watch.isPending) badge = "Watching"
  if (verified) badge = "Verified"
  return (
    <StageCard title="Check probe signal">
      <div role="status" aria-live="polite">
        <Badge variant={verified ? "secondary" : "outline"}>{badge}</Badge>
        <p className="mt-2">{shown}</p>
        {readout && (
          <FieldDescription className="font-numeric">
            Live input: {readout.triggered ? "Contact" : "Open"} ·{" "}
            {readout.reads} readings received
          </FieldDescription>
        )}
      </div>
      <p>
        After positioning, leave the axes stationary and spindle stopped. The
        guide watches the signal automatically. No buttons are needed while
        touching.
      </p>
      <p>
        {conductive
          ? "Touch the stationary rod with a wire or metal object connected to the machine's conductive table or bracket. Hold for about two seconds, then remove it. A loose metal object alone may not complete the sensing circuit. Do not push or bend the rod."
          : "Gently trigger the stationary probe once, hold for about two seconds, then let it return."}{" "}
        Return to the PC and continue when the signal is verified.
      </p>
      <FieldDescription>
        This sends status queries only, with no axis motion. A tool-setter
        measurement checks a separate input. Remove loose testing contacts
        before running the job. A completed touch test stays valid through
        jogging for the same measured probe within its two-minute window. The
        guide checks the released input again when you stop positioning.
      </FieldDescription>
    </StageCard>
  )
}
