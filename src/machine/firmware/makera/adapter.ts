import {
  ADDED_ANCHOR_LIMIT,
  ASSIST_KEYS,
  AnchorConfigurationSchema,
  COORDINATE_LIMIT,
  hasControlCharacter,
  isLocalIPv4,
} from "../../contract/index.ts"
import type {
  AddedAnchor,
  AnchorPosition,
  AssistKey,
  NetworkDevice,
  PlateAssists,
  Telemetry,
} from "../../contract/index.ts"
import type {
  AddedSlot,
  AssistStep,
  FirmwareAdapter,
  JobProtocol,
  OutboundFrame,
} from "../adapter.ts"
import { FRAME_TYPES, encodeFrame } from "./codec.ts"
import { makeraRules, planMakeraCommand } from "./commands.ts"
import { MakeraCompletion } from "./completion.ts"
import {
  MAKERA_CONFIGURATION_PATH,
  MakeraConfigurationDownload,
  readMakeraCameraPicture,
  readMakeraDimmingLightTimer,
  readMakeraVacuumDefaultPower,
  withMakeraCameraPicture,
  withMakeraLightTimer,
  withMakeraVacuumDefaultPower,
} from "./configuration.ts"
import { changesToolBeforeSpindle, prepareMakeraProgram } from "./dialect.ts"
import { parseMakeraHeightMap } from "./height-map.ts"
import { MakeraInterpreter } from "./interpreter.ts"
import { parseFileSize, parseHomedReport, parseSwitchReport } from "./lines.ts"
import { MakeraTransfer } from "./transfer.ts"

const command = (payload: string): OutboundFrame => ({
  type: FRAME_TYPES.command,
  payload,
})

const ASSISTS: Record<
  AssistKey,
  {
    field: "vacuumAuto" | "blowingAuto" | "bedCleanAuto" | "antiStatic"
    suffix: string
  }
> = {
  vacuum: { field: "vacuumAuto", suffix: "" },
  blow: { field: "blowingAuto", suffix: ".1" },
  bedClean: { field: "bedCleanAuto", suffix: ".2" },
  antiStatic: { field: "antiStatic", suffix: ".4" },
}

/** Non-motion firmware modes. Explicit settings persist; nothing is restored automatically. */
function assistPlan(
  assists: PlateAssists | null,
  telemetry: Telemetry
): AssistStep[] {
  if (telemetry.bedCleanAuto === null)
    throw new Error(
      "The device does not report its bed-clean mode; job completion cannot be verified."
    )
  const steps: AssistStep[] = []
  for (const key of ASSIST_KEYS) {
    const mode = assists?.[key] ?? "device"
    if (mode === "device") continue
    const { field, suffix } = ASSISTS[key]
    if (telemetry[field] === null)
      throw new Error(`The device does not report the ${key} assist mode.`)
    const enabled = mode === "on"
    if (telemetry[field] !== enabled)
      steps.push({
        key,
        enabled,
        frame: command(`M${enabled ? 331 : 332}${suffix}`),
        applied: (after) => after[field] === enabled,
      })
  }
  return steps
}

/** The firmware's "no tool" (T-1): the next M6 changes and measures whatever it names. */
const FORGET_TOOL = command("M493.2 T-1")

const makeraJob: JobProtocol = {
  // Where Makera Studio keeps the programs it runs.
  path: (id) => `/sd/gcodes/openspindle-${id}.nc`,
  homedQuery: command("G28.6"),
  homed: parseHomedReport,
  assistPlan,
  bedClean: (telemetry) => telemetry.bedCleanAuto,
  createTransfer: (bytes, md5, path) => new MakeraTransfer(bytes, md5, path),
  // ATCHandler skips M6 for the tool it believes is loaded, so on a manual-change machine the
  // program's first change would neither stop for the tool nor measure it at the tool sensor.
  // Never with an automatic changer: it tracks the clamped tool, and with none set it picks
  // the new one without dropping the old. Never before a spindle start, which halts without
  // a cutting tool.
  toolReset: (program, identity, telemetry) =>
    !identity.atc &&
    telemetry.tool !== -1 &&
    changesToolBeforeSpindle(program.text)
      ? { frame: FORGET_TOOL, applied: (after) => after.tool === -1 }
      : null,
  // As Makera Studio plays a file: the ESP32 streams it to the player, which asks for it by
  // name. `play /sd/<file> -v` never started on a Z1 Pro. Without -v, played lines' replies
  // go nowhere; alarms, halts and automation messages still report.
  play: (path) => command(`play ${path}`),
  playedFileSize: parseFileSize,
  createCompletion: (program, bedClean, now) =>
    new MakeraCompletion(program, bedClean, now),
}

