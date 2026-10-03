import { createHash } from "node:crypto"
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  lstat,
  rm,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  inputs,
  isDrillFile,
  parameters,
  LIMITS,
} from "../../../src/domain/pcb/manifest.mjs"
import { runProcess } from "./runtime.mjs"

export class InputError extends Error {}
/** The program uses more than one tool slot; PCB operations support one tool. */
export class MultipleToolSlotsError extends InputError {
  constructor(message, slots) {
    super(message)
    this.slots = slots
  }
}
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const fail = (message) => {
  throw new InputError(message)
}
const bytes = (text) => Buffer.byteLength(text, "utf8")
const roles = new Set(inputs.map(({ id }) => id))
const names = Object.fromEntries(inputs.map(({ id, label }) => [id, label]))
const isMask = (role) => role === "front-mask" || role === "back-mask"

/**
 * Clears the openings completely. pcb2gcode stops offsetting once no opening remains;
 * keep this finite because it converts the theoretical pass count to an integer.
 */
const MASK_CLEARANCE = 10_000

export function validateRequest(input) {
  if (
    !object(input) ||
    input.schemaVersion !== 1 ||
    Object.keys(input).some(
      (key) => !["schemaVersion", "files", "parameters"].includes(key)
    )
  )
    fail("Expected a version 1 generator request.")
  if (
    !Array.isArray(input.files) ||
    !input.files.length ||
    input.files.length > 16
  )
    fail("Choose up to 16 Gerber/drill files.")
  const seen = new Set()
  let total = 0
  const files = input.files.map((file) => {
    if (
      !object(file) ||
      Object.keys(file).some(
        (key) => !["role", "name", "content"].includes(key)
      ) ||
      !roles.has(file.role)
    )
      fail("Unknown input file role.")
    if (seen.has(file.role) && file.role !== "drill")
      fail(`Only one ${file.role} file is supported.`)
    seen.add(file.role)
    if (
      typeof file.name !== "string" ||
      !file.name.trim() ||
      file.name.length > 180 ||
      /[\x00-\x1f\x7f/\\]/.test(file.name) ||
      file.name === "." ||
      file.name === ".."
    )
      fail(
        "File names must be plain names without paths or control characters."
      )
    if (
      typeof file.content !== "string" ||
      !file.content.trim() ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(file.content) ||
      !file.content.isWellFormed()
    )
      fail(`${file.name} must contain valid UTF-8 text.`)
    if (isDrillFile(file) !== (file.role === "drill"))
      fail(
        file.role === "drill"
          ? `${file.name} is a Gerber file: Drill and Mill drill operations take an Excellon drill file.`
          : `${file.name} is a drill file: ${names[file.role]} operations take a Gerber file.`
      )
    const size = bytes(file.content)
    total += size
    if (size > LIMITS.inputFile || total > LIMITS.inputTotal)
      fail("Input exceeds the 8 MiB per-file or 16 MiB total limit.")
    return { role: file.role, name: file.name, content: file.content }
  })
  if (!object(input.parameters ?? {})) fail("Parameters must be an object.")
  const supplied = input.parameters ?? {}
  if (Object.keys(supplied).some((id) => !parameters.some((p) => p.id === id)))
    fail("Unknown machining parameter.")
  const values = {}
  for (const p of parameters) {
    const value = Object.hasOwn(supplied, p.id) ? supplied[p.id] : p.default
    if (p.type === "number") {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < p.min ||
        value > p.max
      )
        fail(`${p.label} must be between ${p.min} and ${p.max}.`)
      const steps = (value - p.min) / p.step
      if (Math.abs(steps - Math.round(steps)) > 1e-6)
        fail(`${p.label} must follow a step of ${p.step}.`)
    } else if (p.type === "boolean") {
      if (typeof value !== "boolean") fail(`${p.label} must be a boolean.`)
    } else if (!p.options.some((option) => option.value === value))
      fail(`Invalid ${p.label}.`)
    values[p.id] = value
  }
  if (
    values.zeroStart &&
    files.filter((file) => file.role === "drill").length > 1 &&
    seen.size === 1
  )
    fail(
      "Separate drill files need a shared board reference when shifting to zero. Add the Edge.Cuts or copper Gerber, or disable Shift project to zero to preserve the shared KiCad origin."
    )
  if (values.zchange < values.zsafe)
    fail("Tool change height must be at least travel clearance.")
  if (
    values.zeroStart &&
    files.some((file) => isMask(file.role)) &&
    files.some((file) => !isMask(file.role))
  )
    fail(
      "Mask and other PCB layers convert separately. Disable Shift project to zero to preserve their shared origin."
    )
  if (
    seen.has("outline") &&
    values.bridges > 0 &&
    (values.bridgesnum < 1 || values.zbridges <= values.zcut)
  )
    fail(
      "Holding tabs require a positive count and a tab top above the final outline depth."
    )
  return { schemaVersion: 1, files, parameters: values }
}

