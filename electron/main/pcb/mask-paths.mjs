/*
 * Mask clearing paths with even scraping. pcb2gcode, given a single pass, goes once round each
 * mask opening, a tool radius inside its edge; its own passes inward are spaced from that edge
 * with the remainder left in the middle, so the middle of a pad is scraped most and its edge,
 * grazed only by the outermost pass, least. Here each opening's rings run from that outermost
 * loop to an innermost one half a stepover from its middle, the same in every opening, evenly
 * spaced between; the outermost goes round `edgePasses` times. The tool never plunges where it
 * cuts: it comes down to the surface, leads in along the ring on a vertical arc, and after
 * going round leads out over the same stretch, so that stretch is cut as deep as the rest.
 */
import {
  EndType,
  FillRule,
  JoinType,
  PointInPolygonResult,
  areaD,
  inflatePathsD,
  pointInPolygonD,
  unionD,
} from "clipper2-ts"

/** Decimal places Clipper keeps, mm: a tenth of a micrometre. */
const PRECISION = 4
/** How far a rounded corner may stray from its true arc, mm. */
const ARC_TOLERANCE = 0.002
/** How exactly an opening's depth is found, mm. */
const DEPTH_TOLERANCE = 0.0005
/** How far above the surface the tool moves between rings of one opening, mm, at most. */
const LIFT = 0.5
/** How much of a ring the tool leads in over, and out, at most: a short ring's arc is tighter. */
const LEAD_SHARE = 0.25
/** How far each lead's steps may stray from its arc in Z, mm: they are as few as that allows. */
const LEAD_TOLERANCE = 0.005
/**
 * How far a fitted line may stray from the points it replaces, mm (`fittedMoves`): a few
 * percent of a mask bit's width, so a ring needs a point every 15–25° rather than every 5°.
 */
const FIT_TOLERANCE = 0.01
/** How far a fitted line's Z may stray from the points it replaces, mm. */
const Z_TOLERANCE = 0.001

/**
 * A coordinate to the micrometre, without trailing zeros or "-0": a mask program repeats every
 * point of a ring on each lap, so its length is mostly its numbers.
 */
const number = (value) =>
  String(Number((Math.abs(value) < 5e-4 ? 0 : value).toFixed(3)))
const close = (a, b) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * pcb2gcode's program split around its cuts: the lines before its first rapid over a cut (the
 * setup and tool change, ending at the travel clearance), the closed loops it cuts below Z0 in
 * order, and the lines after its last cut (the retract and program end).
 */
export function readLoops(program) {
  const lines = program.split("\n")
  const first = lines.findIndex((line) => /^G00 X/.test(line))
  let last = -1
  lines.forEach((line, index) => {
    if (/^G01 X/.test(line)) last = index
  })
  if (first < 0 || last < first) return null
  const loops = []
  let position = { x: 0, y: 0 }
  let z = Infinity
  let loop = null
  for (const line of lines.slice(first, last + 1)) {
    const code = line.replace(/\(.*?\)/g, "")
    const word = (letter) => {
      const match = new RegExp(`${letter}(-?[\\d.]+)`).exec(code)
      return match ? Number(match[1]) : null
    }
    const [x, y, nextZ] = [word("X"), word("Y"), word("Z")]
    if (nextZ !== null) {
      z = nextZ
      loop = null
    }
    if (x === null && y === null) continue
    position = { x: x ?? position.x, y: y ?? position.y }
    if (z >= 0) continue
    if (!loop) {
      loop = [position]
      loops.push(loop)
      continue
    }
    loop.push(position)
    // A loop ends where it started; a run that goes on is another loop.
    if (loop.length > 3 && close(position, loop[0])) loop = null
  }
  return {
    header: lines.slice(0, first),
    loops: loops
      .map((points) =>
        close(points[0], points.at(-1)) ? points.slice(0, -1) : points
      )
      .filter((points) => points.length >= 3),
    footer: lines.slice(last + 1),
  }
}

