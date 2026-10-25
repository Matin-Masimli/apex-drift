import * as THREE from 'three';
import { Surface } from '../../physics/surfaces';
import type { Vehicle } from '../../vehicles/Vehicle';
import { ParticleSystem } from './Particles';
import { SkidMarks } from './SkidMarks';

const SKID_COLOR: Partial<Record<Surface, THREE.Color>> = {
  [Surface.Asphalt]: new THREE.Color(0.03, 0.03, 0.03),
  [Surface.Curb]: new THREE.Color(0.05, 0.05, 0.05),
  [Surface.Wet]: new THREE.Color(0.02, 0.02, 0.02),
  [Surface.Grass]: new THREE.Color(0.16, 0.2, 0.08),
  [Surface.Gravel]: new THREE.Color(0.32, 0.26, 0.18),
};

/**
 * Turns vehicle sim state into visual effects. Reads only public sim data (wheel slip, surface,
 * contact points, impacts, shift events), so the same code drives local, ghost and network cars.
 */
export class VehicleEffects {
  readonly skids = new SkidMarks();
  readonly smoke = new ParticleSystem(3500, false);
  readonly sparks = new ParticleSystem(1500, true);
  readonly group = new THREE.Group();
  private readonly lastShift = new WeakMap<Vehicle, number>();
  private readonly overrunTimer = new WeakMap<Vehicle, number>();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private carry = new Map<string, number>();

  constructor() {
    this.group.add(this.skids.mesh, this.smoke.points, this.sparks.points);
  }

  setParticleLimit(n: number): void {
    this.smoke.setLimit(n);
    this.sparks.setLimit(Math.round(n * 0.4));
  }

  /** Emit `rate` particles per second, carrying the fractional remainder between frames. */
  private emitCount(key: string, rate: number, dt: number): number {
    const acc = (this.carry.get(key) ?? 0) + rate * dt;
    const n = Math.floor(acc);
    this.carry.set(key, acc - n);
    return n;
  }

