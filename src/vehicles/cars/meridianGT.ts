import type { CarConfig } from '../types';

/**
 * Aurel Meridian GT-E: front-mid-engined GT endurance racer. The M1 reference car:
 * balanced, stable, high top speed. All other cars are tuned relative to this one.
 */
export const meridianGT: CarConfig = {
  id: 'meridian-gte',
  name: 'Aurel Meridian GT-E',
  class: 'gt',
  backstory:
    'Built by the small coachworks of Aurel to win a 24-hour race on its first attempt, the Meridian ' +
    'trades outright aggression for composure. It is the car privateer teams buy when they want to finish.',
  ratings: { speed: 8, acceleration: 7, handling: 7, braking: 8 },

  chassis: {
    mass: 1280,
    weightFront: 0.47,
    cgHeight: 0.46,
    halfExtents: [0.97, 0.36, 2.32],
    colliderCenterY: 0.66,
    inertiaScale: [0.9, 0.85, 0.9],
  },

  geometry: { wheelbase: 2.68, trackFront: 1.64, trackRear: 1.62 },

  suspension: {
    // ~2.2 Hz front / 2.0 Hz rear ride frequency, damping ratio ~0.35 bump / ~0.55 rebound.
    front: { restLength: 0.2, maxCompression: 0.14, stiffness: 58000, bumpDamping: 3200, reboundDamping: 5200, antiRollBar: 26000 },
    rear: { restLength: 0.2, maxCompression: 0.14, stiffness: 54000, bumpDamping: 3300, reboundDamping: 5400, antiRollBar: 15000 },
  },

  wheels: {
    front: { radius: 0.34, width: 0.29, inertia: 1.3 },
    rear: { radius: 0.345, width: 0.32, inertia: 1.4 },
  },

  tires: {
    front: { muLong: 1.5, muLat: 1.45, peakSlipRatio: 0.1, peakSlipAngleDeg: 7, shape: 1.45, loadSensitivity: 0.12, nominalLoad: 3200 },
    rear: { muLong: 1.52, muLat: 1.48, peakSlipRatio: 0.1, peakSlipAngleDeg: 7.5, shape: 1.42, loadSensitivity: 0.12, nominalLoad: 3400 },
  },

  steering: { maxAngleDeg: 32, speed: 3.2, speedSensitivity: 0.055, ackermann: 0.6 },

  engine: {
    idleRpm: 950,
    redlineRpm: 8000,
    limiterRpm: 8250,
    torqueCurve: [
      [800, 260], [2000, 410], [3000, 495], [4000, 560], [5000, 600],
      [6000, 592], [7000, 545], [7800, 485], [8300, 380],
    ],
    inertia: 0.2,
    engineBraking: 90,
    launchRpm: 3800,
  },

  gearbox: {
    ratios: [3.15, 2.3, 1.76, 1.41, 1.16, 0.97],
    reverse: 3.0,
    finalDrive: 3.55,
    shiftTime: 0.12,
    autoUpshiftRpm: 7700,
    autoDownshiftRpm: 4300,
    efficiency: 0.9,
  },

  drivetrain: {
    layout: 'RWD',
    frontTorqueSplit: 0,
    front: { type: 'open', preload: 0, lockRatio: 0 },
    rear: { type: 'lsd', preload: 120, lockRatio: 0.35 },
    center: { type: 'open', preload: 0, lockRatio: 0 },
  },

  brakes: { maxTorque: 7600, bias: 0.6, handbrakeTorque: 2600 },

  aero: { dragArea: 0.86, downforceArea: 2.1, balance: 0.43 },

  aids: { abs: true, tc: true, esc: false },
};