/**
 * The openings the loops bound, each its outer path and the holes in it, in the order their
 * first loops come; `sign` is the direction pcb2gcode went round them (that of `areaD`).
 */
function openingsOf(loops) {
  // The four-argument form keeps `PRECISION`; the two-argument one rounds to 0.01 mm.
  const united = unionD(loops, [], FillRule.EvenOdd, PRECISION)
  const outers = united.filter((path) => areaD(path) > 0)
  const holes = united.filter((path) => areaD(path) < 0)
  const inside = (point, path) =>
    pointInPolygonD(point, path, PRECISION) !== PointInPolygonResult.IsOutside
  const openings = outers.map((outer) => ({
    outer,
    holes: [],
    first: loops.findIndex((loop) => inside(loop[0], outer)),
    sign: 1,
  }))
  for (const hole of holes) {
    const owner = openings
      .filter(({ outer }) => inside(hole[0], outer))
      .sort((a, b) => Math.abs(areaD(a.outer)) - Math.abs(areaD(b.outer)))[0]
    owner?.holes.push(hole)
  }
  for (const opening of openings) {
    const loop = loops[opening.first]
    if (loop) opening.sign = Math.sign(areaD(loop)) || 1
  }
  return openings.sort((a, b) => a.first - b.first)
}

const shrink = (paths, delta) =>
  delta === 0
    ? paths
    : inflatePathsD(
        paths,
        -delta,
        JoinType.Round,
        EndType.Polygon,
        2,
        PRECISION,
        ARC_TOLERANCE
      )

/** How far an opening's tool area reaches inward: the largest shrink that leaves any of it. */
function depthOf(paths) {
  // Nothing is left once the shrink passes half the opening's width or height.
  const xs = paths[0].map((point) => point.x)
  const ys = paths[0].map((point) => point.y)
  let low = 0
  let high =
    Math.min(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys)
    ) /
      2 +
    DEPTH_TOLERANCE
  while (high - low > DEPTH_TOLERANCE) {
    const middle = (low + high) / 2
    if (shrink(paths, middle).length) low = middle
    else high = middle
  }
  return low
}

/**
 * An opening's rings, outermost first, each its paths and how many times the tool goes round
 * them: the outermost loop `edgePasses` times, then once each the paths at offsets evenly
 * spaced at most `step` apart, down to the innermost half a `step` from the opening's middle,
 * as in every opening. An opening too narrow for more keeps its outermost loop alone.
 */
export function ringsOf(paths, step, edgePasses) {
  const inward = depthOf(paths) - step / 2
  const count = inward > DEPTH_TOLERANCE ? Math.ceil(inward / step) : 0
  const rings = [{ paths, laps: edgePasses }]
  for (let ring = 1; ring <= count; ring++) {
    const shrunk = shrink(paths, (ring * inward) / count)
    if (shrunk.length) rings.push({ paths: shrunk, laps: 1 })
  }
  return rings
}

/** A closed path in direction `sign`, starting at its point nearest `from`. */
function from(path, sign, near) {
  const directed = Math.sign(areaD(path)) === sign ? path : [...path].reverse()
  let start = 0
  directed.forEach((point, index) => {
    if (distance(point, near) < distance(directed[start], near)) start = index
  })
  return [...directed.slice(start), ...directed.slice(0, start)]
}

/**
 * The moves round a closed path from its first point, `laps` times, at `depth` below Z0, from
 * and back to Z0, leading in and out along the path itself on vertical arcs of `radius`:
 *
 * - in: from the surface down an arc that meets the path at full depth tangentially, as
 *   Fusion's vertical lead-in does;
 * - round the path at full depth, back to where the lead-in started;
 * - out: on over the lead-in's stretch, up an arc of the same radius that leaves the surface
 *   tangentially.
 *
 * Going in, each point of that stretch is cut as far below the surface as going out it is
 * short of full depth, so in all as deep as every other point: `laps` times the depth. The
 * stretch is as long as the arc takes to come down `depth`, at most `LEAD_SHARE` of the path
 * (a tighter arc on a short path); a radius under the depth leads in over the depth.
 */
