import { COORDINATE_LIMIT, MAX_ROUTINE_CONTACTS } from "../../contract/index.ts"
import type {
  ContactsMeasurement,
  GridMeasurement,
  JobMeasurement,
  Telemetry,
} from "../../contract/index.ts"
import { parseMakeraHeightMap } from "./height-map.ts"

const MAX_MEASUREMENTS = 100
const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)`
/** ATCHandler echoes each script line; M497.n sets the state its routine is in. */
const ROUTINE_STATE = /^M497\.(\d)$/
const CONTACT = new RegExp(
  String.raw`^\[PRB:(${NUMBER}),(${NUMBER}),(${NUMBER}):1\]$`
)
/** A routine's echoed search across X or Y: its sides, where the Z probe only goes down. */
const SIDE_SEARCH = /^G38\.2\s*[XY]/i
const GRID_START = new RegExp(
  String.raw`^Probe start ht: ${NUMBER} mm, start MCS x,y: (${NUMBER}),(${NUMBER}), rectangular bed width,height in mm: (${NUMBER}),(${NUMBER}), grid size: (\d+)x(\d+)$`
)
const GRID_POINT = new RegExp(
  String.raw`^DEBUG: X(${NUMBER}), Y(${NUMBER}), Z(${NUMBER})$`
)
const TABLE_ROW = new RegExp(String.raw`^${NUMBER}\|`)
const TABLE_DIVIDER = /^(?:-----\+-----)+$/
const RANGE = new RegExp(
  String.raw`^Max deviation between highest and lowest: (${NUMBER})$`
)
const GRID_FAILED = /^(?:probe failed to complete|finding bed failed)\b/i

/**
 * A reported number as a job carries it (`JobMeasurementSchema`), null when it is not finite or
 * beyond ±10 m: one such value would make every snapshot of the job invalid.
 */
const reported = (text: string): number | null => {
  const value = Number(text)
  return Number.isFinite(value) && Math.abs(value) <= COORDINATE_LIMIT
    ? value
    : null
}

/** The routine states whose contacts are measurements: the tool sensor, the stock. */
const CALIBRATING = 3
const Z_PROBING = 5

const axis = (size: number, count: number) =>
  Array.from({ length: count }, (_, index) =>
    Number(((size * index) / (count - 1)).toFixed(4))
  )

/**
 * What the Z1 reports while its own routines run (ATCHandler's scripts reply to every
 * connection, even from a played file): the tool sensor's and the Z probe's contacts
 * ([PRB:x,y,z:1], the slow touch last), the 3D probing routines' contacts (M480), and
 * CartGridStrategy's rectangular probe, point by point (DEBUG: X Y Z) and then as the height map
 * it prints. Lines from a played file itself go to the firmware's null stream, so a G32 or G38.2
 * written in the program reports nothing.
 *
 * The corner routines outside a pocket queue their lines, echoed after M497.5 like the Z probe's,
 * and search across X and Y after touching the top; the others run theirs at once, unechoed, so
 * their contacts come without a routine state. Either way a routine's contacts, until Done ATC,
 * are one measurement.
 */
export class MakeraMeasurements {
  private state: number | null = null
  /** The measurement the next contact refines: a tool's fast touch, or a routine's contacts. */
  private touchIndex: number | null = null
  /**
   * The contacts of the routine running, and whether it has searched across X or Y. A Z probe's
   * are held until it ends, as a corner routine touches the top the same way before its sides.
   */
  private contacts: [number, number, number][] = []
  /** The last contact's work X and Y, from the work origin reported with it. */
  private lastWork: [number, number] | null = null
  private sides = false
  /** Where and when the routine's first contact came. */
  private started: { line: number | null; at: number } | null = null
  private table: string[] | null = null
  private items: JobMeasurement[] = []

  get list(): readonly JobMeasurement[] {
    return this.items
  }

  /** Reads one reported line; true when the measurements changed. */
  read(text: string, telemetry: Telemetry | null, now: number): boolean {
    const state = ROUTINE_STATE.exec(text)
    if (state) {
      const changed = this.endRoutine()
      this.state = Number(state[1])
      return changed
    }
    if (/^done atc\b/i.test(text)) {
      const changed = this.endRoutine()
      this.state = null
      return changed
    }
    if (SIDE_SEARCH.test(text)) {
      this.sides = true
      return false
    }
    const contact = CONTACT.exec(text)
    if (contact) return this.touch(contact, telemetry, now)
    const grid = this.probingGrid()
    const start = GRID_START.exec(text)
    if (start) return this.startGrid(start, telemetry?.job?.line ?? null, now)
    if (!grid) return false
    const point = GRID_POINT.exec(text)
    if (point) return this.point(grid, point)
    if (this.table || TABLE_ROW.test(text)) return this.tableLine(grid, text)
    const range = RANGE.exec(text)
    if (range) {
      const spread = reported(range[1])
      return spread !== null && this.replace(grid, { range: spread })
    }
    if (/^probe completed\.?$/i.test(text))
      return this.replace(grid, { status: "completed" })
    if (GRID_FAILED.test(text)) return this.replace(grid, { status: "failed" })
    return false
  }

  /**
   * The end of a routine: a Z probe that searched no side touched the stock top where its last
   * (slow) contact was. True when that added a measurement.
   */
  private endRoutine(): boolean {
    const last = this.contacts.at(-1)
    const surface =
      this.state === Z_PROBING && !this.sides && last && this.started
        ? this.add({
            kind: "touch",
            target: "surface",
            tool: null,
            machine: last,
            work: this.lastWork,
            ...this.started,
          })
        : false
    this.touchIndex = null
    this.contacts = []
    this.lastWork = null
    this.sides = false
    this.started = null
    return surface
  }

  private touch(
    [, x, y, z]: RegExpExecArray,
    telemetry: Telemetry | null,
    now: number
  ): boolean {
    const [machineX, machineY, machineZ] = [x, y, z].map(reported)
    if (machineX === null || machineY === null || machineZ === null)
      return false
    const contact: [number, number, number] = [machineX, machineY, machineZ]
    const line = telemetry?.job?.line ?? null
    if (this.state === CALIBRATING)
      return this.sensorTouch(contact, telemetry, now)
    if (this.state !== null && this.state !== Z_PROBING) return false
    if (this.contacts.length >= MAX_ROUTINE_CONTACTS) return false
    this.started ??= { line, at: now }
    this.contacts.push(contact)
    const origin = telemetry?.workOrigin
    this.lastWork = origin ? [machineX - origin.x, machineY - origin.y] : null
    // A Z probe's contacts wait for its end; a 3D probing routine's show as they come.
    if (this.state === Z_PROBING && !this.sides) return false
    const measurement: ContactsMeasurement = {
      kind: "contacts",
      contacts: [...this.contacts],
      ...this.started,
    }
    const current = this.touchIndex
    if (current !== null) {
      this.items = this.items.map((item, index) =>
        index === current ? measurement : item
      )
      return true
    }
    if (!this.add(measurement)) return false
    this.touchIndex = this.items.length - 1
    return true
  }

  /** A tool's contact on the tool sensor as it is changed to; the slow touch refines the fast. */
  private sensorTouch(
    contact: [number, number, number],
    telemetry: Telemetry | null,
    now: number
  ): boolean {
    const measurement: JobMeasurement = {
      kind: "touch",
      target: "tool-sensor",
      tool: telemetry?.requestedTool ?? null,
      machine: contact,
      work: null,
      line: telemetry?.job?.line ?? null,
      at: now,
    }
    const refined = this.touchIndex
    if (refined !== null) {
      this.items = this.items.map((item, at) =>
        at === refined ? measurement : item
      )
      return true
    }
    if (!this.add(measurement)) return false
    this.touchIndex = this.items.length - 1
    return true
  }

  private startGrid(
    [, x, y, width, depth, columns, rows]: RegExpExecArray,
    line: number | null,
    now: number
  ): boolean {
    const size = { columns: Number(columns), rows: Number(rows) }
    const [startX, startY, gridWidth, gridDepth] = [x, y, width, depth].map(
      reported
    )
    if (
      startX === null ||
      startY === null ||
      gridWidth === null ||
      gridDepth === null ||
      size.columns < 2 ||
      size.rows < 2 ||
      size.columns * size.rows > 16384 ||
      size.columns > 255 ||
      size.rows > 255
    )
      return false
    this.table = null
    return this.add({
      kind: "grid",
      start: [startX, startY],
      width: gridWidth,
      depth: gridDepth,
      ...size,
      heights: Array.from({ length: size.rows }, () =>
        Array<number | null>(size.columns).fill(null)
      ),
      xCoordinates: axis(gridWidth, size.columns),
      yCoordinates: axis(gridDepth, size.rows).reverse(),
      range: null,
      status: "probing",
      line,
      at: now,
    })
  }

  /** A probed point, placed by its distance from the grid's first one. */
  private point(grid: GridMeasurement, [, x, y, z]: RegExpExecArray): boolean {
    const height = reported(z)
    if (height === null) return false
    const column = Math.round(
      ((Number(x) - grid.start[0]) * (grid.columns - 1)) / grid.width
    )
    const fromStart = Math.round(
      ((Number(y) - grid.start[1]) * (grid.rows - 1)) / grid.depth
    )
    const row = grid.rows - 1 - fromStart
    if (column < 0 || column >= grid.columns || row < 0 || row >= grid.rows)
      return false
    const heights = grid.heights.map((values, index) =>
      index === row
        ? values.map((value, at) => (at === column ? height : value))
        : values
    )
    return this.replace(grid, { heights })
  }

  /** print_bed_level's rows, divider and X axis; the map replaces the points once complete. */
  private tableLine(grid: GridMeasurement, text: string): boolean {
    const table = (this.table ??= [])
    const divided = table.some((line) => TABLE_DIVIDER.test(line))
    table.push(text)
    if (!divided) return false
    this.table = null
    try {
      const map = parseMakeraHeightMap([...table, "ok"].join("\n"), 0, "z1")
      if (map.columns !== grid.columns || map.rows !== grid.rows) return false
      return this.replace(grid, {
        heights: map.heights,
        xCoordinates: map.xCoordinates ?? grid.xCoordinates,
        yCoordinates: map.yCoordinates ?? grid.yCoordinates,
      })
    } catch {
      return false
    }
  }

  private probingGrid(): GridMeasurement | null {
    const last = this.items.at(-1)
    return last?.kind === "grid" && last.status === "probing" ? last : null
  }

  private replace(
    grid: GridMeasurement,
    patch: Partial<Omit<GridMeasurement, "kind">>
  ): boolean {
    const index = this.items.lastIndexOf(grid)
    if (index < 0) return false
    this.items = this.items.map((item, at) =>
      at === index ? { ...grid, ...patch } : item
    )
    return true
  }

  private add(measurement: JobMeasurement): boolean {
    if (this.items.length >= MAX_MEASUREMENTS) return false
    this.items = [...this.items, measurement]
    return true
  }
}
