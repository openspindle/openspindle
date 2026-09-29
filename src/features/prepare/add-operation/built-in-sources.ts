import type { LucideIcon } from "lucide-react"
import { OPERATION_KINDS, probingOf } from "@/domain/operations/kinds"
import type { ProbingSourceKind } from "@/domain/operations/kinds"
import { PROBING_ICONS } from "@/features/plugins/operation-icon"
import {
  useAddProbingOperation,
  useProbeForAdding,
} from "./use-add-probing-operation"

/** An operation OpenSpindle generates itself, as Add operation and the Prepare toolbar offer it. */
export type BuiltInSource = {
  readonly id: string
  readonly icon: LucideIcon
  readonly title: string
  readonly description: string
  /** Adds the operation and selects it; false when it was not added. */
  readonly add: () => boolean
}

const PROBING_KINDS: readonly ProbingSourceKind[] = [
  "auto-level",
  "auto-z-height",
  "auto-scan",
  "probe-3d",
]

const PROBING_DESCRIPTIONS: Record<ProbingSourceKind, string> = {
  "auto-level":
    "Probe the stock surface; the job pauses to review the height map.",
  "auto-z-height": "Touch the stock top with the probe and set work Z there.",
  "auto-scan": "Trace the edges of the plate's work area before cutting.",
  "probe-3d":
    "Find a corner or center with the 3D probe and set the work origin there.",
}

/**
 * The probing operations of the machine's probe: none without a probe, auto-scan if it traces,
 * 3D probing if it has a 3D probe.
 */
export function useBuiltInSources(): BuiltInSource[] {
  const probe = useProbeForAdding()
  const addAutoLevel = useAddProbingOperation("auto-level")
  const addAutoZHeight = useAddProbingOperation("auto-z-height")
  const addAutoScan = useAddProbingOperation("auto-scan")
  const addProbe3d = useAddProbingOperation("probe-3d")
  const add: Record<ProbingSourceKind, () => boolean> = {
    "auto-level": addAutoLevel,
    "auto-z-height": addAutoZHeight,
    "auto-scan": addAutoScan,
    "probe-3d": addProbe3d,
  }
  return PROBING_KINDS.filter((kind) => probingOf(kind).available(probe)).map(
    (kind) => ({
      id: kind,
      icon: PROBING_ICONS[kind],
      title: OPERATION_KINDS[kind].label,
      description: PROBING_DESCRIPTIONS[kind],
      add: add[kind],
    })
  )
}