function ledLaps(points, laps, depth, radius) {
  const ring = [...points, points[0]]
  const along = [0]
  for (let index = 1; index < ring.length; index++)
    along.push(along[index - 1] + distance(ring[index - 1], ring[index]))
  const length = along.at(-1)
  const deep = -depth
  const wanted = Math.max(radius, deep)
  // The horizontal stretch an arc of radius r takes to come down `deep`, and back.
  const lead = Math.min(
    Math.sqrt(2 * wanted * deep - deep * deep),
    length * LEAD_SHARE
  )
  const arc = (lead * lead + deep * deep) / (2 * deep)
  const out = laps * length
  const end = out + lead
  // How far below full depth an arc tangent to it at `u` = 0 is at distance `u` along.
  const rise = (u) => arc - Math.sqrt(Math.max(0, arc * arc - u * u))
  const zAt = (s) => {
    if (s < lead) return -(deep - rise(lead - s))
    if (s <= out) return depth
    return -rise(end - s)
  }
  const pointAt = (s) => {
    const at = s - Math.floor(s / length) * length
    // The first corner at or past `at`.
    let low = 1
    let high = along.length - 1
    while (low < high) {
      const middle = (low + high) >> 1
      if (along[middle] < at) low = middle + 1
      else high = middle
    }
    const index = low
    const span = along[index] - along[index - 1]
    const t = span ? (at - along[index - 1]) / span : 0
    const [a, b] = [ring[index - 1], ring[index]]
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  }
  // Every corner the moves pass, and the leads' arcs in steps that stay within
  // `LEAD_TOLERANCE` of them: a chord of a circle strays r(1 − cos(θ/2)) from it.
  const sweep = Math.asin(Math.min(1, lead / arc))
  const steps = Math.max(
    1,
    Math.ceil(sweep / (2 * Math.acos(Math.max(-1, 1 - LEAD_TOLERANCE / arc))))
  )
  const stops = new Set([lead, out, end])
  for (let step = 1; step < steps; step++) {
    stops.add((lead * step) / steps)
    stops.add(out + (lead * step) / steps)
  }
  for (let lap = 0; lap <= laps; lap++)
    for (const s of along.slice(1))
      if (lap * length + s < end) stops.add(lap * length + s)
  return [...stops]
    .sort((a, b) => a - b)
    .map((s) => ({ ...pointAt(s), z: zAt(s) }))
}

/** Whether Z goes from `points[a]` to `points[b]` in proportion to `along`, the distance travelled. */
function linearZ(points, a, b, along) {
  const total = along[b - a]
  for (let index = a + 1; index < b; index++) {
    const expected =
      points[a].z + ((points[b].z - points[a].z) * along[index - a]) / total
    if (Math.abs(points[index].z - expected) > Z_TOLERANCE) return false
  }
  return true
}

/** Whether `points[a]` to `points[b]` lie on the straight line between them, in order. */
function fitsLine(points, a, b) {
  const [p, q] = [points[a], points[b]]
  const length = distance(p, q)
  if (length < 1e-9) return false
  const along = [0]
  for (let index = a + 1; index <= b; index++) {
    const t =
      ((points[index].x - p.x) * (q.x - p.x) +
        (points[index].y - p.y) * (q.y - p.y)) /
      length
    const off = Math.abs(
      ((points[index].y - p.y) * (q.x - p.x) -
        (points[index].x - p.x) * (q.y - p.y)) /
        length
    )
    if (off > FIT_TOLERANCE || t < along.at(-1) - FIT_TOLERANCE) return false
    along.push(t)
  }
  return linearZ(points, a, b, along)
}

/**
 * The G-code for moves through `points` from the first, where the tool is: runs of points one
 * straight line passes within `FIT_TOLERANCE` of become that line, so a ring has as few points
 * as its shape needs, each at `feedFor` its own start and end. Only absolute straight moves
 * (G01), never arcs: the Z1 can lose or repeat a line of a played file without saying so,
 * which costs a straight move a chord at most, but moves an arc's centre (I, J from wherever
 * the tool is) and turns it into a stray full circle.
 */
