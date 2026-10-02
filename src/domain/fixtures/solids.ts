import type { Point3 } from "@/domain/primitives"
import { fixtureModelSolids } from "./catalog"
import {
  boxCorners,
  fixturePointOnBed,
  isBedKind,
  namedFixtures,
  pointsBounds,
} from "./definitions"
import type { FixtureInstance } from "./definitions"

/** A box on the bed that a probe meets, and what it is part of, by the name the plate shows. */
export type Solid = {
  readonly name: string
  readonly min: Point3
  readonly max: Point3
}

/**
 * Where a plate's enabled fixtures are solid on the bed, but for its bed, which carries the
 * stock: each fixture's boxes (`fixtureModelSolids`) where it stands, turned with it, named as
 * the Fixtures panel lists it.
 */
export function fixtureSolids(fixtures: readonly FixtureInstance[]): Solid[] {
  return namedFixtures(fixtures).flatMap(({ instance, name }) => {
    const { model, kind } = instance.definition
    if (!instance.enabled || !model || isBedKind(kind)) return []
    return fixtureModelSolids(model).map((box) => ({
      name,
      ...pointsBounds(
        boxCorners(box).map((corner) => fixturePointOnBed(instance, corner))
      ),
    }))
  })
}

/** Whether a box stands under a point on the bed: its footprint holds X and Y, edges included. */
export const standsUnder = (
  { min, max }: Pick<Solid, "min" | "max">,
  [x, y]: readonly number[]
) => x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1]
