import { Surface } from '../physics/surfaces';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { clamp, type V3 } from '../core/math';
import { CenterLine } from './spline';
import type { Side, TrackDef, TrackPos, TrackRange } from './types';

/**
 * A built track: the centreline, every generated mesh (as plain arrays: headless-safe), and
 * gameplay data (grid, checkpoints, sectors). Physics and rendering both consume this.
 */

export type MeshLayer = 'road' | 'roadWet' | 'curb' | 'grass' | 'gravel' | 'runoffAsphalt' | 'barrier' | 'terrain';

export interface MeshData {
  positions: number[];
  uvs: number[];
  indices: number[];
}

const LAYER_SURFACE: Record<MeshLayer, Surface> = {
  road: Surface.Asphalt,
  roadWet: Surface.Wet,
  curb: Surface.Curb,
  grass: Surface.Grass,
  gravel: Surface.Gravel,
  runoffAsphalt: Surface.Asphalt,
  barrier: Surface.Asphalt,
  terrain: Surface.Grass,
};

const SURFACE_LAYER: Partial<Record<Surface, MeshLayer>> = {
  [Surface.Grass]: 'grass',
  [Surface.Gravel]: 'gravel',
  [Surface.Asphalt]: 'runoffAsphalt',
};

export interface GridSlot {
  position: V3;
  yaw: number;
}

const BARRIER_HEIGHT = 1.1;
const BARRIER_THICKNESS = 0.35;

export class Track {
  readonly line: CenterLine;
  readonly meshes = new Map<MeshLayer, MeshData>();
  readonly startS: number;
  /** Sector boundaries as distances *from the start line* (0 < d < length), ascending. */
  readonly sectorOffsets: number[];
  /** Checkpoint distances from the start line. Checkpoint 0 is the line itself. */
  readonly checkpointOffsets: number[];
  readonly grid: GridSlot[];
  /** Per-sample barrier lateral offsets (+ right), or NaN where there is no barrier. */
  readonly barrierLeft: number[] = [];
  readonly barrierRight: number[] = [];
  /** Per-sample curb flags, for visuals and AI. */
  readonly curbLeft: boolean[] = [];
  readonly curbRight: boolean[] = [];
  private readonly cpS: number[] = [];
  readonly terrain: { half: number; step: number; centerX: number; centerZ: number; res: number };

  constructor(readonly def: TrackDef) {
    this.line = new CenterLine(def.controlPoints, 2);

    // Arc length of each control point = arc length of its nearest resampled point.
    const tmp = { index: 0, lateral: 0, distSq: 0 };
    for (const cp of def.controlPoints) this.cpS.push(this.line.samples[this.line.nearest(cp, tmp).index].s);

    this.startS = this.resolve(def.startLine);
    this.sectorOffsets = def.sectors.map(p => this.line.wrap(this.resolve(p) - this.startS)).sort((a, b) => a - b);
    this.checkpointOffsets = Array.from({ length: def.checkpointCount }, (_, i) => (this.line.length * i) / def.checkpointCount);

    // Start grid: two staggered columns behind the line, 8 m apart along the track.
    this.grid = Array.from({ length: 8 }, (_, i) => {
      const smp = this.line.sampleAt(this.startS - 12 - i * 8);
      const lat = i % 2 === 0 ? -2.8 : 2.8;
      return {
        position: { x: smp.pos.x + smp.right.x * lat, y: smp.pos.y, z: smp.pos.z + smp.right.z * lat },
        // Rotating local −Z by yaw θ about +Y gives (−sin θ, 0, −cos θ); solve for the tangent.
        yaw: Math.atan2(-smp.tangent.x, -smp.tangent.z),
      };
    });

    const half = def.scenery.terrainHalfSize;
    const xs = this.line.samples.map(s => s.pos.x), zs = this.line.samples.map(s => s.pos.z);
    this.terrain = {
      half, step: 10,
      centerX: (Math.min(...xs) + Math.max(...xs)) / 2,
      centerZ: (Math.min(...zs) + Math.max(...zs)) / 2,
      res: Math.round((half * 2) / 10),
    };

    this.buildSurfaces();
    this.buildTerrain();
  }

  /** Convert a TrackPos to a wrapped arc length. */
  resolve(p: TrackPos): number {
    if (typeof p === 'number') return this.line.wrap(p);
    return this.line.wrap(this.cpS[p.cp] + (p.offset ?? 0));
  }

  get length(): number { return this.line.length; }

  /** Is arc length s inside a (possibly wrapping) range? */
  inRange(s: number, r: TrackRange): boolean {
    const a = this.resolve(r.from), b = this.resolve(r.to);
    return a <= b ? s >= a && s <= b : s >= a || s <= b;
  }

  private layer(name: MeshLayer): MeshData {
    let m = this.meshes.get(name);
    if (!m) this.meshes.set(name, (m = { positions: [], uvs: [], indices: [] }));
    return m;
  }

