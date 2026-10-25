/**
 * Minimal, allocation-conscious vector/quaternion math for the simulation.
 *
 * The simulation (core, physics, vehicles, ai, tracks) must run headless on the server,
 * so it deliberately does NOT depend on three.js. Rendering converts these to three types.
 *
 * Conventions (shared by sim and renderer):
 *   +Y up, right-handed. A car's local frame is: forward = -Z, right = +X, up = +Y.
 */

export interface V3 { x: number; y: number; z: number }
export interface Q4 { x: number; y: number; z: number; w: number }

export class Vec3 implements V3 {
  constructor(public x = 0, public y = 0, public z = 0) {}

  set(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
  copy(v: V3): this { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone(): Vec3 { return new Vec3(this.x, this.y, this.z); }
  add(v: V3): this { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v: V3): this { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  scale(s: number): this { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaled(v: V3, s: number): this { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  dot(v: V3): number { return this.x * v.x + this.y * v.y + this.z * v.z; }
  length(): number { return Math.hypot(this.x, this.y, this.z); }
  lengthSq(): number { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize(): this {
    const l = this.length();
    return l > 1e-12 ? this.scale(1 / l) : this;
  }
  /** this = a × b */
  crossVectors(a: V3, b: V3): this {
    const x = a.y * b.z - a.z * b.y;
    const y = a.z * b.x - a.x * b.z;
    const z = a.x * b.y - a.y * b.x;
    return this.set(x, y, z);
  }
  /** Rotate this vector in place by unit quaternion q. */
  applyQuat(q: Q4): this {
    // v' = v + 2w(q×v) + 2q×(q×v): the standard optimized form of q·v·q*.
    const { x, y, z } = this;
    const tx = 2 * (q.y * z - q.z * y);
    const ty = 2 * (q.z * x - q.x * z);
    const tz = 2 * (q.x * y - q.y * x);
    this.x = x + q.w * tx + (q.y * tz - q.z * ty);
    this.y = y + q.w * ty + (q.z * tx - q.x * tz);
    this.z = z + q.w * tz + (q.x * ty - q.y * tx);
    return this;
  }
  lerp(v: V3, t: number): this {
    this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t;
    return this;
  }
}

export class Quat implements Q4 {
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}

  set(x: number, y: number, z: number, w: number): this { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q: Q4): this { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  setFromAxisAngle(axis: V3, angle: number): this {
    const h = angle / 2, s = Math.sin(h);
    return this.set(axis.x * s, axis.y * s, axis.z * s, Math.cos(h));
  }
  /** Spherical interpolation toward q (shortest path). */
  slerp(q: Q4, t: number): this {
    let { x, y, z, w } = q;
    let cos = this.x * x + this.y * y + this.z * z + this.w * w;
    if (cos < 0) { cos = -cos; x = -x; y = -y; z = -z; w = -w; }
    let k0: number, k1: number;
    if (cos > 0.9995) { k0 = 1 - t; k1 = t; } else {
      const a = Math.acos(cos), s = Math.sin(a);
      k0 = Math.sin((1 - t) * a) / s; k1 = Math.sin(t * a) / s;
    }
    this.set(this.x * k0 + x * k1, this.y * k0 + y * k1, this.z * k0 + z * k1, this.w * k0 + w * k1);
    const l = Math.hypot(this.x, this.y, this.z, this.w);
    return this.set(this.x / l, this.y / l, this.z / l, this.w / l);
  }
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
/** Frame-rate independent exponential approach: move `current` toward `target` with time constant 1/rate. */
export const damp = (current: number, target: number, rate: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-rate * dt));
/** Move toward target by at most maxDelta. */
export const approach = (current: number, target: number, maxDelta: number) =>
  current < target ? Math.min(current + maxDelta, target) : Math.max(current - maxDelta, target);

export const DEG = Math.PI / 180;
export const RPM_TO_RAD = (2 * Math.PI) / 60;
export const RAD_TO_RPM = 60 / (2 * Math.PI);
export const MS_TO_KMH = 3.6;

/** Linear interpolation over a sorted table of [x, y] points, clamped at the ends. */
export function sampleCurve(points: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return last[1];
}
