import { clamp, MS_TO_KMH, RPM_TO_RAD, sampleCurve } from '../core/math';
import type { Track } from '../tracks/Track';
import type { CarConfig } from '../vehicles/types';
import { SURFACES, Surface } from '../physics/surfaces';

const G = 9.81;
const AIR = 1.225;

/**
 * A racing line around a track: per centreline sample, a lateral offset (+ right) and the line's
 * world position and curvature. Headless-safe and shared by all AI cars.
 *
 * Built with a K1999-style curvature relaxation (after Rémi Coulom's well-known method; technique
 * only): starting from the centreline, each point is moved along its lateral axis until the
 * curvature through it equals the average of its neighbours' curvatures, clamped to the usable
 * width. Repeated with progressively finer neighbour spans, this spreads each corner's turning
 * over the longest possible arc, giving the classic wide entry, late apex and wide exit.
 * (A simple "pull toward neighbours' midpoint" minimises length instead, and hugs the inside of
 * hairpins at a tighter radius than necessary.)
 */
export class RacingLine {
  /** Lateral offset of the line from the centreline at each sample (m, + = right). */
  readonly offset: Float64Array;
  /** Line positions (x, z) and signed curvature (1/m, + = right turn) at each sample. */
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly curvature: Float64Array;
  readonly n: number;

  constructor(readonly track: Track, opts: { margin?: number; iterations?: number } = {}) {
    const line = track.line;
    const n = (this.n = line.samples.length);
    const margin = opts.margin ?? 1.6;
    const half = track.def.width / 2 - margin;
    this.offset = new Float64Array(n);
    this.x = new Float64Array(n);
    this.z = new Float64Array(n);
    this.curvature = new Float64Array(n);
    const off = this.offset;
    const S = line.samples;

    const px = (i: number) => S[i].pos.x + S[i].right.x * off[i];
    const pz = (i: number) => S[i].pos.z + S[i].right.z * off[i];
    /** Signed curvature of the circle through three points (Menger curvature). */
    const menger = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => {
      const cross = (bx - ax) * (cz - bz) - (bz - az) * (cx - bx);
      const d = Math.hypot(bx - ax, bz - az) * Math.hypot(cx - bx, cz - bz) * Math.hypot(cx - ax, cz - az);
      return d > 1e-9 ? (2 * cross) / d : 0;
    };
    const w = (i: number) => ((i % n) + n) % n;
    for (const span of [24, 16, 10, 6, 3, 2, 1]) {
      for (let it = 0; it < (opts.iterations ?? 60); it++) {
        for (let i = 0; i < n; i++) {
          const ip = w(i - span), inx = w(i + span);
          const kPrev = menger(px(w(ip - span)), pz(w(ip - span)), px(ip), pz(ip), px(i), pz(i));
          const kNext = menger(px(i), pz(i), px(inx), pz(inx), px(w(inx + span)), pz(w(inx + span)));
          const target = (kPrev + kNext) / 2;
          // Linearise curvature vs lateral offset with a small probe, then solve for the target.
          const k0 = menger(px(ip), pz(ip), px(i), pz(i), px(inx), pz(inx));
          const eps = 0.05;
          const x1 = px(i) + S[i].right.x * eps, z1 = pz(i) + S[i].right.z * eps;
          const k1 = menger(px(ip), pz(ip), x1, z1, px(inx), pz(inx));
          if (Math.abs(k1 - k0) < 1e-9) continue;
          const d = ((target - k0) * eps) / (k1 - k0);
          off[i] = clamp(off[i] + clamp(d, -0.5, 0.5), -half, half);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      this.x[i] = S[i].pos.x + S[i].right.x * off[i];
      this.z[i] = S[i].pos.z + S[i].right.z * off[i];
    }
    // Curvature from heading change over ±2 samples, lightly smoothed.
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = (i - 2 + n) % n, q = (i + 2) % n;
      const h0 = Math.atan2(this.x[i] - this.x[p], -(this.z[i] - this.z[p]));
      const h1 = Math.atan2(this.x[q] - this.x[i], -(this.z[q] - this.z[i]));
      let d = h1 - h0;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      const len = Math.hypot(this.x[i] - this.x[p], this.z[i] - this.z[p]) + Math.hypot(this.x[q] - this.x[i], this.z[q] - this.z[i]);
      raw[i] = (2 * d) / Math.max(len, 1e-3);
    }
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -2; k <= 2; k++) acc += raw[(i + k + n) % n];
      this.curvature[i] = acc / 5;
    }
  }

  /** Total length of the racing line (m). */
  get length(): number {
    let L = 0;
    for (let i = 0; i < this.n; i++) {
      const j = (i + 1) % this.n;
      L += Math.hypot(this.x[j] - this.x[i], this.z[j] - this.z[i]);
    }
    return L;
  }
}