/** Anchor 1 is stored as a machine position, Anchor 2 as an offset from it. */
const ANCHOR_KEYS = [
  "coordinate.anchor1_x",
  "coordinate.anchor1_y",
  "coordinate.anchor2_offset_x",
  "coordinate.anchor2_offset_y",
] as const
const ANCHOR_REPLY =
  /^(sd|cached): (coordinate\.anchor(?:1_[xy]|2_offset_[xy])) is (?:set to (.*)|not in config)$/
/** Configurator.cpp's answers to `config-set sd`: the value it wrote, or no room on its line. */
const ANCHOR_SET_REPLY =
  /^sd: (coordinate\.anchor(?:1_[xy]|2_offset_[xy])) (?:has been set to (.*)|not enough space to overwrite existing key\/value)$/
/** An anchor setting as it is written: to three decimals, a micrometre. */
const settingText = (value: number) => value.toFixed(3)
const toSetting = (value: number) => Number(settingText(value))

/**
 * Anchors the user added, after the Z1's own two: `openspindle.anchor3` and on, each one setting
 * that holds the anchor's id and its X and Y from Anchor 1 (`id,x,y`), or `-` once it is free.
 * `config-set` appends a setting it does not find and overwrites one it finds in place, as long
 * as the new value is at most 19 characters longer than the value it was added with; it cannot
 * remove one. Every value here is at most 8 characters longer than another, and the key with
 * its value stays within the 130 characters of a line the firmware reads.
 */
const addedKey = (slot: number) => `openspindle.anchor${slot + 3}`
const ADDED_REPLY =
  /^(sd|cached): (openspindle\.anchor\d+) is (?:set to (.*)|not in config)$/
const ADDED_SET_REPLY =
  /^sd: (openspindle\.anchor\d+) (?:has been set to (.*)|not enough space to overwrite existing key\/value)$/
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/
/** A free place's value. */
const FREE = "-"

/** A place's value: its anchor's id, X and Y to a micrometre (never "-0.000"), or free. */
const addedText = (anchor: AddedAnchor | null) =>
  anchor
    ? [
        anchor.id,
        ...anchor.offset.map((part) => settingText(toSetting(part) + 0)),
      ].join(",")
    : FREE

/**
 * What a place's value holds: its anchor, null when it is free, "other" for what is no anchor;
 * a place's line has room for an anchor only when it held one.
 */
function parseAdded(value: string): AddedSlot {
  if (value === FREE) return null
  const [id = "", x = "", y = "", ...rest] = value.split(",")
  if (rest.length || !/^[A-Za-z0-9-]{1,64}$/.test(id)) return "other"
  if (!NUMBER.test(x) || !NUMBER.test(y)) return "other"
  const offset = [Number(x) + 0, Number(y) + 0] as const
  return offset.every((part) => Math.abs(part) <= COORDINATE_LIMIT)
    ? { id, offset: [...offset] }
    : "other"
}

/** Anchor 1's position, then Anchor 2's offset from it, as the configuration keeps them. */
function anchorValues(anchors: readonly AnchorPosition[]): number[] {
  const first = anchors.find((anchor) => anchor.id === "anchor-1")
  const second = anchors.find((anchor) => anchor.id === "anchor-2")
  if (!first || !second || anchors.length !== 2)
    throw new Error(
      "A Makera machine stores two anchors: Anchor 1 and Anchor 2."
    )
  const x = toSetting(first.x)
  const y = toSetting(first.y)
  const offsets = [
    toSetting(toSetting(second.x) - x),
    toSetting(toSetting(second.y) - y),
  ]
  if (offsets.some((offset) => Math.abs(offset) > COORDINATE_LIMIT))
    throw new Error(
      `Anchor 2 must be within ${COORDINATE_LIMIT} mm of Anchor 1 in X and Y.`
    )
  return [x, y, ...offsets]
}

