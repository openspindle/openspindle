import type { Xyz } from "./motion-queue.ts"

/** Isolated controller motion, with bounded integration and no queued travel. */
export class DirectMotion {
  private position: Xyz
  private velocity: Xyz = [0, 0, 0]
  private desired: Xyz = [0, 0, 0]
  private endpoint: {
    axis: 0 | 1 | 2
    value: number
    start: number
    distance: number
    sign: number
    peak: number
    ramp: number
    cruise: number
    elapsed: number
  } | null = null
  private last: number
  private expiresAt = Infinity
  private expired = false
  private speed = 1
  private readonly axisRates: readonly [number, number, number]
  private readonly acceleration: number
  private readonly bounds: {
    min: readonly [number, number, number]
    max: readonly [number, number, number]
  }
  constructor(
    position: Xyz,
    axisRates: readonly [number, number, number],
    acceleration: number,
    bounds: {
      min: readonly [number, number, number]
      max: readonly [number, number, number]
    },
    now: number
  ) {
    this.axisRates = axisRates
    this.acceleration = acceleration
    this.bounds = bounds
    this.position = [...position]
    this.last = now
  }
  target(
    vector: readonly [number, number, number],
    speedScale: number,
    expiresAt: number,
    now: number
  ) {
    this.advance(now, this.speed)
    this.endpoint = null
    this.desired = vector.map(
      (value, axis) => ((value * this.axisRates[axis]) / 60) * speedScale
    ) as Xyz
    this.expiresAt = expiresAt
  }
  heartbeat(expiresAt: number) {
    this.expiresAt = expiresAt
  }
  step(
    axis: 0 | 1 | 2,
    distance: number,
    speedScale: number,
    now: number
  ): string | null {
    this.advance(now, this.speed)
    if (this.endpoint || this.velocity.some((v) => Math.abs(v) > 1e-8))
      return "A controller move is still running"
    const value = this.position[axis] + distance
    if (value < this.bounds.min[axis] || value > this.bounds.max[axis])
      return "Step exceeds the simulator travel envelope"
    const length = Math.abs(distance)
    const peak = Math.min(
      (this.axisRates[axis] / 60) * speedScale,
      Math.sqrt(length * this.acceleration)
    )
    this.endpoint = {
      axis,
      value,
      start: this.position[axis],
      distance: length,
      sign: Math.sign(distance),
      peak,
      ramp: peak / this.acceleration,
      cruise: Math.max(0, (length - (peak * peak) / this.acceleration) / peak),
      elapsed: 0,
    }
    return null
  }
  zero(now: number) {
    this.advance(now, this.speed)
    this.endpoint = null
    this.desired = [0, 0, 0]
    this.expiresAt = Infinity
  }
  advance(now: number, speed: number) {
    this.speed = speed
    const gap = now - this.last
    if (gap < 0 || gap > 50) {
      this.endpoint = null
      this.desired = [0, 0, 0]
      this.velocity = [0, 0, 0]
      this.expired = true
      this.last = now
    }
    while (this.last < now) {
      if (this.last >= this.expiresAt) {
        this.desired = [0, 0, 0]
        this.endpoint = null
        this.expired = true
      }
      const end = Math.min(
        now,
        this.last + 20,
        this.last < this.expiresAt ? this.expiresAt : now
      )
      const seconds = ((end - this.last) / 1000) * speed
      const endpoint = this.endpoint
      if (endpoint) {
        // A rest-to-rest profile reaches the endpoint at zero velocity without a snap.
        const total = 2 * endpoint.ramp + endpoint.cruise
        endpoint.elapsed = Math.min(total, endpoint.elapsed + seconds)
        const time = endpoint.elapsed
        let travel: number
        let velocity: number
        if (time < endpoint.ramp) {
          velocity = this.acceleration * time
          travel = (this.acceleration * time * time) / 2
        } else if (time < endpoint.ramp + endpoint.cruise) {
          velocity = endpoint.peak
          travel = endpoint.peak * (time - endpoint.ramp / 2)
        } else {
          const remaining = total - time
          velocity = this.acceleration * remaining
          travel =
            endpoint.distance - (this.acceleration * remaining * remaining) / 2
        }
        this.position[endpoint.axis] = endpoint.start + endpoint.sign * travel
        this.velocity = [0, 0, 0]
        this.velocity[endpoint.axis] = endpoint.sign * velocity
        this.desired = [0, 0, 0]
        if (time === total) {
          this.position[endpoint.axis] = endpoint.value
          this.endpoint = null
        }
        this.last = end
        continue
      }
      const difference = this.desired.map((v, axis) => v - this.velocity[axis])
      const length = Math.hypot(...difference)
      const factor = length
        ? Math.min(1, (this.acceleration * seconds) / length)
        : 0
      for (const axis of [0, 1, 2] as const) {
        const before = this.velocity[axis]
        const after = before + difference[axis] * factor
        const next = this.position[axis] + ((before + after) / 2) * seconds
        const bounded = Math.max(
          this.bounds.min[axis],
          Math.min(this.bounds.max[axis], next)
        )
        this.position[axis] = bounded
        this.velocity[axis] = bounded === next ? after : 0
      }
      this.last = end
    }
    if (now >= this.expiresAt) {
      this.desired = [0, 0, 0]
      this.endpoint = null
      this.expired = true
    }
    return {
      position: [...this.position] as Xyz,
      feed: Math.hypot(...this.velocity) * 60,
      moving:
        this.endpoint !== null ||
        this.velocity.some((value) => Math.abs(value) > 1e-8),
      expired: this.expired,
    }
  }
  halt(now: number): Xyz {
    this.advance(now, this.speed)
    this.endpoint = null
    this.velocity = [0, 0, 0]
    this.desired = [0, 0, 0]
    return [...this.position]
  }
}
