import type { V3 } from '../core/math';
import type { Track } from './Track';

export type LapEvent =
  | { type: 'lapStart' }
  | { type: 'lap'; lapTime: number; valid: boolean; best: boolean; sectors: number[] }
  | { type: 'sector'; index: number; time: number; delta: number | null }
  | { type: 'invalidated' }
  | { type: 'wrongWay' };

/**
 * Tracks one car's progress around a circuit: lap and sector timing, ordered checkpoints (so
 * shortcuts and reversing over the line don't count), and track-limit invalidation.
 *
 * Progress is measured as distance along the centreline from the start line, from the nearest
 * centreline sample. Line crossings are interpolated within the step for sub-step accurate times.
 * Headless-safe: used by the server for authoritative timing.
 */
export class LapTimer {
  /** Laps completed. */
  lapsCompleted = 0;
  /** True once the car has crossed the line and a timed lap is running. */
  lapRunning = false;
  currentLapTime = 0;
  lastLapTime: number | null = null;
  bestLapTime: number | null = null;
  valid = true;
  /** Sector times of the lap in progress. */
  currentSectors: number[] = [];
  lastSectors: number[] = [];
  bestSectors: (number | null)[];
  /** Distance from the start line along the lap, [0, length). */
  progress = 0;
  /** Signed lateral offset from the centreline (+ right). */
  lateral = 0;
  /**
   * Continuous distance travelled along the track since the first update (m): integrates wrap-aware
   * progress deltas, so it never jumps at the start line. Starting behind the line (on the grid)
   * gives a small negative value. Race positions sort by this.
   */
  raceDistance = 0;

  private nextCheckpoint = 1;
  private sectorStart = 0;
  private initialised = false;
  private wrongWayTimer = 0;
  private readonly tmp = { index: 0, lateral: 0, distSq: 0 };
  private readonly trackLimit: number;

  constructor(private readonly track: Track) {
    this.bestSectors = new Array(track.sectorOffsets.length + 1).fill(null);
    // Off track = car centre beyond the curb plus a little more than half a car width.
    this.trackLimit = track.def.width / 2 + track.def.curbs.width + 1.3;
  }

  /** Current sector index (0-based). */
  get sector(): number {
    let k = 0;
    while (k < this.track.sectorOffsets.length && this.progress >= this.track.sectorOffsets[k]) k++;
    return k;
  }

  /** Forget the lap in progress (after a reset/teleport). The next line crossing starts a fresh lap. */
  resetLap(): void {
    this.lapRunning = false;
    this.initialised = false;
    this.currentLapTime = 0;
    this.currentSectors = [];
    this.valid = true;
  }

  /** Begin timing immediately (race start from the grid: lap 1 includes the run to the line). */
  startNow(): void {
    this.lapRunning = true;
    this.currentLapTime = 0;
    this.sectorStart = 0;
    this.currentSectors = [];
    this.valid = true;
    this.nextCheckpoint = 1;
  }

  update(dt: number, position: V3, forwardSpeed: number): LapEvent[] {
    const events: LapEvent[] = [];
    const t = this.track;
    const L = t.length;
    const near = t.line.nearest(position, this.tmp);
    const d = t.line.wrap(t.line.samples[near.index].s - t.startS);
    this.lateral = near.lateral;
    const prev = this.progress;
    this.progress = d;

    if (!this.initialised) {
      this.initialised = true;
      this.raceDistance = d > L / 2 ? d - L : d;
      // Next checkpoint is the first one ahead of the current position.
      this.nextCheckpoint = t.checkpointOffsets.findIndex(c => c > d);
      if (this.nextCheckpoint < 0) this.nextCheckpoint = t.checkpointOffsets.length;
      if (this.lapRunning && d > L / 2) {
        // Started behind the line (grid): checkpoints count from the line.
        this.nextCheckpoint = 1;
      }
      return events;
    }

    if (this.lapRunning) this.currentLapTime += dt;

    const delta = d - prev;
    const crossedForward = delta < -L / 2;  // wrapped from ~L to ~0
    const crossedBackward = delta > L / 2;  // wrapped from ~0 to ~L
    this.raceDistance += crossedForward ? delta + L : crossedBackward ? delta - L : delta;

    if (crossedBackward) {
      // Reversed over the line: lap no longer counts.
      if (this.lapRunning && this.valid) { this.valid = false; events.push({ type: 'invalidated' }); }
      this.nextCheckpoint = t.checkpointOffsets.length + 1; // impossible until a fresh crossing
    }

    // Ordered checkpoints, sectors (only while moving forward without wrapping).
    if (!crossedForward && !crossedBackward && delta > 0) {
      while (this.nextCheckpoint < t.checkpointOffsets.length && d >= t.checkpointOffsets[this.nextCheckpoint] && prev < t.checkpointOffsets[this.nextCheckpoint]) {
        this.nextCheckpoint++;
      }
      if (this.lapRunning) {
        for (let k = 0; k < t.sectorOffsets.length; k++) {
          const b = t.sectorOffsets[k];
          if (prev < b && d >= b && this.currentSectors.length === k) {
            // Interpolate the crossing inside the step.
            const frac = (b - prev) / delta;
            const at = this.currentLapTime - dt * (1 - frac);
            this.closeSector(at, events);
          }
        }
      }
    }

    if (crossedForward) {
      const gapToLine = L - prev;
      const frac = gapToLine / (gapToLine + d);
      const at = this.currentLapTime - dt * (1 - frac);
      const allCheckpoints = this.nextCheckpoint >= t.checkpointOffsets.length;
      if (this.lapRunning && allCheckpoints) {
        this.closeSector(at, events);
        const lapTime = at;
        const isBest = this.valid && (this.bestLapTime === null || lapTime < this.bestLapTime);
        if (isBest) this.bestLapTime = lapTime;
        if (this.valid) this.currentSectors.forEach((st, i) => {
          if (this.bestSectors[i] === null || st < (this.bestSectors[i] as number)) this.bestSectors[i] = st;
        });
        this.lastLapTime = lapTime;
        this.lastSectors = this.currentSectors.slice();
        this.lapsCompleted++;
        events.push({ type: 'lap', lapTime, valid: this.valid, best: isBest, sectors: this.lastSectors });
      }
      // A new lap starts at the crossing instant.
      this.lapRunning = true;
      this.currentLapTime = dt * (1 - frac);
      this.sectorStart = 0;
      this.currentSectors = [];
      this.valid = true;
      this.nextCheckpoint = 1;
      events.push({ type: 'lapStart' });
    }

    // Track limits.
    if (this.lapRunning && this.valid && Math.abs(this.lateral) > this.trackLimit) {
      this.valid = false;
      events.push({ type: 'invalidated' });
    }

    // Wrong way: moving backwards along the track at speed for a while.
    const along = delta / Math.max(dt, 1e-6);
    this.wrongWayTimer = !crossedForward && !crossedBackward && along < -3 && forwardSpeed > 3 ? this.wrongWayTimer + dt : 0;
    if (this.wrongWayTimer > 1.5) { events.push({ type: 'wrongWay' }); this.wrongWayTimer = 0; }

    return events;
  }

  private closeSector(at: number, events: LapEvent[]): void {
    const k = this.currentSectors.length;
    const time = at - this.sectorStart;
    this.currentSectors.push(time);
    this.sectorStart = at;
    const best = this.bestSectors[k];
    events.push({ type: 'sector', index: k, time, delta: best === null ? null : time - best });
  }
}
