/** The kit's work envelope, relative to Anchor 1; shared with its simulator. */
export const Z1_WORK_AREA = [200, 200, 100] as const
export const Z1_WORK_AREA_ORIGIN = [-12, -12] as const
export function z1WorkBounds(anchor: readonly [number, number]) {
  const min = [
    anchor[0] + Z1_WORK_AREA_ORIGIN[0],
    anchor[1] + Z1_WORK_AREA_ORIGIN[1],
  ] as const
  return {
    min,
    max: [min[0] + Z1_WORK_AREA[0], min[1] + Z1_WORK_AREA[1]] as const,
  }
}

/** Firmware Z soft limits, shared with probing and the controller simulator. */
export const MACHINE_Z = { min: -102, max: -1 } as const

/** Verified Z1 spindle range; Carvera's 15,000 RPM spindle is a different model. */
export const Z1_SPINDLE_RANGE = { min: 1000, max: 13000 } as const
