import type { HeightMap, RuleSettings } from "@/machine/contract"
import type { StoredAnchorSetup } from "@/domain/anchors/stored-anchors"
import type { FixtureInstance } from "@/domain/fixtures/definitions"
import type { Tool } from "@/domain/tools/tool"
import type { Stock } from "@/domain/stock/stock"
import { resolveOperation } from "../operations/kinds"
import {
  OperationSchema,
  OperationSourceSchema,
  revise,
} from "../operations/operation"
import type { Operation, OperationSource } from "../operations/operation"
import { PlateSchema, PlateSetupSchema, plateLabel } from "../plate/plate"
import type { Group, Plate, PlateSetup } from "../plate/plate"
import {
  addFixture,
  defaultFixtures,
  lockFixture,
  removeFixture,
  updateFixture,
  withBed,
} from "../plate/plate-fixtures"
import type { FixturePatch } from "../plate/plate-fixtures"
import { moveSetupItem } from "../plate/setup-items"
import type { SetupItemRef } from "../plate/setup-items"
import { withAnchors, withTouchedWorkOrigin } from "../plate/work-origin"
import { fail, normalizeText, ok, schemaIssue } from "../primitives"
import {
  RuleSettingsSchema,
  sameRuleSettings,
  savedRuleSettings,
} from "../rules/settings"
import type { Point3, Result } from "../primitives"
import {
  assignOperationTools,
  assignTool,
  bindTools,
  localTools,
  pruneTools,
  renumberTool,
} from "../tools/tool-table"

/** The project the workspace holds: its name and file. */
export type WorkspaceProject = {
  readonly name: string
  readonly fileName: string
}

/** Everything the user works on; derived data (compiled programs) is never stored here. */
export type WorkspaceState = {
  readonly plates: readonly Plate[]
  readonly selectedPlateId: string | null
  readonly tools: readonly Tool[]
  readonly stocks: readonly Stock[]
  readonly defaultToolId: string | null
  readonly defaultStockId: string | null
  readonly project: WorkspaceProject
  readonly heightMaps: Readonly<Record<string, HeightMap>>
  /**
   * How the project reports its rules, and their limits: only those it sets otherwise than the
   * rules do by default; saved with the project.
   */
  readonly ruleSettings: RuleSettings
}

type PlateTarget = { readonly plateId: string }
type OperationTarget = PlateTarget & { readonly operationId: string }
type FixtureTarget = PlateTarget & { readonly fixtureId: string }

/** What `plate.setup` changes: anything but the fixtures, which have commands of their own. */
export type PlateSetupPatch = Partial<Omit<PlateSetup, "fixtures">>