/** The announcement a Z1 broadcasts for discovery (UDP 3333): name,ip,port,busy[,version]. */
function parseAnnouncement(
  data: Uint8Array,
  sender: string
): NetworkDevice | null {
  if (data.length > 512 || !isLocalIPv4(sender)) return null
  const fields = new TextDecoder()
    .decode(data)
    .trim()
    .split(",")
    .map((field) => field.trim())
  if (fields.length !== 4 && fields.length !== 5) return null
  const [name, address, port, busy] = fields
  const version = fields.at(4)
  if (
    !name ||
    name.length > 128 ||
    hasControlCharacter(name) ||
    !isLocalIPv4(address) ||
    !/^\d{1,5}$/.test(port) ||
    !["0", "1"].includes(busy) ||
    (version !== undefined && !/^[\x20-\x7e]{1,64}$/.test(version))
  )
    return null
  const portNumber = Number(port)
  if (portNumber < 1 || portNumber > 65535) return null
  // The sender is authoritative: an announcement cannot redirect a connection elsewhere.
  return { name, host: sender, port: portNumber, busy: busy === "1" }
}

export const makeraAdapter: FirmwareAdapter = {
  id: "makera",
  defaultPort: 2222,
  discovery: { port: 3333, parse: parseAnnouncement },
  createInterpreter: () => new MakeraInterpreter(),
  encode: (frame) => encodeFrame(frame.type, frame.payload),
  queries: {
    identity: command("model"),
    status: { type: FRAME_TYPES.control, payload: "?" },
    diagnostics: command("diagnose"),
  },
  halt: { type: FRAME_TYPES.control, payload: "\x18" },
  // SimpleShell's reset: "Rebooting machine in 3 seconds...".
  restart: command("reset"),
  consoleLine: command,
  features: (identity, telemetry) => ({
    atc: identity.atc,
    camera: true,
    bedClean: telemetry?.bedCleanAuto != null,
  }),
  plan: planMakeraCommand,
  rules: makeraRules,
  // Application limits for jogging, spindle speed and overrides, not the machine's rating.
  limits: {
    jogMinDistance: 0.01,
    jogMaxDistance: 10,
    jogMinSpeedScale: 0.01,
    jogMaxSpeedScale: 0.25,
    spindleRpmMin: 1000,
    spindleRpmMax: 10000,
    overrideMin: 50,
    overrideMax: 150,
  },
  prepareProgram: prepareMakeraProgram,
  job: makeraJob,
  configuration: {
    path: MAKERA_CONFIGURATION_PATH,
    readAdmit: (telemetry) =>
      (telemetry.state === "Idle" || telemetry.state === "Alarm") &&
      telemetry.job === null
        ? null
        : "The device must be idle or halted with no active program.",
    writeAdmit: (telemetry) => {
      if (telemetry.state !== "Idle" || telemetry.job !== null)
        return "The device must be idle with no active program."
      if (telemetry.spindleOn !== false || telemetry.spindleRpm !== 0)
        return "Stop the spindle before saving the device configuration."
      return null
    },
    createDownload: () => new MakeraConfigurationDownload(),
    createUpload: (bytes, md5) =>
      new MakeraTransfer(bytes, md5, MAKERA_CONFIGURATION_PATH),
    vacuumDefaultPower: readMakeraVacuumDefaultPower,
    withVacuumDefaultPower: withMakeraVacuumDefaultPower,
    cameraPicture: readMakeraCameraPicture,
    withCameraPicture: withMakeraCameraPicture,
    dimmingLightTimer: readMakeraDimmingLightTimer,
    withLightTimer: withMakeraLightTimer,
    afterRestart: true,
  },
  anchors: {
    admit: (telemetry) =>
      telemetry.state === "Idle" && telemetry.job === null
        ? null
        : "The device must be idle with no active program.",
    keys: ANCHOR_KEYS,
    // Explicitly the persisted SD source; "cached" replies belong to other clients' reads.
    query: (key) => command(`config-get sd ${key}`),
    parse(text, key) {
      if (text.length > 256) return undefined
      const match = ANCHOR_REPLY.exec(text.trim())
      if (!match || match[1] !== "sd" || match[2] !== key) return undefined
      // Group 3 is absent for "is not in config".
      const value = match.at(3)?.trim()
      if (
        !value ||
        !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)
      )
        return null
      const number = Number(value)
      return Number.isFinite(number) && Math.abs(number) <= COORDINATE_LIMIT
        ? number
        : null
    },
    isReply: (text) =>
      [ANCHOR_REPLY, ANCHOR_SET_REPLY, ADDED_REPLY, ADDED_SET_REPLY].some(
        (reply) => reply.test(text.trim())
      ),
    // Plates keep positions relative to these ids, and so does the Z1 fixture kit's defaults.
    build: ([x, y, offsetX, offsetY], fetchedAt) =>
      AnchorConfigurationSchema.parse({
        source: "firmware-config",
        anchors: [
          { id: "anchor-1", name: "Anchor 1", x, y },
          { id: "anchor-2", name: "Anchor 2", x: x + offsetX, y: y + offsetY },
        ],
        fetchedAt,
      }),
    // Into the saved SD configuration, which reads verify; the firmware's own moves (tool
    // changes, the tool setter) load it when the machine starts.
    write: {
      values: anchorValues,
      command: (key, value) =>
        command(`config-set sd ${key} ${settingText(value)}`),
      confirm(text, key, value) {
        if (text.length > 256) return undefined
        const reply = text.trim()
        if (reply === "sd source does not exist")
          return "The device has no saved configuration to store anchors in."
        if (reply.startsWith("Usage: config-set"))
          return "The device did not take the anchor setting."
        const match = ANCHOR_SET_REPLY.exec(reply)
        if (!match || match[1] !== key) return undefined
        // Group 2 is absent when the setting's line has no room for the value.
        const stored = match.at(2)?.trim()
        if (stored === undefined)
          return `The device has no room to store ${key}.`
        return stored === settingText(value)
          ? true
          : `The device stored ${key} as ${stored}.`
      },
      afterRestart: true,
    },
    added: {
      limit: ADDED_ANCHOR_LIMIT,
      query: (slot) => command(`config-get sd ${addedKey(slot)}`),
      parse(text, slot) {
        if (text.length > 256) return undefined
        const match = ADDED_REPLY.exec(text.trim())
        if (!match || match[1] !== "sd" || match[2] !== addedKey(slot))
          return undefined
        // Group 3 is absent for "is not in config": no such place yet.
        const value = match.at(3)?.trim()
        return value === undefined ? "absent" : parseAdded(value)
      },
      command: (slot, anchor) =>
        command(`config-set sd ${addedKey(slot)} ${addedText(anchor)}`),
      confirm(text, slot, anchor) {
        if (text.length > 256) return undefined
        const reply = text.trim()
        if (reply === "sd source does not exist")
          return "The device has no saved configuration to store anchors in."
        if (reply.startsWith("Usage: config-set"))
          return "The device did not take the anchor setting."
        const key = addedKey(slot)
        const match = ADDED_SET_REPLY.exec(reply)
        if (!match || match[1] !== key) return undefined
        const stored = match.at(2)?.trim()
        if (stored === undefined)
          return `The device has no room to store ${key}.`
        return stored === addedText(anchor)
          ? true
          : `The device stored ${key} as ${stored}.`
      },
    },
  },
  heightMap: {
    // M375 without .1 would load the grid and enable compensation.
    query: command("M375.1"),
    parse: parseMakeraHeightMap,
  },
  switches: {
    query: command("M119"),
    // Endstops answers in any state; a program's moves would race the reading.
    admit: (telemetry) =>
      telemetry.job === null &&
      (telemetry.state === "Idle" || telemetry.state === "Alarm")
        ? null
        : "The device must be idle or halted with no active program.",
    parse: parseSwitchReport,
  },
  cameraUrl: (device) => `ws://${device.host}:82/ws_video`,
}
