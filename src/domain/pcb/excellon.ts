/**
 * How many hole sizes an Excellon drill file makes: the distinct diameters of the tools its
 * body selects. pcb2gcode drills the tools of one size together, so drilling takes one drill
 * per size.
 */
export function holeSizeCount(content: string): number {
  const diameters = new Map<number, number>()
  const selected = new Set<number>()
  // The header (M48 up to % or M95) defines tools and the body selects them; a file without
  // a header does both in its body.
  let body = !/^\s*M48\s*$/im.test(content)
  for (const line of content.split(/\r?\n/)) {
    const code = line.replace(/;.*/, "").trim().toUpperCase()
    if (!body && (code === "%" || code === "M95")) body = true
    const tool = /^T(\d+)(.*)$/.exec(code)
    if (!tool) continue
    const number = Number(tool[1])
    const diameter = /C(\d*\.?\d+)/.exec(tool[2])
    if (diameter) diameters.set(number, Number(diameter[1]))
    if (body && number > 0) selected.add(number)
  }
  return new Set(
    [...selected].map((number) => diameters.get(number) ?? `T${number}`)
  ).size
}
