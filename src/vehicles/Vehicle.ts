import { RAPIER, type PhysicsWorld } from '../physics/PhysicsWorld';
import { computeTireForce, TireCurve, type TireForceResult, type TireParams } from '../physics/tire';
import { Surface, SURFACES } from '../physics/surfaces';
import { approach, clamp, DEG, Quat, sign, Vec3, type V3 } from '../core/math';
import { Powertrain, splitDiff, type PowertrainOutput } from './Powertrain';
import type { AxleSuspension, CarConfig, DriverInput, WheelConfig } from './types';

/** Wheel sub-steps per physics step. 8 × 120 Hz = 960 Hz wheel integration. */
const SUBSTEPS = 8;
/**
 * Lowest speed used as the slip denominator. Below this, slip becomes a scaled velocity
 * difference rather than a ratio, which turns the tire into a strong damper at standstill
 * instead of a division by ~zero. 3 m/s keeps the chassis coupling stable at 120 Hz.
 */
const SLIP_SPEED_FLOOR = 3;
const AIR_DENSITY = 1.225;
const GRAVITY = 9.81;
const BUMP_STOP_STIFFNESS_MUL = 12;

export const WHEEL_NAMES = ['FL', 'FR', 'RL', 'RR'] as const;

/** Full per-wheel state. Public so the debug overlay and renderer can read it. */
export class WheelState {
  // --- configuration (fixed after construction) ---
  readonly mountLocal = new Vec3();
  readonly curve: TireCurve;
  /** Share of driveline torque this wheel receives through the diffs at equal speeds (0 if undriven). */
  driveShare = 0;

  // --- suspension ---
  grounded = false;
  /** Current spring length (m), from mount point to wheel centre. */
  suspensionLength: number;
  compression = 0;
  private prevCompression = 0;
  /** Vertical tire load (N). */
  load = 0;
  surface = Surface.Asphalt;
  readonly contactPoint = new Vec3();
  readonly contactNormal = new Vec3(0, 1, 0);

  // --- tire / wheel dynamics ---
  /** Wheel angular velocity (rad/s, + = rolling forward). */
  omega = 0;
  /** Accumulated spin angle for rendering (rad). */
  spinAngle = 0;
  /** Road-wheel steer angle (rad, + = right). */
  steerAngle = 0;
  slipRatio = 0;
  slipAngle = 0;
  /** Contact-frame forces averaged over the last step (N). */
  fx = 0;
  fy = 0;
  gripUsed = 0;
  combinedSlip = 0;
  vLong = 0;
  vLat = 0;
  // Per-step torques (Nm)
  driveTorque = 0;
  brakeTorque = 0;
  /** 0..1 ABS pressure modulation (1 = full pressure). */
  absFactor = 1;
  absActive = false;

  // Scratch: contact frame for this step.
  readonly fwd = new Vec3();
  readonly side = new Vec3();

  constructor(
    readonly index: number,
    readonly isFront: boolean,
    /** -1 = left, +1 = right */
    readonly lateral: -1 | 1,
    readonly wheel: WheelConfig,
    readonly susp: AxleSuspension,
    readonly tire: TireParams,
  ) {
    this.curve = new TireCurve(tire.shape);
    this.suspensionLength = susp.restLength;
  }

  updateCompression(newCompression: number, dt: number): number {
    this.prevCompression = this.compression;
    this.compression = newCompression;
    return (this.compression - this.prevCompression) / dt;
  }

  resetDynamics(): void {
    this.omega = 0;
    this.compression = 0;
    this.prevCompression = 0;
    this.load = 0;
    this.fx = this.fy = 0;
    this.absFactor = 1;
    this.suspensionLength = this.susp.restLength;
  }
}

export interface AidsState {
  abs: boolean;
  tc: boolean;
  esc: boolean;
}

/** Live aid activity for the debug overlay / HUD lights. */
export interface AidsActivity {
  abs: boolean;
  tc: boolean;
  esc: boolean;
}

