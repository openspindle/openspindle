import type { PCBOperationData } from "./operation-data"

const MM_PER_INCH = 25.4

/** The origin a PCB file was plotted from, as far as the file tells. */
export type PlotOrigin = {
  /**
   * Plotted from KiCad's page origin (`%TF.SameCoordinates,Original*%`) rather than the
   * drill/place file origin, whose position KiCad writes there instead (`PX…PY…`).
   */
  readonly pageOrigin: boolean
  /** The least and most X and Y of its coordinates, mm; null where it has none it can read. */
  readonly min: readonly [x: number, y: number] | null
  readonly max: readonly [x: number, y: number] | null
}

/** Bounds of X and Y values, which a file may give apart (a coordinate it leaves out stays). */
function bounds(xs: readonly number[], ys: readonly number[]) {
  if (!xs.length || !ys.length) return { min: null, max: null }
  // A loop: a copper layer has more coordinates than spread arguments may.
  const range = (values: readonly number[]) => {
    let [least, most] = [Infinity, -Infinity]
    for (const value of values) {
      least = Math.min(least, value)
      most = Math.max(most, value)
    }
    return [least, most] as const
  }
  const [x, y] = [range(xs), range(ys)]
  return { min: [x[0], y[0]] as const, max: [x[1], y[1]] as const }
}

/**
 * A Gerber file's plot origin and extent: its coordinates are integers with the decimals its
 * format statement (`%FSLAX46Y46*%`) gives, in its unit (`%MOMM*%` or `%MOIN*%`). Only
 * absolute coordinates with leading zeros omitted are read, as KiCad writes them; extended
 * commands (`%…%`), such as aperture definitions, hold no coordinates.
 */
function gerberOrigin(content: string): PlotOrigin {
  const pageOrigin = /%TF\.SameCoordinates,Original\*%/.test(content)
  const format = /%FSLAX\d(\d)Y\d(\d)\*%/.exec(content)
  if (!format) return { pageOrigin, min: null, max: null }
  const unit = /%MOIN\*%/.test(content) ? MM_PER_INCH : 1
  const [xScale, yScale] = [format[1], format[2]].map(
    (decimals) => unit / 10 ** Number(decimals)
  )
  const xs: number[] = []
  const ys: number[] = []
  for (const block of content.replace(/%[^%]*%/g, "").split("*")) {
    const code = block.trim()
    if (!code || code.startsWith("G04")) continue
    const x = /X(-?\d+)/.exec(code)
    const y = /Y(-?\d+)/.exec(code)
    if (x) xs.push(Number(x[1]) * xScale)
    if (y) ys.push(Number(y[1]) * yScale)
  }
  return { pageOrigin, ...bounds(xs, ys) }
}

/**
 * An Excellon drill file's extent: its decimal coordinates after its header, in its unit
 * (`METRIC` or `INCH`). Drill files do not say which origin they were plotted from, and
 * coordinates without a decimal point need a format they may not give: those are not read.
 */
function excellonOrigin(content: string): PlotOrigin {
  const unit = /^\s*INCH/im.test(content) ? MM_PER_INCH : 1
  const xs: number[] = []
  const ys: number[] = []
  let body = !/^\s*M48\s*$/im.test(content)
  for (const line of content.split(/\r?\n/)) {
    const code = line.replace(/;.*/, "").trim().toUpperCase()
    if (!body && (code === "%" || code === "M95")) body = true
    if (!body) continue
    for (const [, value] of code.matchAll(/X(-?\d*\.\d+)/g))
      xs.push(Number(value) * unit)
    for (const [, value] of code.matchAll(/Y(-?\d*\.\d+)/g))
      ys.push(Number(value) * unit)
  }
  return { pageOrigin: false, ...bounds(xs, ys) }
}

/** Each PCB file's plot origin, by the data that holds it. */
const origins = new WeakMap<PCBOperationData, PlotOrigin>()

/** The origin a PCB operation's file was plotted from, and where its coordinates lie. */
export function plotOrigin(data: PCBOperationData): PlotOrigin {
  let origin = origins.get(data)
  if (!origin) {
    const { role, content } = data.file
    origin = role === "drill" ? excellonOrigin(content) : gerberOrigin(content)
    origins.set(data, origin)
  }
  return origin
}
