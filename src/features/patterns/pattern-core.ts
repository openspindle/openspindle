import { PatternSpecSchema } from "@/domain/operations/pattern"
import type { PatternSpec } from "@/domain/operations/pattern"

export type GeneratedPattern = {
  readonly paths: number[][][]
  readonly gcode: string
  readonly min: [number, number, number]
  readonly max: [number, number, number]
  readonly points: number
}
export type PatternOutput = {
  generated: GeneratedPattern
  engine: "Rust / WASM" | "Local preview"
}

type Variables = Readonly<Partial<Record<string, number>>>
type Evaluator = (vars: Variables) => number
const BUILTINS: Partial<Record<string, (...args: number[]) => number>> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
}

/** Small expression parser: no eval, dynamic code or host access; errors are shown in the editor. */
export function parseFormula(input: string): Evaluator {
  const source = input.trim()
  const tokens: string[] = []
  let offset = 0
  while (offset < source.length) {
    const matched =
      /^\s*(\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[()+\-*/^,])/.exec(
        source.slice(offset)
      )
    if (!matched)
      throw new Error(
        `Unexpected token near "${source.slice(offset, offset + 12)}"`
      )
    tokens.push(matched[1])
    offset += matched[0].length
    if (tokens.length > 240) throw new Error("Expression is too long")
  }
  let cursor = 0
  const next = (): string | undefined => tokens[cursor]
  const pop = (): string | undefined => tokens[cursor++]
  function primary(): Evaluator {
    const token = pop()
    if (!token) throw new Error("Incomplete formula")
    if (token === "(") {
      const inner = expression(0)
      if (pop() !== ")") throw new Error("Missing closing parenthesis")
      return inner
    }
    if (token === "+" || token === "-") {
      const rhs = expression(3)
      if (token === "-") return (v) => -rhs(v)
      return rhs
    }
    if (/^(?:\d|\.)/.test(token)) {
      const value = Number(token)
      return () => value
    }
    if (/^[A-Za-z_]/.test(token)) {
      if (next() !== "(") {
        return (vars) => {
          const result: number | undefined = vars[token]
          if (result === undefined)
            throw new Error(`Unknown variable "${token}"`)
          return result
        }
      }
      pop()
      const args: Evaluator[] = []
      while (next() !== ")") {
        args.push(expression(0))
        if (next() !== ",") break
        pop()
      }
      if (pop() !== ")")
        throw new Error("Expected closing function parenthesis")
      const f = Object.hasOwn(BUILTINS, token) ? BUILTINS[token] : undefined
      if (!f) throw new Error(`Unknown mathematical function "${token}"`)
      const expected = token === "pow" ? 2 : 1
      const variadic = token === "min" || token === "max"
      if (args.length < expected || (!variadic && args.length !== expected))
        throw new Error(`Invalid number of arguments for "${token}"`)
      return (v) => f(...args.map((arg) => arg(v)))
    }
    throw new Error(`Unexpected symbol "${token}"`)
  }
  function expression(min: number): Evaluator {
    let lhs = primary()
    while (cursor < tokens.length) {
      const op = next()
      let priority = -1
      if (op === "+" || op === "-") priority = 1
      if (op === "*" || op === "/") priority = 2
      if (op === "^") priority = 3
      if (priority < min) break
      pop()
      const rhs = expression(priority + (op === "^" ? 0 : 1))
      const left = lhs
      if (op === "+") lhs = (v) => left(v) + rhs(v)
      else if (op === "-") lhs = (v) => left(v) - rhs(v)
      else if (op === "*") lhs = (v) => left(v) * rhs(v)
      else if (op === "/") lhs = (v) => left(v) / rhs(v)
      else lhs = (v) => Math.pow(left(v), rhs(v))
    }
    return lhs
  }
  const output = expression(0)
  if (cursor !== tokens.length)
    throw new Error(`Unexpected "${tokens[cursor]}"`)
  return output
}

const number = (v: number) => v.toFixed(4)

/** Local preview and offline fallback. Kept in sync with the Rust vector/toolpath IR. */
export function generateLocally(input: PatternSpec): GeneratedPattern {
  const parsed = PatternSpecSchema.safeParse(input)
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid pattern")
  const p = parsed.data
  const f = [parseFormula(p.x), parseFormula(p.y), parseFormula(p.z)]
  const constant = Object.fromEntries(
    p.parameters.map(({ name, value }) => [name, value])
  )
  const paths: number[][][] = []
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.paths; i++) {
    const curve: number[][] = []
    for (let step = 0; step < p.samples; step++) {
      const t = p.tMin + ((p.tMax - p.tMin) * step) / (p.samples - 1)
      const vars = {
        ...constant,
        t,
        i,
        n: p.paths,
        pi: Math.PI,
        tau: 2 * Math.PI,
      }
      const point = f.map((fn) => fn(vars))
      if (point.some((v) => !Number.isFinite(v)))
        throw new Error(`Nonfinite point at path ${i + 1}, sample ${step + 1}`)
      if (
        Math.abs(point[0]) > 300 ||
        Math.abs(point[1]) > 300 ||
        point[2] < -3 ||
        point[2] > 0
      )
        throw new Error("Pattern exceeds ±300 mm XY or -3…0 mm engraving depth")
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], point[axis])
        max[axis] = Math.max(max[axis], point[axis])
      }
      curve.push(point)
    }
    paths.push(curve)
  }
  const lines = [
    "(Parametric engraving; verify stock top Z0, cutter and clearances)",
    "G21 G90 G17 G94",
    `T${p.tool} M6`,
    `S${p.rpm} M3`,
    `G0 Z${number(p.safeZ)}`,
  ]
  for (const path of paths) {
    const [x, y, z] = path[0]
    lines.push(`G0 X${number(x)} Y${number(y)}`)
    lines.push(`G1 Z${number(z)} F${number(p.plunge)}`)
    for (const [px, py, pz] of path.slice(1))
      lines.push(
        `G1 X${number(px)} Y${number(py)} Z${number(pz)} F${number(p.feed)}`
      )
    lines.push(`G0 Z${number(p.safeZ)}`)
  }
  lines.push("M5", "M30")
  return {
    paths,
    gcode: lines.join("\n"),
    min,
    max,
    points: p.samples * p.paths,
  }
}

type PatternWasm = {
  default: () => Promise<unknown>
  generate_pattern: (request: string) => string
}
let wasmEngine: Promise<PatternWasm | null> | undefined

/** Load once, including the optional module's absence in standalone local mode. */
function loadWasm(): Promise<PatternWasm | null> {
  wasmEngine ??= (async () => {
    try {
      const uri = `${import.meta.env.BASE_URL}pattern-wasm/openspindle_pattern_engine.js`
      const module: PatternWasm = await import(/* @vite-ignore */ uri)
      await module.default()
      return module
    } catch {
      return null
    }
  })()
  return wasmEngine
}

/** Uses Rust when available; formula errors never silently switch engines. */
export async function generatePattern(
  spec: PatternSpec
): Promise<PatternOutput> {
  const validated = PatternSpecSchema.parse(spec)
  // Check the shared formula language before either engine evaluates it.
  for (const axis of [validated.x, validated.y, validated.z]) parseFormula(axis)
  const module = await loadWasm()
  if (!module)
    return { generated: generateLocally(validated), engine: "Local preview" }
  const output: GeneratedPattern = JSON.parse(
    module.generate_pattern(JSON.stringify(validated))
  )
  return { generated: output, engine: "Rust / WASM" }
}
