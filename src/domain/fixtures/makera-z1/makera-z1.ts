import type { NcWord } from "@/machine/contract"
import type { Point3 } from "@/domain/nc/gcode"
import type { StoredAnchorSetup } from "@/domain/anchors/stored-anchors"
import { formatMillimetres } from "../../geometry/millimetres"
import type { NcUnitState } from "../../compile/nc-unit"
import type { MachineOrigin } from "../../plate/work-origin"
import type { MachineProbing } from "../../probing/strategy"
import { PROBE_3D_TOOL, PROBE_TOOL } from "../../tools/tool-table"
import { FixtureKit } from "../fixture-kit"
import type { KitFixture, KitRecolor, MachineCamera } from "../fixture-kit"
import { Z1DowelPin } from "./dowel-pin"
import { Z1Firmware } from "./firmware"
import { Z1FourthAxis } from "./fourth-axis"
import { Z1LBracketThick, Z1LBracketThin } from "./l-bracket"
import { MAKERA_CAM } from "./makera-cam"
import { Z1MdfBed } from "./mdf-bed"
import { Z1MdfWasteboard } from "./mdf-wasteboard"
import { Z1_GLOSSARY } from "./nc-glossary"
import { isZ1Park, readZ1Block } from "./nc-grammar"
import { Z1_GENERIC_SPECS, Z1_PROBING_NC } from "./probing-nc"
import { HEIGHT_MAP } from "./strategies/height-map"
import { ROUTINES } from "./strategies/routines"
import { Z_PROBE } from "./strategies/z-probe"
import { Z1TopClamp } from "./top-clamp"
import { Z1_PROBING_SECTIONS } from "./wired-probe/blocks"
import { g32Grids } from "./wired-probe/grid"
import { touchPoints } from "./wired-probe/touch-off"
import { CLEARANCE_Z } from "./wired-probe/travel"
import { Z1Bed } from "./z1-bed"

/** An NC number to four decimals, without exponent notation or −0. */
const ncNumber = (value: number) => String(Number(value.toFixed(4)) + 0)

/** Version 6 drew the aluminium parts lighter than the steel pins, in machined aluminium. */
const LIGHTER_ALUMINIUM: KitRecolor = { in: 6, from: ["#a2aab3"] }

/** The Makera Z1's kit id (`FixtureKit.id`), as its rules name the machine they hold for. */
export const MAKERA_Z1_ID = "makera-z1"

/**
 * The Makera Z1 and Z1 Pro: the aluminium bed, probing with the wired probe and the 3D probe,
 * the fixtures Makera makes for it and its anchors.
 */