  /**
   * Build the track's cross-section layers as ribbons along the centreline.
   *
   * Each layer is described per sample by a *profile*: a list of (lateral offset, height offset, u)
   * points ordered left → right across the top surface. Consecutive samples are joined by quads.
   * Ordering left → right makes every top face point up and every wall face outward from the
   * section, without any per-case winding logic.
   */
  private buildSurfaces(): void {
    const def = this.def;
    const line = this.line;
    const n = line.samples.length;
    const hw = def.width / 2;
    const cw = def.curbs.width;
    const ch = def.curbs.height;

    // --- Per-sample layout decisions ---
    const shoulder: Record<'left' | 'right', { width: number; layer: MeshLayer }[]> = { left: [], right: [] };
    for (let i = 0; i < n; i++) {
      const smp = line.samples[i];
      const k = smp.curvature;
      // Max usable lateral distance on the inside of a corner before the offset curve folds over itself.
      const insideLimit = Math.abs(k) > 1e-4 ? 0.8 / Math.abs(k) : Infinity;
      for (const side of ['left', 'right'] as const) {
        const inside = (side === 'right') === (k > 0);
        let width = def.shoulderWidth;
        let layer: MeshLayer = 'grass';
        for (const r of def.runoff) {
          if ((r.side === side || r.side === 'both') && this.inRange(smp.s, r)) {
            width = r.width;
            layer = SURFACE_LAYER[r.surface] ?? 'grass';
          }
        }
        if (inside) width = Math.min(width, Math.max(1, insideLimit - hw));
        shoulder[side].push({ width, layer });

        let barrier = hw + Math.max(def.barrierOffset, width + 2);
        if (inside && barrier > insideLimit) barrier = insideLimit;
        (side === 'left' ? this.barrierLeft : this.barrierRight).push(barrier < hw + 4 ? NaN : barrier);
      }
      // Curbs: inside of any meaningful corner; outside of tight ones.
      const ak = Math.abs(k);
      const curbInside = ak > def.curbs.minCurvature;
      const curbOutside = ak > def.curbs.outsideCurvature;
      this.curbRight.push(k > 0 ? curbInside : curbOutside);
      this.curbLeft.push(k < 0 ? curbInside : curbOutside);
    }
    // Extend curb runs a few samples each way so they start before turn-in and end after the exit.
    for (const arr of [this.curbLeft, this.curbRight]) {
      const src = arr.slice();
      for (let i = 0; i < n; i++) if (src[i]) for (let d = -6; d <= 6; d++) arr[(i + d + n) % n] = true;
    }
    // Smooth barrier offsets so inside-of-corner clamps don't produce jagged walls.
    for (const arr of [this.barrierLeft, this.barrierRight]) {
      const src = arr.slice();
      for (let i = 0; i < n; i++) {
        if (Number.isNaN(src[i])) continue;
        let m = src[i];
        for (let d = -4; d <= 4; d++) { const v = src[(i + d + n) % n]; if (!Number.isNaN(v)) m = Math.min(m, v); }
        arr[i] = m;
      }
    }

    const wet = (s: number) => def.wetPatches.some(r => this.inRange(s, r));

    // --- Layers ---
    type Profile = [lateral: number, dy: number, u: number][];
    const ribbon = (
      pick: (i: number) => MeshLayer | null,
      profile: (i: number) => Profile,
      vScale: number,
    ) => {
      let prevLayer: MeshLayer | null = null;
      let prevRing = -1;
      for (let i = 0; i < n; i++) {
        const layer = pick(i);
        if (!layer) { prevLayer = null; continue; }
        const mesh = this.layer(layer);
        const ringA = prevLayer === layer && prevRing >= 0 ? prevRing : this.pushRing(mesh, i, profile(i), vScale, i);
        // The ring at i+1 uses the profile of sample i+1 but continues v past the seam on wrap.
        const ringB = this.pushRing(mesh, (i + 1) % n, profile((i + 1) % n), vScale, i + 1);
        const pts = profile(i).length;
        for (let p = 0; p < pts - 1; p++) {
          const a = ringA + p, b = ringA + p + 1, c = ringB + p, d = ringB + p + 1;
          mesh.indices.push(a, b, c, b, d, c);
        }
        prevLayer = layer;
        prevRing = ringB;
      }
    };

    // Road (u: 0 at the left edge, 1 at the right edge).
    ribbon(i => (wet(line.samples[i].s) ? 'roadWet' : 'road'), () => [[-hw, 0, 0], [-hw / 2, 0, 0.25], [0, 0, 0.5], [hw / 2, 0, 0.75], [hw, 0, 1]], 1 / def.width);

    // Curbs: sloped strip outside the road edge, with a small vertical lip on the outer edge.
    ribbon(i => (this.curbRight[i] ? 'curb' : null), () => [[hw, 0.005, 0], [hw + cw * 0.6, ch * 0.7, 0.6], [hw + cw, ch, 1], [hw + cw, -0.05, 1]], 1 / 2);
    ribbon(i => (this.curbLeft[i] ? 'curb' : null), () => [[-hw - cw, -0.05, 1], [-hw - cw, ch, 1], [-hw - cw * 0.6, ch * 0.7, 0.6], [-hw, 0.005, 0]], 1 / 2);

    // Shoulders / runoff: slightly below the road, dropping at the outer edge to meet the terrain.
    ribbon(i => shoulder.right[i].layer, i => {
      const w = shoulder.right[i].width;
      return [[hw - 0.2, -0.02, 0], [hw + w * 0.8, -0.06, 0.8], [hw + w, -0.35, 1]];
    }, 1 / 10);
    ribbon(i => shoulder.left[i].layer, i => {
      const w = shoulder.left[i].width;
      return [[-hw - w, -0.35, 1], [-hw - w * 0.8, -0.06, 0.8], [-hw + 0.2, -0.02, 0]];
    }, 1 / 10);

    // Barriers: a thin wall (inner face, top, outer face). Gaps where the clamp removed them.
    const T = BARRIER_THICKNESS, H = BARRIER_HEIGHT;
    ribbon(i => (Number.isNaN(this.barrierRight[i]) || Number.isNaN(this.barrierRight[(i + 1) % n]) ? null : 'barrier'),
      i => { const L = this.barrierRight[i]; return [[L, -0.4, 0], [L, H, 0.45], [L + T, H, 0.55], [L + T, -0.4, 1]]; }, 1 / 4);
    ribbon(i => (Number.isNaN(this.barrierLeft[i]) || Number.isNaN(this.barrierLeft[(i + 1) % n]) ? null : 'barrier'),
      i => { const L = -this.barrierLeft[i]; return [[L - T, -0.4, 0], [L - T, H, 0.45], [L, H, 0.55], [L, -0.4, 1]]; }, 1 / 4);
  }

