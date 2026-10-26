import { approach, clamp, DEG, RPM_TO_RAD, sampleCurve, Vec3 } from '../core/math';
import type { Track } from '../tracks/Track';
import type { Vehicle } from '../vehicles/Vehicle';
import { neutralInput, type DriverInput } from '../vehicles/types';
import { SpeedProfile, type RacingLine } from './RacingLine';

export type Difficulty = 'easy' | 'medium' | 'hard';

/** Peak engine power (hp) from the torque curve. */
function carSpecsPower(v: Vehicle): number {
  let p = 0;
  for (let rpm = v.config.engine.idleRpm; rpm <= v.config.engine.limiterRpm; rpm += 100) {
    p = Math.max(p, sampleCurve(v.config.engine.torqueCurve, rpm) * rpm * RPM_TO_RAD);
  }
  return p / 745.7;
}

/** Minimum centre-to-centre lateral spacing the AI keeps from a car alongside (m). */
const SIDE_GAP = 2.9;

/**
 * Skill knobs per difficulty.
 * grip:       fraction of the car's usable grip the speed profile is built on (corner speed).
 * brakeLate:  how far ahead (s) the driver reads the speed profile; less = brakes later.
 * passMargin: lateral clearance it wants when overtaking (m); more = more cautious.
 */
export const DIFFICULTY: Record<Difficulty, { grip: number; lookahead: number; passMargin: number; aggression: number }> = {
  easy: { grip: 0.8, lookahead: 0.32, passMargin: 3.6, aggression: 0.3 },
  medium: { grip: 0.9, lookahead: 0.24, passMargin: 3.2, aggression: 0.6 },
  hard: { grip: 0.95, lookahead: 0.17, passMargin: 2.9, aggression: 0.9 },
};

/** What a driver can see about another car (from the race state, not the renderer). */
export interface CarView {
  id: number;
  /** Monotonic race distance (laps · length + progress), m. */
  raceDistance: number;
  /** Lateral offset from the centreline (m, + right). */
  lateral: number;
  /** Forward speed (m/s). */
  speed: number;
}

/**
 * AI racing driver. Produces a DriverInput each physics step, through the same controls the player
 * uses (no physics cheats): steering by pure pursuit on the racing line, throttle/brake by tracking a
 * per-car speed profile, plus traffic handling.
 *
 * Traffic:
 *   - a car ahead in our path → pick the overtaking side with room (closest to the racing line);
 *     if neither side has room, follow at a safe gap instead of driving into it
 *   - a car alongside → keep a minimum lateral separation
 * Rubber-banding (optional) nudges the pace by a few percent based on the gap to the player.
 */
export class AIDriver {
  readonly profile: SpeedProfile;
  /** Extra lateral offset from the racing line used for overtaking/avoidance (m). */
  private avoid = 0;
  private stuckTime = 0;
  /** Smoothed throttle (the driver feeds power in rather than stamping on it). */
  private throttle = 0;
  /** Throttle application rate (1/s): slower for high power-to-weight cars. */
  private readonly throttleRate: number;
  private readonly fwd = new Vec3();
  private readonly right = new Vec3();
  private readonly tmp = { index: 0, lateral: 0, distSq: 0 };
  /** Set when the car has been stuck or facing backwards for a while; the race recovers it. */
  needsRecovery = false;
  /** Lateral position at the start (grid lane), held through the first metres of a race. */
  private startLateral: number | null = null;
  /** Debug: current mode for the overlay. */
  state: 'racing' | 'passing' | 'following' = 'racing';
  private readonly skill: (typeof DIFFICULTY)[Difficulty];
  /** 1 where the centreline sample is inside a wet patch. */
  private readonly wetAt: Uint8Array;

  constructor(
    private readonly track: Track,
    private readonly line: RacingLine,
    private readonly vehicle: Vehicle,
    readonly difficulty: Difficulty,
    readonly id: number,
  ) {
    this.skill = DIFFICULTY[difficulty];
    this.profile = new SpeedProfile(line, vehicle.config, { gripScale: this.skill.grip * (vehicle.config.ai?.gripScale ?? 1) });
    const hpPerTonne = carSpecsPower(vehicle) / (vehicle.config.chassis.mass / 1000);
    this.throttleRate = 2.2 * clamp(220 / hpPerTonne, 0.45, 1);
    this.wetAt = new Uint8Array(track.line.samples.map(s => (track.def.wetPatches.some(r => track.inRange(s.s, r)) ? 1 : 0)));
    vehicle.aids.abs = true;
    vehicle.aids.tc = true;
    // Stability control on for every AI: it catches the trail-braking snaps a human would correct by feel.
    vehicle.aids.esc = true;
    vehicle.powertrain.automatic = true;
  }

