import { Vec3, type V3 } from '../core/math';

/** One evenly spaced sample along a track centreline. */
export interface TrackSample {
  /** Distance from the start of the spline (m). */
  s: number;
  pos: Vec3;
  /** Unit tangent (direction of travel). */
  tangent: Vec3;
  /** Unit vector to the driver's right, kept horizontal (no banking in Phase 1). */
  right: Vec3;
  /** Signed horizontal curvature (1/m). + = turning right. */
  curvature: number;
}

/**
 * Closed centripetal Catmull-Rom spline, resampled at a fixed spacing.
 *
 * Centripetal parameterisation (α = 0.5) avoids the cusps and self-intersections that the uniform
 * variant produces when control points are unevenly spaced, which hand-placed track points always are.
 * The spline is first densely evaluated, then resampled by arc length so that `samples[i].s = i · spacing`.
 */
export class CenterLine {
  readonly samples: TrackSample[] = [];
  readonly length: number;
  readonly spacing: number;
  /** Uniform grid of sample indices for fast nearest-point queries. */
  private readonly grid = new Map<string, number[]>();
  private static readonly CELL = 40;

  constructor(controlPoints: readonly V3[], spacing = 2) {
    const dense = evaluateClosedCatmullRom(controlPoints, 40);
    // Arc-length table over the dense polyline.
    const cum = [0];
    for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + distance(dense[i - 1], dense[i]));
    const total = cum[cum.length - 1] + distance(dense[dense.length - 1], dense[0]);
    const n = Math.round(total / spacing);
    this.spacing = total / n;
    this.length = total;

    let j = 0;
    for (let i = 0; i < n; i++) {
      const s = i * this.spacing;
      while (j < dense.length - 1 && cum[j + 1] < s) j++;
      const a = dense[j], b = dense[(j + 1) % dense.length];
      const segLen = (j + 1 < cum.length ? cum[j + 1] : total) - cum[j];
      const t = segLen > 0 ? (s - cum[j]) / segLen : 0;
      const pos = new Vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      this.samples.push({ s, pos, tangent: new Vec3(), right: new Vec3(), curvature: 0 });
    }

    // Tangents by central difference; right = tangent × up, flattened to horizontal.
    for (let i = 0; i < n; i++) {
      const prev = this.samples[(i - 1 + n) % n].pos, next = this.samples[(i + 1) % n].pos;
      const smp = this.samples[i];
      smp.tangent.copy(next).sub(prev).normalize();
      smp.right.set(-smp.tangent.z, 0, smp.tangent.x).normalize();
    }
    // Curvature: change in heading per metre, smoothed over a few samples to suppress spline wiggle.
    const raw: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = this.samples[(i - 2 + n) % n].tangent, b = this.samples[(i + 2) % n].tangent;
      const h0 = Math.atan2(a.x, -a.z), h1 = Math.atan2(b.x, -b.z);
      raw.push(wrapAngle(h1 - h0) / (4 * this.spacing));
    }
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -3; k <= 3; k++) acc += raw[(i + k + n) % n];
      this.samples[i].curvature = acc / 7;
    }

    this.samples.forEach((smp, i) => {
      const key = this.cellKey(smp.pos.x, smp.pos.z);
      let list = this.grid.get(key);
      if (!list) this.grid.set(key, (list = []));
      list.push(i);
    });
  }

  private cellKey(x: number, z: number): string {
    return `${Math.floor(x / CenterLine.CELL)},${Math.floor(z / CenterLine.CELL)}`;
  }

  /** Sample index at arc length s (wraps). */
  indexAt(s: number): number {
    const n = this.samples.length;
    return ((Math.round(s / this.spacing) % n) + n) % n;
  }

  sampleAt(s: number): TrackSample {
    return this.samples[this.indexAt(s)];
  }

  /** Wrap a distance into [0, length). */
  wrap(s: number): number {
    return ((s % this.length) + this.length) % this.length;
  }

  /**
   * Nearest sample to a world position, by horizontal distance. Searches neighbouring grid cells,
   * widening up to ~200 m; beyond that it falls back to a full scan, or returns index −1 when
   * `globalFallback` is false. Returns the index and the signed lateral offset (+ = right of centre).
   */
  nearest(p: V3, out: { index: number; lateral: number; distSq: number }, globalFallback = true): typeof out {
    let best = -1, bestD = Infinity;
    const cx = Math.floor(p.x / CenterLine.CELL), cz = Math.floor(p.z / CenterLine.CELL);
    // Grow the searched square until it provably contains the nearest sample: a block of radius r
    // cells covers every point within r·CELL metres, so stop once the best match is that close.
    for (let r = 1; r <= 5; r++) {
      if (best >= 0 && Math.sqrt(bestD) <= (r - 1) * CenterLine.CELL) break;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r && r > 1) continue; // only the new outer ring
        const list = this.grid.get(`${cx + dx},${cz + dz}`);
        if (!list) continue;
        for (const i of list) {
          const q = this.samples[i].pos;
          const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
          if (d < bestD) { bestD = d; best = i; }
        }
      }
    }
    if (best < 0 && !globalFallback) {
      out.index = -1; out.distSq = Infinity; out.lateral = 0;
      return out;
    }
    if (best < 0) {
      this.samples.forEach((smp, i) => {
        const d = (smp.pos.x - p.x) ** 2 + (smp.pos.z - p.z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      });
    }
    const smp = this.samples[best];
    out.index = best;
    out.distSq = bestD;
    out.lateral = (p.x - smp.pos.x) * smp.right.x + (p.z - smp.pos.z) * smp.right.z;
    return out;
  }
}

function evaluateClosedCatmullRom(pts: readonly V3[], perSegment: number): V3[] {
  const out: V3[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    // Centripetal knot spacing: t_{k+1} = t_k + |P_{k+1} − P_k|^0.5
    const t0 = 0;
    const t1 = t0 + Math.sqrt(distance(p0, p1));
    const t2 = t1 + Math.sqrt(distance(p1, p2));
    const t3 = t2 + Math.sqrt(distance(p2, p3));
    for (let k = 0; k < perSegment; k++) {
      const t = t1 + ((t2 - t1) * k) / perSegment;
      out.push(barryGoldman(p0, p1, p2, p3, t0, t1, t2, t3, t));
    }
  }
  return out;
}

/** Barry–Goldman pyramidal evaluation of a Catmull-Rom segment with arbitrary knots. */
function barryGoldman(p0: V3, p1: V3, p2: V3, p3: V3, t0: number, t1: number, t2: number, t3: number, t: number): V3 {
  const lerpP = (a: V3, b: V3, ta: number, tb: number): V3 => {
    const u = tb - ta < 1e-9 ? 0 : (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
  };
  const a1 = lerpP(p0, p1, t0, t1), a2 = lerpP(p1, p2, t1, t2), a3 = lerpP(p2, p3, t2, t3);
  const b1 = lerpP(a1, a2, t0, t2), b2 = lerpP(a2, a3, t1, t3);
  return lerpP(b1, b2, t1, t2);
}

const distance = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