/**
 * Only fixed flags and validated values: no shell, arbitrary flags, config or preamble files.
 * A job converts copper/outline and the drill at `drillIndex`, or the mask layers alone:
 * pcb2gcode's polarity inversion applies to every Gerber in an invocation.
 */
export function buildArguments(
  request,
  {
    drillIndex = 0,
    mask = request.files.every((file) => isMask(file.role)),
  } = {}
) {
  const p = request.parameters
  const drills = request.files.filter((file) => file.role === "drill")
  const files = filesForJob(request.files, drills[drillIndex], mask)
  const suppliedRoles = new Set(files.map((file) => file.role))
  const millingHoles = suppliedRoles.has("drill") && p.drillMethod === "mill"
  const args = [
    "--noconfigfile",
    "--metric",
    "--metricoutput",
    "--vectorial",
    "--nog64",
    "--nog91-1",
    "--output-dir=output",
    `--zsafe=${p.zsafe}`,
    `--zchange=${p.zchange}`,
    `--zero-start=${p.zeroStart ? 1 : 0}`,
  ]
  if (suppliedRoles.has("drill")) args.push("--nog81")
  if (
    suppliedRoles.has("back") ||
    suppliedRoles.has("back-mask") ||
    (suppliedRoles.has("drill") && p.drillSide === "back") ||
    (suppliedRoles.has("outline") && p.cutSide === "back")
  )
    args.push(`--mirror-axis=${p.mirrorAxis}`)
  for (const file of files) {
    const inputRole = isMask(file.role) ? file.role.slice(0, -5) : file.role
    args.push(
      `--${inputRole}=${inputFilename(file.role, drills.length, drillIndex)}`,
      `--${inputRole}-output=${file.role}.nc`
    )
  }
  if (millingHoles) args.push("--milldrill-output=milldrill.nc")
  const fields = {}
  if (suppliedRoles.has("front") || suppliedRoles.has("back"))
    Object.assign(fields, {
      zwork: "zwork",
      millDiameter: "mill-diameters",
      isolationWidth: "isolation-width",
      millFeed: "mill-feed",
      millVertfeed: "mill-vertfeed",
      millSpeed: "mill-speed",
    })
  if (mask) {
    args.push(
      "--invert-gerbers",
      `--isolation-width=${MASK_CLEARANCE}`,
      `--milling-overlap=${100 - p.maskStepover}%`
    )
    Object.assign(fields, {
      maskDepth: "zwork",
      maskDiameter: "mill-diameters",
      maskFeed: "mill-feed",
      maskVertfeed: "mill-vertfeed",
      maskSpeed: "mill-speed",
    })
  }
  // Milling holes takes pcb2gcode's outline cutter: an outline in the same job is then only
  // the board reference, and generate() takes its program from a job of its own.
  if (suppliedRoles.has("outline") && !millingHoles)
    Object.assign(fields, {
      zcut: "zcut",
      cutterDiameter: "cutter-diameter",
      cutInfeed: "cut-infeed",
      cutFeed: "cut-feed",
      cutVertfeed: "cut-vertfeed",
      cutSpeed: "cut-speed",
      cutSide: "cut-side",
      bridges: "bridges",
      bridgesnum: "bridgesnum",
      zbridges: "zbridges",
    })
  if (suppliedRoles.has("drill"))
    Object.assign(fields, {
      zdrill: "zdrill",
      drillFeed: "drill-feed",
      drillSpeed: "drill-speed",
      drillSide: "drill-side",
    })
  for (const [id, flag] of Object.entries(fields))
    args.push(`--${flag}=${p[id]}`)
  // pcb2gcode mills every hole from the minimum diameter up, here 0, so none is left to
  // drill; it still requires the drill feed and speed above.
  if (millingHoles)
    args.push(
      "--min-milldrill-hole-diameter=0",
      `--milldrill-diameter=${p.milldrillDiameter}`,
      `--zmilldrill=${p.zdrill}`,
      `--cutter-diameter=${p.milldrillDiameter}`,
      `--zcut=${p.zdrill}`,
      `--cut-infeed=${p.milldrillInfeed}`,
      `--cut-feed=${p.milldrillFeed}`,
      `--cut-vertfeed=${p.drillFeed}`,
      `--cut-speed=${p.drillSpeed}`
    )
  return args
}

