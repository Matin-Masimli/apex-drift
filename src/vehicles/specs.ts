import { MS_TO_KMH, RPM_TO_RAD, sampleCurve } from '../core/math';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Surface } from '../physics/surfaces';
import { Vehicle } from './Vehicle';
import { neutralInput, type CarConfig } from './types';

export interface CarSpecs {
  powerHp: number;
  peakTorqueNm: number;
  weightKg: number;
  /** Top speed (km/h): the lower of the gear-limited and drag-limited speeds. */
  topSpeedKmh: number;
  /** Measured in a short headless simulation run, with the car's default aids. */
  zeroToHundred: number;
}

const cache = new Map<string, CarSpecs>();

/**
 * Showroom numbers, derived from the physics config rather than typed in by hand, so they can
 * never drift from how the car actually drives. Requires `initPhysics()` to have run.
 */
export function carSpecs(cfg: CarConfig): CarSpecs {
  const hit = cache.get(cfg.id);
  if (hit) return hit;

  // Peak power from the torque curve (P = T·ω), sampled every 50 rpm.
  let powerW = 0, peakT = 0;
  for (let rpm = cfg.engine.idleRpm; rpm <= cfg.engine.limiterRpm; rpm += 50) {
    const t = sampleCurve(cfg.engine.torqueCurve, rpm);
    peakT = Math.max(peakT, t);
    powerW = Math.max(powerW, t * rpm * RPM_TO_RAD);
  }

  // Top speed: walk up in speed while some gear still has more tractive force than drag + rolling.
  const R = cfg.drivetrain.layout === 'FWD' ? cfg.wheels.front.radius : cfg.wheels.rear.radius;
  const g = cfg.gearbox;
  let top = 0;
  for (let v = 5; v < 160; v += 0.25) {
    const resist = 0.5 * 1.225 * cfg.aero.dragArea * v * v + 0.013 * cfg.chassis.mass * 9.81;
    let best = 0;
    for (const ratio of g.ratios) {
      const total = ratio * g.finalDrive;
      const rpm = (v / R) * total / RPM_TO_RAD;
      if (rpm > cfg.engine.limiterRpm) continue;
      best = Math.max(best, (sampleCurve(cfg.engine.torqueCurve, Math.max(rpm, cfg.engine.idleRpm)) * total * g.efficiency) / R);
    }
    if (best < resist) break;
    top = v;
  }

  const specs: CarSpecs = {
    powerHp: Math.round(powerW / 745.7),
    peakTorqueNm: Math.round(peakT),
    weightKg: cfg.chassis.mass,
    topSpeedKmh: Math.round(top * MS_TO_KMH),
    zeroToHundred: measureZeroToHundred(cfg),
  };
  cache.set(cfg.id, specs);
  return specs;
}

function measureZeroToHundred(cfg: CarConfig): number {
  const dt = 1 / 120;
  const physics = new PhysicsWorld(dt);
  physics.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 2000, y: 0.5, z: 2000 }, Surface.Asphalt);
  const car = new Vehicle(physics, cfg, { position: { x: 0, y: 0, z: 0 }, yaw: 0 });
  for (let i = 0; i < 60; i++) { car.step(neutralInput(), dt); physics.step(); }
  const input = { ...neutralInput(), throttle: 1 };
  let t = 0;
  while (car.forwardSpeed * MS_TO_KMH < 100 && t < 20) { car.step(input, dt); physics.step(); t += dt; }
  physics.dispose();
  return Math.round(t * 10) / 10;
}