  update(v: Vehicle, id: string, dt: number): void {
    const rnd = Math.random;
    const lv = v.body.linvel();

    // --- Per wheel: skids, smoke, dust, grass, spray ---
    for (const w of v.wheels) {
      const key = `${id}:${w.index}`;
      if (!w.grounded || w.load < 200) { this.skids.add(key, 0, this.tmp, this.tmp2, 0, SKID_COLOR[Surface.Asphalt]!); continue; }
      const R = w.wheel.radius;
      // Slip speed: how fast the contact patch slides over the ground.
      const slipSpeed = Math.hypot(w.omega * R - w.vLong, w.vLat);
      const loose = w.surface === Surface.Grass || w.surface === Surface.Gravel;
      const sliding = Math.max(0, w.combinedSlip - 1.05);
      // On loose ground the tires dig ruts at any meaningful speed.
      const skidI = loose ? Math.min(1, Math.abs(w.vLong) / 15) * 0.8 : Math.min(1, sliding * 0.8) * Math.min(1, slipSpeed / 3);
      this.tmp.set(w.contactPoint.x, w.contactPoint.y, w.contactPoint.z);
      this.tmp2.set(w.side.x, w.side.y, w.side.z);
      this.skids.add(key, skidI, this.tmp, this.tmp2, w.wheel.width * 0.9, SKID_COLOR[w.surface] ?? SKID_COLOR[Surface.Asphalt]!);

      const speed = Math.abs(w.vLong);
      const cp = w.contactPoint;
      let rate = 0;
      let kind: 'smoke' | 'dust' | 'grass' | 'spray' = 'smoke';
      if (w.surface === Surface.Gravel) { kind = 'dust'; rate = Math.min(60, speed * 2.2 + slipSpeed * 3); }
      else if (w.surface === Surface.Grass) { kind = 'grass'; rate = speed > 4 ? Math.min(30, speed + slipSpeed * 2) : 0; }
      else if (w.surface === Surface.Wet) { kind = 'spray'; rate = speed > 12 ? Math.min(50, (speed - 12) * 2) : 0; }
      else if (sliding > 0.25 && slipSpeed > 4) { kind = 'smoke'; rate = Math.min(80, sliding * slipSpeed * 3); }
      const n = this.emitCount(key, rate, dt);
      for (let i = 0; i < n; i++) {
        const j = () => (rnd() - 0.5);
        switch (kind) {
          case 'smoke': {
            const g = 0.8 + rnd() * 0.12;
            this.smoke.spawn({
              x: cp.x + j() * 0.3, y: cp.y + 0.25, z: cp.z + j() * 0.3,
              vx: lv.x * 0.25 + j() * 1.5, vy: 0.6 + rnd() * 0.8, vz: lv.z * 0.25 + j() * 1.5,
              life: 1.6 + rnd() * 1.4, size0: 0.8, size1: 5 + rnd() * 2, alpha: 0.32, r: g, g, b: g, gravity: 0.25, drag: 1.4,
            });
            break;
          }
          case 'dust':
            this.smoke.spawn({
              x: cp.x + j() * 0.4, y: cp.y + 0.2, z: cp.z + j() * 0.4,
              vx: lv.x * 0.3 + j() * 2, vy: 0.5 + rnd() * 1.2, vz: lv.z * 0.3 + j() * 2,
              life: 1.5 + rnd() * 1.5, size0: 1, size1: 6, alpha: 0.4, r: 0.66, g: 0.56, b: 0.42, gravity: 0.1, drag: 1.2,
            });
            if (rnd() < 0.4) this.sparks.spawn({ // flung stones (dark, not additive-bright)
              x: cp.x, y: cp.y + 0.1, z: cp.z, vx: -lv.x * 0.1 + j() * 3, vy: 2 + rnd() * 3, vz: -lv.z * 0.1 + j() * 3,
              life: 0.6, size0: 0.08, size1: 0.08, alpha: 0.25, r: 0.25, g: 0.2, b: 0.15, gravity: -9.8, drag: 0.2,
            });
            break;
          case 'grass':
            this.smoke.spawn({
              x: cp.x + j() * 0.3, y: cp.y + 0.15, z: cp.z + j() * 0.3,
              vx: lv.x * 0.2 + j() * 2, vy: 1.5 + rnd() * 2, vz: lv.z * 0.2 + j() * 2,
              life: 0.8 + rnd() * 0.5, size0: 0.25, size1: 0.35, alpha: 0.9, r: 0.22, g: 0.36, b: 0.12, gravity: -9.8, drag: 0.8,
            });
            break;
          case 'spray':
            this.smoke.spawn({
              x: cp.x + j() * 0.3, y: cp.y + 0.2, z: cp.z + j() * 0.3,
              vx: lv.x * 0.5 + j() * 1.5, vy: 0.8 + rnd() * 1.5, vz: lv.z * 0.5 + j() * 1.5,
              life: 0.7 + rnd() * 0.6, size0: 0.6, size1: 3, alpha: 0.22, r: 0.85, g: 0.88, b: 0.9, gravity: -2, drag: 2,
            });
            break;
        }
      }
    }

    // --- Sparks from chassis impacts and scrapes ---
    for (const imp of v.drainImpacts()) {
      const strength = Math.min(1, imp.impulse / 800 + imp.speed / 40);
      if (imp.speed < 3 || strength < 0.05) continue;
      const count = Math.round(4 + strength * 40);
      for (let i = 0; i < count; i++) {
        const j = () => (Math.random() - 0.5);
        this.sparks.spawn({
          x: imp.point.x, y: imp.point.y, z: imp.point.z,
          vx: lv.x * 0.6 + imp.normal.x * 2 + j() * 8, vy: 1 + Math.random() * 4, vz: lv.z * 0.6 + imp.normal.z * 2 + j() * 8,
          life: 0.25 + Math.random() * 0.45, size0: 0.12, size1: 0.05, alpha: 1.6, r: 1, g: 0.62, b: 0.22, gravity: -9.8, drag: 0.6,
        });
      }
    }

    // --- Exhaust flames: downshift blips and high-rpm throttle lift (overrun) ---
    const pt = v.powertrain;
    let flame = 0;
    if (this.lastShift.get(v) !== pt.shiftCounter) {
      if (this.lastShift.has(v) && pt.lastShiftDirection < 0) flame = 1;
      this.lastShift.set(v, pt.shiftCounter);
    }
    const overrun = pt.rpm > v.config.engine.redlineRpm * 0.7 && v.appliedThrottle < 0.05 && pt.clutchLocked;
    const ot = (this.overrunTimer.get(v) ?? 0) + (overrun ? dt : -dt);
    this.overrunTimer.set(v, Math.max(0, Math.min(0.6, ot)));
    if (overrun && ot < 0.35 && Math.random() < dt * 14) flame = Math.max(flame, 0.5);
    if (flame > 0) this.exhaustFlame(v, flame);
  }

  private exhaustFlame(v: Vehicle, strength: number): void {
    const [, , hz] = v.config.chassis.halfExtents;
    this.q.copy(v.body.rotation() as THREE.Quaternion);
    const p = v.body.translation();
    const lv = v.body.linvel();
    for (const sx of [-0.42, 0.42]) {
      this.tmp.set(sx, 0.32, hz + 0.05).applyQuaternion(this.q).add(p as THREE.Vector3);
      this.tmp2.set(0, 0, 1).applyQuaternion(this.q); // backwards out of the pipe
      const n = Math.round(6 + strength * 10);
      for (let i = 0; i < n; i++) {
        const sp = 3 + Math.random() * 5;
        const hot = Math.random();
        this.sparks.spawn({
          x: this.tmp.x, y: this.tmp.y, z: this.tmp.z,
          vx: lv.x + this.tmp2.x * sp, vy: lv.y + Math.random() * 0.4, vz: lv.z + this.tmp2.z * sp,
          life: 0.07 + Math.random() * 0.08, size0: 0.35 * strength + 0.1, size1: 0.05, alpha: 1.4,
          r: 1, g: 0.45 + hot * 0.4, b: hot > 0.85 ? 0.9 : 0.15, gravity: 0, drag: 3,
        });
      }
    }
  }

  /** Advance particle simulation once per frame (after all vehicles emitted). */
  step(dt: number, camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    this.smoke.update(dt, viewportHeight, camera.fov);
    this.sparks.update(dt, viewportHeight, camera.fov);
  }
}
