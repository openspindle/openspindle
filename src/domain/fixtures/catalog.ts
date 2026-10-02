import { machineId } from "@/machine/contract"
import {
  boxCorners,
  inModelFrame,
  pointsBounds,
} from "@/domain/fixtures/definitions"
import type {
  FixtureBounds,
  FixtureDefinition,
  FixtureInstance,
  FixtureModel,
} from "@/domain/fixtures/definitions"
import { boxMountPoints } from "@/domain/fixtures/mount-points"
import type { MountPoint } from "@/domain/fixtures/mount-points"
import type { Fixture } from "./fixture"
import type { FixtureKit } from "./fixture-kit"
import { MakeraZ1 } from "./makera-z1/makera-z1"

const MAKERA_Z1 = new MakeraZ1()

/** The kits of the machines OpenSpindle knows. */
export const FIXTURE_KITS: readonly FixtureKit[] = [MAKERA_Z1]

/**
 * The kit a new workspace starts from, and the machine of a plate whose device and fixtures name
 * none (`kitForSetup`).
 */
export const DEFAULT_KIT: FixtureKit = MAKERA_Z1

/** The kit made for a device model; null when there is none. */
export const kitForDevice = (deviceModel: string) =>
  FIXTURE_KITS.find((kit) => kit.isFor(deviceModel)) ?? null

/** The kit definitions come from: the one whose fixtures' models they draw; null for none. */
export const kitOf = (definitions: readonly FixtureDefinition[]) =>
  FIXTURE_KITS.find((kit) =>
    definitions.some((definition) => kit.draws(definition))
  ) ?? null

/**
 * The kit of a device by its id (`machineId`, its model and name); null for no device, or one
 * whose model has none.
 */
export function kitForDeviceId(deviceId: string | null): FixtureKit | null {
  if (deviceId === null) return null
  return (
    FIXTURE_KITS.find((kit) =>
      kit.deviceModels.some((model) =>
        deviceId.startsWith(machineId({ model, name: "" }))
      )
    ) ?? null
  )
}

/** What a plate's machine is known by: the device it is set up for and its fixtures. */
export type KitSubject = {
  readonly deviceId: string | null
  readonly fixtures: readonly Pick<FixtureInstance, "definition">[]
}

/**
 * The kit of the machine a plate is set up for: its device's, else the one its fixtures come
 * from, else the default kit.
 */
export const kitForSetup = (setup: KitSubject): FixtureKit =>
  kitForDeviceId(setup.deviceId) ??
  kitOf(setup.fixtures.map((instance) => instance.definition)) ??
  DEFAULT_KIT

/** The kit of the machine a plate is set up for (`kitForSetup`). */
export const kitForPlate = (plate: { readonly setup: KitSubject }) =>
  kitForSetup(plate.setup)

/** Every kit fixture that draws a bundled model, by the model's URL. */
const BY_MODEL = new Map<string, Fixture>(
  FIXTURE_KITS.flatMap((kit) =>
    kit.fixtures.flatMap(({ fixture }) => {
      const { source } = fixture.model
      return source.kind === "bundled" ? [[source.url, fixture] as const] : []
    })
  )
)

/**
 * The points a fixture model mounts and lines up by, in its frame: its own, else those of the
 * fixture whose bundled model it draws (moved with the model when a definition gave it another
 * origin), else the corners and centres of its box.
 */
export function fixtureModelMountPoints(
  model: FixtureModel
): readonly MountPoint[] {
  if (model.mountPoints) return model.mountPoints
  const fixture =
    model.source.kind === "bundled" ? BY_MODEL.get(model.source.url) : null
  if (!fixture) return boxMountPoints(model.bounds)
  return inModelFrame(fixture.mountPoints, fixture.model, model)
}

/**
 * The boxes a fixture model is solid in, in its frame: those of the fixture whose bundled model
 * it draws (moved with the model when a definition gave it another origin or turned its mesh),
 * else its box.
 */
export function fixtureModelSolids(
  model: FixtureModel
): readonly FixtureBounds[] {
  const fixture =
    model.source.kind === "bundled" ? BY_MODEL.get(model.source.url) : null
  const solids = fixture?.solids
  if (!fixture || !solids) return [model.bounds]
  return solids.map((solid) => {
    const corners = boxCorners(solid).map((position, index): MountPoint => ({
      id: `corner-${index}`,
      name: "Corner",
      position,
    }))
    return pointsBounds(
      inModelFrame(corners, fixture.model, model).map(
        (corner) => corner.position
      )
    )
  })
}

/**
 * How shiny a fixture model is drawn: the finish of the fixture whose bundled model it draws;
 * null for other models, which are drawn as their kind is.
 */
export function fixtureModelFinish(model: FixtureModel) {
  const fixture =
    model.source.kind === "bundled" ? BY_MODEL.get(model.source.url) : null
  return fixture?.finish ?? null
}
