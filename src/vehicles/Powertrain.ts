import { clamp, RAD_TO_RPM, RPM_TO_RAD, sampleCurve, sign } from '../core/math';
import type { CarConfig, DiffConfig } from './types';

/** Output of one powertrain sub-step. */
export interface PowertrainOutput {
  /** Total torque delivered to the driven wheels, after gearing (Nm). */
  wheelTorque: number;
  /**
   * Engine + flywheel inertia reflected through the gearbox (Ie·G²), only while the clutch is locked.
   * In 1st gear this can be 10× a wheel's own inertia, which is why low gears feel "heavy" and why
   * wheelspin builds progressively instead of instantly.
   */
  reflectedInertia: number;
}

/**
 * Engine, clutch and gearbox.
 *
 * Gears: -1 = reverse, 0 = neutral, 1..n = forward.
 *
 * Clutch model, two states:
 *  - locked:   engine speed is slaved to the driveline (ω_e = ω_wheels · G); engine torque passes straight through.
 *  - slipping: engine spins freely; the clutch transmits a friction torque toward the driveline speed.
 *
 * Launch from rest: clutch capacity rises with rpm (like an automated clutch), reaching the engine's
 * torque at `launchRpm`, so full throttle holds the engine near launch rpm while the car pulls away.
 * After a gear change the clutch closes with full capacity instead, for a quick re-sync.
 */
export class Powertrain {
  gear = 1;
  rpm: number;
  automatic = true;
  clutchLocked = false;
  /** Engine torque output at the crank this sub-step (Nm, negative = engine braking). */
  engineTorque = 0;
  /** Throttle actually applied after limiter/shift cut (0..1). */
  effectiveThrottle = 0;
  /** Increments on every completed shift; the renderer/audio watch it for shift effects. */
  shiftCounter = 0;
  /** -1 for the last shift being a downshift, +1 for an upshift. */
  lastShiftDirection = 0;

  private shiftTimer = 0;
  private targetGear = 1;
  private limiterTimer = 0;
  /** True while pulling away from rest (soft, rpm-based clutch bite); false after the clutch has locked. */
  private launchMode = true;
  private readonly peakTorque: number;

  constructor(private readonly cfg: CarConfig) {
    this.rpm = cfg.engine.idleRpm;
    this.peakTorque = Math.max(...cfg.engine.torqueCurve.map(p => p[1]));
  }

  get forwardGears(): number { return this.cfg.gearbox.ratios.length; }
  get isShifting(): boolean { return this.shiftTimer > 0; }

  /** Overall ratio engine:wheel for a gear (negative for reverse, 0 for neutral). */
  ratio(gear: number): number {
    const gb = this.cfg.gearbox;
    if (gear > 0) return gb.ratios[gear - 1] * gb.finalDrive;
    if (gear < 0) return -gb.reverse * gb.finalDrive;
    return 0;
  }

  /** Engine RPM the driveline would force in a given gear at a given driveline speed. */
  rpmInGear(gear: number, drivelineOmega: number): number {
    return Math.abs(drivelineOmega * this.ratio(gear)) * RAD_TO_RPM;
  }

  requestShift(gear: number): void {
    gear = clamp(gear, -1, this.forwardGears);
    if (this.isShifting || gear === this.gear) return;
    this.lastShiftDirection = gear > this.gear ? 1 : -1;
    this.targetGear = gear;
    this.shiftTimer = this.cfg.gearbox.shiftTime;
    this.clutchLocked = false;
  }

