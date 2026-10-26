import { AIDriver, type CarView, type Difficulty } from '../ai/AIDriver';
import type { RacingLine } from '../ai/RacingLine';
import { clamp } from '../core/math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { LapTimer, type LapEvent } from '../tracks/LapTimer';
import type { Track } from '../tracks/Track';
import { getCar } from '../vehicles/cars';
import { Vehicle } from '../vehicles/Vehicle';
import { neutralInput, type DriverInput } from '../vehicles/types';
import { SpeedProfile } from '../ai/RacingLine';

/**
 * Headless race rules: grid, AI drivers, lap counting, positions, finishing and recovery.
 * Contains no rendering, so the client renders it and the multiplayer server (M5) can run it as is.
 */

export interface RacerSpec {
  name: string;
  carId: string;
  paintIndex: number;
  /** Human-controlled (input passed to `step`). */
  player: boolean;
  difficulty?: Difficulty;
}

export interface RaceOptions {
  /** 0 = untimed practice / time trial (no finish). */
  laps: number;
  rubberBand: boolean;
}

export class Racer {
  finished = false;
  /** Race time at which this car crossed the finish line (s). */
  finishTime = 0;
  recoveries = 0;
  constructor(
    readonly index: number,
    readonly spec: RacerSpec,
    readonly vehicle: Vehicle,
    readonly timer: LapTimer,
    public ai: AIDriver | null,
  ) {}
  /** Laps completed in this race. */
  get laps(): number { return this.timer.lapsCompleted; }
}

export type RaceEvent =
  | { type: 'lap'; racer: Racer; lap: LapEvent & { type: 'lap' } }
  | { type: 'finish'; racer: Racer; position: number }
  | { type: 'timer'; racer: Racer; event: LapEvent }
  | { type: 'recovered'; racer: Racer }
  | { type: 'done' };

/**
 * Order AI entries for a mixed-class grid: fastest predicted lap at the front, so faster cars
 * aren't forced to carve through slower ones from the back (how multi-class grids line up).
 */
export function orderGridByPace(specs: RacerSpec[], line: RacingLine): RacerSpec[] {
  const pace = new Map<string, number>();
  for (const s of specs) if (!pace.has(s.carId)) pace.set(s.carId, new SpeedProfile(line, getCar(s.carId)).lapTime(line));
  return [...specs].sort((a, b) => pace.get(a.carId)! - pace.get(b.carId)!);
}

export class RaceSim {
  readonly racers: Racer[] = [];
  phase: 'grid' | 'racing' | 'done' = 'grid';
  /** Seconds since lights out. */
  raceTime = 0;
  private finishOrder: Racer[] = [];
  private firstFinishTime = -1;
  private playerFinishTime = -1;
  private readonly views: CarView[] = [];

  constructor(
    private readonly physics: PhysicsWorld,
    readonly track: Track,
    readonly line: RacingLine,
    specs: RacerSpec[],
    readonly opts: RaceOptions,
  ) {
    specs.forEach((spec, i) => {
      const slot = track.grid[i % track.grid.length];
      const vehicle = new Vehicle(physics, getCar(spec.carId), slot);
      const timer = new LapTimer(track);
      const ai = spec.player ? null : new AIDriver(track, line, vehicle, spec.difficulty ?? 'medium', i);
      this.racers.push(new Racer(i, spec, vehicle, timer, ai));
      this.views.push({ id: i, raceDistance: 0, lateral: 0, speed: 0 });
    });
  }

  get player(): Racer | undefined { return this.racers.find(r => r.spec.player); }

  /** Lights out. */
  start(): void {
    this.phase = 'racing';
    this.raceTime = 0;
    for (const r of this.racers) r.timer.startNow();
  }

  /** Current running order (finished cars by finish time, then by distance covered). */
  order(): Racer[] {
    const running = this.racers.filter(r => !r.finished).sort((a, b) => b.timer.raceDistance - a.timer.raceDistance);
    return [...this.finishOrder, ...running];
  }

  position(r: Racer): number { return this.order().indexOf(r) + 1; }