/** Mask clearing never shares polarity or cutting parameters with copper or outlines. */
const filesForJob = (files, drill, mask) =>
  files.filter(
    (file) =>
      isMask(file.role) === mask && (file.role !== "drill" || file === drill)
  )

const inputFilename = (role, drillCount, drillIndex) =>
  role === "drill"
    ? `input-drill${drillCount > 1 ? `-${drillIndex + 1}` : ""}.drl`
    : `input-${role}.gbr`

const drillOutputName = (file, index, count) => {
  if (count === 1) return "drill.nc"
  const stem =
    file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^[.-]+|[.-]+$/g, "")
      .slice(0, 80) || "holes"
  return `drill-${index + 1}-${stem}.nc`
}

const comment = (value) =>
  String(value)
    .replace(/[\r\n\x00-\x1f\x7f]/g, " ")
    .slice(0, 180)

function requireSingleTool(source, role) {
  const slots = new Set()
  // Match comments before words so tool references in native messages are ignored.
  const words = /\([^)]*\)|;[^\r\n]*|([a-z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi
  for (const match of source.matchAll(words)) {
    if (match[1]?.toUpperCase() === "T") slots.add(Number(match[2]))
  }
  if (slots.size > 1) {
    const tools = [...slots].sort((a, b) => a - b).map((slot) => `T${slot}`)
    const hint =
      role === "drill"
        ? " Choose Mill drill to make every hole with one end mill."
        : ""
    throw new MultipleToolSlotsError(
      `This ${role} file generates multiple tool slots (${tools.join(", ")}). PCB operations support one tool.${hint}`,
      tools
    )
  }
}

const millimetres = (value) => `${Number(value.toFixed(3))} mm`

/**
 * pcb2gcode plunges every hole no wider than the end mill, and warns that those "were bigger
 * than the milling tool". Names the sizes in the milldrill program's header that come out
 * wider than drawn instead, or returns null.
 */
function plungedWider(program, diameter) {
  const header = /^\( Hole sizes:(.*)\)$/m.exec(program)?.[1] ?? ""
  const narrower = [...header.matchAll(/\[([^\]]+)mm\]/g)]
    .map((match) => Number(match[1]))
    .filter(
      (size) => size < diameter && millimetres(size) !== millimetres(diameter)
    )
  if (!narrower.length) return null
  const sizes = narrower.map(millimetres)
  const listed =
    sizes.length > 1
      ? `${sizes.slice(0, -1).join(", ")} and ${sizes.at(-1)}`
      : sizes[0]
  return `The ${listed} holes are smaller than the ${millimetres(diameter)} end mill and come out ${millimetres(diameter)} wide.`
}

export function augmentProgram(source, label, request) {
  const sources = request.files.map(
    (file) =>
      `; Input: ${comment(file.name)} | SHA256 ${createHash("sha256").update(file.content).digest("hex")}`
  )
  return [
    "; OpenSpindle PCB",
    `; Toolpath: ${comment(label)}`,
    ...sources,
    "; Original machining commands follow unchanged. Review setup and tooling before Run.",
    "",
    source,
  ].join("\n")
}