/** Every change to the workspace is one of these; `applyCommand` is the only writer. */
export type WorkspaceCommand =
  | {
      readonly type: "plates.add"
      readonly plates: readonly Plate[]
      readonly select?: boolean
    }
  /** The empty plate stays as a plate of the user's own: plates added later go beside it. */
  | ({ readonly type: "plate.keep" } & PlateTarget)
  | ({ readonly type: "plate.remove" } & PlateTarget)
  | { readonly type: "plate.select"; readonly plateId: string | null }
  | ({ readonly type: "plate.move"; readonly targetId: string } & PlateTarget)
  /** An empty name removes the plate's own: it shows as "Plate N" again. */
  | ({ readonly type: "plate.rename"; readonly name: string } & PlateTarget)
  | ({
      readonly type: "plate.setup"
      readonly patch: PlateSetupPatch
    } & PlateTarget)
  /** Adds a fixture to the plate; a bed becomes its bed, as `fixture.setBed` makes it. */
  | ({
      readonly type: "fixture.add"
      readonly fixture: FixtureInstance
    } & PlateTarget)
  /** Removes a fixture from the plate; a locked one stays until it is unlocked. */
  | ({ readonly type: "fixture.remove" } & FixtureTarget)
  /** Places a fixture or gives it another origin; a locked one stays as it is. */
  | ({
      readonly type: "fixture.update"
      readonly patch: FixturePatch
    } & FixtureTarget)
  /** Locks a fixture in place, or unlocks it; beds stay in place without a lock. */
  | ({
      readonly type: "fixture.lock"
      readonly locked: boolean
    } & FixtureTarget)
  /**
   * The plate's bed, as a plate has one: its own fixture of the bed's definition when it has
   * one, else `bed`; every other bed goes. Null leaves the plate without a bed.
   */
  | ({
      readonly type: "fixture.setBed"
      readonly bed: FixtureInstance | null
    } & PlateTarget)
  /**
   * The fixtures and anchors of the plate's device profile: `fixtures` are its fixtures for new
   * plates. The plate's locked fixtures stay, and its bed is the profile's.
   */
  | ({
      readonly type: "fixtures.useDefaults"
      readonly fixtures: readonly FixtureInstance[]
      readonly anchors: StoredAnchorSetup | null
    } & PlateTarget)
  /**
   * Moves a setup item by `delta` millimetres: a fixture, the stock with the design on it, or
   * the design (its work origin). Beds and locked fixtures stay in place.
   */
  | ({
      readonly type: "plate.moveItem"
      readonly item: SetupItemRef
      readonly delta: Point3
    } & PlateTarget)
  | ({
      readonly type: "plate.dismissNotice"
      readonly noticeId: string
    } & PlateTarget)
  /**
   * A device's anchors changed (read from it, or realigned): plates set up for it, or for no
   * device yet, follow them; the connected device's, every plate moves to it. `deviceId` null
   * is the workspace profile: unassigned plates only.
   */
  | {
      readonly type: "anchors.sync"
      readonly deviceId: string | null
      readonly anchors: StoredAnchorSetup
      readonly connected?: boolean
    }
  /** The plate moves to a device, whichever it was set up for, and takes its anchors. */
  | ({
      readonly type: "plate.useDevice"
      readonly deviceId: string
      readonly anchors: StoredAnchorSetup
    } & PlateTarget)
  | ({
      readonly type: "operation.add"
      readonly operation: Operation
      /** Library tools meant for the operation's own tool numbers. */
      readonly preferredTools?: ReadonlyMap<number | null, string>
      readonly index?: number
    } & PlateTarget)
  | ({ readonly type: "operation.remove" } & OperationTarget)
  | ({
      readonly type: "operation.move"
      readonly index: number
    } & OperationTarget)
  | ({
      readonly type: "operation.rename"
      readonly name: string
    } & OperationTarget)
  | ({
      readonly type: "operation.stopBefore"
      readonly value: boolean
    } & OperationTarget)
  | ({
      readonly type: "operation.source"
      readonly source: OperationSource
      /** When set, the change is refused unless the operation is still at this revision. */
      readonly expectedRevision?: number
    } & OperationTarget)
  /** Library tools for the operation's own tool numbers; shared entries keep their tools. */
  | ({
      readonly type: "operation.tools"
      readonly tools: ReadonlyMap<number | null, string>
    } & OperationTarget)
  | ({
      readonly type: "tool.assign"
      readonly number: number | null
      readonly toolId: string | null
    } & PlateTarget)
  | ({
      readonly type: "tool.renumber"
      readonly from: number
      readonly to: number
    } & PlateTarget)
  | ({
      readonly type: "groups.set"
      readonly groups: readonly Group[]
    } & PlateTarget)
  | {
      readonly type: "library.tools"
      readonly tools: readonly Tool[]
      readonly defaultToolId?: string | null
    }
  | {
      readonly type: "library.stocks"
      readonly stocks: readonly Stock[]
      readonly defaultStockId?: string | null
    }
  | {
      /** Saved as a project file. */
      readonly type: "project.saved"
      readonly fileName: string
    }
  | { readonly type: "heightMap.store"; readonly map: HeightMap }
  /**
   * The project's rule settings, kept without those equal to the rules' defaults; settings that
   * report every rule as the current ones do leave the workspace as it was.
   */
  | { readonly type: "ruleSettings.set"; readonly settings: RuleSettings }
  | { readonly type: "workspace.replace"; readonly state: WorkspaceState }
  /** Applies every command in order, or none of them: the first refusal refuses the batch. */
  | { readonly type: "batch"; readonly commands: readonly WorkspaceCommand[] }

