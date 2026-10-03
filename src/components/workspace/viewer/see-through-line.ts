import * as THREE from "three"
import { Line2NodeMaterial } from "three/webgpu"
import type { NodeBuilder } from "three/webgpu"

/**
 * A fat line that blends as any see-through material does when `transparent`. Line2NodeMaterial
 * draws a see-through line opaque, mixed with a copy of the screen behind it that three.js keeps
 * once for every renderer in the window: another renderer drawing such a line (a picture, the
 * fixture preview) swaps that copy under the first, whose frames then fail. So while the line's
 * colour is set up it reads as opaque, which skips the mixing, and blends by its alpha instead.
 */
export class SeeThroughLineMaterial extends Line2NodeMaterial {
  private seeThrough = false
  private settingUpColor = false

  constructor(parameters?: ConstructorParameters<typeof Line2NodeMaterial>[0]) {
    super(parameters)
    this.seeThrough = parameters?.transparent === true
    Object.defineProperty(this, "transparent", {
      get: () => this.seeThrough && !this.settingUpColor,
      set: (value: boolean) => {
        this.seeThrough = value
      },
    })
    // Line2NodeMaterial turns blending off; blend by alpha, see-through or not.
    this.blending = THREE.CustomBlending
    this.blendSrc = THREE.SrcAlphaFactor
    this.blendDst = THREE.OneMinusSrcAlphaFactor
    this.blendSrcAlpha = THREE.OneFactor
    this.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
  }

  override setupDiffuseColor(builder: NodeBuilder) {
    this.settingUpColor = true
    try {
      super.setupDiffuseColor(builder)
    } finally {
      this.settingUpColor = false
    }
  }
}