/** Converts Gerber/Excellon text with the pcb2gcode program at `executable`. */
export async function generate(
  input,
  { executable, runner = runProcess, signal, timeout = LIMITS.timeout } = {}
) {
  const request = validateRequest(input)
  const { files, parameters } = request
  const work = await mkdtemp(join(tmpdir(), "openspindle-pcb-"))
  try {
    const drills = files.filter((file) => file.role === "drill")
    const drillNames = drills.map((file, index) =>
      drillOutputName(file, index, drills.length)
    )
    for (const file of files)
      await writeFile(
        join(
          work,
          inputFilename(file.role, drills.length, drills.indexOf(file))
        ),
        file.content,
        { flag: "wx" }
      )
    const output = join(work, "output")
    const programs = []
    const previews = []
    const jobs = []
    const jobWarnings = []
    const log = { stdout: "", stderr: "" }
    let rawTotal = 0
    let returnedTotal = 0
    let logTotal = 0
    const deadline = Date.now() + timeout
    const millingHoles = drills.length > 0 && parameters.drillMethod === "mill"
    // One job per drill file, or one without; the first keeps the Gerbers' programs. With
    // an outline, milled holes take its cutter, so the Gerbers convert in a job of their own.
    let drillJobs = []
    if (drills.length) drillJobs = drills.map((_file, index) => index)
    else if (files.some((file) => !isMask(file.role))) drillJobs = [null]
    const jobIndexes =
      millingHoles && files.some((file) => file.role === "outline")
        ? [null, ...drillJobs]
        : drillJobs
    const conversions = jobIndexes.map((drillIndex, index) => ({
      drillIndex,
      mask: false,
      keepGerbers: index === 0,
    }))
    if (files.some((file) => isMask(file.role)))
      conversions.push({ drillIndex: null, mask: true, keepGerbers: true })
    for (const { drillIndex, mask, keepGerbers } of conversions) {
      const remaining = deadline - Date.now()
      if (remaining <= 0)
        throw new Error("pcb2gcode exceeded its generation time limit.")
      if (signal?.aborted) throw new Error("Generation cancelled.")
      await mkdir(output)
      // Every drill file sees the same Gerbers, so bounds, zero-start, and back
      // mirroring use exactly the same reference. Excellon tool tables stay separate.
      const args = buildArguments(request, { drillIndex, mask })
      const jobFiles = filesForJob(files, drills[drillIndex], mask)
      // Milled holes come out of pcb2gcode's milldrill program.
      const expected = new Map(
        jobFiles.map((file) => [
          file.role === "drill" && millingHoles
            ? "milldrill.nc"
            : `${file.role}.nc`,
          file.role,
        ])
      )
      jobs.push({
        ...(drills[drillIndex] ? { drill: drills[drillIndex].name } : {}),
        ...(mask ? { mask: true } : {}),
        arguments: args,
      })
      const jobLog = await runner(executable, args, {
        cwd: work,
        signal,
        timeout: remaining,
        logLimit: LIMITS.log - logTotal,
      })
      if (Date.now() > deadline)
        throw new Error("pcb2gcode exceeded its generation time limit.")
      if (signal?.aborted) throw new Error("Generation cancelled.")
      const jobName = mask ? "Mask layers" : "Gerber files"
      const heading =
        conversions.length > 1
          ? `[${drills[drillIndex]?.name ?? jobName}]\n`
          : ""
      logTotal +=
        bytes(heading) * 2 + bytes(jobLog.stdout) + bytes(jobLog.stderr)
      if (logTotal > LIMITS.log)
        throw new Error("pcb2gcode diagnostic output exceeded its limit.")
      log.stdout += heading + jobLog.stdout
      // plungedWider() replaces pcb2gcode's count of holes plunged by the end mill.
      const stderr = jobLog.stderr.replace(
        /^Warning: \d+ holes? (?:was|were) bigger than the milling tool\.\n?/m,
        ""
      )
      if (stderr.trim()) {
        log.stderr += heading + stderr + "\n"
        jobWarnings.push(
          (heading + stderr).trim().replace(/\s+/g, " ").slice(0, 4000)
        )
      }
      const entries = (await readdir(output)).sort()
      if (entries.length > LIMITS.outputCount)
        throw new Error("pcb2gcode produced too many output files.")
      const producedRoles = new Set()
      for (const name of entries) {
        if (!/\.(?:nc|svg)$/.test(name)) continue
        const path = join(output, name)
        const stat = await lstat(path)
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new Error("pcb2gcode produced an invalid output file.")
        rawTotal += stat.size
        if (stat.size > LIMITS.outputFile || rawTotal > LIMITS.outputTotal)
          throw new Error("pcb2gcode output exceeded its size limit.")
        const role = name.endsWith(".nc") ? expected.get(name) : null
        if (role === undefined)
          throw new Error("pcb2gcode produced an unexpected CNC program.")
        if (role) producedRoles.add(role)
        const drillPreview =
          name === "original_drill.svg" || name === "original_milldrill.svg"
        if (!keepGerbers && role !== "drill" && !drillPreview) continue
        const content = new TextDecoder("utf-8", { fatal: true }).decode(
          await readFile(path)
        )
        if (!content.trim())
          throw new Error(`pcb2gcode produced an empty ${name}.`)
        if (role) {
          requireSingleTool(content, role)
          const wider =
            role === "drill" && millingHoles
              ? plungedWider(content, parameters.milldrillDiameter)
              : null
          if (wider) jobWarnings.push((heading + wider).replace(/\s+/g, " "))
          let label = names[role]
          if (role === "drill" && drills.length > 1)
            label += `: ${drills[drillIndex].name}`
          const source = augmentProgram(content, label, request)
          if (bytes(source) > LIMITS.outputFile)
            throw new Error("Annotated output exceeded its size limit.")
          returnedTotal += bytes(source)
          programs.push({
            name: role === "drill" ? drillNames[drillIndex] : name,
            source,
          })
        } else if (/<svg(?:\s|>)/.test(content)) {
          returnedTotal += bytes(content)
          let previewName = mask ? `mask-${name}` : name
          if (drillPreview && drills.length > 1)
            previewName = name.replace(
              "drill.svg",
              `${drillNames[drillIndex].slice(0, -3)}.svg`
            )
          previews.push({ name: previewName, svg: content })
        }
        if (returnedTotal > LIMITS.outputTotal)
          throw new Error("pcb2gcode output exceeded its size limit.")
        if (programs.length + previews.length > LIMITS.outputCount)
          throw new Error("pcb2gcode produced too many output files.")
      }
      for (const role of new Set(jobFiles.map((file) => file.role)))
        if (!producedRoles.has(role))
          throw new Error(
            `pcb2gcode did not produce the requested ${role} CNC program${role === "drill" ? ` for ${drills[drillIndex].name}` : ""}. Check the input layer and diagnostic output. ${jobLog.stdout.slice(-1000)}`
          )
      // Discard repeated copper/outline output before the next Excellon job.
      await rm(output, { recursive: true, force: true })
    }
    // Keep outline last; separate sides remain separate programs and physical setups.
    const order = [
      "front.nc",
      "back.nc",
      "front-mask.nc",
      "back-mask.nc",
      ...drillNames,
      "outline.nc",
    ]
    programs.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
    const warnings = [
      "Machining values are examples, not a verified tool/material recipe. Confirm work zero, tooling, clearances and depth before Run.",
      "SVGs show pcb2gcode geometry before back-side mirroring. OpenSpindle previews the actual generated CNC coordinates.",
    ]
    if (
      files.some((file) => file.role === "back" || file.role === "back-mask") ||
      (drills.length > 0 && parameters.drillSide === "back") ||
      (files.some((file) => file.role === "outline") &&
        parameters.cutSide === "back")
    )
      warnings.push(
        `Back-side operations mirror about X=${parameters.mirrorAxis} mm. Flip and align the board before the separate back-side setup.`
      )
    warnings.push(...jobWarnings)
    return {
      schemaVersion: 1,
      programs,
      previews,
      warnings,
      metadata: {
        parameters,
        arguments: jobs[0].arguments,
        ...(jobs.length > 1 ? { jobs } : {}),
        diagnostics: log.stdout,
      },
    }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
