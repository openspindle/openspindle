import { useEffect, useRef, useState } from "react"
import { Copy, Download, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import type { PatternSpec } from "@/domain/operations/pattern"
import { PatternPreview } from "./pattern-preview"
import { PatternLayerControls } from "./pattern-layer-controls"
import type { LayeredOutput } from "./pattern-layers"
import { PATTERN_PRESETS, defaultPattern } from "./presets"

type Props = {
  initial?: PatternSpec
  onApply?: (definition: PatternSpec, output: LayeredOutput) => void
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
  const [document, setDocument] = useState<PatternSpec>(() =>
    structuredClone(initial ?? defaultPattern())
  )
  const [selected, setSelected] = useState(0)
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set())
  const workerRef = useRef<Worker | null>(null)
  const request = useRef(0)
  useEffect(() => {
    const worker = new Worker(new URL("./pattern-worker.ts", import.meta.url), {
      type: "module",
    })
    workerRef.current = worker
    return () => {
      workerRef.current = null
      worker.terminate()
    }
  }, [])
  const activeLayer = document.layers?.[selected - 1]
  const spec = activeLayer?.kind === "formula" ? activeLayer.formula : document
  const showFormula = selected === 0 || activeLayer?.kind === "formula"
  const [result, setResult] = useState<{
    spec: PatternSpec
    output: LayeredOutput
  } | null>(null)
  // Only enable saving or exporting when these exact inputs produced the NC.
  const output = result?.spec === document ? result.output : null
  const [problem, setProblem] = useState<string | null>(null)
  const pending = !output && !problem
  const [lineWidth, setLineWidth] = useState(1)
  const [showRemoval, setShowRemoval] = useState(false)
  const [paramName, setParamName] = useState("")
  const update = (patch: Partial<PatternSpec>) =>
    changeSpec({ ...spec, ...patch })
  const changeDocument = (next: PatternSpec) => {
    setProblem(null)
    setDocument(next)
  }
  const changeSpec = (next: PatternSpec) => {
    if (activeLayer?.kind === "formula") {
      changeDocument({
        ...document,
        layers: document.layers?.map((layer, index) =>
          index === selected - 1 ? { ...activeLayer, formula: next } : layer
        ),
      })
    } else {
      changeDocument({
        ...next,
        layers: document.layers,
        color: document.color,
        maskClearance: document.maskClearance,
      })
    }
  }
  useEffect(() => {
    const worker = workerRef.current
    if (!worker) return
    const id = ++request.current
    const complete = ({
      data,
    }: MessageEvent<{
      id: number
      output?: LayeredOutput
      error?: string
    }>) => {
      if (data.id !== id) return
      if (data.output) {
        setResult({ spec: document, output: data.output })
        setProblem(null)
      } else setProblem(data.error ?? "The pattern could not be generated.")
    }
    const failed = () => setProblem("The pattern worker could not start.")
    worker.addEventListener("message", complete)
    worker.addEventListener("error", failed)
    const handle = window.setTimeout(() => {
      worker.postMessage({
        id,
        spec: document,
        baseUrl: new URL(import.meta.env.BASE_URL, window.document.baseURI)
          .href,
      })
    }, 120)
    return () => {
      window.clearTimeout(handle)
      worker.removeEventListener("message", complete)
      worker.removeEventListener("error", failed)
    }
  }, [document])
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
    const anchor = window.document.createElement("a")
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
                if (output) onApply(document, output)
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
          <PatternLayerControls
            spec={document}
            selected={selected}
            select={setSelected}
            change={changeDocument}
            hidden={hidden}
            toggle={(index) =>
              setHidden((previous) => {
                const next = new Set(previous)
                if (next.has(index)) next.delete(index)
                else next.add(index)
                return next
              })
            }
            remove={(index) =>
              setHidden(
                (previous) =>
                  new Set(
                    [...previous]
                      .filter((i) => i !== index)
                      .map((i) => (i > index ? i - 1 : i))
                  )
              )
            }
          />
          {showFormula && (
            <>
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
                <h2 className="text-sm font-medium">
                  Mathematical expressions
                </h2>
                {(["x", "y", "z"] as const).map((axis) => (
                  <label key={axis} className="flex flex-col gap-1 text-xs">
                    <span className="font-medium">
                      {axis.toUpperCase()}(t,i)
                    </span>
                    <Textarea
                      className="min-h-12 resize-y font-mono"
                      value={spec[axis]}
                      onChange={(event) =>
                        update({ [axis]: event.target.value })
                      }
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
                        <span className="font-numeric text-xs">
                          {item.value}
                        </span>
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
                          {
                            name: paramName,
                            value: 1,
                            min: 0,
                            max: 10,
                            step: 0.1,
                          },
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
            </>
          )}
        </div>
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex flex-wrap items-end gap-3">
            <Numeric
              label="Line width (px)"
              value={lineWidth}
              onChange={(value) =>
                setLineWidth(Math.max(0.5, Math.min(5, value)))
              }
              min={0.5}
              max={5}
              step={0.25}
            />
            <Button
              variant="outline"
              aria-pressed={showRemoval}
              onClick={() => setShowRemoval(!showRemoval)}
            >
              {showRemoval ? "Show toolpath" : "Show removal"}
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border bg-muted/20 p-3">
            <PatternPreview
              output={result?.output ?? null}
              removal={showRemoval}
              hidden={hidden}
              width={lineWidth}
            />
          </div>
          {problem && (
            <p role="alert" className="text-xs text-destructive">
              {problem}
            </p>
          )}
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
