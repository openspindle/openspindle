/*
 * The typefaces the app can show: one for text (display) and one for code and numbers shown as
 * values (mono). The stylesheet declares every face; the choice sets the theme's font variables.
 */

export type FontRole = "sans" | "mono"

export const FONTS = {
  "space-grotesk": {
    label: "Space Grotesk",
    family: '"Space Grotesk Variable"',
  },
  roboto: { label: "Roboto", family: '"Roboto Variable"' },
  "ibm-plex-sans": {
    label: "IBM Plex Sans",
    family: '"IBM Plex Sans Variable"',
  },
  "space-mono": { label: "Space Mono", family: '"Space Mono"' },
  "jetbrains-mono": {
    label: "JetBrains Mono",
    family: '"JetBrains Mono Variable"',
  },
} as const

export type FontId = keyof typeof FONTS
export type Fonts = Readonly<Record<FontRole, FontId>>

/** The fonts each role can take: text takes the sans faces, mono the monospaced ones. */
export const FONT_CHOICES: Readonly<Record<FontRole, readonly FontId[]>> = {
  sans: ["space-grotesk", "roboto", "ibm-plex-sans"],
  mono: ["space-mono", "jetbrains-mono"],
}

/** The mono fonts' digits and signs alone (styles.css), for numbers shown as values. */
const NUMERALS: Readonly<Partial<Record<FontId, string>>> = {
  "space-mono": '"Space Mono Numerals"',
  "jetbrains-mono": '"JetBrains Mono Numerals"',
}

export const DEFAULT_FONTS: Fonts = {
  sans: "space-grotesk",
  mono: "space-mono",
}

export const FONT_STORAGE_KEYS: Readonly<Record<FontRole, string>> = {
  sans: "openspindle:font-sans",
  mono: "openspindle:font-mono",
}

export function isFontFor(role: FontRole, value: unknown): value is FontId {
  return FONT_CHOICES[role].some((id) => id === value)
}

/** A role's font, or its default for a value this app does not offer for it. */
export const fontFor = (role: FontRole, value: unknown): FontId =>
  isFontFor(role, value) ? value : DEFAULT_FONTS[role]

export function readFonts(): Fonts {
  const read = (role: FontRole) => {
    try {
      return fontFor(role, localStorage.getItem(FONT_STORAGE_KEYS[role]))
    } catch {
      // The default fonts remain available when storage is unavailable.
      return DEFAULT_FONTS[role]
    }
  }
  return { sans: read("sans"), mono: read("mono") }
}

/** The theme's font variables a role's font sets; numbers shown as values take the mono's digits. */
function roleVariables(role: FontRole, font: FontId): Record<string, string> {
  if (role === "sans") return { "--app-font-sans": FONTS[font].family }
  return {
    "--app-font-mono": FONTS[font].family,
    "--app-font-numeric": NUMERALS[font] ?? FONTS[font].family,
  }
}

/** Every role's choices with the variables each sets: the init script's table. */
const VARIABLES = Object.fromEntries(
  (Object.keys(FONT_CHOICES) as FontRole[]).map((role) => [
    role,
    Object.fromEntries(
      FONT_CHOICES[role].map((font) => [font, roleVariables(role, font)])
    ),
  ])
)

export function applyFonts(fonts: Fonts) {
  const style = document.documentElement.style
  for (const role of ["sans", "mono"] as const)
    for (const [name, value] of Object.entries(
      roleVariables(role, fonts[role])
    ))
      style.setProperty(name, value)
}

// Apply the saved fonts before the page paints; React takes over after mount.
export const FONTS_INIT_SCRIPT = `(() => {
  const variables = ${JSON.stringify(VARIABLES)};
  const defaults = ${JSON.stringify(DEFAULT_FONTS)};
  const keys = ${JSON.stringify(FONT_STORAGE_KEYS)};
  for (const role of Object.keys(variables)) {
    let font = defaults[role];
    try {
      const saved = localStorage.getItem(keys[role]);
      if (Object.hasOwn(variables[role], saved)) font = saved;
    } catch {}
    for (const [name, value] of Object.entries(variables[role][font]))
      document.documentElement.style.setProperty(name, value);
  }
})();`
