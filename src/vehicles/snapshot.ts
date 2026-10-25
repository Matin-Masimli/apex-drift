import { Quat, Vec3 } from '../core/math';
import type { Vehicle } from './Vehicle';

/**
 * Compact visual state of a vehicle: everything needed to draw it, nothing needed to simulate it.
 * Used for render interpolation, replays, the time-trial ghost (M4) and remote cars (M5).
 *
 * Packed layout (SNAPSHOT_SIZE floats):
 *   0-2 position, 3-6 rotation (x, y, z, w),
 *   7-18 wheels × 4 (suspension length, steer angle, spin angle),
 *   19 brake light (0/1), 20 speed (m/s), 21 rpm, 22 gear
 */
export const SNAPSHOT_SIZE = 23;

export function writeSnapshot(v: Vehicle, out: Float32Array, offset = 0): void {
  const p = v.body.translation(), q = v.body.rotation();
  out[offset] = p.x; out[offset + 1] = p.y; out[offset + 2] = p.z;
  out[offset + 3] = q.x; out[offset + 4] = q.y; out[offset + 5] = q.z; out[offset + 6] = q.w;
  for (let i = 0; i < 4; i++) {
    const w = v.wheels[i];
    out[offset + 7 + i * 3] = w.suspensionLength;
    out[offset + 8 + i * 3] = w.steerAngle;
    out[offset + 9 + i * 3] = w.spinAngle;
  }
  out[offset + 19] = v.appliedBrake > 0.05 || v.appliedHandbrake > 0.05 ? 1 : 0;
  out[offset + 20] = v.forwardSpeed;
  out[offset + 21] = v.rpm;
  out[offset + 22] = v.gear;
}

/** Interpolate two snapshots (a → b by t) into `out`. Rotations slerp; spin angles take the short way. */
export function lerpSnapshot(a: Float32Array, ao: number, b: Float32Array, bo: number, t: number, out: Float32Array): void {
  for (let i = 0; i < 3; i++) out[i] = a[ao + i] + (b[bo + i] - a[ao + i]) * t;
  tmpQa.set(a[ao + 3], a[ao + 4], a[ao + 5], a[ao + 6]).slerp(tmpQb.set(b[bo + 3], b[bo + 4], b[bo + 5], b[bo + 6]), t);
  out[3] = tmpQa.x; out[4] = tmpQa.y; out[5] = tmpQa.z; out[6] = tmpQa.w;
  for (let w = 0; w < 4; w++) {
    const k = 7 + w * 3;
    out[k] = a[ao + k] + (b[bo + k] - a[ao + k]) * t;
    out[k + 1] = a[ao + k + 1] + (b[bo + k + 1] - a[ao + k + 1]) * t;
    let d = b[bo + k + 2] - a[ao + k + 2];
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    out[k + 2] = a[ao + k + 2] + d * t;
  }
  out[19] = t < 0.5 ? a[ao + 19] : b[bo + 19];
  out[20] = a[ao + 20] + (b[bo + 20] - a[ao + 20]) * t;
  out[21] = a[ao + 21] + (b[bo + 21] - a[ao + 21]) * t;
  out[22] = t < 0.5 ? a[ao + 22] : b[bo + 22];
}

const tmpQa = new Quat();
const tmpQb = new Quat();

/** Read the position out of a snapshot. */
export const snapshotPosition = (s: Float32Array, out: Vec3) => out.set(s[0], s[1], s[2]);

/**
 * Fixed-capacity ring buffer of timestamped snapshots, recorded at a fixed rate.
 * Headless-safe (the server can record replays too).
 */
export class SnapshotRecorder {
  private readonly data: Float32Array;
  private readonly times: Float64Array;
  private head = 0;
  private size = 0;

  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity * SNAPSHOT_SIZE);
    this.times = new Float64Array(capacity);
  }

  record(v: Vehicle, time: number): void {
    writeSnapshot(v, this.data, this.head * SNAPSHOT_SIZE);
    this.times[this.head] = time;
    this.head = (this.head + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
  }

  get count(): number { return this.size; }
  get startTime(): number { return this.size ? this.times[this.index(0)] : 0; }
  get endTime(): number { return this.size ? this.times[this.index(this.size - 1)] : 0; }

  /** Ring index of the k-th oldest frame. */
  private index(k: number): number {
    return (this.head - this.size + k + this.capacity * 2) % this.capacity;
  }

  /** Interpolated snapshot at `time` (clamped to the recorded range). */
  sample(time: number, out: Float32Array): void {
    if (this.size === 0) return;
    // Binary search over the chronological order.
    let lo = 0, hi = this.size - 1;
    if (time <= this.times[this.index(0)]) hi = 0;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.times[this.index(mid)] <= time) lo = mid; else hi = mid;
    }
    const ia = this.index(lo), ib = this.index(hi);
    const ta = this.times[ia], tb = this.times[ib];
    const t = tb > ta ? Math.min(1, Math.max(0, (time - ta) / (tb - ta))) : 0;
    lerpSnapshot(this.data, ia * SNAPSHOT_SIZE, this.data, ib * SNAPSHOT_SIZE, t, out);
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
  }
}