  /** Push one cross-section ring of vertices; returns the index of its first vertex. */
  private pushRing(mesh: MeshData, i: number, profile: [number, number, number][], vScale: number, vIndex: number): number {
    const smp = this.line.samples[i];
    const start = mesh.positions.length / 3;
    const v = vIndex * this.line.spacing * vScale;
    for (const [lat, dy, u] of profile) {
      mesh.positions.push(smp.pos.x + smp.right.x * lat, smp.pos.y + dy, smp.pos.z + smp.right.z * lat);
      mesh.uvs.push(u, v);
    }
    return start;
  }

  /**
   * Terrain height: hugs the track (just under the shoulders) near the circuit, and blends to rolling
   * procedural hills further out, so elevation changes look like they belong to the landscape.
   */
  heightAt(x: number, z: number): number {
    const sc = this.def.scenery;
    const hills = sc.baseHeight +
      sc.hillAmplitude * (0.5 * Math.sin(x * 0.0041 + 1.3) * Math.cos(z * 0.0035 - 0.4) +
        0.3 * Math.sin((x + z) * 0.0093) + 0.2 * Math.cos((x - z * 0.7) * 0.017));
    const near = this.line.nearest({ x, y: 0, z }, this.nearestTmp, false);
    if (near.index < 0) return hills; // far from the circuit
    const d = Math.sqrt(near.distSq);
    const smp = this.line.samples[near.index];
    const inner = this.def.width / 2 + this.def.shoulderWidth + 6;
    const t = clamp((d - inner) / 90, 0, 1);
    const blend = t * t * (3 - 2 * t); // smoothstep
    return smp.pos.y - 0.4 + (hills - (smp.pos.y - 0.4)) * blend;
  }
  private readonly nearestTmp = { index: 0, lateral: 0, distSq: 0 };

  private buildTerrain(): void {
    const { half, step, centerX, centerZ, res } = this.terrain;
    const mesh = this.layer('terrain');
    for (let r = 0; r <= res; r++) {
      for (let c = 0; c <= res; c++) {
        const x = centerX - half + c * step, z = centerZ - half + r * step;
        mesh.positions.push(x, this.heightAt(x, z), z);
        mesh.uvs.push(x / 12, z / 12);
      }
    }
    const row = res + 1;
    for (let r = 0; r < res; r++) {
      for (let c = 0; c < res; c++) {
        const a = r * row + c, b = a + 1, d = a + row, e = d + 1;
        // Top-facing winding: (a, d, b) has normal +Y for x right / z down rows.
        mesh.indices.push(a, d, b, b, d, e);
      }
    }
  }

  /** Lateral side helper for props. */
  static sideSign(side: Side): number[] {
    return side === 'both' ? [-1, 1] : side === 'left' ? [-1] : [1];
  }

  /** Create all static colliders for this track. */
  buildPhysics(physics: PhysicsWorld): void {
    for (const [layer, mesh] of this.meshes) {
      if (mesh.indices.length === 0) continue;
      physics.addStaticTrimesh(new Float32Array(mesh.positions), new Uint32Array(mesh.indices), LAYER_SURFACE[layer],
        layer === 'barrier' ? 0.25 : 0.9);
    }
  }
}
