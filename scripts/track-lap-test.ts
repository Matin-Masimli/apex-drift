/**
 * Headless lap test: a simple pure-pursuit autopilot drives laps of a circuit with the full
 * vehicle sim, verifying the track is drivable (no snags or falls) and that lap timing works.
 *   npx tsx scripts/track-lap-test.ts [laps]
 */
import { initPhysics, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { Vehicle } from '../src/vehicles/Vehicle';
import { meridianGT } from '../src/vehicles/cars/meridianGT';
import { neutralInput } from '../src/vehicles/types';
import { Track } from '../src/tracks/Track';
import { LapTimer } from '../src/tracks/LapTimer';
import { kestrelValley } from '../src/tracks/circuits/kestrelValley';
import { clamp, MS_TO_KMH, Vec3 } from '../src/core/math';

const DT = 1 / 120;
await initPhysics();
const track = new Track(kestrelValley);
const physics = new PhysicsWorld(DT);
track.buildPhysics(physics);
const car = new Vehicle(physics, meridianGT, track.grid[0]);
const timer = new LapTimer(track);
timer.startNow();

const laps = Number(process.argv[2] ?? 2);
const tmp = { index: 0, lateral: 0, distSq: 0 };
const fwd = new Vec3(), right = new Vec3();
let t = 0, maxLat = 0, minY = Infinity, topSpeed = 0;
const n = track.line.samples.length;

while (timer.lapsCompleted < laps && t < 400) {
  const p = car.body.translation();
  const q = car.body.rotation();
  track.line.nearest(p, tmp);
  const v = Math.max(car.forwardSpeed, 5);
  // Look ahead proportional to speed; aim at that centreline point.
  const ahead = track.line.samples[(tmp.index + Math.round((6 + v * 0.55) / track.line.spacing)) % n].pos;
  fwd.set(0, 0, -1).applyQuat(q); right.set(1, 0, 0).applyQuat(q);
  const dx = ahead.x - p.x, dz = ahead.z - p.z;
  const angle = Math.atan2(dx * right.x + dz * right.z, dx * fwd.x + dz * fwd.z);
  // Target speed from the tightest curvature in the next ~(braking distance) metres.
  let maxK = 0;
  const look = Math.round((20 + v * v / 18) / track.line.spacing);
  for (let k = 0; k < look; k++) maxK = Math.max(maxK, Math.abs(track.line.samples[(tmp.index + k) % n].curvature));
  const target = Math.min(85, Math.sqrt((1.05 * 9.81) / Math.max(maxK, 1e-4)));
  const err = target - car.forwardSpeed;
  const input = { ...neutralInput(), steer: clamp(angle * 3, -1, 1), throttle: clamp(err * 0.4, 0, 1), brake: clamp(-err * 0.15, 0, 1) };
  car.step(input, DT);
  physics.step();
  t += DT;
  for (const e of timer.update(DT, car.body.translation(), car.forwardSpeed)) {
    if (e.type === 'lap') console.log(`  lap ${timer.lapsCompleted}: ${e.lapTime.toFixed(3)} s ${e.valid ? '' : '(invalid)'} sectors ${e.sectors.map(s => s.toFixed(2)).join(' / ')}`);
    if (e.type === 'invalidated') console.log(`  invalidated at ${timer.progress.toFixed(0)} m (lateral ${timer.lateral.toFixed(1)})`);
  }
  maxLat = Math.max(maxLat, Math.abs(timer.lateral));
  minY = Math.min(minY, car.body.translation().y);
  topSpeed = Math.max(topSpeed, car.forwardSpeed * MS_TO_KMH);
}
console.log(`time ${t.toFixed(1)} s, laps ${timer.lapsCompleted}, best ${timer.bestLapTime?.toFixed(3)}, max lateral ${maxLat.toFixed(1)} m, min y ${minY.toFixed(2)}, top ${topSpeed.toFixed(0)} km/h`);
if (timer.lapsCompleted < laps) { console.error('FAILED: did not complete laps'); process.exit(1); }