const findPlate = (state: WorkspaceState, plateId: string) =>
  state.plates.find((plate) => plate.id === plateId)

function replacePlate(state: WorkspaceState, next: Plate): WorkspaceState {
  return {
    ...state,
    plates: state.plates.map((plate) => (plate.id === next.id ? next : plate)),
  }
}

/** Re-binds an operation's tools to what its NC currently selects. */
function rebind(
  plate: Plate,
  operation: Operation,
  library: readonly Tool[],
  preferred?: ReadonlyMap<number | null, string>
): Plate {
  const resolved = resolveOperation(operation, plate)
  // Pending operations keep their bindings until they have NC.
  if (!resolved.ok) return plate
  return bindTools(plate, operation, localTools(resolved.value.nc), {
    preferred,
    library,
  }).plate
}

function updateOperation(
  state: WorkspaceState,
  target: OperationTarget,
  update: (operation: Operation, plate: Plate) => Result<Operation>,
  rebindTools = false
): Result<WorkspaceState> {
  const plate = findPlate(state, target.plateId)
  const operation = plate?.operations.find(
    (item) => item.id === target.operationId
  )
  if (!plate || !operation) return fail("The operation no longer exists.")
  const updated = update(operation, plate)
  if (!updated.ok) return updated
  // Nothing changed: keep the plate as it was, so a concurrent editor save is no conflict.
  if (updated.value === operation && !plate.example) return ok(state)
  const next: Plate = {
    ...plate,
    example: false,
    operations: plate.operations.map((item) =>
      item.id === operation.id ? updated.value : item
    ),
  }
  return ok(
    replacePlate(
      state,
      rebindTools ? rebind(next, updated.value, state.tools) : next
    )
  )
}

const sameAnchors = (
  left: StoredAnchorSetup | null,
  right: StoredAnchorSetup
) => JSON.stringify(left) === JSON.stringify(right)

const sameGroups = (left: readonly Group[], right: readonly Group[]) =>
  JSON.stringify(left) === JSON.stringify(right)

type DeviceAnchors = {
  readonly deviceId: string | null
  readonly anchors: StoredAnchorSetup
}

/** The plate set up for the device, with its anchors. */
function withDeviceAnchors(plate: Plate, device: DeviceAnchors): Plate {
  const { deviceId, anchors } = plate.setup
  if (deviceId === device.deviceId && sameAnchors(anchors, device.anchors))
    return plate
  // What is kept relative to an anchor follows it; nothing else moves.
  const setup = withAnchors(plate.setup, structuredClone(device.anchors))
  return { ...plate, setup: { ...setup, deviceId: device.deviceId } }
}

/** A plate follows a device's anchors when it is set up for that device, or for none yet. */
function syncAnchors(plate: Plate, sync: DeviceAnchors): Plate {
  const { deviceId } = plate.setup
  if (deviceId !== null && deviceId !== sync.deviceId) return plate
  return withDeviceAnchors(plate, sync)
}

/**
 * A setup changed by a patch. New anchors carry what is kept relative to one of them (the work
 * origin, the stock, fixtures), unless the patch places it itself.
 */
function patchedSetup(setup: PlateSetup, patch: Partial<PlateSetup>) {
  const next = { ...setup, ...patch }
  if (!("anchors" in patch)) return next
  const carried = withAnchors({ ...next, anchors: setup.anchors }, next.anchors)
  return { ...carried, ...patch }
}

