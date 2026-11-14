import { PLAIN_NC } from "../compile/nc-unit"
import { error, operationSubject } from "../diagnostics"
import type { QuickFix } from "../diagnostics"
import { fail, ok } from "../primitives"
import type { OperationKind } from "./kinds"
import {
  facingKeepOuts,
  facingNc,
  facingPocketPaths,
  facingEntryFrameIssue,
  facingRaster,
  facingToolIssue,
  facingCentreBounds,
} from "./facing"
import { workOriginOnMachine } from "../plate/work-origin"

export const facingKind: OperationKind<"facing"> = {
  kind: "facing",
  label: "Facing",
  verbatim: false,
  generated: true,
  phase: () => "machining",
  tools: ({ source }) => [source.tool],
  resolve: (operation, plate, { tools, kit }) => {
    const p = operation.source.params
    const number = operation.tools.find(
      (binding) => binding.local === operation.source.tool
    )?.plate
    const id = plate.tools.find((entry) => entry.number === number)?.toolId
    const tool = tools.find((candidate) => candidate.id === id)
    let issue = facingToolIssue(tool)
    let fix: QuickFix = { kind: "edit-operation", operationId: operation.id }
    const keepOuts = facingKeepOuts(plate.setup, kit)
    if (!issue && keepOuts.length && !workOriginOnMachine(plate.setup)) {
      issue =
        "Place work XY relative to a stored anchor so the automatic facing keep-outs can be located."
      fix = { kind: "read-anchors" }
    }
    const index = plate.operations.findIndex((item) => item.id === operation.id)
    if (
      !issue &&
      keepOuts.length &&
      plate.operations
        .slice(0, index)
        .some(
          ({ source }) => source.kind === "probing" && source.task === "origin"
        )
    )
      issue =
        "Move Facing before origin probing, or remove that routine after independently confirming work zero; a measured origin would shift the automatic keep-outs."
    if (
      !issue &&
      !facingRaster(p, keepOuts).rows.some((row) => row.spans.length)
    )
      issue =
        "The entire facing raster is inside a protected area. Move or enlarge the rectangle."
    if (!issue && tool?.diameter !== p.diameter)
      issue =
        "The cutter diameter changed. Reopen Facing and apply its current diameter."
    if (!issue && p.removal > (tool?.geometry.fluteLength ?? 0))
      issue = "Removal exceeds the cutter's known cutting length."
    if (
      !issue &&
      kit.spindleRange &&
      (p.rpm < kit.spindleRange.min || p.rpm > kit.spindleRange.max)
    )
      issue = `Spindle RPM must be ${kit.spindleRange.min}–${kit.spindleRange.max} for ${kit.name}.`
    if (!issue) issue = facingEntryFrameIssue(p, plate.setup)
    if (!issue) issue = facingPocketPaths(p, keepOuts).issue
    const bounds = facingCentreBounds(p)
    const left = bounds.min[0] + plate.setup.workOrigin[0]
    const right = bounds.max[0] + plate.setup.workOrigin[0]
    const front = bounds.min[1] + plate.setup.workOrigin[1]
    const back = bounds.max[1] + plate.setup.workOrigin[1]
    if (
      !issue &&
      (left < kit.workAreaOrigin[0] ||
        right > kit.workAreaOrigin[0] + kit.workArea[0] ||
        front < kit.workAreaOrigin[1] ||
        back > kit.workAreaOrigin[1] + kit.workArea[1])
    )
      issue =
        "The cutter-centre travel exceeds the modeled work area. Reduce the rectangle, change its placement or use a cleared-pocket entry."
    const stock = plate.setup.stock
    if (
      !issue &&
      stock &&
      p.top - p.removal + plate.setup.workOrigin[2] < plate.setup.stockAnchor[2]
    )
      issue = "The requested cut goes below the modeled stock bottom."
    if (issue)
      return fail(
        error("facing-invalid", `${operation.name}: ${issue}`, {
          subject: operationSubject(operation.id),
          fix,
        })
      )
    return ok({
      nc: facingNc(p, operation.source.tool, keepOuts),
      policy: PLAIN_NC,
      reviewLines: [],
    })
  },
}
