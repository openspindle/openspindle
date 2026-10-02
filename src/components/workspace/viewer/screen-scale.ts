import * as THREE from "three"

const size = new THREE.Vector2()
const at = new THREE.Vector3()

/**
 * Millimetres (scene units) per CSS pixel where `object` is, seen through `camera`: what keeps
 * an overlay one size on screen at every zoom. 0 while the canvas has no size.
 */
export function millimetresPerPixel(
  renderer: { getSize: (target: THREE.Vector2) => THREE.Vector2 },
  camera: THREE.Camera,
  object: THREE.Object3D
): number {
  const height = renderer.getSize(size).y
  if (!height) return 0
  if (camera instanceof THREE.OrthographicCamera)
    return (camera.top - camera.bottom) / camera.zoom / height
  if (camera instanceof THREE.PerspectiveCamera) {
    const depth = -object
      .getWorldPosition(at)
      .applyMatrix4(camera.matrixWorldInverse).z
    return (
      (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) /
      camera.zoom /
      height
    )
  }
  return 0
}
