import type * as THREE from "three"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { PMREMGenerator } from "three/webgpu"
import type { WebGPURenderer } from "three/webgpu"

/**
 * A studio's light all round, as an environment map `renderer` lights scenes with: the soft
 * gradients and reflections of a CAD model's shaded view. The renderer must have started.
 */
export function studioEnvironment(renderer: WebGPURenderer): THREE.Texture {
  const room = new RoomEnvironment()
  const generator = new PMREMGenerator(renderer)
  const texture = generator.fromScene(room, 0.04).texture
  generator.dispose()
  room.dispose()
  return texture
}
