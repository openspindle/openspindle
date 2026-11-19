import type { PatternSpec } from "@/domain/operations/pattern"

export type PatternPreset = {
  id: string
  name: string
  description: string
  spec: PatternSpec
}
const p = (
  name: string,
  value: number,
  min: number,
  max: number,
  step = 0.01
) => ({ name, value, min, max, step })
const base: PatternSpec = {
  x: "radius*cos(t)",
  y: "radius*sin(t)",
  z: "-depth",
  tMin: 0,
  tMax: 2 * Math.PI,
  samples: 360,
  paths: 1,
  parameters: [p("radius", 13, 1, 50, 0.1), p("depth", 0.08, 0.01, 1, 0.01)],
  safeZ: 3,
  feed: 350,
  plunge: 100,
  rpm: 12000,
  tool: 1,
}
const preset = (
  id: string,
  name: string,
  description: string,
  changes: Partial<PatternSpec>
): PatternPreset => ({ id, name, description, spec: { ...base, ...changes } })
export const PATTERN_PRESETS: readonly PatternPreset[] = [
  preset(
    "rosette",
    "Guilloché rosette",
    "Fine radial waves across nested rings",
    {
      x: "(radius-i*spacing+amplitude*cos(waves*t+i*twist))*cos(t)",
      y: "(radius-i*spacing+amplitude*cos(waves*t+i*twist))*sin(t)",
      paths: 12,
      samples: 720,
      parameters: [
        p("radius", 13, 5, 40, 0.1),
        p("spacing", 0.6, 0.1, 2),
        p("amplitude", 0.18, 0, 1),
        p("waves", 36, 3, 120, 1),
        p("twist", 0.2, 0, 2),
        p("depth", 0.08, 0.01, 0.5),
      ],
    }
  ),
  preset("concentric", "Concentric rings", "Minimal engine-turned circles", {
    x: "(radius-i*spacing)*cos(t)",
    y: "(radius-i*spacing)*sin(t)",
    paths: 24,
    parameters: [
      p("radius", 13, 5, 40, 0.1),
      p("spacing", 0.42, 0.1, 1),
      p("depth", 0.06, 0.01, 0.4),
    ],
  }),
  preset(
    "sunburst",
    "Sunburst",
    "Fine radial lines cut from the center toward the rim",
    {
      x: "(inner+(radius-inner)*t)*cos(tau*i/n)",
      y: "(inner+(radius-inner)*t)*sin(tau*i/n)",
      tMax: 1,
      samples: 30,
      paths: 144,
      parameters: [
        p("inner", 1.8, 0, 10, 0.1),
        p("radius", 13, 8, 40, 0.1),
        p("depth", 0.06, 0.01, 0.4),
      ],
    }
  ),
  preset("turbine", "Turbine", "Curved radial spokes like a machined rotor", {
    x: "(inner+(radius-inner)*t)*cos(tau*i/n+twist*t)",
    y: "(inner+(radius-inner)*t)*sin(tau*i/n+twist*t)",
    z: "-depth*t",
    tMax: 1,
    samples: 90,
    paths: 72,
    parameters: [
      p("inner", 3.5, 1, 10, 0.1),
      p("radius", 13, 8, 40, 0.1),
      p("twist", 1.1, -3, 3, 0.05),
      p("depth", 0.18, 0.01, 0.5),
    ],
  }),
  preset(
    "spiral",
    "Archimedean spirals",
    "Multiple intertwined winding grooves",
    {
      x: "(inner+(radius-inner)*t)*cos(tau*(turns*t+i/n))",
      y: "(inner+(radius-inner)*t)*sin(tau*(turns*t+i/n))",
      tMax: 1,
      samples: 800,
      paths: 6,
      parameters: [
        p("inner", 1, 0, 8, 0.1),
        p("radius", 13, 8, 40, 0.1),
        p("turns", 6, 1, 20, 1),
        p("depth", 0.06, 0.01, 0.5),
      ],
    }
  ),
  preset("waves", "Flinqué waves", "A ripple pattern in close parallel bands", {
    x: "(t-0.5)*width",
    y: "(i-(n-1)/2)*spacing+amplitude*sin(tau*waves*t+i*phase)",
    tMax: 1,
    samples: 300,
    paths: 42,
    parameters: [
      p("width", 25, 10, 60, 0.5),
      p("spacing", 0.5, 0.1, 2),
      p("amplitude", 0.24, 0, 1),
      p("waves", 8, 1, 24, 1),
      p("phase", 0.2, -3, 3, 0.05),
      p("depth", 0.06, 0.01, 0.5),
    ],
  }),
  preset("basket", "Basketweave", "Alternating woven guilloché lines", {
    x: "(t-0.5)*width",
    y: "(i-(n-1)/2)*spacing+amplitude*sin(tau*waves*t+pi*i)",
    tMax: 1,
    samples: 300,
    paths: 34,
    parameters: [
      p("width", 25, 10, 60, 0.5),
      p("spacing", 0.68, 0.1, 2),
      p("amplitude", 0.28, 0, 1),
      p("waves", 13, 2, 40, 1),
      p("depth", 0.09, 0.01, 0.5),
    ],
  }),
  preset(
    "clous",
    "Clous de Paris",
    "A grid of raised-looking diamond rosettes",
    {
      x: "(floor(i/columns)-(columns-1)/2)*pitch+cell*cos(t)",
      y: "(i-columns*floor(i/columns)-(columns-1)/2)*pitch+cell*sin(t)",
      z: "-depth*(0.5-0.5*cos(2*t))",
      paths: 144,
      samples: 48,
      parameters: [
        p("columns", 12, 4, 15, 1),
        p("pitch", 1.9, 0.5, 4),
        p("cell", 0.82, 0.1, 2),
        p("depth", 0.12, 0.01, 0.5),
      ],
    }
  ),
  preset("perlage", "Perlage", "Repeated overlapping circular graining", {
    x: "(floor(i/columns)-(columns-1)/2)*pitch+cell*cos(t)",
    y: "(i-columns*floor(i/columns)-(columns-1)/2)*pitch+cell*sin(t)",
    paths: 144,
    samples: 60,
    parameters: [
      p("columns", 12, 4, 15, 1),
      p("pitch", 1.9, 0.5, 4),
      p("cell", 0.96, 0.1, 2),
      p("depth", 0.05, 0.01, 0.5),
    ],
  }),
  preset(
    "grain",
    "Grain d'orge",
    "Barleycorn-like repeating engine-turned ovals",
    {
      x: "(radius-i*spacing+amplitude*cos(waves*t))*cos(t)",
      y: "(radius-i*spacing-amplitude*cos(waves*t))*sin(t)",
      paths: 16,
      samples: 720,
      parameters: [
        p("radius", 13, 8, 40, 0.1),
        p("spacing", 0.48, 0.1, 1),
        p("amplitude", 0.26, 0.01, 1),
        p("waves", 48, 8, 120, 1),
        p("depth", 0.07, 0.01, 0.5),
      ],
    }
  ),
]
export const defaultPattern = () => structuredClone(PATTERN_PRESETS[0].spec)