function updatePlate(
  state: WorkspaceState,
  plateId: string,
  update: (plate: Plate) => Result<Plate>
): Result<WorkspaceState> {
  const plate = findPlate(state, plateId)
  if (!plate) return fail("The plate no longer exists.")
  const next = update(plate)
  if (!next.ok) return next
  // An unchanged plate leaves the workspace as it was: nothing to save or redraw.
  return ok(next.value === plate ? state : replacePlate(state, next.value))
}

/** The plate with the setup `change` makes of its own, held to the schema storage checks. */
function updateSetup(
  state: WorkspaceState,
  plateId: string,
  change: (setup: PlateSetup) => Result<PlateSetup>
): Result<WorkspaceState> {
  return updatePlate(state, plateId, (plate) => {
    const setup = change(plate.setup)
    if (!setup.ok) return setup
    if (setup.value === plate.setup) return ok(plate)
    const issue = schemaIssue(PlateSetupSchema, setup.value)
    return issue ? fail(issue) : ok({ ...plate, setup: setup.value })
  })
}

/**
 * The single writer of workspace state: pure, and every refusal comes with a reason. What a
 * command brings in (plates, operations, sources, setups, groups, names) is held to the same
 * schemas storage checks on load, so nothing the workspace accepts is dropped on restart;
 * typed names are normalised rather than refused. Every plate a command brings in or changes,
 * opened projects' too, keeps the work origin its touch-off sets (`withTouchedWorkOrigin`).
 */
export function applyCommand(
  state: WorkspaceState,
  command: WorkspaceCommand
): Result<WorkspaceState> {
  const result = commandResult(state, command)
  if (!result.ok || result.value === state) return result
  const { plates } = result.value
  const kept = plates.map((plate) =>
    state.plates.includes(plate) ? plate : withTouchedWorkOrigin(plate)
  )
  return kept.every((plate, index) => plate === plates[index])
    ? result
    : ok({ ...result.value, plates: kept })
}

