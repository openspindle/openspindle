import { useEffect, useEffectEvent } from "react"
import { createAtom, useSelector } from "@tanstack/react-store"
import { toast } from "sonner"
import {
  anchorsToStore,
  anchorsToWrite,
} from "@/domain/fixtures/stored-anchors"
import { machineId } from "@/machine/contract"
import { useMachineSnapshot, useWriteAnchors } from "@/platform/machine"
import { useFixtureLibrary } from "./fixture-context"

/** The bed setups' anchors the connected device failed to store, and why. */
type StoredAnchorsFailure = {
  readonly anchors: string
  readonly error: string
}

const failureAtom = createAtom<StoredAnchorsFailure | null>(null)

/** Why the device did not store the bed setups' anchors last written; null when it did. */
export const useStoredAnchorsFailure = () => useSelector(failureAtom)

/** Writes the anchors the device failed to store again. */
export const retryStoredAnchors = () => failureAtom.set(() => null)

/** How long anchors stay unchanged before they are written, so that quick edits write once. */
const WRITE_DELAY_MS = 1000

/**
 * Writes the bed setups' anchors of the connected device's profile to the device while its
 * profile has it store them and the device, as it was last read or written, stores them
 * otherwise (`anchorsToWrite`): a second after they last changed, once the device admits it.
 * Anchors it failed to store are written again once they change, or on `retryStoredAnchors`.
 */
export function useStoredAnchorsSync() {
  const machine = useMachineSnapshot()
  const { mutate, isPending } = useWriteAnchors()
  const device = machine.connection.device
  const deviceKey = device ? machineId(device) : null
  const profile = useFixtureLibrary((library) =>
    deviceKey !== null && Object.hasOwn(library.profiles, deviceKey)
      ? library.profiles[deviceKey]
      : null
  )
  const configuration = machine.anchors.value
  const failure = useSelector(failureAtom)
  const allowed = machine.availability.writeAnchors.allowed
  // Only against the device's latest read, which the profile has merged.
  const wanted =
    profile &&
    configuration?.added &&
    profile.storedAnchors?.fetchedAt === configuration.fetchedAt &&
    anchorsToWrite(profile)
      ? anchorsToStore(profile)
      : null
  const key = wanted && JSON.stringify(wanted)

  const write = useEffectEvent(() => {
    if (!wanted || !key) return
    mutate(
      { added: wanted },
      {
        onSuccess: () => failureAtom.set(() => null),
        onError: (error) => {
          failureAtom.set(() => ({ anchors: key, error: error.message }))
          toast.error("The device did not store the bed setups' anchors.", {
            description: error.message,
          })
        },
      }
    )
  })

  useEffect(() => {
    if (!key || !allowed || isPending || failure?.anchors === key) return
    const timer = setTimeout(write, WRITE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [key, allowed, isPending, failure?.anchors])
}
