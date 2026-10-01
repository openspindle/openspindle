import type { NcWord } from "@/machine/contract"
import type { FixtureDefinition } from "@/domain/fixtures/definitions"
import type { CamMarkers } from "@/domain/nc/cam-markers"
import type { Point3 } from "@/domain/nc/gcode"
import type { NcGlossaryEntry } from "@/domain/nc/glossary"
import type { StoredAnchorSetup } from "@/domain/anchors/stored-anchors"
import type { NcBlockEffect, NcUnitState } from "../compile/nc-unit"
import type { FirmwareModel } from "../firmware/firmware-model"
import type { MachineOrigin } from "../plate/work-origin"
import type { Result } from "../primitives"
import type { MachineProbing } from "../probing/strategy"
import type { Fixture } from "./fixture"
import type { MachineBed } from "./machine-bed"

/** One of a kit's fixtures, with the kit versions it arrived and was last corrected in. */
export type KitFixture = {
  readonly fixture: Fixture
  /** The kit version that added it. */
  readonly addedIn: number
  /** The kit version that last corrected its model or default placement, if one did. */
  readonly changedIn?: number
  /**
   * The kit version that last gave it another colour, and the colours it had before: a
   * profile from before that version takes the new colour where it still has an old one.
   */
  readonly recolored?: KitRecolor
}

/** A kit version's new colour for a fixture, and the colours it gave the fixture before. */
export type KitRecolor = {
  readonly in: number
  /** Lower case, as `#rrggbb`. */
  readonly from: readonly string[]
}

/**
 * What a kind of machine is and comes with: its work area, bed and probing, the fixtures made for
 * it and its factory anchors. A device's fixture profile starts from its machine's kit and keeps
 * up with the kit's versions: each version adds fixtures or corrects them.
 */
export abstract class FixtureKit {
  /** Unique among kits, and never changes: rules name the machines they hold for by it (`Rule.machines`). */
  abstract readonly id: string
  abstract readonly name: string
  /** The device models it is for, as devices announce them. */
  abstract readonly deviceModels: readonly string[]
  /** A picture of the machine, bundled with the app. */
  abstract readonly imageUrl: string
  /**
   * How far the tool reaches in X, Y and Z, in millimetres, from the origin of bed coordinates:
   * the work area's front-left corner, on the bed's top.
   */
  abstract readonly workArea: Point3
  abstract readonly bed: MachineBed
  /**
   * How it probes with the probes of the tool library: the tool numbers its firmware needs them
   * in, the NC generic strategies are made of, its firmware's own strategies and how its NC reads
   * as probing; null for a machine that does not probe.
   */
  abstract readonly probing: MachineProbing | null
  /**
   * How its firmware moves for what the preview leaves to it (machine coordinates, probing,
   * tool changes); null when the preview does not follow it.
   */
  abstract readonly firmware: FirmwareModel | null
  /**
   * Where its camera looks at the bed from, as a direction from the bed's middle, for a view
   * like the camera's; null when it has none.
   */
  abstract readonly cameraView: Point3 | null
  /** Its fixtures, in the order profiles list them. */
  abstract readonly fixtures: readonly KitFixture[]
  /**
   * The NC block that retracts the tool to the machine's clearance height, moving only Z, in
   * machine coordinates and millimetres. Compiling puts it at every operation boundary, before
   * the spindle stops, so a tool left in the cut rises out of it turning and no later move
   * drags it.
   */
  abstract readonly clearanceRetract: string
  /** The markers the CAM made for the machine writes in its programs; null for none. */
  abstract readonly camMarkers: CamMarkers | null
  /** The codes of the machine's NC, as the G-code glossary lists them. */
  abstract readonly glossary: readonly NcGlossaryEntry[]

  /**
   * The NC that puts the machine's work X and Y on a work origin kept relative to one of its
   * anchors, which a program runs before its operations. It leaves work Z as it is.
   */
  abstract workOffsetNc(origin: MachineOrigin): readonly string[]

  /**
   * A block of its own NC beyond plain three-axis machining, such as its probes' routines and its
   * park, as combining operations reads it: what the block does, or why it is refused where it
   * is. Null for a block that is not one of its own, which combining reads as plain machining.
   */
  abstract readNcBlock(
    words: readonly NcWord[],
    state: NcUnitState
  ): Result<NcBlockEffect> | null

  /**
   * Whether a block parks the machine, as the CAM made for it ends its programs. An operation may
   * park only after its last move, and an NC file's Park after machining keeps or leaves out the
   * parks its program closes with. False for every block of a machine without one.
   */
  abstract isPark(words: readonly Pick<NcWord, "letter" | "value">[]): boolean

  /** The anchors a profile starts with, until they are read from its device. */
  abstract factoryAnchors(deviceId: string | null): StoredAnchorSetup

  /** The latest version: the last in which a fixture was added, corrected or recoloured. */
  get version() {
    return Math.max(
      1,
      ...this.fixtures.map(({ addedIn, changedIn = 0, recolored }) =>
        Math.max(addedIn, changedIn, recolored?.in ?? 0)
      )
    )
  }

  /** The definitions a new profile holds. */
  definitions(): FixtureDefinition[] {
    return this.fixtures.map(({ fixture }) => fixture.definition())
  }

  isFor(deviceModel: string) {
    return this.deviceModels.includes(deviceModel)
  }

  /** Whether a definition draws the model of one of the kit's fixtures. */
  draws(definition: FixtureDefinition) {
    const source = definition.model?.source
    return (
      source?.kind === "bundled" &&
      this.fixtures.some(
        ({ fixture }) =>
          fixture.model.source.kind === "bundled" &&
          fixture.model.source.url === source.url
      )
    )
  }
}