  /** One fixed physics step for every car, then the world. */
  step(dt: number, playerInput: DriverInput | null): RaceEvent[] {
    const events: RaceEvent[] = [];
    const racing = this.phase === 'racing';
    const player = this.player;

    // Views of every car for the AI (from the previous step's state).
    for (const r of this.racers) {
      const v = this.views[r.index];
      v.raceDistance = r.timer.raceDistance;
      v.lateral = r.timer.lateral;
      v.speed = r.vehicle.forwardSpeed;
    }

    for (const r of this.racers) {
      let input: DriverInput;
      if (this.phase === 'grid') {
        input = { ...neutralInput(), handbrake: 1 };
      } else if (r.ai) {
        const others = this.views.filter(v => v.id !== r.index);
        let pace = 1;
        if (this.opts.rubberBand && player && !player.finished && !r.finished) {
          // Ahead of the player → a touch slower; behind → a touch faster (±5% at ~125 m).
          const gap = r.timer.raceDistance - player.timer.raceDistance;
          pace = clamp(1 - gap / 2500, 0.95, 1.05);
        }
        // Finished cars cruise their cool-down lap.
        if (r.finished) pace = 0.75;
        input = r.ai.update(dt, this.views[r.index], others, pace);
        if (racing && r.ai.needsRecovery) {
          this.recover(r);
          events.push({ type: 'recovered', racer: r });
        }
      } else {
        input = playerInput ?? neutralInput();
      }
      r.vehicle.step(input, dt);
    }
    this.physics.step();

    if (this.phase === 'grid') return events;
    this.raceTime += dt;

    for (const r of this.racers) {
      for (const e of r.timer.update(dt, r.vehicle.body.translation(), r.vehicle.forwardSpeed)) {
        events.push({ type: 'timer', racer: r, event: e });
        if (e.type !== 'lap') continue;
        events.push({ type: 'lap', racer: r, lap: e });
        if (this.opts.laps > 0 && !r.finished && r.laps >= this.opts.laps) {
          r.finished = true;
          r.finishTime = this.raceTime;
          this.finishOrder.push(r);
          if (this.firstFinishTime < 0) this.firstFinishTime = this.raceTime;
          events.push({ type: 'finish', racer: r, position: this.finishOrder.length });
          if (r.spec.player) {
            this.playerFinishTime = this.raceTime;
            // The player's car drives its cool-down lap on autopilot.
            r.ai = new AIDriver(this.track, this.line, r.vehicle, 'easy', r.index);
          }
        }
      }
    }

    if (this.phase === 'racing' && this.opts.laps > 0) {
      const all = this.racers.every(r => r.finished);
      const leaderTimeout = this.firstFinishTime >= 0 && this.raceTime - this.firstFinishTime > 60;
      const playerTimeout = this.playerFinishTime >= 0 && this.raceTime - this.playerFinishTime > 30;
      if (all || leaderTimeout || playerTimeout) {
        this.phase = 'done';
        events.push({ type: 'done' });
      }
    }
    return events;
  }

  /**
   * Put a car back on the track at its current progress, a few metres back, on the first lateral
   * slot not occupied by another car. Lap progress is kept (no lap reset in a race).
   */
  recover(r: Racer): void {
    const t = this.track;
    const L = t.line;
    const near = L.nearest(r.vehicle.body.translation(), { index: 0, lateral: 0, distSq: 0 });
    const s = L.samples[near.index].s - 4;
    const smp = L.sampleAt(s);
    const lateral = [0, -3.5, 3.5].find(lat => !this.racers.some(o => {
      if (o === r) return false;
      const p = o.vehicle.body.translation();
      return Math.hypot(p.x - (smp.pos.x + smp.right.x * lat), p.z - (smp.pos.z + smp.right.z * lat)) < 6;
    })) ?? 0;
    r.vehicle.reset(
      { x: smp.pos.x + smp.right.x * lateral, y: smp.pos.y, z: smp.pos.z + smp.right.z * lateral },
      Math.atan2(-smp.tangent.x, -smp.tangent.z),
    );
    r.ai?.resetAfterRecovery();
    r.recoveries++;
  }

  /** Gap (s) from `r` to the car ahead of it, estimated from distance and its speed. */
  gapAhead(r: Racer): number | null {
    const order = this.order();
    const i = order.indexOf(r);
    if (i <= 0) return null;
    const ahead = order[i - 1];
    const d = ahead.timer.raceDistance - r.timer.raceDistance;
    return d / Math.max(10, r.vehicle.forwardSpeed);
  }
}
