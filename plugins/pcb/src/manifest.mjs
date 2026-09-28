/*
 * The conversion core's vocabulary: the KiCad exports it recognizes and the pcb2gcode
 * parameters it accepts. The views, the companion and the CLI share these definitions.
 * The plugin manifest itself is openspindle-plugin.json.
 */

const number = (id, label, value, min, max, step, unit) => ({
  id,
  label,
  type: "number",
  default: value,
  min,
  max,
  step,
  ...(unit ? { unit } : {}),
})
const side = (id, label) => ({
  id,
  label,
  type: "select",
  default: "front",
  options: [
    { value: "front", label: "Front" },
    { value: "back", label: "Back (mirrored)" },
  ],
})
const parameterGroups = {
  zsafe: "board",
  zchange: "board",
  mirrorAxis: "board",
  zeroStart: "board",
  zwork: "isolation",
  millDiameter: "isolation",
  isolationWidth: "isolation",
  millFeed: "isolation",
  millVertfeed: "isolation",
  millSpeed: "isolation",
  drillMethod: "drilling",
  zdrill: "drilling",
  milldrillDiameter: "drilling",
  milldrillInfeed: "drilling",
  milldrillFeed: "drilling",
  drillFeed: "drilling",
  drillSpeed: "drilling",
  drillSide: "drilling",
  zcut: "outline",
  cutterDiameter: "outline",
  cutInfeed: "outline",
  cutFeed: "outline",
  cutVertfeed: "outline",
  cutSpeed: "outline",
  cutSide: "outline",
  bridges: "outline",
  bridgesnum: "outline",
  zbridges: "outline",
}
/** Drilling values only one drill method uses; the others apply to both. */
const parameterMethods = {
  milldrillDiameter: "mill",
  milldrillInfeed: "mill",
  milldrillFeed: "mill",
}

/** Case-insensitive literal detection rules: content markers first, then file names. */
export const inputs = [
  {
    id: "front",
    label: "Front",
    accept: ".gbr,.ger,.gtl",
    detect: {
      suffixes: ["f_cu.gbr", "f.cu.gbr", "f_cu.ger", "f.cu.ger", ".gtl"],
      contentIncludesAll: ["TF.FileFunction,Copper", ",Top"],
    },
  },
  {
    id: "back",
    label: "Back",
    accept: ".gbr,.ger,.gbl",
    detect: {
      suffixes: ["b_cu.gbr", "b.cu.gbr", "b_cu.ger", "b.cu.ger", ".gbl"],
      contentIncludesAll: ["TF.FileFunction,Copper", ",Bot"],
    },
  },
  {
    id: "outline",
    label: "Outline",
    accept: ".gbr,.ger,.gko,.gm1",
    detect: {
      suffixes: [
        "edge_cuts.gbr",
        "edge.cuts.gbr",
        "edge_cuts.ger",
        "edge.cuts.ger",
        ".gko",
        ".gm1",
      ],
      contentIncludesAll: ["TF.FileFunction,Profile"],
    },
  },
  {
    id: "drill",
    label: "Drill",
    accept: ".drl,.xln,.txt",
    multiple: true,
    detect: { suffixes: [".drl", ".xln"], contentIncludesAll: ["M48"] },
  },
]

export const parameters = [
  number("zsafe", "Travel clearance", 2, 0.1, 100, 0.1, "mm"),
  number(
    "zchange",
    "Tool change height (work coordinates)",
    10,
    0.1,
    100,
    0.1,
    "mm"
  ),
  number("zwork", "Depth", -0.05, -2, -0.001, 0.001, "mm"),
  number(
    "millDiameter",
    "Effective tool diameter",
    0.2,
    0.01,
    10,
    0.000001,
    "mm"
  ),
  number("isolationWidth", "Minimum clearance", 0.2, 0, 10, 0.01, "mm"),
  number("millFeed", "Feed rate", 120, 1, 10000, 1, "mm/min"),
  number("millVertfeed", "Plunge feed", 60, 1, 10000, 1, "mm/min"),
  number("millSpeed", "Spindle speed", 12000, 1, 100000, 1, "rpm"),
  {
    // Drill plunges one drill per hole size; Mill makes every hole with one end mill,
    // circling those wider than it (pcb2gcode's milldrill).
    id: "drillMethod",
    label: "Method",
    type: "select",
    default: "drill",
    options: [
      { value: "drill", label: "Drill" },
      { value: "mill", label: "Mill" },
    ],
  },
  number("zdrill", "Depth", -1.8, -20, -0.01, 0.01, "mm"),
  number("milldrillDiameter", "Tool diameter", 0.8, 0.01, 20, 0.000001, "mm"),
  number("milldrillInfeed", "Depth per pass", 0.3, 0.01, 10, 0.01, "mm"),
  number("milldrillFeed", "Feed rate", 120, 1, 10000, 1, "mm/min"),
  number("drillFeed", "Plunge feed", 80, 1, 10000, 1, "mm/min"),
  number("drillSpeed", "Spindle speed", 12000, 1, 100000, 1, "rpm"),
  side("drillSide", "Machine from"),
  number("zcut", "Depth", -1.8, -20, -0.01, 0.01, "mm"),
  number("cutterDiameter", "Tool diameter", 1, 0.01, 20, 0.000001, "mm"),
  number("cutInfeed", "Depth per pass", 0.3, 0.01, 10, 0.01, "mm"),
  number("cutFeed", "Feed rate", 100, 1, 10000, 1, "mm/min"),
  number("cutVertfeed", "Plunge feed", 60, 1, 10000, 1, "mm/min"),
  number("cutSpeed", "Spindle speed", 12000, 1, 100000, 1, "rpm"),
  side("cutSide", "Cut outline from"),
  number("bridges", "Holding tab width (0 disables)", 1, 0, 20, 0.1, "mm"),
  number("bridgesnum", "Holding tab count", 4, 0, 32, 1),
  number("zbridges", "Holding tab top", -1, -20, 0, 0.01, "mm"),
  number("mirrorAxis", "Back-side flip axis X", 0, -1000, 1000, 0.01, "mm"),
  {
    id: "zeroStart",
    label: "Shift project to zero (otherwise preserve KiCad origin)",
    type: "boolean",
    default: false,
  },
].map((parameter) => ({
  ...parameter,
  group: parameterGroups[parameter.id],
  ...(parameterMethods[parameter.id]
    ? { method: parameterMethods[parameter.id] }
    : {}),
}))

export const LIMITS = Object.freeze({
  inputFile: 8 * 1024 * 1024,
  inputTotal: 16 * 1024 * 1024,
  outputFile: 8 * 1024 * 1024,
  outputTotal: 20 * 1024 * 1024,
  outputCount: 64,
  log: 64 * 1024,
  timeout: 120_000,
})
