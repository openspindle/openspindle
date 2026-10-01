export const CONFIGURATION_PATH = "/sd/config.txt"

type ConfigurationDefaults = {
  readonly anchors: readonly [number, number, number, number]
  readonly feedRate: number
  readonly seekRate: number
  readonly axisRates: readonly [number, number, number]
  readonly park: readonly [number, number]
  readonly clearanceZ: number
}

/** Representative development data, independent of any machine's downloaded configuration. */
export function initialConfiguration(defaults: ConfigurationDefaults) {
  return new TextEncoder().encode(`# OpenSpindle Z1 simulator configuration
# Development defaults, not a configuration for a real machine.
# Saved edits persist until the simulator process exits.
# Anchor and vacuum defaults are loaded on reset; motion uses built-in defaults.

# Motion: speeds in mm/min
default_feed_rate                 ${defaults.feedRate}
default_seek_rate                 ${defaults.seekRate}
x_axis_max_speed                 ${defaults.axisRates[0]}
y_axis_max_speed                 ${defaults.axisRates[1]}
z_axis_max_speed                 ${defaults.axisRates[2]}
acceleration                    100
z_acceleration                  50
junction_deviation              0.05

# Anchors and parking positions, in machine coordinates
coordinate.anchor1_x            ${defaults.anchors[0]}
coordinate.anchor1_y            ${defaults.anchors[1]}
coordinate.anchor2_offset_x     ${defaults.anchors[2]}
coordinate.anchor2_offset_y     ${defaults.anchors[3]}
coordinate.clearance_x          ${defaults.park[0]}
coordinate.clearance_y          ${defaults.park[1]}
coordinate.clearance_z          ${defaults.clearanceZ}
coordinate.toolrack_offset_x    48.78
coordinate.toolrack_offset_y    179.74

# Representative probing and spindle settings
zprobe.enable                   true
zprobe.fast_feedrate             100
zprobe.slow_feedrate             5
zprobe.probe_height              5
spindle.enable                  true
spindle.max_rpm                 18000

# Default vacuum power for Follow spindle, loaded on reset
switch.vacuum.default_on_value   80
`)
}

function settingLine(line: string) {
  return /^([ \t]*)([^\s#]+)([ \t]+)([^\s#]+)([^\r\n]*)$/.exec(line)
}

/** `config-get sd` reads the same bytes the file-transfer endpoint serves. */
export function savedSetting(bytes: Uint8Array, key: string) {
  for (const line of new TextDecoder().decode(bytes).split(/\r?\n/)) {
    const setting = settingLine(line)
    if (setting?.[2] === key) return setting[4]
  }
  return undefined
}

/**
 * `config-set sd`, as FileConfigSource::write does it: the first line that sets the key is
 * overwritten from its start with `key value #`, the rest of the line left after it, when that
 * fits in the line's length less four; otherwise nothing changes (null). A key no line sets is
 * appended on a line of its own.
 */
export function withSavedSetting(
  bytes: Uint8Array,
  key: string,
  value: string
): Uint8Array | null {
  const text = new TextDecoder().decode(bytes)
  let start = 0
  while (start < text.length) {
    const newline = text.indexOf("\n", start)
    const end = newline < 0 ? text.length : newline + 1
    const setting = settingLine(text.slice(start, end).replace(/\r?\n$/, ""))
    if (setting?.[2] === key) {
      if (key.length + value.length + 3 > end - start - 4) return null
      const written = `${key} ${value} #`
      return new TextEncoder().encode(
        text.slice(0, start) + written + text.slice(start + written.length)
      )
    }
    start = end
  }
  return new TextEncoder().encode(
    `${text}\n${key}         ${value}         # added\n`
  )
}
