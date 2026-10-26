/**
 * Headless AI race: a full field of AI cars races on the circuit with real collisions.
 * Verifies the AI completes races and reports pace, incidents and finishing order.
 *
 *   npx tsx scripts/ai-race-test.ts [laps] [difficulty] [car-id | mixed] [cars]
 */
import { initPhysics, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { Track } from '../src/tracks/Track';
import { kestrelValley } from '../src/tracks/circuits/kestrelValley';
import { RacingLine } from '../src/ai/RacingLine';
import { orderGridByPace, RaceSim, type RacerSpec } from '../src/game/RaceSim';
import type { Difficulty } from '../src/ai/AIDriver';
import { CARS } from '../src/vehicles/cars';

const DT = 1 / 120;
await initPhysics();
const laps = Number(process.argv[2] ?? 2);
const difficulty = (process.argv[3] ?? 'medium') as Difficulty;
const carArg = process.argv[4] ?? 'meridian-gte';
const count = Number(process.argv[5] ?? 8);

const track = new Track(kestrelValley);
const line = new RacingLine(track);
const physics = new PhysicsWorld(DT);
track.buildPhysics(physics);
const specs: RacerSpec[] = Array.from({ length: count }, (_, i) => ({
  name: `AI ${i + 1}`,
  carId: carArg === 'mixed' ? CARS[i % CARS.length].id : carArg,
  paintIndex: i % 5,
  player: false,
  difficulty,
}));
const race = new RaceSim(physics, track, line, carArg === 'mixed' ? orderGridByPace(specs, line) : specs, { laps, rubberBand: false });
for (let i = 0; i < 60; i++) race.step(DT, null);
race.start();

let contacts = 0, recoveries = 0, invalid = 0;
// An incident = a car touching something after ≥0.5 s without contact (so a long scrape counts once).
const lastContact = new Map<number, number>();
const where: string[] = [];
const t0 = performance.now();
while (race.phase === 'racing' && race.raceTime < laps * 200) {
  for (const e of race.step(DT, null)) {
    if (e.type === 'recovered') { recoveries++; where.push(`recover ${e.racer.spec.name} @${(e.racer.timer.progress).toFixed(0)}m t=${race.raceTime.toFixed(0)}`); }
    if (e.type === 'timer' && e.event.type === 'invalidated') invalid++;
  }
  for (const r of race.racers) {
    const hits = r.vehicle.drainImpacts().filter(i => i.impulse > 200);
    if (!hits.length) continue;
    if (race.raceTime - (lastContact.get(r.index) ?? -10) > 0.5) {
      contacts++;
      if (process.env.VERBOSE) where.push(`contact ${r.spec.name} @${r.timer.progress.toFixed(0)}m t=${race.raceTime.toFixed(1)}`);
    }
    lastContact.set(r.index, race.raceTime);
  }
}
const wall = (performance.now() - t0) / 1000;
console.log(`${count} cars, ${laps} laps, ${difficulty}, ${carArg}: race ${race.raceTime.toFixed(1)} s sim in ${wall.toFixed(1)} s wall (${(race.raceTime / wall).toFixed(1)}x realtime)`);
race.order().forEach((r, i) => {
  const best = r.timer.bestLapTime;
  console.log(`  P${i + 1} ${r.spec.name.padEnd(5)} ${r.vehicle.config.name.padEnd(20)} ${r.finished ? r.finishTime.toFixed(2).padStart(7) + ' s' : `DNF (${r.laps} laps)`}  best ${best ? best.toFixed(2) : '-'}  recoveries ${r.recoveries}`);
});
console.log(`  contact incidents: ${contacts}, recoveries: ${recoveries}, invalidated laps: ${invalid}`);
if (process.env.VERBOSE) console.log(where.join('\n'));
// Cars still running when the race closes (60 s after the leader) are classified, not failures.
// Fail if a car is stuck far behind (less than half the race distance) or needed many recoveries.
const stuck = race.racers.filter(r => !r.finished && r.timer.raceDistance < laps * track.length * 0.5);
const wild = race.racers.filter(r => r.recoveries > laps * 2);
if (stuck.length || wild.length) { console.error(`FAILED: ${stuck.length} stuck, ${wild.length} with excessive recoveries`); process.exit(1); }