export class MakeraZ1 extends FixtureKit {
  readonly id = MAKERA_Z1_ID
  readonly name = "Makera Z1"
  readonly deviceModels = ["Z1", "Z1 Pro"]
  readonly imageUrl = "/images/makera_z1.png"
  /** The official three-axis work envelope, not the bed's size. */
  readonly workArea: Point3 = [200, 200, 100]
  readonly bed = new Z1Bed()
  /**
   * The firmware selects a Z touch probe, such as Makera's wired Probe 2.0, as T0 and the 3D
   * probe as T9999, its own number for it. It finds origins with T9999 active (its 3D probing
   * routines, M480) and probes everything else with T0 active, the probe's laser (M494) too, as
   * its NC grammar reads them (`readZ1Block`). Besides the generic strategies it offers its own
   * auto-leveling (G32, M495), its Z probe (M495) and its 3D probing routines (M480).
   */
  readonly probing: MachineProbing = {
    probes: (task, { touch }) => touch === (task === "origin" ? "xyz" : "z"),
    slot: ({ touch }) => (touch === "z" ? PROBE_TOOL : PROBE_3D_TOOL),
    nc: Z1_PROBING_NC,
    specs: Z1_GENERIC_SPECS,
    strategies: [HEIGHT_MAP, Z_PROBE, ROUTINES],
    sections: Z1_PROBING_SECTIONS,
    readers: { grids: g32Grids, touches: touchPoints },
  }
  readonly firmware = new Z1Firmware()
  /**
   * On the frame left of the bed, level with the spindle in Y, looking along X 41° down; its
   * stream's 640 × 480 picture. Measured from a picture of the L-bracket and the bed's holes.
   */
  readonly camera: MachineCamera = {
    position: [-52, 0, 96],
    target: [58, 0, 0],
    fov: 45,
    aspect: 4 / 3,
  }
  readonly fixtures: readonly KitFixture[] = [
    { fixture: new Z1MdfBed(), addedIn: 1 },
    { fixture: new Z1FourthAxis(), addedIn: 1 },
    {
      fixture: new Z1LBracketThick(),
      addedIn: 1,
      recolored: LIGHTER_ALUMINIUM,
    },
    {
      fixture: new Z1LBracketThin(),
      addedIn: 1,
      recolored: LIGHTER_ALUMINIUM,
    },
    { fixture: new Z1TopClamp(), addedIn: 5, recolored: LIGHTER_ALUMINIUM },
    // Version 3 stood the pin 4 mm proud of the MDF bed (5 mm proud of the aluminium bed before).
    { fixture: new Z1DowelPin(), addedIn: 2, changedIn: 3 },
    { fixture: new Z1MdfWasteboard(), addedIn: 4 },
  ]
  /**
   * Up to the clearance Makera configures (`coordinate.clearance_z`), which the firmware's tool
   * change and park rise to as well.
   */
  readonly clearanceRetract = `G53 G0 Z${formatMillimetres(CLEARANCE_Z)}`
  /** Makera CAM's toolpath and stock markers (`;@MKR|…`). */
  readonly camMarkers = MAKERA_CAM
  readonly glossary = Z1_GLOSSARY

  /**
   * The firmware reads `G10 L2`'s X and Y in the current units, and its `P0` is the current work
   * coordinate system, whatever an earlier program left, so `G21 G54` selects millimetres and
   * G54 first. Then `G10 L2 P0`, as Makera's controller sends it before a job, sets G54's X and
   * Y origin, which the firmware saves. Numbers have four decimals, as Makera's controller
   * sends them.
   */
  workOffsetNc({ anchor, offset, position, factory }: MachineOrigin) {
    const lines = [
      `; Work origin: ${anchor.name} + X${ncNumber(offset[0])} Y${ncNumber(offset[1])}; sets work X and Y, not Z.`,
    ]
    if (factory)
      lines.push(
        "; FACTORY DEFAULT anchor coordinates - verify against the device before Run"
      )
    lines.push(
      "G21 G54",
      `G10 L2 P0 X${ncNumber(position[0])} Y${ncNumber(position[1])}`
    )
    return lines
  }

  /** Its park, the wired probe's routines, and the path control the firmware ignores. */
  readNcBlock(words: readonly NcWord[], state: NcUnitState) {
    return readZ1Block(words, state)
  }

  /** G28 alone in its block, as Makera's CAM ends its programs. */
  isPark(words: readonly Pick<NcWord, "letter" | "value">[]) {
    return isZ1Park(words)
  }

  /**
   * Makera's factory anchor positions, in machine coordinates. Anchor 1 is the L-bracket's inner
   * corner on the bed: the bracket's outer corner is at X -3, Y -3 and its arms are 15 mm wide.
   */
  factoryAnchors(deviceId: string | null): StoredAnchorSetup {
    return {
      version: 1,
      deviceId,
      source: "factory",
      anchor1BedPosition: [12, 12],
      anchors: [
        { id: "anchor-1", name: "Anchor 1", machinePosition: [-192.4, -194.3] },
        { id: "anchor-2", name: "Anchor 2", machinePosition: [-103.9, -149.3] },
      ],
    }
  }
}
