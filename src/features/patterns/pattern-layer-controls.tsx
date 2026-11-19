import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PATTERN_FONTS } from "@/domain/operations/pattern"
import type { PatternLayer, PatternSpec } from "@/domain/operations/pattern"
import { PATTERN_COLOR } from "./pattern-layers"
import { defaultPattern } from "./presets"

const definitions = {
  formula: "Pattern",
  "circle-mask": "Circle mask",
  "dial-mask": "Dial numeral mask",
  cutout: "Circular cutout",
} satisfies Record<PatternLayer["kind"], string>

function newLayer(kind: PatternLayer["kind"], index: number): PatternLayer {
  switch (kind) {
    case "formula":
      return {
        kind,
        formula: defaultPattern(),
        color: ["#da7033", "#a857e7", "#338e6d", "#eb5475"][index % 4],
      }
    case "circle-mask":
      return { kind, color: "#bd8aff", x: 0, y: 0, radius: 2 }
    case "dial-mask":
      return { kind, color: "#f0b844", font: "serif", radius: 11, size: 2.2 }
    case "cutout":
      return {
        kind,
        color: "#ef5867",
        radius: 14,
        diameter: 2,
        thickness: 1,
        breakthrough: 0,
        stepDown: 0.25,
        tool: 2,
        feed: 150,
        plunge: 50,
        rpm: 12000,
      }
  }
}

function NumberField({
  label,
  value,
  change,
}: {
  label: string
  value: number
  change: (value: number) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      {label}
      <Input
        type="number"
        className="font-numeric"
        step="any"
        value={value}
        onChange={(e) => change(Number(e.target.value))}
      />
    </label>
  )
}

export function PatternLayerControls({
  spec,
  selected,
  select,
  change,
  hidden,
  toggle,
  remove,
}: {
  spec: PatternSpec
  selected: number
  select: (index: number) => void
  change: (spec: PatternSpec) => void
  hidden: ReadonlySet<number>
  toggle: (index: number) => void
  remove: (index: number) => void
}) {
  const layers = spec.layers ?? []
  const layer = layers.at(selected - 1)
  const active = selected > 0 ? layer : undefined
  const replace = (next: PatternLayer) =>
    change({
      ...spec,
      layers: layers.map((item, i) => (i === selected - 1 ? next : item)),
    })
  const entries = [
    "Base pattern",
    ...layers.map((item, i) => `${definitions[item.kind]} ${i + 2}`),
  ]
  return (
    <section className="flex flex-col gap-2" aria-label="Pattern layers">
      <div className="flex flex-wrap gap-1">
        {entries.map((name, i) => (
          <div key={i} className="flex items-center">
            <Button
              size="sm"
              variant={i === selected ? "default" : "outline"}
              aria-pressed={i === selected}
              onClick={() => select(i)}
            >
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{
                  backgroundColor: i
                    ? layers[i - 1].color
                    : (spec.color ?? PATTERN_COLOR),
                }}
              />
              {name}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Show ${name} in preview`}
              aria-pressed={!hidden.has(i)}
              onClick={() => toggle(i)}
            >
              {hidden.has(i) ? <EyeOff /> : <Eye />}
            </Button>
          </div>
        ))}
      </div>
      <Select<PatternLayer["kind"]>
        value={null}
        onValueChange={(value) => {
          if (value === null || layers.length >= 12) return
          change({
            ...spec,
            layers: [...layers, newLayer(value, layers.length)],
          })
          select(layers.length + 1)
        }}
      >
        <SelectTrigger aria-label="Add layer" disabled={layers.length >= 12}>
          <SelectValue placeholder="Add layer" />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(definitions) as PatternLayer["kind"][]).map((kind) => (
            <SelectItem key={kind} value={kind}>
              {definitions[kind]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-xs">
          Layer colour
          <Input
            type="color"
            className="w-12 p-0"
            value={active?.color ?? spec.color ?? PATTERN_COLOR}
            onChange={(e) => {
              if (active) replace({ ...active, color: e.target.value })
              else change({ ...spec, color: e.target.value })
            }}
          />
        </label>
        {active && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              change({
                ...spec,
                layers: layers.filter((_, i) => i !== selected - 1),
              })
              remove(selected)
              select(0)
            }}
          >
            Remove layer
          </Button>
        )}
      </div>
      {(active?.kind === "circle-mask" || active?.kind === "dial-mask") && (
        <NumberField
          label="Engraving mask clearance (mm)"
          value={spec.maskClearance ?? 0.5}
          change={(maskClearance) => change({ ...spec, maskClearance })}
        />
      )}
      {active?.kind === "circle-mask" && (
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="Center X (mm)"
            value={active.x}
            change={(x) => replace({ ...active, x })}
          />
          <NumberField
            label="Center Y (mm)"
            value={active.y}
            change={(y) => replace({ ...active, y })}
          />
          <NumberField
            label="Radius (mm)"
            value={active.radius}
            change={(radius) => replace({ ...active, radius })}
          />
        </div>
      )}
      {active?.kind === "dial-mask" && (
        <>
          <Select
            items={PATTERN_FONTS.map((font) => ({ value: font, label: font }))}
            value={active.font}
            onValueChange={(font) => {
              if (font) replace({ ...active, font })
            }}
          >
            <SelectTrigger aria-label="Numeral font">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PATTERN_FONTS.map((font) => (
                <SelectItem key={font} value={font}>
                  {font}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Numeral radius (mm)"
              value={active.radius}
              change={(radius) => replace({ ...active, radius })}
            />
            <NumberField
              label="Font size (mm)"
              value={active.size}
              change={(size) => replace({ ...active, size })}
            />
          </div>
        </>
      )}
      {active?.kind === "cutout" && (
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["radius", "Part radius (mm)"],
              ["diameter", "Cutter diameter (mm)"],
              ["thickness", "Stock thickness (mm)"],
              ["breakthrough", "Extra depth (mm)"],
              ["stepDown", "Step-down (mm)"],
              ["tool", "Tool T"],
              ["feed", "Cut feed (mm/min)"],
              ["plunge", "Plunge (mm/min)"],
              ["rpm", "RPM"],
            ] as const
          ).map(([key, label]) => (
            <NumberField
              key={key}
              label={label}
              value={active[key]}
              change={(value) => replace({ ...active, [key]: value })}
            />
          ))}
          <p className="col-span-2 text-xs text-muted-foreground">
            Full perimeter cut. Hold the part and confirm clearance below stock.
          </p>
        </div>
      )}
    </section>
  )
}
