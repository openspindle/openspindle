import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react"
import type { ReactNode } from "react"
import { toast } from "sonner"
import { isFresh } from "@/machine/contract"
import {
  machineErrorCode,
  useMachineCommand,
  useMachineSnapshot,
} from "@/platform/machine"
import { useAppearance } from "./appearance-provider"
import { useWorkLightInactivity } from "./use-work-light-inactivity"
import { useWorkLightPreferences } from "./work-light-preferences"

type WorkLightControl = {
  readonly turnOn: () => void
  readonly pending: boolean
  readonly error: Error | null
}

const WorkLightContext = createContext<WorkLightControl | null>(null)

/**
 * Applies the latest preference once it is safe, without retrying failed commands; one the
 * controller refused because another operation was running (such as reading the configuration
 * on connecting) is applied again once that has ended.
 */
export function WorkLightControlProvider({
  children,
}: {
  children: ReactNode
}) {
  const { resolvedAppearance } = useAppearance()
  const { brightness } = useWorkLightPreferences()
  const inactivity = useWorkLightInactivity()
  const snapshot = useMachineSnapshot()
  const { mutate, isPending, error, variables } = useMachineCommand()
  const inFlight = useRef(false)
  const attempted = useRef<string | null>(null)
  const observed = useRef<{
    connectionId: string | null
    lightOn: boolean | null
  }>({ connectionId: null, lightOn: null })
  const connectionId = snapshot.connection.id
  const lightOn = snapshot.telemetry?.lightOn ?? null
  const percent = resolvedAppearance ? brightness[resolvedAppearance] : null
  const target = `${connectionId}:${resolvedAppearance}:${percent}`

  const apply = useCallback(
    (onlyIfOn: boolean) => {
      if (
        inFlight.current ||
        !connectionId ||
        percent === null ||
        !snapshot.availability.lightBrightness.allowed ||
        !isFresh(snapshot.telemetry, Date.now()) ||
        (onlyIfOn && snapshot.telemetry.lightOn !== true)
      )
        return

      attempted.current = target
      inFlight.current = true
      mutate(
        { type: "lightBrightness", connectionId, percent, onlyIfOn },
        {
          onError: (failure) => {
            if (machineErrorCode(failure) === "busy") {
              attempted.current = null
              return
            }
            toast.error("Work light brightness could not be applied", {
              description: failure.message,
            })
          },
          onSettled: () => {
            inFlight.current = false
          },
        }
      )
    },
    [connectionId, mutate, percent, snapshot, target]
  )

  useEffect(() => {
    const previous = observed.current
    if (
      previous.connectionId !== connectionId ||
      (previous.lightOn === true && lightOn === false)
    )
      attempted.current = null
    observed.current = { connectionId, lightOn }

    if (lightOn === true && attempted.current !== target) apply(true)
  }, [apply, connectionId, isPending, lightOn, target])

  const turnOn = useCallback(() => apply(false), [apply])
  const currentError =
    variables?.type === "lightBrightness" &&
    variables.connectionId === connectionId &&
    machineErrorCode(error) !== "busy"
      ? error
      : null

  return (
    <WorkLightContext.Provider
      value={{
        turnOn,
        pending: isPending || inactivity.pending,
        error: currentError ?? inactivity.error,
      }}
    >
      {children}
    </WorkLightContext.Provider>
  )
}

export function useWorkLightControl(): WorkLightControl {
  const context = useContext(WorkLightContext)
  if (!context)
    throw new Error("Work light control requires WorkLightControlProvider.")
  return context
}