  /**
   * @param self      this car's race view
   * @param others    every other car
   * @param paceScale rubber-band multiplier on target speed (1 = none)
   */
  update(dt: number, self: CarView, others: CarView[], paceScale = 1): DriverInput {
    const v = this.vehicle;
    const t = this.track;
    const L = t.line;
    const n = L.samples.length;
    const pos = v.body.translation();
    const near = L.nearest(pos, this.tmp);
    const idx = near.index;
    const speed = Math.max(0, v.forwardSpeed);
    const half = t.def.width / 2 - 1.2;

    // ---------- Traffic ----------
    let avoidTarget = 0;
    let speedCap = Infinity;
    let yieldScale = 1;
    /** Deceleration needed to avoid running into a car ahead in our lane (m/s²). */
    let trafficDecel = 0;
    this.state = 'racing';
    const lookRange = 30 + speed * 1.2;
    // Overtakes are only started where the road ahead is nearly straight: a car 3+ m off the racing
    // line mid-corner is on a much tighter arc than its speed profile assumes, and spins.
    // Wet patches are no-passing zones too: off-line braking on a wet surface is how pile-ups start.
    let kAhead = 0, wetAhead = false;
    for (let d = 0; d < 30 + speed * 1.6; d += 4) {
      const j = (idx + Math.round(d / L.spacing)) % n;
      kAhead = Math.max(kAhead, Math.abs(this.line.curvature[j]));
      wetAhead ||= this.wetAt[j] === 1;
    }
    const canStartPass = kAhead < 1 / 180 && !wetAhead;
    for (const o of others) {
      const gap = o.raceDistance - self.raceDistance; // + = ahead of us
      if (gap < -8 || gap > lookRange) continue;
      const oIdx = L.indexAt(t.startS + (o.raceDistance % t.length));
      const myPathLat = this.line.offset[oIdx] + this.avoid;
      const dLat = o.lateral - myPathLat;
      if (gap > 4) {
        if (Math.abs(dLat) > 2.6) continue; // not in our path
        // Car ahead in our path: choose a side to pass on.
        const m = this.skill.passMargin;
        const candidates = [o.lateral - m, o.lateral + m].filter(c => Math.abs(c) <= half);
        const closing = speed - o.speed;
        const committed = Math.abs(this.avoid) > 1; // already alongside: finish the move
        // A stopped or crawling car (crash, spin) is driven around anywhere, not just on straights.
        const obstacle = o.speed < Math.max(8, speed * 0.45);
        if (candidates.length && (closing > -1 || gap < 15) && (canStartPass || committed || obstacle)) {
          const best = candidates.reduce((a, b) => (Math.abs(a - this.line.offset[oIdx]) < Math.abs(b - this.line.offset[oIdx]) ? a : b));
          const sideClear = !others.some(p => p !== o && Math.abs(p.raceDistance - o.raceDistance) < 10 && Math.abs(p.lateral - best) < SIDE_GAP);
          if (sideClear) {
            avoidTarget = best - this.line.offset[idx];
            this.state = 'passing';
            continue;
          }
        }
        // No room: hang back at a safe gap, matched to the car ahead, braking for it if it brakes.
        speedCap = Math.min(speedCap, o.speed + (gap - 9) * 0.6);
        const room = gap - 8; // ~3.5 m bumper to bumper
        if (speed > o.speed) trafficDecel = Math.max(trafficDecel, room > 0.5 ? (speed * speed - o.speed * o.speed) / (2 * room) : 20);
        this.state = 'following';
      } else if (Math.abs(gap) <= 5) {
        // Alongside: keep at least SIDE_GAP between centres (≈ 0.9 m between bodies).
        const sep = self.lateral - o.lateral;
        if (Math.abs(sep) < SIDE_GAP + 0.4) avoidTarget += Math.sign(sep || 1) * (SIDE_GAP + 0.4 - Math.abs(sep)) * 1.6;
        // The car slightly behind yields before a corner, so two cars don't arrive side by side.
        if (gap > 0 && Math.abs(sep) < SIDE_GAP + 1) yieldScale = 0.96;
      }
    }
    // Race start: hold the grid lane for the first 150 m, then release onto the line over the next
    // 150 m, so the two grid columns don't all merge into each other with their tyres spinning.
    this.startLateral ??= near.lateral;
    const launch = 1 - clamp((self.raceDistance - 150) / 150, 0, 1);
    if (launch > 0) avoidTarget += (this.startLateral - this.line.offset[idx]) * launch;
    // Avoid offset moves smoothly (≈ 3 m/s), and the total stays inside the usable width.
    const lineOff = this.line.offset[idx];
    avoidTarget = clamp(avoidTarget, -half - lineOff, half - lineOff);
    this.avoid = approach(this.avoid, avoidTarget, (avoidTarget === 0 ? 1.5 : 3.0) * dt);

    // ---------- Steering: pure pursuit ----------
    // Lookahead grows with speed: short enough to hold the line in slow corners, long enough to stay
    // well-damped at 250+ km/h.
    const look = clamp(6 + speed * 0.45, 8, 50);
    const j = (idx + Math.round(look / L.spacing)) % n;
    const sj = L.samples[j];
    const off = clamp(this.line.offset[j] + this.avoid, -half, half);
    const tx = sj.pos.x + sj.right.x * off, tz = sj.pos.z + sj.right.z * off;
    const q = v.body.rotation();
    this.fwd.set(0, 0, -1).applyQuat(q);
    this.right.set(1, 0, 0).applyQuat(q);
    const dx = tx - pos.x, dz = tz - pos.z;
    const ahead = dx * this.fwd.x + dz * this.fwd.z;
    const side = dx * this.right.x + dz * this.right.z;
    const alpha = Math.atan2(side, Math.max(ahead, 0.1));
    const dist = Math.hypot(dx, dz);
    // Pure pursuit: curvature 2·sin α / L, road-wheel angle from the bicycle model.
    const delta = Math.atan((2 * Math.sin(alpha) * v.config.geometry.wheelbase) / Math.max(dist, 1));
    const s = v.config.steering;
    const limit = (s.maxAngleDeg * DEG) / (1 + speed * s.speedSensitivity);
    // Countersteer against a real slide (beyond ~2°), stronger as the slide grows, and damp yaw
    // against the yaw rate the line itself calls for (v·κ), which removes weaving on straights.
    const slip = v.bodySlip;
    const slide = Math.sign(slip) * Math.max(0, Math.abs(slip) - 0.035);
    const yawErr = v.yawRate - speed * this.line.curvature[idx];
    const steer = clamp(delta / limit - slide * (1 + Math.min(2, Math.abs(slide) * 8)) - yawErr * 0.12, -1, 1);

    // ---------- Speed ----------
    // Extra caution while off the racing line by more than the line allows (passing, recovering).
    const caution = (Math.abs(near.lateral - this.line.offset[idx]) > 3 ? 0.94 : 1) * yieldScale;
    const targetAt = (d: number) => Math.min(this.profile.speed[(idx + Math.round(d / L.spacing)) % n] * paceScale * caution, speedCap);
    // Braking: the deceleration needed to meet the profile at any point ahead, a = (v² − vₜ²) / 2d.
    // Braking exactly that hard (not flat out) keeps grip in reserve for turning while trail-braking.
    // `lookahead` (reaction time, s) shifts how early the driver starts reacting.
    const react = speed * this.skill.lookahead;
    let aReq = 0;
    const brakeDist = 12 + (speed * speed) / (2 * this.profile.brakeDecel * 0.75);
    for (let d = 4; d < brakeDist; d += 4) {
      const vt = targetAt(d + react);
      aReq = Math.max(aReq, (speed * speed - vt * vt) / (2 * d));
    }
    aReq = Math.max(aReq, trafficDecel);
    const target = targetAt(react + 2);
    const input = neutralInput();
    input.steer = steer;
    if (aReq > 0.6) {
      input.brake = clamp((aReq / this.profile.brakeDecel) * 1.1, 0.05, 1);
    } else {
      const err = target - speed;
      if (err > 0.4) input.throttle = clamp(0.45 + err * 0.35, 0, 1);
      else if (err < -1.5) input.brake = clamp(-err * 0.1, 0, 0.5);
      else input.throttle = 0.3;
    }
    // Throttle feel: cap power when the driven tyres pass their peak slip or the car starts to yaw,
    // and feed it in at a limited rate. This is what keeps 1,000 hp cars pointing forwards.
    let drivenSlip = 0;
    for (const w of v.wheels) if (w.driveShare > 0 && w.grounded) drivenSlip = Math.max(drivenSlip, w.slipRatio / w.tire.peakSlipRatio);
    // Keep driven-wheel slip *below* the peak: past it the tyre has little lateral grip left, and a
    // high-torque car then swaps ends at the first steering input.
    let cap = drivenSlip > 0.8 ? clamp(1 - (drivenSlip - 0.8) * 1.5, 0.15, 1) : 1;
    cap *= clamp(1 - (Math.abs(slip) - 0.04) * 5, 0.15, 1);
    const wanted = Math.min(input.throttle, cap);
    this.throttle = approach(this.throttle, wanted, (wanted > this.throttle ? this.throttleRate : 10) * dt);
    input.throttle = this.throttle;

    // ---------- Stuck / wrong-way detection ----------
    const tang = L.samples[idx].tangent;
    const facing = this.fwd.x * tang.x + this.fwd.z * tang.z;
    this.stuckTime = speed < 1.5 || facing < -0.2 ? this.stuckTime + dt : 0;
    this.needsRecovery = this.stuckTime > 3;
    return input;
  }

  resetAfterRecovery(): void {
    this.stuckTime = 0;
    this.needsRecovery = false;
    this.avoid = 0;
    this.throttle = 0;
  }
}
