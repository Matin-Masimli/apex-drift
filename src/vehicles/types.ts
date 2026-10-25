import type { TireParams } from '../physics/tire';
import type { Surface } from '../physics/surfaces';

/**
 * Data-driven car definition. Every tuning number lives here, so new cars and re-tunes need no code.
 *
 * Geometry is in the car's local frame: forward = -Z, right = +X, up = +Y.
 * The chassis origin is on the ground plane, at the middle of the wheelbase, at design ride height.
 */

export type Drivetrain = 'FWD' | 'RWD' | 'AWD';
export type CarClass = 'formula' | 'gt' | 'rally' | 'muscle' | 'hyper' | 'hatch';

export interface DiffConfig {
  /** open: equal torque, the wheel with less grip spins. lsd: clutch-type limited slip. */
  type: 'open' | 'lsd';
  /** Locking torque available with no input torque (Nm). */
  preload: number;
  /** Extra locking torque as a fraction of input torque (0 = open, 1 = spool). */
  lockRatio: number;
}

export interface AxleSuspension {
  /** Spring length at full extension (m). Spring force is zero here. */
  restLength: number;
  /** Maximum compression from full extension before the bump stop (m). */
  maxCompression: number;
  /** Wheel-rate spring stiffness (N/m). */
  stiffness: number;
  /** Damping while compressing (N per m/s). */
  bumpDamping: number;
  /** Damping while extending (N per m/s). Usually ~1.5× bump. */
  reboundDamping: number;
  /** Anti-roll bar stiffness (N/m of left/right compression difference). */
  antiRollBar: number;
}

export interface WheelConfig {
  radius: number;
  width: number;
  /** Rotational inertia of wheel + tire + brake disc (kg·m²). */
  inertia: number;
}

export interface CarConfig {
  id: string;
  name: string;
  class: CarClass;
  /** Short flavour text for the car select screen. */
  backstory: string;
  /** Display ratings, 1..10, for stat bars. */
  ratings: { speed: number; acceleration: number; handling: number; braking: number };

  chassis: {
    /** Total mass including wheels (kg). */
    mass: number;
    /** Front axle load fraction at rest (0..1). */
    weightFront: number;
    /** Centre of mass height above ground (m). */
    cgHeight: number;
    /** Collision box half extents (m) and its centre height above ground. */
    halfExtents: [number, number, number];
    colliderCenterY: number;
    /** Multiplies the solid-box inertia estimate per axis (pitch X, yaw Y, roll Z). Lower = more agile. */
    inertiaScale: [number, number, number];
  };

  geometry: {
    wheelbase: number;
    trackFront: number;
    trackRear: number;
  };

  suspension: { front: AxleSuspension; rear: AxleSuspension };
  wheels: { front: WheelConfig; rear: WheelConfig };
  tires: {
    front: TireParams;
    rear: TireParams;
    /** Per-surface grip multipliers for this car's tires (e.g. rally tires on gravel). */
    surfaceGrip?: Partial<Record<Surface, number>>;
  };

  steering: {
    maxAngleDeg: number;
    /** Steering rack speed (rad/s of road-wheel angle). */
    speed: number;
    /** Steering lock reduction with speed: limit = max / (1 + speed_ms · k). */
    speedSensitivity: number;
    /** 0 = parallel steer, 1 = full Ackermann geometry. */
    ackermann: number;
  };

  engine: {
    idleRpm: number;
    redlineRpm: number;
    limiterRpm: number;
    /** [rpm, torque Nm] points, full throttle. */
    torqueCurve: [number, number][];
    /** Crank + flywheel inertia (kg·m²). */
    inertia: number;
    /** Engine braking torque at redline with closed throttle (Nm). Scales linearly with rpm. */
    engineBraking: number;
    /** RPM the clutch slips at during a standing start with full throttle. */
    launchRpm: number;
  };

  gearbox: {
    /** Forward gear ratios, 1st first. */
    ratios: number[];
    reverse: number;
    finalDrive: number;
    /** Time with the clutch open during a shift (s). */
    shiftTime: number;
    autoUpshiftRpm: number;
    autoDownshiftRpm: number;
    /** Driveline efficiency (0..1). */
    efficiency: number;
  };

  drivetrain: {
    layout: Drivetrain;
    /** AWD only: fraction of torque sent to the front axle by the centre diff. */
    frontTorqueSplit: number;
    front: DiffConfig;
    rear: DiffConfig;
    center: DiffConfig;
  };

  brakes: {
    /** Total brake torque at full pedal, all wheels (Nm). */
    maxTorque: number;
    /** Fraction of brake torque at the front axle. */
    bias: number;
    /** Handbrake torque per rear wheel (Nm). */
    handbrakeTorque: number;
  };

  aero: {
    /** Drag coefficient × frontal area, Cd·A (m²). */
    dragArea: number;
    /** Lift coefficient × area, Cl·A (m²). Positive = downforce. */
    downforceArea: number;
    /** Fraction of downforce on the front axle. */
    balance: number;
  };

  aids: {
    abs: boolean;
    tc: boolean;
    esc: boolean;
  };
}

/** Driver controls for one physics step. The sim smooths and limits these itself. */
export interface DriverInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (left) .. +1 (right) */
  steer: number;
  /** 0..1 */
  handbrake: number;
  /** Edge-triggered: true for exactly one step per press. */
  shiftUp: boolean;
  shiftDown: boolean;
}

export const neutralInput = (): DriverInput => ({
  throttle: 0, brake: 0, steer: 0, handbrake: 0, shiftUp: false, shiftDown: false,
});
