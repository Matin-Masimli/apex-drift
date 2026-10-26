/**
 * Headless vehicle test bench. Runs the exact same simulation code the browser uses, in Node,
 * with no renderer. Proves sim/render separation and gives repeatable numbers for tuning:
 *
 *   npm run sim:headless              # all cars
 *   npm run sim:headless -- <car-id>  # one car
 */
import { initPhysics, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { Vehicle } from '../src/vehicles/Vehicle';
import { CARS, getCar } from '../src/vehicles/cars';
import { neutralInput, type CarConfig, type DriverInput } from '../src/vehicles/types';
import { Surface } from '../src/physics/surfaces';
import { MS_TO_KMH } from '../src/core/math';

const DT = 1 / 120;

function makeWorld(surface = Surface.Asphalt) {
  const physics = new PhysicsWorld(DT);
  // A 20 km flat runway so top-speed runs never hit an edge.
  physics.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 10000, y: 0.5, z: 10000 }, surface);
  return physics;
}

function spawn(cfg: CarConfig, surface = Surface.Asphalt) {
  const physics = makeWorld(surface);
  const car = new Vehicle(physics, cfg, { position: { x: 0, y: 0, z: 0 }, yaw: 0 });
  const step = (input: DriverInput) => {
    car.step(input, DT);
    physics.step();
  };
  return { physics, car, step };
}

function assertFinite(car: Vehicle, label: string) {
  const p = car.body.translation();
  if (![p.x, p.y, p.z, car.rpm, ...car.wheels.map(w => w.omega)].every(Number.isFinite)) {
    throw new Error(`${label}: simulation produced a non-finite value`);
  }
}

