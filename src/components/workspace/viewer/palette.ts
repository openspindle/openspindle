import * as THREE from "three"
import type { Severity } from "@/domain/diagnostics"

/** Drawing colors, resolved once per viewer: theme-derived, except the probing ones. */
export type ViewerPalette = {
  primary: THREE.Color
  rapid: THREE.Color
  /** Auto-level grids: yellow in any theme. */
  probe: THREE.Color
  /** The probe's path over an auto-level grid: green in any theme, apart from cutting paths. */
  probePath: THREE.Color
  /** Where an auto Z-height touches: red in any theme. */
  touchOff: THREE.Color
  /** The outline of where a plate cuts. */
  workArea: THREE.Color
  /** Where problems are: errors in the theme's warning colour, as alerts show them; warnings amber. */
  problem: Record<Severity, THREE.Color>
}

/** A theme colour token, such as `--primary`, in the sRGB Three.js accepts. */
function themeColor(element: HTMLElement, token: string, fallback: string) {
  // Canvas resolves CSS Color 4 / oklch theme tokens into sRGB.
  const probe = document.createElement("span")
  probe.style.color = `var(${token}, ${fallback})`
  element.append(probe)
  const css = getComputedStyle(probe).color
  probe.remove()
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 1
  const context = canvas.getContext("2d")
  if (!context) return new THREE.Color(fallback)
  context.fillStyle = css
  context.fillRect(0, 0, 1, 1)
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data
  return new THREE.Color().setRGB(
    r / 255,
    g / 255,
    b / 255,
    THREE.SRGBColorSpace
  )
}

export function viewerPalette(element: HTMLElement): ViewerPalette {
  const primary = themeColor(element, "--primary", "#3159d7")
  return {
    primary,
    rapid: primary.clone().lerp(new THREE.Color(0x75b7af), 0.65),
    probe: new THREE.Color(0xfacc15),
    probePath: new THREE.Color(0x22c55e),
    touchOff: new THREE.Color(0xef4444),
    workArea: primary.clone().lerp(new THREE.Color(0xe39a2d), 0.7),
    problem: {
      error: themeColor(element, "--warning", "#c2410c"),
      warning: new THREE.Color(0xf59e0b),
    },
  }
}
