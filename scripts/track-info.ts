/**
 * Prints a track's built geometry stats and checks gameplay data (headless).
 *   npx tsx scripts/track-info.ts
 */
import { Track } from '../src/tracks/Track';
import { kestrelValley } from '../src/tracks/circuits/kestrelValley';

const t0 = performance.now();
const track = new Track(kestrelValley);
const ms = performance.now() - t0;
const L = track.length;
console.log(`${track.def.name}: ${L.toFixed(0)} m, ${track.line.samples.length} samples, built in ${ms.toFixed(0)} ms`);
const ys = track.line.samples.map(s => s.pos.y);
console.log(`elevation ${Math.min(...ys).toFixed(1)}..${Math.max(...ys).toFixed(1)} m`);
const radii = track.line.samples.map(s => Math.abs(s.curvature)).sort((a, b) => b - a);
console.log(`tightest radius ${(1 / radii[0]).toFixed(1)} m`);
let straight = 0, best = 0;
for (const s of track.line.samples.concat(track.line.samples)) {
  straight = Math.abs(s.curvature) < 1 / 1500 ? straight + track.line.spacing : 0;
  best = Math.max(best, straight);
}
console.log(`longest straight ${best.toFixed(0)} m`);
console.log(`start ${track.startS.toFixed(0)}  sectors ${track.sectorOffsets.map(v => v.toFixed(0)).join(', ')}`);
for (const [k, m] of track.meshes) console.log(`  ${k.padEnd(14)} ${(m.positions.length / 3).toString().padStart(7)} verts ${(m.indices.length / 3).toString().padStart(7)} tris`);
const nanBarrier = track.barrierLeft.filter(Number.isNaN).length + track.barrierRight.filter(Number.isNaN).length;
console.log(`barrier gaps (samples) ${nanBarrier}`);
const g = track.grid[0];
console.log(`pole slot ${JSON.stringify(g.position)} yaw ${(g.yaw * 57.3).toFixed(1)}°`);
