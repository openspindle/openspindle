import { isAnchorConfiguration } from "@/machine/contract"
import type { RuleFixes } from "@/machine/contract"
import {
  anchorsFromDevice,
  isStoredAnchorSetup,
} from "../anchors/stored-anchors"
import type { StoredAnchor } from "../anchors/stored-anchors"
import { PLATE_SUBJECT, operationSubject } from "../diagnostics"
import type { QuickFix } from "../diagnostics"
import { EPSILON } from "../geometry/millimetres"
import type {
  OperationRuleSubject,
  RunRuleSubject,
  StageRule,
} from "../rules/stages"
import { placementContext } from "./placement"
import type { AnchorPlacement, PlacementContext } from "./placement"

/** What a probing operation's advice offers: editing the operation. */
export const editOperation: RuleFixes<OperationRuleSubject, QuickFix> = {
  offer: ({ first }) => [
    { kind: "edit-operation", operationId: first.operation.id },
  ],
}

/**
 * An anchored probing operation (a grid, a touch-off or 3D probing) among Run's subjects: the
 * anchor it travels to, and where its plate places it; null for any other subject.
 */
function anchoredProbing({ plate, operation }: RunRuleSubject): {
  readonly placement: AnchorPlacement
  readonly plate: PlacementContext
} | null {
  if (!plate || !operation) return null
  const { source } = operation
  if (source.kind !== "probing" || source.task === "outline") return null
  const { placement } = source.params
  return placement.kind === "anchor"
    ? { placement, plate: placementContext(plate) }
    : null
}

/** An anchored probing operation's gates before Run: a failure stops its later ones. */
const PROBING_CHAIN = "probing"

/** What each of an anchored probing operation's failures offers: reading the device's anchors. */
const readAnchors: RuleFixes<RunRuleSubject, QuickFix> = {
  offer: () => [{ kind: "read-anchors" }],
}

/** What a probing operation's failure before Run is about: the operation. */
const aboutOperation = ({ operation }: RunRuleSubject) =>
  operation ? operationSubject(operation.id) : PLATE_SUBJECT

const probingAnchorsNotRead: StageRule<"run"> = {
  id: "probing/anchors-not-read",
  stage: "run",
  label: "Probing anchors read",
  description:
    "An anchored probing operation needs the plate's anchor snapshot read from the connected device, which the plate is set up for.",
  severity: "error",
  configurable: false,
  chain: PROBING_CHAIN,
  test: (subject) => {
    const anchored = anchoredProbing(subject)
    if (!anchored) return true
    const setup = anchored.plate.anchorSetup
    const connected = subject.machine.connectedDeviceId
    return (
      !!connected &&
      anchored.plate.deviceId === connected &&
      isStoredAnchorSetup(setup) &&
      setup.source === "firmware-config" &&
      setup.deviceId === connected
    )
  },
  explain: ({ first }) => ({
    problem:
      "Use Read anchors to load this plate's connected device settings before Run.",
    about: aboutOperation(first),
  }),
  fixes: readAnchors,
}

const probingLiveAnchorsUnavailable: StageRule<"run"> = {
  id: "probing/live-anchors-unavailable",
  stage: "run",
  label: "Probing anchors loaded",
  description:
    "An anchored probing operation is checked against the connected device's current stored anchors, which Read anchors loads.",
  severity: "error",
  configurable: false,
  chain: PROBING_CHAIN,
  test: (subject) =>
    !anchoredProbing(subject) || isAnchorConfiguration(subject.machine.anchors),
  explain: ({ first }) => ({
    problem:
      "Use Read anchors to load the connected device's current stored anchors before Run.",
    about: aboutOperation(first),
  }),
  fixes: readAnchors,
}

const probingAnchorsChanged: StageRule<"run"> = {
  id: "probing/anchors-changed",
  stage: "run",
  label: "Probing anchors unchanged",
  description:
    "The connected device must still store the anchors of the plate's snapshot, the probing operation's among them.",
  severity: "error",
  configurable: false,
  chain: PROBING_CHAIN,
  test: (subject) => {
    const anchored = anchoredProbing(subject)
    const setup = anchored?.plate.anchorSetup
    const { connectedDeviceId, anchors } = subject.machine
    if (
      !anchored ||
      !isStoredAnchorSetup(setup) ||
      !connectedDeviceId ||
      !isAnchorConfiguration(anchors)
    )
      return true
    const live = anchorsFromDevice(anchors, connectedDeviceId).anchors
    const saved = ({ id, machinePosition: [x, y] }: StoredAnchor) =>
      setup.anchors.some(
        (anchor) =>
          anchor.id === id &&
          Math.abs(anchor.machinePosition[0] - x) <= EPSILON &&
          Math.abs(anchor.machinePosition[1] - y) <= EPSILON
      )
    return (
      live.some((anchor) => anchor.id === anchored.placement.anchorId) &&
      live.every(saved)
    )
  },
  explain: ({ first }) => ({
    problem: "Stored anchors changed. Use Read anchors before Run.",
    about: aboutOperation(first),
  }),
  fixes: readAnchors,
}

/**
 * What Run needs of an anchored probing operation (a grid, a touch-off or 3D probing): the
 * plate's anchor snapshot read from the connected device, which the plate is set up for, and
 * still matching the device's stored anchors. Generation blockers block Run as compile errors.
 */
export const PROBING_RUN_RULES: readonly StageRule<"run">[] = [
  probingAnchorsNotRead,
  probingLiveAnchorsUnavailable,
  probingAnchorsChanged,
]