function fittedMoves(points, feedFor) {
  const lines = []
  let rate = null
  let a = 0
  while (a < points.length - 1) {
    let end = a + 1
    while (end + 1 < points.length && fitsLine(points, a, end + 1)) end++
    const feed = feedFor(points[a], points[end])
    if (feed !== rate) lines.push(`G01 F${number(feed)}`)
    rate = feed
    // Every line whole, G01 X Y Z: a line the machine loses or plays twice then costs that move
    // alone, where a Z left out would keep a stray line's height for the rest of the ring.
    const p = points[end]
    lines.push(`G01 X${number(p.x)} Y${number(p.y)} Z${number(p.z)}`)
    a = end
  }
  return lines
}

/**
 * pcb2gcode's single-pass mask program with each opening cleared by even rings (`ringsOf`),
 * each led in and out (`ledLaps`) and gone round `maskPasses` times as often as `ringsOf`
 * says (the opening cleared that many times): its setup and end stay as they are. Each opening is one
 * run of moves, so it stays one part of the toolpath; between its rings the tool lifts `LIFT`
 * (at most the travel clearance) and comes down to the surface at the next one's start, where
 * the last ring's lead-out ended. `parameters` are the converter's validated values.
 */
export function maskProgram(program, parameters) {
  const read = readLoops(program)
  if (!read || !read.loops.length) return program
  const step = (parameters.maskDiameter * parameters.maskStepover) / 100
  const lift = Math.min(LIFT, parameters.zsafe)
  const plunge = `G01 F${number(parameters.maskVertfeed)}`
  const body = []
  let at = read.loops[0][0]
  for (const opening of openingsOf(read.loops)) {
    let first = true
    for (const ring of ringsOf(
      [opening.outer, ...opening.holes],
      step,
      parameters.maskEdgePasses
    )) {
      const paths = [...ring.paths]
      while (paths.length) {
        // Nearest first; holes go round opposite their opening, as pcb2gcode cuts them.
        paths.sort(
          (a, b) =>
            Math.min(...a.map((point) => distance(point, at))) -
            Math.min(...b.map((point) => distance(point, at)))
        )
        const path = paths.shift()
        const sign = areaD(path) > 0 ? opening.sign : -opening.sign
        const points = from(path, sign, at)
        const start = points[0]
        const target = `X${number(start.x)} Y${number(start.y)}`
        if (first)
          body.push(
            `G00 ${target} ( rapid move to begin. )`,
            plunge,
            "G01 Z0.00000"
          )
        else
          body.push(
            `G01 Z${number(lift)} ( lift to the next ring )`,
            `G01 ${target} Z${number(lift)}`,
            plunge,
            "G01 Z0.00000 ( down to the surface )"
          )
        body.push("( lead in along the ring )")
        // Each pass goes round every ring again, within the same lead-in and lead-out.
        const moves = ledLaps(
          points,
          ring.laps * parameters.maskPasses,
          parameters.maskDepth,
          parameters.maskLeadRadius
        )
        // As written: the feeds are held to the coordinates the machine gets.
        const path3 = [{ ...start, z: 0 }, ...moves].map((move) => ({
          x: Number(number(move.x)),
          y: Number(number(move.y)),
          z: Number(number(move.z)),
        }))
        // A move's feed: going down no faster than the plunge feed (the feed times the share
        // that is vertical), rounded down to a tenth.
        const feedFor = (from3, to3) => {
          const down = from3.z - to3.z
          if (down <= 0) return parameters.maskFeed
          const length = Math.hypot(to3.x - from3.x, to3.y - from3.y, down)
          return Math.min(
            parameters.maskFeed,
            Math.floor(((parameters.maskVertfeed * length) / down) * 10) / 10
          )
        }
        body.push(...fittedMoves(path3, feedFor))
        at = moves.at(-1)
        first = false
      }
    }
    body.push(`G00 Z${number(parameters.zsafe)} ( retract )`, "")
  }
  return [...read.header, ...body, ...read.footer].join("\n")
}