/**
 * Per-car speed profile along a racing line: the fastest speed at each sample that the car's
 * grip, downforce, power and brakes allow. Three passes:
 *   1. corner limit:  v²·κ = μ·(g + (c + κᵥ)·v²)   with c = ½ρ·ClA / m   (downforce adds grip with speed)
 *      and κᵥ the vertical curvature of the road: over a crest (κᵥ < 0) the car goes light and loses
 *      grip, in a dip (κᵥ > 0) it is pressed down and gains grip.
 *   2. backward pass: braking  v_i ≤ √(v_{i+1}² + 2·a_brake·ds)
 *   3. forward pass:  traction/power  v_i ≤ √(v_{i−1}² + 2·a_accel·ds)
 * Run twice around the closed loop so the start/finish seam is consistent.
 */
export class SpeedProfile {
  readonly speed: Float64Array;
  /** Peak braking deceleration on asphalt at low speed (m/s²), for the driver's brake control. */
  readonly brakeDecel: number;

  constructor(line: RacingLine, cfg: CarConfig, opts: { gripScale?: number } = {}) {
    const n = line.n;
    const ds = line.track.line.spacing;
    const m = cfg.chassis.mass;
    // Usable grip: tyre μ reduced for load sensitivity and weight transfer (calibrated against the
    // headless bench's max lateral g), scaled by AI skill.
    const muBase = Math.min(cfg.tires.front.muLat, cfg.tires.rear.muLat) * 0.84 * (opts.gripScale ?? 1);
    const muLong = Math.min(cfg.tires.front.muLong, cfg.tires.rear.muLong) * 0.84 * (opts.gripScale ?? 1);
    this.brakeDecel = muLong * G * 0.92;
    const c = (0.5 * AIR * cfg.aero.downforceArea) / m;
    const drag = (0.5 * AIR * cfg.aero.dragArea) / m;
    const vTop = topSpeed(cfg);
    const drivenShare = cfg.drivetrain.layout === 'AWD' ? 1 : cfg.drivetrain.layout === 'FWD' ? cfg.chassis.weightFront : 1 - cfg.chassis.weightFront;
    const peakPower = maxPower(cfg) * cfg.gearbox.efficiency;

    // Vertical curvature d²y/ds² from the centreline elevation (smoothed over ±8 m).
    const S = line.track.line.samples;
    const kv = new Float64Array(n);
    const h = 4;
    for (let i = 0; i < n; i++) {
      const y0 = S[(i - h + n) % n].pos.y, y1 = S[i].pos.y, y2 = S[(i + h) % n].pos.y;
      kv[i] = (y0 - 2 * y1 + y2) / ((h * ds) ** 2);
    }
    // Corner limit uses the tightest curvature in a window around each point (10 m back, 18 m
    // ahead): margin for tracking error and for direction changes in S-bends, where the car must
    // unload one side before it can load the other.
    const back = Math.round(10 / ds), fwd = Math.round(18 / ds);
    const kWin = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let d = -back; d <= fwd; d++) m = Math.max(m, Math.abs(line.curvature[(i + d + n) % n]));
      kWin[i] = m;
    }
    // Surface grip under the racing line (wet patches).
    const wetGrip = SURFACES[Surface.Wet].gripMul * (cfg.tires.surfaceGrip?.[Surface.Wet] ?? 1);
    const surfGrip = (i: number) => (line.track.def.wetPatches.some(r => line.track.inRange(S[i].s, r)) ? wetGrip : 1);
    const v = (this.speed = new Float64Array(n));
    for (let i = 0; i < n; i++) {
      const k = kWin[i];
      const mu = muBase * surfGrip(i);
      // Crests count fully, dips only half (being pressed down is less reliable than going light).
      const denom = k - mu * (c + Math.min(kv[i], 0) + Math.max(kv[i], 0) * 0.5);
      v[i] = denom <= 1e-6 ? vTop : Math.min(vTop, Math.sqrt((mu * G) / denom));
    }
    for (let pass = 0; pass < 2; pass++) {
      // Braking (backward): longitudinal grip left after cornering (friction circle), plus drag.
      for (let j = 2 * n - 1; j >= 0; j--) {
        const i = j % n, nx = (i + 1) % n;
        const vn = v[nx];
        const latA = vn * vn * Math.abs(line.curvature[nx]);
        const total = muLong * surfGrip(nx) * (G + c * vn * vn);
        const brakeA = Math.sqrt(Math.max(0, total * total - latA * latA)) * 0.92 + drag * vn * vn;
        v[i] = Math.min(v[i], Math.sqrt(vn * vn + 2 * brakeA * ds));
      }
      // Acceleration (forward): limited by driven-wheel traction and engine power, minus drag.
      for (let j = 0; j < 2 * n; j++) {
        const i = j % n, pv = (i - 1 + n) % n;
        const vp = Math.max(v[pv], 1);
        const latA = vp * vp * Math.abs(line.curvature[pv]);
        const total = muLong * surfGrip(pv) * drivenShare * (G + c * vp * vp);
        const traction = Math.sqrt(Math.max(0, total * total - latA * latA));
        const power = peakPower / (m * vp) * 0.85;
        const acc = Math.max(0, Math.min(traction, power) - drag * vp * vp);
        v[i] = Math.min(v[i], Math.sqrt(v[pv] * v[pv] + 2 * acc * ds));
      }
    }
  }

  /** Predicted lap time along the line (s), for reference. */
  lapTime(line: RacingLine): number {
    let t = 0;
    for (let i = 0; i < line.n; i++) {
      const j = (i + 1) % line.n;
      t += Math.hypot(line.x[j] - line.x[i], line.z[j] - line.z[i]) / Math.max(1, (this.speed[i] + this.speed[j]) / 2);
    }
    return t;
  }
}

function maxPower(cfg: CarConfig): number {
  let p = 0;
  for (let rpm = cfg.engine.idleRpm; rpm <= cfg.engine.limiterRpm; rpm += 100) p = Math.max(p, sampleCurve(cfg.engine.torqueCurve, rpm) * rpm * RPM_TO_RAD);
  return p;
}

/** Gear-limited top speed (m/s), with a small margin below the limiter. */
function topSpeed(cfg: CarConfig): number {
  const R = cfg.drivetrain.layout === 'FWD' ? cfg.wheels.front.radius : cfg.wheels.rear.radius;
  const top = cfg.gearbox.ratios[cfg.gearbox.ratios.length - 1] * cfg.gearbox.finalDrive;
  const gearLimited = ((cfg.engine.limiterRpm * 0.97 * RPM_TO_RAD) / top) * R;
  // Drag-limited: P = ½ρ·CdA·v³
  const dragLimited = Math.cbrt((2 * maxPower(cfg) * cfg.gearbox.efficiency * 0.9) / (AIR * cfg.aero.dragArea));
  return Math.min(gearLimited, dragLimited, 400 / MS_TO_KMH);
}
