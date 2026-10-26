import type { Vehicle } from '../vehicles/Vehicle';
import { lerpSnapshot, SNAPSHOT_SIZE, writeSnapshot } from '../vehicles/snapshot';

/**
 * A recorded lap for the Time Trial ghost: snapshots at a fixed rate, each tagged with lap time and
 * track progress. Progress gives the live delta ("how far ahead/behind am I at this point of the
 * lap") without any physics. Headless-safe; serialises compactly for localStorage.
 */
export class GhostLap {
  constructor(
    readonly lapTime: number,
    readonly times: Float32Array,
    readonly progress: Float32Array,
    readonly frames: Float32Array,
  ) {}

  get count(): number { return this.times.length; }

  /** Interpolated snapshot at lap time t. */
  sample(t: number, out: Float32Array): void {
    const n = this.count;
    if (n === 0) return;
    let lo = 0, hi = n - 1;
    if (t <= this.times[0]) hi = 0;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] <= t) lo = mid; else hi = mid;
    }
    const ta = this.times[lo], tb = this.times[hi];
    const f = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 0;
    lerpSnapshot(this.frames, lo * SNAPSHOT_SIZE, this.frames, hi * SNAPSHOT_SIZE, f, out);
  }

  /** Lap time at which the ghost reached `progress` (m from the line), interpolated. */
  timeAtProgress(progress: number): number | null {
    const n = this.count;
    if (n < 2 || progress < this.progress[0] || progress > this.progress[n - 1]) return null;
    let lo = 0, hi = n - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.progress[mid] <= progress) lo = mid; else hi = mid;
    }
    const pa = this.progress[lo], pb = this.progress[hi];
    const f = pb > pa ? (progress - pa) / (pb - pa) : 0;
    return this.times[lo] + (this.times[hi] - this.times[lo]) * f;
  }

  serialize(): string {
    const header = new Float32Array([this.lapTime, this.count]);
    const all = new Float32Array(2 + this.count * (2 + SNAPSHOT_SIZE));
    all.set(header, 0);
    all.set(this.times, 2);
    all.set(this.progress, 2 + this.count);
    all.set(this.frames, 2 + this.count * 2);
    const bytes = new Uint8Array(all.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  static deserialize(b64: string): GhostLap | null {
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const all = new Float32Array(bytes.buffer);
      const lapTime = all[0], n = all[1];
      if (!Number.isFinite(lapTime) || n <= 1 || all.length !== 2 + n * (2 + SNAPSHOT_SIZE)) return null;
      return new GhostLap(lapTime, all.slice(2, 2 + n), all.slice(2 + n, 2 + 2 * n), all.slice(2 + 2 * n));
    } catch {
      return null;
    }
  }
}

/** Records the current lap; `finish` turns it into a GhostLap. */
export class GhostRecorder {
  private times: number[] = [];
  private progress: number[] = [];
  private frames: number[] = [];
  private readonly snap = new Float32Array(SNAPSHOT_SIZE);
  private nextSample = 0;

  constructor(private readonly rate = 30) {}

  begin(): void {
    this.times = [];
    this.progress = [];
    this.frames = [];
    this.nextSample = 0;
  }

  /** Call every physics step with the lap time and the lap progress. */
  record(lapTime: number, progress: number, vehicle: Vehicle): void {
    if (lapTime < this.nextSample) return;
    this.nextSample = lapTime + 1 / this.rate;
    writeSnapshot(vehicle, this.snap);
    this.times.push(lapTime);
    // Progress is monotonic within a lap; clamp tiny backwards jitter so the search stays valid.
    const last = this.progress.length ? this.progress[this.progress.length - 1] : 0;
    this.progress.push(Math.max(last, progress));
    for (const v of this.snap) this.frames.push(v);
  }

  finish(lapTime: number): GhostLap {
    return new GhostLap(lapTime, new Float32Array(this.times), new Float32Array(this.progress), new Float32Array(this.frames));
  }
}

const key = (trackId: string, carId: string) => `apexdrift.ghost.${trackId}.${carId}`;

export function loadGhost(trackId: string, carId: string): GhostLap | null {
  try {
    const s = localStorage.getItem(key(trackId, carId));
    return s ? GhostLap.deserialize(s) : null;
  } catch {
    return null;
  }
}

export function saveGhost(trackId: string, carId: string, ghost: GhostLap): void {
  try { localStorage.setItem(key(trackId, carId), ghost.serialize()); } catch { /* storage full or unavailable */ }
}