  /** Per physics step: timers. */
  update(dt: number): void {
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) {
        this.shiftTimer = 0;
        this.gear = this.targetGear;
        this.shiftCounter++;
      }
    }
    if (this.limiterTimer > 0) this.limiterTimer -= dt;
  }

  torqueAt(rpm: number): number {
    return sampleCurve(this.cfg.engine.torqueCurve, rpm);
  }

  /**
   * Advance engine/clutch by one sub-step.
   * @param drivelineOmega weighted mean angular speed of the driven wheels (rad/s, + = forward)
   */
  substep(h: number, throttleIn: number, drivelineOmega: number, out: PowertrainOutput): PowertrainOutput {
    const e = this.cfg.engine;
    let thr = throttleIn;

    if (this.isShifting) {
      // Upshift: torque cut. Downshift: automatic throttle blip to rev-match.
      thr = this.lastShiftDirection < 0 ? 0.55 : 0;
    }
    if (this.rpm >= e.limiterRpm) this.limiterTimer = 0.06; // hard-cut limiter
    if (this.limiterTimer > 0) thr = 0;
    // Idle governor: keeps the engine from dying when it's free-spinning.
    if (!this.clutchLocked && this.rpm < e.idleRpm) thr = Math.max(thr, clamp((e.idleRpm - this.rpm) / 300, 0, 0.35));
    this.effectiveThrottle = thr;

    // Full-throttle curve blended with a friction/pumping loss that grows with rpm.
    const te = thr * this.torqueAt(this.rpm) - (1 - thr) * e.engineBraking * (this.rpm / e.redlineRpm);
    this.engineTorque = te;

    const G = this.isShifting ? 0 : this.ratio(this.gear);
    const eff = this.cfg.gearbox.efficiency;
    let omegaE = this.rpm * RPM_TO_RAD;

    out.wheelTorque = 0;
    out.reflectedInertia = 0;

    if (G === 0) {
      // Neutral or mid-shift: engine spins freely.
      this.clutchLocked = false;
      omegaE += (h * te) / e.inertia;
    } else {
      const omegaClutchOut = drivelineOmega * G; // driveline speed seen from the engine side
      if (this.clutchLocked) {
        omegaE = omegaClutchOut;
        if (omegaE * RAD_TO_RPM < e.idleRpm * 0.9) {
          this.clutchLocked = false; // would stall: slip the clutch instead
          this.launchMode = true;
        }
        out.wheelTorque = te * G * eff;
        out.reflectedInertia = e.inertia * G * G;
      } else {
        let capacity: number;
        if (this.launchMode) {
          // Bite rises from just above idle; at launchRpm it slightly exceeds the engine's torque there,
          // so a flat-out start settles the engine at ~launchRpm.
          const engagement = clamp((this.rpm - e.idleRpm * 1.05) / (e.launchRpm - e.idleRpm * 1.05), 0, 1);
          // As road speed builds, the clutch closes fully (like a driver finishing the pedal release),
          // reaching full capacity when the driveline alone would spin the engine at launch rpm.
          const release = clamp(Math.abs(omegaClutchOut) * RAD_TO_RPM / e.launchRpm, 0, 1) ** 2;
          capacity = engagement * this.torqueAt(e.launchRpm) * 1.05 + release * this.peakTorque;
        } else {
          capacity = this.peakTorque * 2;
        }
        const slip = omegaE - omegaClutchOut;
        // Friction torque toward zero slip, smoothed over a small band (8 rad/s) to avoid chatter.
        const tc = capacity * clamp(slip / 8, -1, 1);
        const next = omegaE + (h * (te - tc)) / e.inertia;
        if (sign(next - omegaClutchOut) !== sign(slip) || Math.abs(slip) < 0.5) {
          // Speeds matched within this sub-step: lock the clutch.
          omegaE = omegaClutchOut;
          this.clutchLocked = true;
          this.launchMode = false;
        } else {
          omegaE = next;
        }
        out.wheelTorque = tc * G * eff;
      }
    }

    this.rpm = clamp(omegaE * RAD_TO_RPM, 0, e.limiterRpm * 1.15);
    return out;
  }

  reset(): void {
    this.gear = 1;
    this.targetGear = 1;
    this.shiftTimer = 0;
    this.rpm = this.cfg.engine.idleRpm;
    this.clutchLocked = false;
    this.launchMode = true;
  }
}

/**
 * Split input torque between two outputs (left/right wheels, or front/rear axles).
 *
 * Open diff: torque split by `bias` (0.5 for an axle), so the output with less grip spins up.
 * LSD (clutch pack): adds a locking torque that moves torque from the faster to the slower output,
 * up to (preload + lockRatio·|T_in|). The transfer is also capped at what would exactly equalise the
 * two speeds this sub-step:  T_eq = Δω · (Ia·Ib)/(Ia+Ib) / h. That keeps it stable at any lock ratio.
 */
export function splitDiff(
  tIn: number, bias: number,
  omegaA: number, omegaB: number,
  inertiaA: number, inertiaB: number,
  cfg: DiffConfig, h: number,
  out: [number, number],
): [number, number] {
  let ta = tIn * bias;
  let tb = tIn * (1 - bias);
  if (cfg.type === 'lsd') {
    const limit = cfg.preload + cfg.lockRatio * Math.abs(tIn);
    const equalise = ((omegaA - omegaB) * (inertiaA * inertiaB)) / ((inertiaA + inertiaB) * h);
    // Half of the equalising torque per sub-step: avoids clutch-pack chatter.
    const transfer = clamp(equalise * 0.5, -limit, limit);
    ta -= transfer;
    tb += transfer;
  }
  out[0] = ta;
  out[1] = tb;
  return out;
}
