import type { HomeSwitch, SwitchReport } from "../../contract/index.ts"
import type { Line, LineKind } from "../adapter.ts"

/** Ordered: the first matching rule classifies the line. */
const RULES: ReadonlyArray<readonly [LineKind, RegExp]> = [
  ["rejection", /^ok\b.*\binvalid\b/i],
  ["ack", /^ok(?:\s|$)/i],
  ["halt", /^(?:halted\b|!!|.*\baborted by (?:halt|kill)\b)/i],
  ["abort", /^aborted playing\b/i],
  ["alarm", /^alarm[:\s]/i],
  ["error", /^error[:\s]/i],
  [
    "rejection",
    /^(?:can not\b|not suspended\b|already suspended\b|unknown command\b|unsupported command\b|invalid command\b|currently printing\b|can only jump\b|not currently playing\b)/i,
  ],
  [
    "job-fault",
    /^(?:probe failed to complete\b|finding bed failed\b|calibration failed to complete\b|scan failed to complete\b|file not found\b|file\.open failed\b|.*\b(?:upload|download)\b.*\bfailed\b)/i,
  ],
  ["automation-done", /^done atc\b/i],
]

export function classifyLine(raw: string): Line {
  const text = raw.trim()
  const rule = RULES.find(([, pattern]) => pattern.test(text))
  return { text, kind: rule ? rule[0] : "info" }
}

/**
 * Player.cpp on_main_loop prints "  File size %ld" to every connection once the ESP32 serves the
 * file a play asked for by the CRC-16 of its path, before the player reports progress.
 */
export function parseFileSize(text: string): number | null {
  const match = /^File size (-?\d+)$/.exec(text.trim())
  return match ? Number(match[1]) : null
}

/** Endstops G28.6: "X:1 Y:1 Z:1 ..." optionally followed by its acknowledgement. */
export function parseHomedReport(
  text: string
): { homed: boolean; acknowledged: boolean } | null {
  const trimmed = text.trim()
  const acknowledged = /\sok\s*$/i.test(trimmed)
  const clean = trimmed.replace(/\s+ok\s*$/i, "")
  if (!/^(?:[XYZABC]:[01]\s*){3,6}$/.test(clean)) return null
  const flags = [...clean.matchAll(/([XYZABC]):([01])/g)]
  const axes = flags.map((match) => match[1])
  if (
    new Set(axes).size !== axes.length ||
    !["X", "Y", "Z"].every((axis) => axes.includes(axis))
  )
    return null
  return { homed: flags.every((match) => match[2] === "1"), acknowledged }
}

/**
 * Endstops M119: each home switch by its axis and end, then the raw pins, then the probe input
 * ("X_max:0 Y_max:0 Z_max:0 A_min:1 pins- (XL)P0.24:0 … Probe: 0"); 1 reads closed.
 */
export function parseSwitchReport(
  text: string
): Omit<SwitchReport, "at"> | null {
  const parts = text.trim().split(/\s*pins-\s*/)
  const [homesText, rest] = parts
  if (
    parts.length < 2 ||
    !/^(?:[XYZABC]_(?:min|max):[01]\s*)+$/.test(homesText)
  )
    return null
  const homes = [...homesText.matchAll(/([XYZABC])_(min|max):([01])/g)].map(
    ([, axis, end, value]) => ({
      axis: axis as HomeSwitch["axis"],
      end: end as HomeSwitch["end"],
      closed: value === "1",
    })
  )
  const probe = /\bProbe:\s*([01])\b/.exec(rest)
  return { homes, probe: probe ? probe[1] === "1" : null }
}
