import { useEffect, useState } from "react"
import { Copy, Download, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import type { PatternSpec } from "@/domain/operations/pattern"
import { generatePattern } from "./pattern-core"
import type { PatternOutput } from "./pattern-core"
import { PATTERN_PRESETS, defaultPattern } from "./presets"

type Props = {
  initial?: PatternSpec
  onApply?: (definition: PatternSpec, output: PatternOutput) => void
}

function Preview({ output }: { output: PatternOutput | null }) {
  if (!output)
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Enter a formula to see the toolpath.
      </div>
    )
  const { paths, min, max } = output.generated
  const pad = 2
  const width = Math.max(1, max[0] - min[0])
  const height = Math.max(1, max[1] - min[1])
  // SVG's Y axis is down; reflect the world Y axis to make it point up.
  const toPath = (points: number[][]) =>
    points
      .map(
        ([x, y], i) =>
          `${i === 0 ? "M" : "L"}${x.toFixed(3)},${(-y).toFixed(3)}`
      )
      .join(" ")
  return (
    <svg
      className="h-full w-full text-primary"
      role="img"
      aria-label="Mathematical toolpath preview"
      viewBox={`${min[0] - pad} ${-max[1] - pad} ${width + 2 * pad} ${height + 2 * pad}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <circle
        cx={0}
        cy={0}
        r={13.5}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.12}
        strokeWidth={0.12}
      />
      {paths.map((points, i) => (
        <path
          key={i}
          d={toPath(points)}
          stroke="currentColor"
          strokeWidth={0.09}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}

function Numeric({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="number"
        className="font-numeric"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
      />
    </label>
  )
}

/** Standalone editor: no Electron, machine RPC, project store or implicit machine commands. */
export function PatternEditor({ initial, onApply }: Props) {
  const [spec, setSpec] = useState<PatternSpec>(() =>
    structuredClone(initial ?? defaultPattern())
  )
  const [result, setResult] = useState<{
    spec: PatternSpec
    output: PatternOutput
  } | null>(null)
  // Only enable saving or exporting when these exact inputs produced the NC.
  const output = result?.spec === spec ? result.output : null
  const [problem, setProblem] = useState<string | null>(null)
  const pending = !output && !problem
  const [paramName, setParamName] = useState("")
  const update = (patch: Partial<PatternSpec>) =>
    changeSpec({ ...spec, ...patch })
  const changeSpec = (next: PatternSpec) => {
    setProblem(null)
    setSpec(next)
  }
  useEffect(() => {
    let active = true
    const handle = window.setTimeout(() => {
      void generatePattern(spec).then(
        (next) => {
          if (active) {
            setResult({ spec, output: next })
            setProblem(null)
          }
        },
        (error: unknown) => {
          if (active) {
            setResult(null)
            setProblem(error instanceof Error ? error.message : String(error))
          }
        }
      )
    }, 120)
    return () => {
      active = false
      window.clearTimeout(handle)
    }
  }, [spec])
  const param = (
    index: number,
    patch: Partial<PatternSpec["parameters"][number]>
  ) =>
    update({
      parameters: spec.parameters.map((value, i) =>
        i === index ? { ...value, ...patch } : value
      ),
    })
  const save = () => {
    if (!output) return
    const blob = new Blob([output.generated.gcode], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "openspindle-pattern.gcode"
    anchor.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 overflow-hidden p-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div>
          <h1 className="font-heading text-lg font-semibold">
            Patterns / Textures
          </h1>
          <p className="text-xs text-muted-foreground">
            Parametric engraving · x(t,i), y(t,i), z(t,i) · Z0 = surface
          </p>
        </div>
        <div className="flex items-center gap-2">
          {output && (
            <span className="text-xs text-muted-foreground">
              {output.engine} · {output.generated.points.toLocaleString("en")}{" "}
              points
            </span>
          )}
          {onApply && (
            <Button
              disabled={!output || pending}
              onClick={() => {
                if (output) onApply(spec, output)
              }}
            >
              Apply toolpath
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!output || pending}
            onClick={() => {
              if (output)
                void navigator.clipboard.writeText(output.generated.gcode)
            }}
          >
            <Copy /> Copy NC
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!output || pending}
            onClick={save}
          >
            <Download /> G-code
          </Button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(285px,360px)_minmax(0,1fr)] gap-3">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-lg border p-3">
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Watch dial presets</h2>
            <div className="grid grid-cols-2 gap-1">
              {PATTERN_PRESETS.map((item) => (
                <Button
                  key={item.id}
                  variant="outline"
                  size="sm"
                  className="h-auto justify-start text-left whitespace-normal"
                  title={item.description}
                  onClick={() => changeSpec(structuredClone(item.spec))}
                >
                  {item.name}
                </Button>
              ))}
            </div>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Mathematical expressions</h2>
            {(["x", "y", "z"] as const).map((axis) => (
              <label key={axis} className="flex flex-col gap-1 text-xs">
                <span className="font-medium">{axis.toUpperCase()}(t,i)</span>
                <Textarea
                  className="min-h-12 resize-y font-mono"
                  value={spec[axis]}
                  onChange={(event) => update({ [axis]: event.target.value })}
                />
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              t is the curve parameter, i is the path index, n is the path
              count. Supports sin, cos, floor, sqrt and standard arithmetic.
            </p>
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">Adjustable parameters</h2>
            {spec.parameters.map((item, index) => (
              <div
                key={item.name + index}
                className="flex flex-col gap-2 rounded-md border p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{item.name}</span>
                  <div className="flex items-center gap-1">
                    <span className="font-numeric text-xs">{item.value}</span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${item.name}`}
                      onClick={() =>
                        update({
                          parameters: spec.parameters.filter(
                            (_, i) => i !== index
                          ),
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                <Slider
                  min={item.min}
                  max={item.max}
                  step={item.step}
                  value={[item.value]}
                  onValueChange={(values) =>
                    param(index, {
                      value: Array.isArray(values) ? values[0] : values,
                    })
                  }
                />
                <div className="grid grid-cols-3 gap-2">
                  <Numeric
                    label="Min"
                    value={item.min}
                    step={item.step}
                    onChange={(value) => param(index, { min: value })}
                  />
                  <Numeric
                    label="Max"
                    value={item.max}
                    step={item.step}
                    onChange={(value) => param(index, { max: value })}
                  />
                  <Numeric
                    label="Step"
                    value={item.step}
                    min={0.001}
                    step={0.01}
                    onChange={(value) => param(index, { step: value })}
                  />
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <Input
                placeholder="New parameter name"
                value={paramName}
                onChange={(event) => setParamName(event.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={
                  !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(paramName) ||
                  spec.parameters.some(({ name }) => name === paramName)
                }
                onClick={() => {
                  update({
                    parameters: [
                      ...spec.parameters,
                      { name: paramName, value: 1, min: 0, max: 10, step: 0.1 },
                    ],
                  })
                  setParamName("")
                }}
              >
                <Plus /> Add
              </Button>
            </div>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Sampling and machining</h2>
            <div className="grid grid-cols-2 gap-2">
              <Numeric
                label="t min"
                value={spec.tMin}
                step={0.1}
                onChange={(tMin) => update({ tMin })}
              />
              <Numeric
                label="t max"
                value={spec.tMax}
                step={0.1}
                onChange={(tMax) => update({ tMax })}
              />
              <Numeric
                label="Samples / curve"
                value={spec.samples}
                min={2}
                max={2400}
                onChange={(samples) => update({ samples })}
              />
              <Numeric
                label="Curves"
                value={spec.paths}
                min={1}
                max={240}
                onChange={(paths) => update({ paths })}
              />
              <Numeric
                label="Safe Z (mm)"
                value={spec.safeZ}
                min={0.5}
                step={0.5}
                onChange={(safeZ) => update({ safeZ })}
              />
              <Numeric
                label="Cut feed (mm/min)"
                value={spec.feed}
                onChange={(feed) => update({ feed })}
              />
              <Numeric
                label="Plunge (mm/min)"
                value={spec.plunge}
                onChange={(plunge) => update({ plunge })}
              />
              <Numeric
                label="RPM"
                value={spec.rpm}
                step={100}
                onChange={(rpm) => update({ rpm })}
              />
              <Numeric
                label="Tool T"
                value={spec.tool}
                min={1}
                max={999}
                onChange={(tool) => update({ tool })}
              />
            </div>
          </section>
        </div>
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border bg-muted/20 p-3">
            {problem ? (
              <p role="alert" className="text-sm text-destructive">
                {problem}
              </p>
            ) : (
              <Preview output={output} />
            )}
          </div>
          <div className="flex max-h-[32%] min-h-32 flex-col rounded-lg border">
            <div className="flex items-center justify-between border-b px-3 py-2 text-xs">
              <span>
                Generated CNC movements (preview only; machining requires a
                separate Run)
              </span>
              {pending && <span>Updating…</span>}
            </div>
            <pre className="min-h-0 overflow-auto p-3 font-mono text-xs">
              {output?.generated.gcode.slice(0, 14000) ?? ""}
            </pre>
          </div>
          <p className="shrink-0 text-xs text-muted-foreground">
            Recheck work origin, safe Z, V-bit width, fixtures and toolsetter in
            OpenSpindle before machining.
          </p>
        </div>
      </div>
    </div>
  )
}
