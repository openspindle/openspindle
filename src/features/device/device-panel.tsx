import { useEffect, useState } from "react"
import {
  Check,
  Link2,
  LoaderCircle,
  LockOpen,
  RotateCcw,
  Square,
  X,
} from "lucide-react"
import type { ReactNode } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { FieldDescription } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import {
  MachineCommandSchema,
  isFresh,
  outsideLimits,
} from "@/machine/contract"
import type { AvailabilityKey, MachineCommand } from "@/machine/contract"
import {
  useMachineCommand,
  useMachineSnapshot,
  useResetMachine,
  useStopMachine,
} from "@/platform/machine"
import { ReasonButton } from "@/components/workspace/reason-button"
import { DeviceAccessoriesCard } from "./device-accessories-card"
import { DeviceCoordinatesCard } from "./device-coordinates-card"
import { DeviceJogCard } from "./device-jog-card"
import { DeviceOverridesCard } from "./device-overrides-card"
import { DeviceSpindleCard } from "./device-spindle-card"
import { DeviceStatusCard } from "./device-status-card"

export function DevicePanel({
  openPicker,
  fixturePanel,
}: {
  openPicker: () => void
  fixturePanel?: ReactNode
}) {
  const snapshot = useMachineSnapshot()
  const command = useMachineCommand()
  const stop = useStopMachine()
  const reset = useResetMachine()
  const [confirmReset, setConfirmReset] = useState(false)
  const { availability, activity, features, limits, lockout } = snapshot
  const device = snapshot.connection.device
  const telemetry = isFresh(snapshot.telemetry, Date.now())
    ? snapshot.telemetry
    : null
  const [notice, setNotice] = useState("")
  const pending = command.isPending || stop.isPending || reset.isPending

  useEffect(() => {
    setNotice("")
  }, [device?.host, device?.port])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(""), 2500)
    return () => clearTimeout(timer)
  }, [notice])

  /** Availability decides; the schema catches out-of-range input before it is sent. */
  const reason = (key: AvailabilityKey, action?: MachineCommand) => {
    const entry = availability[key]
    if (!entry.allowed) return entry.reason ?? "Unavailable."
    if (action && !MachineCommandSchema.safeParse(action).success)
      return "Enter a value within the allowed range."
    return action && limits ? outsideLimits(action, limits) : null
  }
  const allowed = (action: MachineCommand) =>
    !pending && reason(action.type, action) === null
  const execute = (action: MachineCommand) => {
    if (!allowed(action)) return
    setNotice("")
    command.mutate(action, { onSuccess: () => setNotice("Command confirmed") })
  }

  let state = "Disconnected"
  if (snapshot.connection.restarting) state = "Restarting"
  if (device) state = telemetry ? telemetry.state : "Waiting for status"
  let actionStatus = notice
  if (activity) actionStatus = `${activity.label}…`
  const failure = stop.error ?? reset.error ?? command.error

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-auto p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2>{device?.name ?? "No device connected"}</h2>
            {device && <FieldDescription>{device.host}</FieldDescription>}
          </div>
          <Badge variant={state === "Alarm" ? "destructive" : "secondary"}>
            {state}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={activity !== null}
            onClick={openPicker}
          >
            <Link2 />
            {device ? "Connection" : "Connect device"}
          </Button>
          <ReasonButton
            label="Unlock"
            variant="outline"
            reason={reason("unlock")}
            disabled={pending}
            onClick={() =>
              command.mutate(
                { type: "unlock" },
                {
                  onSuccess: () =>
                    toast.success("Unlocked", {
                      description:
                        "Home the machine before running a program: its position may have changed.",
                    }),
                }
              )
            }
          >
            <LockOpen />
            Unlock
          </ReasonButton>
          <ReasonButton
            label="Reset"
            variant="outline"
            reason={reason("reset")}
            disabled={pending}
            onClick={() => setConfirmReset(true)}
          >
            <RotateCcw />
            Reset
          </ReasonButton>
          <ReasonButton
            label="Stop"
            variant="destructive"
            reason={reason("stop")}
            onClick={() => stop.mutate()}
          >
            <Square fill="currentColor" />
            Stop
          </ReasonButton>
        </div>
      </header>
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the machine?</AlertDialogTitle>
            <AlertDialogDescription>
              Its controller restarts, which takes a few seconds and stops
              anything it is doing. OpenSpindle connects to it again once it is
              back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmReset(false)
                reset.mutate()
              }}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {snapshot.connection.restarting && (
        <Alert role="status">
          <LoaderCircle className="animate-spin" />
          <AlertDescription>
            The machine is restarting. OpenSpindle connects to it again once it
            is back.
          </AlertDescription>
        </Alert>
      )}
      {lockout && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{lockout.reason}</AlertDescription>
        </Alert>
      )}
      {failure && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{failure.message}</AlertDescription>
          <AlertAction>
            <Button
              variant="secondary"
              size="icon-sm"
              aria-label="Dismiss command error"
              onClick={() => {
                command.reset()
                stop.reset()
                reset.reset()
              }}
            >
              <X />
            </Button>
          </AlertAction>
        </Alert>
      )}
      {!failure && snapshot.connection.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{snapshot.connection.error}</AlertDescription>
        </Alert>
      )}
      {telemetry?.state === "Alarm" && telemetry.alarm != null && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>Machine alarm {telemetry.alarm}</AlertDescription>
        </Alert>
      )}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <DeviceStatusCard
            device={device}
            features={features}
            telemetry={telemetry}
            pending={pending}
            reason={reason}
            execute={execute}
          />
          <DeviceAccessoriesCard
            telemetry={telemetry}
            pending={pending}
            reason={reason}
            execute={execute}
          />
          <DeviceOverridesCard
            device={device}
            telemetry={telemetry}
            limits={limits}
            pending={pending}
            reason={reason}
            execute={execute}
          />
          {fixturePanel}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <DeviceCoordinatesCard
            device={device}
            telemetry={telemetry}
            pending={pending}
            reason={reason}
            allowed={allowed}
            execute={execute}
          />
          <DeviceJogCard
            limits={limits}
            reason={reason}
            allowed={allowed}
            execute={execute}
          />
          <DeviceSpindleCard
            device={device}
            telemetry={telemetry}
            limits={limits}
            pending={pending}
            reason={reason}
            execute={execute}
          />
        </div>
      </div>
      <FieldDescription
        className="flex min-h-4 items-center gap-2"
        role="status"
      >
        {actionStatus && (
          <>
            {activity ? (
              <LoaderCircle className="animate-spin" size={13} />
            ) : (
              <Check size={13} />
            )}
            {actionStatus}
          </>
        )}
      </FieldDescription>
    </main>
  )
}