/**
 * The vehicle simulation: a Rapier rigid body for the chassis, plus our own
 * ray-cast suspension, tire model, drivetrain, aero and driver aids.
 *
 * Headless-safe: no rendering imports. Call `step()` once per fixed physics tick, *before* the
 * world steps (it applies impulses that the world then integrates).
 */
export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly wheels: WheelState[];
  readonly powertrain: Powertrain;
  readonly aids: AidsState;
  readonly aidsActive: AidsActivity = { abs: false, tc: false, esc: false };

  /** Smoothed steering input actually applied (-1..1). */
  steerInput = 0;
  /** Inputs as the sim interpreted them this step (after auto-reverse pedal swap). */
  appliedThrottle = 0;
  appliedBrake = 0;
  appliedHandbrake = 0;
  /** Speed along the car's forward axis (m/s). */
  forwardSpeed = 0;
  speed = 0;
  /** Accelerations in the car frame, in g (for the overlay). */
  readonly accelG = { long: 0, lat: 0 };
  /** Body slip angle at the CoM (rad, + = velocity pointing right of heading). */
  bodySlip = 0;
  yawRate = 0;

  private tcFactor = 1;
  private escUndersteer = false;
  private reverseHold = 0;
  private readonly prevVel = new Vec3();

  // Scratch vectors (avoid per-step allocation in the hot path).
  private readonly q = new Quat();
  private readonly pos = new Vec3();
  private readonly up = new Vec3();
  private readonly fwdBody = new Vec3();
  private readonly rightBody = new Vec3();
  private readonly vel = new Vec3();
  private readonly angVel = new Vec3();
  private readonly tmp = new Vec3();
  private readonly tmp2 = new Vec3();
  private readonly rayOrigin = new Vec3();
  private readonly rayDir = new Vec3();
  private readonly pointVel = { x: 0, y: 0, z: 0 };
  private readonly tireOut: TireForceResult = { fx: 0, fy: 0, gripUsed: 0, combinedSlip: 0 };
  private readonly ptOut: PowertrainOutput = { wheelTorque: 0, reflectedInertia: 0 };
  private readonly diffOut: [number, number] = [0, 0];
  private readonly escBrake = [0, 0, 0, 0];
  private readonly accFx = [0, 0, 0, 0];
  private readonly accFy = [0, 0, 0, 0];
  private readonly accGrip = [0, 0, 0, 0];
  private readonly wheelInertia = [0, 0, 0, 0];
  private readonly wheelDrive = [0, 0, 0, 0];

  constructor(
    private readonly physics: PhysicsWorld,
    readonly config: CarConfig,
    spawn: { position: V3; yaw: number },
  ) {
    const c = config;
    this.aids = { ...c.aids };
    this.powertrain = new Powertrain(c);

    // --- Wheels: positions derived from geometry, mount height from static sag ---
    const g = c.geometry;
    const zF = -g.wheelbase / 2;
    const zR = g.wheelbase / 2;
    const frontStatic = (c.chassis.mass * GRAVITY * c.chassis.weightFront) / 2;
    const rearStatic = (c.chassis.mass * GRAVITY * (1 - c.chassis.weightFront)) / 2;
    const mk = (i: number, front: boolean, side: -1 | 1) => {
      const susp = front ? c.suspension.front : c.suspension.rear;
      const wheel = front ? c.wheels.front : c.wheels.rear;
      const w = new WheelState(i, front, side, wheel, susp, front ? c.tires.front : c.tires.rear);
      // Mount so that, at rest under static load, the wheel centre sits exactly at y = radius
      // (i.e. the car sits at its design ride height with the chassis origin on the ground).
      const sag = Math.min((front ? frontStatic : rearStatic) / susp.stiffness, susp.maxCompression * 0.8);
      const y = wheel.radius + susp.restLength - sag;
      const track = front ? g.trackFront : g.trackRear;
      w.mountLocal.set((side * track) / 2, y, front ? zF : zR);
      return w;
    };
    this.wheels = [mk(0, true, -1), mk(1, true, 1), mk(2, false, -1), mk(3, false, 1)];

    const dt = c.drivetrain;
    if (dt.layout === 'FWD') { this.wheels[0].driveShare = this.wheels[1].driveShare = 0.5; }
    else if (dt.layout === 'RWD') { this.wheels[2].driveShare = this.wheels[3].driveShare = 0.5; }
    else {
      this.wheels[0].driveShare = this.wheels[1].driveShare = dt.frontTorqueSplit / 2;
      this.wheels[2].driveShare = this.wheels[3].driveShare = (1 - dt.frontTorqueSplit) / 2;
    }

    // --- Chassis rigid body with explicit mass properties ---
    const [hx, hy, hz] = c.chassis.halfExtents;
    const [sx, sy, sz] = c.chassis.inertiaScale;
    const m = c.chassis.mass;
    // Solid box inertia: I = m/12 · (a² + b²) with full dimensions a, b. X = pitch, Y = yaw, Z = roll.
    const inertia = {
      x: (m / 12) * ((2 * hy) ** 2 + (2 * hz) ** 2) * sx,
      y: (m / 12) * ((2 * hx) ** 2 + (2 * hz) ** 2) * sy,
      z: (m / 12) * ((2 * hx) ** 2 + (2 * hy) ** 2) * sz,
    };
    // weightFront = 1 puts the CoM on the front axle (z = -wb/2), 0 on the rear axle.
    const com = { x: 0, y: c.chassis.cgHeight, z: g.wheelbase * (0.5 - c.chassis.weightFront) };
    const rot = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, spawn.yaw);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.position.x, spawn.position.y + 0.05, spawn.position.z)
      .setRotation(rot)
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setAngularDamping(0.02)
      .setLinearDamping(0);
    this.body = physics.world.createRigidBody(bodyDesc);
    // Collider mass properties are expressed in the *collider's* local frame, so offset the CoM
    // by the collider's own translation to land it at the intended body-space position.
    const colliderCom = { x: com.x, y: com.y - c.chassis.colliderCenterY, z: com.z };
    const colDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(0, c.chassis.colliderCenterY, 0)
      .setMassProperties(m, colliderCom, inertia, { x: 0, y: 0, z: 0, w: 1 })
      .setFriction(0.35)
      .setRestitution(0.15);
    physics.world.createCollider(colDesc, this.body);
  }

  /** Total road-wheel angle limit at the current speed, with a countersteer allowance. */
  private steerLimit(input: number): number {
    const s = this.config.steering;
    const max = s.maxAngleDeg * DEG;
    let limit = max / (1 + Math.abs(this.forwardSpeed) * s.speedSensitivity);
    // Sim-cade assist: when the car is sliding, allow steering *into* the slide (countersteer)
    // up to the body slip angle, so drifts stay catchable on a keyboard.
    if (Math.abs(this.forwardSpeed) > 3 && sign(input) === sign(this.bodySlip)) {
      limit = Math.max(limit, Math.min(max, Math.abs(this.bodySlip) + 4 * DEG));
    }
    return limit;
  }

  private updateSteering(input: DriverInput, dt: number): void {
    const s = this.config.steering;
    // Return to centre faster than turning in: feels more stable on digital input.
    const rate = Math.abs(input.steer) < Math.abs(this.steerInput) ? 2.2 : 1;
    const maxRad = s.maxAngleDeg * DEG;
    this.steerInput = approach(this.steerInput, clamp(input.steer, -1, 1), ((s.speed * rate) / maxRad) * dt);
    const angle = this.steerInput * this.steerLimit(this.steerInput);

    // Ackermann: the inner wheel follows a tighter circle, so it steers more.
    const L = this.config.geometry.wheelbase;
    const t = this.config.geometry.trackFront;
    const [fl, fr] = this.wheels;
    if (Math.abs(angle) < 1e-4) {
      fl.steerAngle = fr.steerAngle = angle;
      return;
    }
    const R = L / Math.tan(Math.abs(angle)); // turn radius at the axle centre
    const inner = Math.atan(L / (R - t / 2));
    const outer = Math.atan(L / (R + t / 2));
    const k = this.config.steering.ackermann;
    const a = Math.abs(angle);
    const innerA = a + (inner - a) * k;
    const outerA = a + (outer - a) * k;
    const sgn = sign(angle);
    // Turning right (+): the right wheel (FR) is the inner wheel.
    fl.steerAngle = sgn * (sgn > 0 ? outerA : innerA);
    fr.steerAngle = sgn * (sgn > 0 ? innerA : outerA);
  }

  /** Gear selection: automatic logic with auto-reverse, or manual paddle requests. */
  private updateGearbox(input: DriverInput, dt: number): void {
    const pt = this.powertrain;
    const drivelineOmega = this.drivelineOmega();
    if (pt.automatic) {
      const nearlyStopped = Math.abs(this.forwardSpeed) < 1.0;
      if (pt.gear > 0) {
        // Hold brake at a standstill to engage reverse.
        this.reverseHold = nearlyStopped && input.brake > 0.3 && input.throttle < 0.05 ? this.reverseHold + dt : 0;
        if (this.reverseHold > 0.3) { pt.requestShift(-1); this.reverseHold = 0; }
        else if (!pt.isShifting) {
          const cfg = this.config.gearbox;
          const slipping = this.wheels.some(w => w.driveShare > 0 && w.slipRatio > 0.4);
          // Shift points follow the throttle: short-shift when cruising, rev out when flat out.
          const t = clamp(input.throttle, 0, 1);
          const upRpm = cfg.autoUpshiftRpm * (0.55 + 0.45 * t);
          const downRpm = cfg.autoDownshiftRpm * (0.55 + 0.45 * t);
          if (pt.rpm > upRpm && pt.gear < pt.forwardGears && pt.clutchLocked && !slipping) {
            pt.requestShift(pt.gear + 1);
          } else if (pt.gear > 1 && pt.rpm < downRpm &&
                     pt.rpmInGear(pt.gear - 1, drivelineOmega) < upRpm * 0.93) {
            pt.requestShift(pt.gear - 1);
          }
        }
      } else if (pt.gear < 0) {
        this.reverseHold = nearlyStopped && input.throttle > 0.3 && input.brake < 0.05 ? this.reverseHold + dt : 0;
        if (this.reverseHold > 0.15) { pt.requestShift(1); this.reverseHold = 0; }
      } else {
        pt.requestShift(1);
      }
    } else {
      // Manual: refuse a downshift that would over-rev the engine ("money shift" protection).
      if (input.shiftUp) pt.requestShift(pt.gear + 1);
      if (input.shiftDown) {
        const target = pt.gear - 1;
        if (target <= 0 || pt.rpmInGear(target, drivelineOmega) < this.config.engine.limiterRpm) pt.requestShift(target);
      }
    }
    pt.update(dt);
  }

  private drivelineOmega(): number {
    let o = 0;
    for (const w of this.wheels) o += w.omega * w.driveShare;
    return o;
  }

  /**
   * Advance the vehicle by one fixed step. Applies impulses to the chassis; the caller then
   * steps the physics world.
   */
  step(input: DriverInput, dt: number): void {
    const c = this.config;
    const body = this.body;

    // ---------- Chassis state ----------
    this.q.copy(body.rotation());
    this.pos.copy(body.translation());
    this.up.set(0, 1, 0).applyQuat(this.q);
    this.fwdBody.set(0, 0, -1).applyQuat(this.q);
    this.rightBody.set(1, 0, 0).applyQuat(this.q);
    this.vel.copy(body.linvel());
    this.angVel.copy(body.angvel());
    this.forwardSpeed = this.vel.dot(this.fwdBody);
    this.speed = this.vel.length();
    const vRight = this.vel.dot(this.rightBody);
    this.bodySlip = Math.abs(this.forwardSpeed) > 1 ? Math.atan2(vRight, Math.abs(this.forwardSpeed)) : 0;
    // Positive yaw rate = turning right (clockwise seen from above = negative about +Y).
    this.yawRate = -this.angVel.dot(this.up);

    // Accelerations for telemetry (from the velocity change over the last step).
    this.tmp.copy(this.vel).sub(this.prevVel).scale(1 / dt);
    this.accelG.long = this.tmp.dot(this.fwdBody) / GRAVITY;
    this.accelG.lat = this.tmp.dot(this.rightBody) / GRAVITY;
    this.prevVel.copy(this.vel);

    // ---------- Inputs (auto-reverse swaps pedals in reverse gear) ----------
    let throttle = clamp(input.throttle, 0, 1);
    let brake = clamp(input.brake, 0, 1);
    if (this.powertrain.automatic && this.powertrain.gear < 0) [throttle, brake] = [brake, throttle];
    this.appliedHandbrake = clamp(input.handbrake, 0, 1);

    this.updateSteering(input, dt);
    this.updateGearbox(input, dt);

    // ---------- Suspension: ray casts and spring/damper forces ----------
    this.rayDir.copy(this.up).scale(-1);
    for (const w of this.wheels) {
      this.rayOrigin.copy(w.mountLocal).applyQuat(this.q).add(this.pos);
      const maxDist = w.susp.restLength + w.wheel.radius;
      const hit = this.physics.castWheelRay(this.rayOrigin, this.rayDir, maxDist, body);
      if (!hit) {
        w.grounded = false;
        w.load = 0;
        w.updateCompression(0, dt);
        w.suspensionLength = w.susp.restLength;
        continue;
      }
      w.grounded = true;
      w.surface = hit.surface;
      w.contactNormal.copy(hit.normal);
      w.contactPoint.copy(this.rayOrigin).addScaled(this.rayDir, hit.distance);

      const rawLength = hit.distance - w.wheel.radius;
      const rawCompression = w.susp.restLength - rawLength;
      const compression = clamp(rawCompression, 0, w.susp.maxCompression);
      w.suspensionLength = w.susp.restLength - compression;
      const compressionVel = w.updateCompression(compression, dt);

      // Spring (Hooke) + velocity damper with separate bump/rebound rates.
      const damping = compressionVel > 0 ? w.susp.bumpDamping : w.susp.reboundDamping;
      let force = w.susp.stiffness * compression + damping * compressionVel;
      // Bump stop: a much stiffer spring once travel is used up, so the chassis doesn't bottom out.
      if (rawCompression > w.susp.maxCompression) {
        // Excess is capped so a ray starting inside geometry (after a crash) can't launch the car.
        const excess = Math.min(rawCompression - w.susp.maxCompression, 0.08);
        force += w.susp.stiffness * BUMP_STOP_STIFFNESS_MUL * excess;
      }
      // Dampers can pull, but a tire can't: never apply a net downward force.
      w.load = Math.max(0, force);
    }

    // Anti-roll bars: a torsion spring resisting left/right compression *difference*.
    // It moves load from the inner to the outer wheel of an axle: a stiffer bar at one end
    // takes grip from that end in corners (front bar → understeer, rear bar → oversteer).
    for (const [l, r, k] of [[0, 1, c.suspension.front.antiRollBar], [2, 3, c.suspension.rear.antiRollBar]] as const) {
      const wl = this.wheels[l], wr = this.wheels[r];
      if (!wl.grounded && !wr.grounded) continue;
      const f = k * (wl.compression - wr.compression);
      if (wl.grounded) wl.load = Math.max(0, wl.load + f);
      if (wr.grounded) wr.load = Math.max(0, wr.load - f);
    }

    // Apply suspension forces along the chassis up axis at each contact point.
    for (const w of this.wheels) {
      if (!w.grounded || w.load <= 0) continue;
      this.tmp.copy(this.up).scale(w.load * dt);
      body.applyImpulseAtPoint(this.tmp, w.contactPoint, true);
    }

    // ---------- Contact frames and contact-patch velocities ----------
    for (const w of this.wheels) {
      // Wheel heading in local space, steered about the local up axis: (sin δ, 0, −cos δ).
      w.fwd.set(Math.sin(w.steerAngle), 0, -Math.cos(w.steerAngle)).applyQuat(this.q);
      if (!w.grounded) { w.vLong = w.vLat = 0; continue; }
      // Project the heading onto the ground plane, then side = fwd × normal (points right).
      const n = w.contactNormal;
      w.fwd.addScaled(n, -w.fwd.dot(n)).normalize();
      w.side.crossVectors(w.fwd, n);
      const pv = body.velocityAtPoint(w.contactPoint, this.pointVel as RAPIER.Vector);
      w.vLong = w.fwd.dot(pv);
      w.vLat = w.side.dot(pv);
    }

    // ---------- Driver aids evaluated per step ----------
    this.updateEsc(throttle);
    if (this.aidsActive.esc && this.escUndersteer) throttle *= 0.6;

    // Brake torques per wheel (before ABS modulation, which happens per sub-step).
    const b = c.brakes;
    for (const w of this.wheels) {
      const axleShare = w.isFront ? b.bias : 1 - b.bias;
      w.brakeTorque = (brake * b.maxTorque * axleShare) / 2 + this.escBrake[w.index];
      if (!w.isFront) w.brakeTorque += this.appliedHandbrake * b.handbrakeTorque;
    }

    // Traction control: cut throttle when a driven wheel spins well past peak slip.
    let maxDrivenSlip = 0;
    for (const w of this.wheels) if (w.driveShare > 0 && w.grounded) maxDrivenSlip = Math.max(maxDrivenSlip, w.slipRatio / w.tire.peakSlipRatio);
    // Proportional: the further past 1.3× peak slip, the more throttle is removed. Cuts fast, restores gently.
    const tcTarget = this.aids.tc ? clamp(1 - (maxDrivenSlip - 1.3) * 0.6, 0.25, 1) : 1;
    this.tcFactor = approach(this.tcFactor, tcTarget, (tcTarget < this.tcFactor ? 10 : 2.5) * dt);
    this.aidsActive.tc = this.tcFactor < 0.95;
    this.appliedThrottle = throttle * this.tcFactor;
    this.appliedBrake = brake;

    // ---------- Sub-stepped wheel / tire / drivetrain integration ----------
    const h = dt / SUBSTEPS;
    this.accFx.fill(0); this.accFy.fill(0); this.accGrip.fill(0);
    let absAny = false;
    let driveAvg = 0;
    for (let sIdx = 0; sIdx < SUBSTEPS; sIdx++) {
      // 1) Engine/clutch → total wheel torque, then distribute through the diffs.
      const pt = this.powertrain.substep(h, this.appliedThrottle, this.drivelineOmega(), this.ptOut);
      for (const w of this.wheels) this.wheelInertia[w.index] = w.wheel.inertia + pt.reflectedInertia * w.driveShare;
      this.distributeTorque(pt.wheelTorque, h);
      driveAvg += pt.wheelTorque / SUBSTEPS;

      // 2) Per wheel: tire force and implicit spin integration.
      for (const w of this.wheels) {
        const I = this.wheelInertia[w.index];
        const R = w.wheel.radius;
        const drive = this.wheelDrive[w.index];

        // ABS: modulate pressure when the wheel locks well past the peak slip ratio.
        let brakeT = w.brakeTorque;
        if (this.aids.abs && brakeT > 0 && w.grounded && Math.abs(w.vLong) > 2) {
          const lock = -w.slipRatio / w.tire.peakSlipRatio;
          w.absFactor = clamp(w.absFactor + (lock > 1.4 ? -18 : 10) * h, 0.1, 1);
          // The handbrake bypasses ABS (it's what you use to start a drift).
          const hb = !w.isFront ? this.appliedHandbrake * c.brakes.handbrakeTorque : 0;
          brakeT = (brakeT - hb) * w.absFactor + hb;
        } else {
          w.absFactor = 1;
        }
        if (w.absFactor < 0.95) absAny = true;

        let fx = 0, fy = 0, k = 0;
        if (w.grounded && w.load > 0) {
          const surf = SURFACES[w.surface];
          const grip = surf.gripMul * (c.tires.surfaceGrip?.[w.surface] ?? 1);
          const denom = Math.max(Math.abs(w.vLong), SLIP_SPEED_FLOOR);
          const kappa = (w.omega * R - w.vLong) / denom;
          const tanAlpha = w.vLat / denom;
          const tf = computeTireForce(w.tire, w.curve, kappa, tanAlpha, w.load, grip, surf.peakSlipMul, this.tireOut);
          fx = tf.fx; fy = tf.fy;
          w.slipRatio = kappa;
          w.slipAngle = Math.atan(tanAlpha);
          w.combinedSlip = tf.combinedSlip;
          this.accGrip[w.index] += tf.gripUsed / SUBSTEPS;

          // Local slope dFx/dω (numerical) for implicit integration. Without this, a stiff tire on a
          // light wheel makes explicit integration explode at low speed. Only the stabilising
          // (positive) part matters; past the peak the slope is ~0 or negative.
          const dk = 1e-3;
          const fx2 = computeTireForce(w.tire, w.curve, kappa + dk, tanAlpha, w.load, grip, surf.peakSlipMul, this.tireOut).fx;
          k = Math.max(0, (fx2 - fx) / dk) * (R / denom);

          // Rolling resistance acts like a small extra brake torque; sinkDrag models gravel/grass ploughing.
          brakeT += surf.rollingResist * w.load * R + surf.sinkDrag * (w.load / 1000) * Math.abs(w.vLong) * R;
        } else {
          w.slipRatio = 0;
          w.slipAngle = 0;
          w.combinedSlip = 0;
        }

        // Wheel spin: I·dω/dt = T_drive − R·Fx − T_brake·sign(ω)
        // Implicit in the tire term: (I + h·R·k)·Δω = h·(T_drive − R·Fx) − brake impulse.
        const effI = I + h * R * k;
        const free = w.omega + (h * (drive - R * fx)) / effI;
        const brakeDelta = (h * brakeT) / effI;
        // Brakes are friction: they can stop the wheel but never spin it backwards.
        w.omega = Math.abs(free) <= brakeDelta ? 0 : free - sign(free) * brakeDelta;

        this.accFx[w.index] += fx / SUBSTEPS;
        this.accFy[w.index] += fy / SUBSTEPS;
      }
    }
    this.aidsActive.abs = absAny;

    // ---------- Apply averaged tire forces at the contact patches ----------
    for (const w of this.wheels) {
      w.fx = this.accFx[w.index];
      w.fy = this.accFy[w.index];
      w.gripUsed = this.accGrip[w.index];
      w.driveTorque = this.wheelDrive[w.index];
      w.spinAngle = (w.spinAngle + w.omega * dt) % (Math.PI * 2);
      if (!w.grounded) continue;
      this.tmp.copy(w.fwd).scale(w.fx * dt).addScaled(w.side, w.fy * dt);
      body.applyImpulseAtPoint(this.tmp, w.contactPoint, true);
    }

    this.applyAero(dt);
  }

  /** Split powertrain torque to the wheels through the centre and axle differentials. */
  private distributeTorque(total: number, h: number): void {
    const d = this.config.drivetrain;
    const [fl, fr, rl, rr] = this.wheels;
    const I = this.wheelInertia;
    const drive = this.wheelDrive;
    drive.fill(0);
    const axle = (t: number, a: WheelState, bw: WheelState, cfg: typeof d.front) => {
      splitDiff(t, 0.5, a.omega, bw.omega, I[a.index], I[bw.index], cfg, h, this.diffOut);
      drive[a.index] = this.diffOut[0];
      drive[bw.index] = this.diffOut[1];
    };
    if (d.layout === 'FWD') axle(total, fl, fr, d.front);
    else if (d.layout === 'RWD') axle(total, rl, rr, d.rear);
    else {
      const omegaF = (fl.omega + fr.omega) / 2, omegaR = (rl.omega + rr.omega) / 2;
      const iF = I[0] + I[1], iR = I[2] + I[3];
      splitDiff(total, d.frontTorqueSplit, omegaF, omegaR, iF, iR, d.center, h, this.diffOut);
      const tF = this.diffOut[0], tR = this.diffOut[1];
      axle(tF, fl, fr, d.front);
      axle(tR, rl, rr, d.rear);
    }
  }

  /**
   * Stability control: compare the actual yaw rate to what a steady-state bicycle model predicts
   * for this steering angle and speed, and brake individual wheels to correct the difference.
   *   r_desired = v·δ / (L · (1 + (v / v_char)²))      (v_char: understeer characteristic speed)
   * clamped by what the tires can deliver: |r| ≤ μ·g / v.
   */
  private updateEsc(throttle: number): void {
    this.escBrake.fill(0);
    this.aidsActive.esc = false;
    this.escUndersteer = false;
    const v = this.forwardSpeed;
    if (!this.aids.esc || v < 6 || this.appliedHandbrake > 0.1) return;
    const delta = (this.wheels[0].steerAngle + this.wheels[1].steerAngle) / 2;
    const L = this.config.geometry.wheelbase;
    const vChar = 28;
    const mu = this.config.tires.rear.muLat;
    const rMax = (mu * GRAVITY) / v;
    const rDes = clamp((v * delta) / (L * (1 + (v / vChar) ** 2)), -rMax, rMax);
    const r = this.yawRate;
    const err = r - rDes;
    const brakeGain = 2600; // Nm per rad/s of yaw-rate error
    const turningRight = (Math.abs(rDes) > 0.02 ? rDes : r) > 0;
    if (Math.abs(r) > Math.abs(rDes) + 0.06 && sign(err) === sign(r)) {
      // Oversteer: brake the OUTER front wheel to create a stabilising yaw moment.
      const idx = turningRight ? 0 : 1;
      this.escBrake[idx] = Math.min(2500, brakeGain * (Math.abs(err) - 0.06));
      this.aidsActive.esc = true;
    } else if (Math.abs(rDes) > 0.05 && Math.abs(r) < Math.abs(rDes) - 0.1 && throttle > 0.1) {
      // Understeer: brake the INNER rear wheel and ease the throttle.
      const idx = turningRight ? 3 : 2;
      this.escBrake[idx] = Math.min(1200, brakeGain * 0.5 * (Math.abs(rDes) - Math.abs(r) - 0.1));
      this.escUndersteer = true;
      this.aidsActive.esc = true;
    }
  }

  /**
   * Aerodynamics. Drag: F = ½ρ·CdA·|v|·v, opposing velocity, at the CoM.
   * Downforce: F = ½ρ·ClA·v_fwd², split between the axles by aero balance, so it adds grip
   * at speed (and shifts the handling balance if the balance differs from the weight distribution).
   */
  private applyAero(dt: number): void {
    const a = this.config.aero;
    const body = this.body;
    const q = 0.5 * AIR_DENSITY;
    // Drag at the centre of mass (applyImpulse acts at the CoM).
    this.tmp.copy(this.vel).scale(-q * a.dragArea * this.speed * dt);
    body.applyImpulse(this.tmp, true);

    if (a.downforceArea === 0) return;
    const df = q * a.downforceArea * this.forwardSpeed * this.forwardSpeed;
    const L = this.config.geometry.wheelbase;
    for (const [z, share] of [[-L / 2, a.balance], [L / 2, 1 - a.balance]] as const) {
      this.tmp2.set(0, this.config.chassis.cgHeight, z).applyQuat(this.q).add(this.pos);
      this.tmp.copy(this.up).scale(-df * share * dt);
      body.applyImpulseAtPoint(this.tmp, this.tmp2, true);
    }
  }

  /** Teleport to a pose and clear all dynamic state. */
  reset(position: V3, yaw: number): void {
    const rot = new Quat().setFromAxisAngle({ x: 0, y: 1, z: 0 }, yaw);
    this.body.setTranslation({ x: position.x, y: position.y + 0.05, z: position.z }, true);
    this.body.setRotation(rot, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const w of this.wheels) w.resetDynamics();
    this.powertrain.reset();
    this.steerInput = 0;
    this.prevVel.set(0, 0, 0);
  }

  /** Engine speed (rpm), for HUD/audio. */
  get rpm(): number { return this.powertrain.rpm; }
  get gear(): number { return this.powertrain.gear; }

  /** Chassis pose (body origin, i.e. ground-level centre of the wheelbase). */
  getPose(outPos: Vec3, outRot: Quat): void {
    outPos.copy(this.body.translation());
    outRot.copy(this.body.rotation());
  }

  dispose(): void {
    this.physics.world.removeRigidBody(this.body);
  }
}