function testCar(cfg: CarConfig) {
  const results: Record<string, string> = {};

  // 1) Settle: 3 s at rest. Ride height should be stable, car shouldn't creep.
  {
    const { car, step } = spawn(cfg);
    for (let i = 0; i < 360; i++) step(neutralInput());
    const p = car.body.translation();
    const loads = car.wheels.map(w => w.load);
    const front = (loads[0] + loads[1]) / loads.reduce((a, b) => a + b, 0);
    results['rest: ride Δy (mm)'] = (p.y * 1000).toFixed(1);
    results['rest: drift (mm)'] = (Math.hypot(p.x, p.z) * 1000).toFixed(1);
    results['rest: front load %'] = (front * 100).toFixed(1);
    assertFinite(car, 'settle');
  }

  // 2) Full-throttle launch: 0-100, 0-200, top speed. Then a TC-off launch for comparison.
  {
    const { car, step } = spawn(cfg);
    car.aids.tc = false;
    for (let i = 0; i < 120; i++) step(neutralInput());
    let t = 0;
    while (car.forwardSpeed * MS_TO_KMH < 100 && t < 30) { step({ ...neutralInput(), throttle: 1 }); t += DT; }
    results['0-100 km/h no TC (s)'] = t.toFixed(2);
  }
  {
    const { car, step } = spawn(cfg);
    for (let i = 0; i < 120; i++) step(neutralInput());
    const input = { ...neutralInput(), throttle: 1 };
    let t = 0, t100 = NaN, t200 = NaN, top = 0, dist = 0, quarter = NaN;
    while (t < 70) {
      step(input);
      t += DT;
      const kmh = car.forwardSpeed * MS_TO_KMH;
      dist += car.forwardSpeed * DT;
      if (isNaN(t100) && kmh >= 100) t100 = t;
      if (isNaN(t200) && kmh >= 200) t200 = t;
      if (isNaN(quarter) && dist >= 402) quarter = t;
      top = Math.max(top, kmh);
    }
    assertFinite(car, 'launch');
    results['0-100 km/h (s)'] = t100.toFixed(2);
    results['0-200 km/h (s)'] = isNaN(t200) ? 'n/a' : t200.toFixed(2);
    results['400 m (s)'] = quarter.toFixed(2);
    results['top speed (km/h)'] = top.toFixed(0);
    results['final gear / rpm'] = `${car.gear} / ${car.rpm.toFixed(0)}`;
  }

  // 3) Braking 100-0 km/h, with and without ABS.
  for (const abs of [true, false]) {
    const { car, step } = spawn(cfg);
    car.aids.abs = abs;
    car.body.setLinvel({ x: 0, y: 0, z: -100 / MS_TO_KMH }, true);
    for (const w of car.wheels) w.omega = 100 / MS_TO_KMH / w.wheel.radius;
    const start = car.body.translation().z;
    const input = { ...neutralInput(), brake: 1 };
    let t = 0;
    do { step(input); t += DT; } while (car.forwardSpeed > 0.1 && t < 10);
    assertFinite(car, 'braking');
    results[`100-0 km/h ${abs ? 'ABS' : 'no ABS'} (m)`] = Math.abs(car.body.translation().z - start).toFixed(1);
  }

  // 4) Max lateral grip: follow a 60 m-radius circle with a steering controller, ramp the target
  //    speed slowly, and report the best lateral g sustained for 1 s while still on the circle.
  //    Closed-loop, so cars with very different steering and balance are measured the same way.
  {
    const { car, step } = spawn(cfg);
    const R = 60, cx = R, cz = 0; // circle centre to the right of the start (clockwise, right turn)
    let target = 10;
    car.body.setLinvel({ x: 0, y: 0, z: -target }, true);
    for (const w of car.wheels) w.omega = target / w.wheel.radius;
    const window: number[] = [];
    let best = 0, steerI = 0;
    for (let i = 0; i < 120 * 90; i++) {
      const p = car.body.translation();
      const q = car.body.rotation();
      // Pure pursuit toward a point 12 m ahead on the circle.
      const ang = Math.atan2(p.z - cz, p.x - cx);
      const aheadAng = ang + 12 / R; // direction of travel around the circle
      const tx = cx + Math.cos(aheadAng) * R, tz = cz + Math.sin(aheadAng) * R;
      const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y)); // local -Z in world
      const rx = 1 - 2 * (q.y * q.y + q.z * q.z), rz = 2 * (q.x * q.z - q.w * q.y);     // local +X in world
      const dx = tx - p.x, dz = tz - p.z;
      const err = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
      steerI = Math.max(-0.5, Math.min(0.5, steerI + err * 0.002));
      const steer = Math.max(-1, Math.min(1, err * 2.5 + steerI));
      const vErr = target - car.forwardSpeed;
      step({ ...neutralInput(), steer, throttle: Math.max(0, Math.min(1, vErr * 0.6 + 0.15)), brake: vErr < -3 ? 0.2 : 0 });
      target += 0.45 / 120;
      const radial = Math.hypot(p.x - cx, p.z - cz);
      if (Math.abs(radial - R) > 4 || Math.abs(car.bodySlip) > 0.35) break; // left the circle or spun
      window.push(Math.abs(car.accelG.lat));
      if (window.length > 120) window.shift();
      if (window.length === 120) best = Math.max(best, window.reduce((a, b) => a + b, 0) / 120);
    }
    assertFinite(car, 'skidpad');
    results['max lateral g (R60 circle)'] = best.toFixed(2);
  }

  // 5) Gravel launch: proves surfaces matter.
  {
    const { car, step } = spawn(cfg, Surface.Gravel);
    for (let i = 0; i < 120; i++) step(neutralInput());
    let t = 0;
    while (car.forwardSpeed * MS_TO_KMH < 100 && t < 30) { step({ ...neutralInput(), throttle: 1 }); t += DT; }
    results['0-100 on gravel (s)'] = t.toFixed(2);
  }

  return results;
}

async function main() {
  await initPhysics();
  const id = process.argv[2];
  const cars = id ? [getCar(id)] : CARS;
  for (const cfg of cars) {
    const t0 = performance.now();
    const r = testCar(cfg);
    console.log(`\n=== ${cfg.name} (${cfg.drivetrain.layout}, ${cfg.chassis.mass} kg) ===`);
    for (const [k, v] of Object.entries(r)) console.log(`  ${k.padEnd(28)} ${v}`);
    console.log(`  (bench ran in ${((performance.now() - t0) / 1000).toFixed(1)} s wall time)`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
