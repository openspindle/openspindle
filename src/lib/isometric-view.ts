import * as THREE from "three"

/** Where an isometric view looks from: the front right, above, at equal angles to the axes. */
const ISOMETRIC = new THREE.Vector3(1, -1, 1).normalize()

/** How far before and beyond what is framed the view sees, in scene units. */
const DEPTH_ROOM = 1000

/**
 * Points an orthographic camera along the isometric view, Z up so that what stands upright
 * stands upright in the picture, centred on and framing `points` in a picture of `aspect`
 * (width by height), with `margin` (a share of the framed size) around them and at least
 * `least` tall, in scene units.
 */
export function fitIsometric(
  camera: THREE.OrthographicCamera,
  points: Iterable<THREE.Vector3>,
  {
    aspect,
    margin,
    least = 0,
  }: { aspect: number; margin: number; least?: number }
) {
  camera.up.set(0, 0, 1)
  camera.position.copy(ISOMETRIC)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  // Where the points are across and up the picture, and along the view.
  const view = camera.matrixWorldInverse
  const box = new THREE.Box3()
  for (const point of points)
    box.expandByPoint(point.clone().applyMatrix4(view))
  const size = box.getSize(new THREE.Vector3())
  const height = Math.max(size.y, size.x / aspect, least) * (1 + margin)
  const width = height * aspect
  const centre = box.getCenter(new THREE.Vector3())
  camera.left = centre.x - width / 2
  camera.right = centre.x + width / 2
  camera.bottom = centre.y - height / 2
  camera.top = centre.y + height / 2
  // From well in front of what is framed to well behind it: what the scene holds around it
  // shows too, in full.
  camera.near = -box.max.z - DEPTH_ROOM
  camera.far = -box.min.z + DEPTH_ROOM
  camera.updateProjectionMatrix()
}

/** The corners of a box, which framing it frames. */
export function boxCorners({ min, max }: THREE.Box3): THREE.Vector3[] {
  return [min.x, max.x].flatMap((x) =>
    [min.y, max.y].flatMap((y) =>
      [min.z, max.z].map((z) => new THREE.Vector3(x, y, z))
    )
  )
}