/** What one command makes of the workspace, before plates keep their touched work origin. */
function commandResult(
  state: WorkspaceState,
  command: WorkspaceCommand
): Result<WorkspaceState> {
  switch (command.type) {
    case "plates.add": {
      // The empty plate is a placeholder: the first plate of the user's own replaces it, and
      // takes the name given to it unless it has its own.
      const kept = state.plates.filter((plate) => !plate.example)
      if (kept.length + command.plates.length > 100)
        return fail("A workspace holds at most 100 plates.")
      for (const [index, plate] of command.plates.entries()) {
        const issue = schemaIssue(PlateSchema, plate)
        if (issue)
          return fail(`${plateLabel(plate, kept.length + index)}: ${issue}`)
      }
      const ids = new Set(kept.map((plate) => plate.id))
      for (const plate of command.plates) {
        if (ids.has(plate.id))
          return fail("The workspace already holds this plate.")
        ids.add(plate.id)
      }
      const name = state.plates.find((plate) => plate.example)?.name
      const first = command.plates.at(0)
      const added =
        first && name && !first.name
          ? [{ ...first, name }, ...command.plates.slice(1)]
          : command.plates
      const plates = [...kept, ...added]
      const selected = command.select
        ? command.plates.at(0)?.id
        : state.selectedPlateId
      const selectedPlateId = plates.some((plate) => plate.id === selected)
        ? (selected ?? null)
        : (plates.at(0)?.id ?? null)
      return ok({ ...state, plates, selectedPlateId })
    }
    case "plate.keep":
      return updatePlate(state, command.plateId, (plate) =>
        ok(plate.example ? { ...plate, example: false } : plate)
      )
    case "plate.remove": {
      const plates = state.plates.filter(
        (plate) => plate.id !== command.plateId
      )
      const selectedPlateId =
        state.selectedPlateId === command.plateId
          ? (plates.at(0)?.id ?? null)
          : state.selectedPlateId
      return ok({ ...state, plates, selectedPlateId })
    }
    case "plate.select":
      if (command.plateId !== null && !findPlate(state, command.plateId))
        return fail("The plate no longer exists.")
      return ok({ ...state, selectedPlateId: command.plateId })
    case "plate.move": {
      const from = state.plates.findIndex(
        (plate) => plate.id === command.plateId
      )
      const to = state.plates.findIndex(
        (plate) => plate.id === command.targetId
      )
      if (from < 0 || to < 0) return fail("The plate no longer exists.")
      const plates = [...state.plates]
      const [moved] = plates.splice(from, 1)
      plates.splice(to, 0, moved)
      return ok({ ...state, plates })
    }
    case "plate.rename": {
      const name = normalizeText(command.name)
      return updatePlate(state, command.plateId, (plate) =>
        ok(name === plate.name ? plate : { ...plate, name })
      )
    }
    case "plate.setup":
      // The fixture commands own the fixtures' rules: one bed, locks and the limit.
      if ("fixtures" in command.patch)
        return fail("Fixtures change through their own commands.")
      return updateSetup(state, command.plateId, (setup) =>
        ok(patchedSetup(setup, command.patch))
      )
    case "plate.moveItem":
      return updateSetup(state, command.plateId, (setup) =>
        moveSetupItem(setup, command.item, command.delta)
      )
    case "fixture.add":
      return updateSetup(state, command.plateId, (setup) =>
        addFixture(setup, command.fixture)
      )
    case "fixture.remove":
      return updateSetup(state, command.plateId, (setup) =>
        removeFixture(setup, command.fixtureId)
      )
    case "fixture.update":
      return updateSetup(state, command.plateId, (setup) =>
        updateFixture(setup, command.fixtureId, command.patch)
      )
    case "fixture.lock":
      return updateSetup(state, command.plateId, (setup) =>
        lockFixture(setup, command.fixtureId, command.locked)
      )
    case "fixture.setBed":
      return updateSetup(state, command.plateId, (setup) =>
        withBed(setup, command.bed)
      )
    case "fixtures.useDefaults":
      return updateSetup(state, command.plateId, (setup) => {
        const fixtures = defaultFixtures(setup, command.fixtures)
        if (!fixtures.ok) return fixtures
        const { anchors } = command
        return ok(patchedSetup(setup, { anchors, fixtures: fixtures.value }))
      })
    case "anchors.sync": {
      const plates = state.plates.map((plate) =>
        command.connected
          ? withDeviceAnchors(plate, command)
          : syncAnchors(plate, command)
      )
      return plates.every((plate, index) => plate === state.plates[index])
        ? ok(state)
        : ok({ ...state, plates })
    }
    case "plate.useDevice":
      return updatePlate(state, command.plateId, (plate) => {
        if (command.anchors.deviceId !== command.deviceId)
          return fail("The anchors belong to another device.")
        return ok(withDeviceAnchors(plate, command))
      })
    case "plate.dismissNotice":
      return updatePlate(state, command.plateId, (plate) =>
        ok({
          ...plate,
          notices: plate.notices.filter((item) => item.id !== command.noticeId),
        })
      )
    case "operation.add":
      return updatePlate(state, command.plateId, (plate) => {
        if (plate.operations.length >= 100)
          return fail("A plate holds at most 100 operations.")
        if (plate.operations.some(({ id }) => id === command.operation.id))
          return fail("The plate already holds this operation.")
        const issue = schemaIssue(OperationSchema, command.operation)
        if (issue) return fail(`${command.operation.name}: ${issue}`)
        const operations = [...plate.operations]
        operations.splice(
          command.index ?? operations.length,
          0,
          command.operation
        )
        return ok(
          rebind(
            { ...plate, operations, example: false },
            command.operation,
            state.tools,
            command.preferredTools
          )
        )
      })
    case "operation.remove":
      return updatePlate(state, command.plateId, (plate) => {
        if (!plate.operations.some(({ id }) => id === command.operationId))
          return ok(plate)
        return ok(
          pruneTools({
            ...plate,
            example: false,
            operations: plate.operations.filter(
              (operation) => operation.id !== command.operationId
            ),
          })
        )
      })
    case "operation.move":
      return updatePlate(state, command.plateId, (plate) => {
        const from = plate.operations.findIndex(
          (operation) => operation.id === command.operationId
        )
        if (from < 0) return fail("The operation no longer exists.")
        const operations = plate.operations.filter(
          (operation) => operation.id !== command.operationId
        )
        const to = Math.max(0, Math.min(command.index, operations.length))
        // Moving to where it already is changes nothing.
        if (to === from) return ok(plate)
        operations.splice(to, 0, plate.operations[from])
        return ok({ ...plate, operations, example: false })
      })
    case "operation.rename": {
      const name = normalizeText(command.name)
      return updateOperation(state, command, (operation) =>
        name
          ? ok(
              name === operation.name ? operation : revise(operation, { name })
            )
          : fail("Enter a name.")
      )
    }
    case "operation.stopBefore":
      return updateOperation(state, command, (operation) =>
        ok(
          command.value === operation.stopBefore
            ? operation
            : revise(operation, { stopBefore: command.value })
        )
      )
    case "operation.source":
      return updateOperation(
        state,
        command,
        (operation) => {
          if (
            command.expectedRevision !== undefined &&
            command.expectedRevision !== operation.revision
          )
            return fail("The operation changed since it was read.")
          const issue = schemaIssue(OperationSourceSchema, command.source)
          return issue
            ? fail(issue)
            : ok(revise(operation, { source: command.source }))
        },
        true
      )
    case "operation.tools":
      return updatePlate(state, command.plateId, (plate) =>
        assignOperationTools(
          plate,
          command.operationId,
          command.tools,
          state.tools
        )
      )
    case "tool.assign":
      return updatePlate(state, command.plateId, (plate) =>
        assignTool(plate, command.number, command.toolId)
      )
    case "tool.renumber":
      return updatePlate(state, command.plateId, (plate) =>
        renumberTool(plate, command.from, command.to)
      )
    case "groups.set": {
      const groups = command.groups.map((group) => ({
        ...group,
        name: normalizeText(group.name) || "Group",
      }))
      const issue = schemaIssue(PlateSchema.shape.groups, groups)
      if (issue) return fail(issue)
      return updatePlate(state, command.plateId, (plate) =>
        ok(sameGroups(plate.groups, groups) ? plate : { ...plate, groups })
      )
    }
    case "library.tools": {
      // Plates keep their references: a deleted tool dangles and blocks Run until reassigned.
      const requested =
        command.defaultToolId === undefined
          ? state.defaultToolId
          : command.defaultToolId
      // The default tool survives the change; otherwise the first tool becomes the default.
      const defaultToolId = command.tools.some((tool) => tool.id === requested)
        ? requested
        : (command.tools.at(0)?.id ?? null)
      return ok({ ...state, tools: command.tools, defaultToolId })
    }
    case "library.stocks":
      return ok({
        ...state,
        stocks: command.stocks,
        defaultStockId:
          command.defaultStockId === undefined
            ? state.defaultStockId
            : command.defaultStockId,
      })
    case "project.saved":
      return ok({
        ...state,
        project: {
          ...state.project,
          fileName: command.fileName,
        },
      })
    case "heightMap.store":
      return ok({
        ...state,
        heightMaps: {
          ...state.heightMaps,
          [command.map.deviceId]: command.map,
        },
      })
    case "ruleSettings.set": {
      const issue = schemaIssue(RuleSettingsSchema, command.settings)
      if (issue) return fail(issue)
      return ok(
        sameRuleSettings(state.ruleSettings, command.settings)
          ? state
          : { ...state, ruleSettings: savedRuleSettings(command.settings) }
      )
    }
    case "workspace.replace":
      return ok(command.state)
    case "batch": {
      let next = state
      for (const item of command.commands) {
        const result = applyCommand(next, item)
        if (!result.ok) return result
        next = result.value
      }
      return ok(next)
    }
  }
}
