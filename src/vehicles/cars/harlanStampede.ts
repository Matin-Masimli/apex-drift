import type { CarConfig } from '../types';

/**
 * Harlan Stampede 7.4: front-engined, rear-drive muscle car. Massive low-down torque, street tyres,
 * a heavy nose and a rear end that steps out on demand. Loves to drift.
 */
export const harlanStampede: CarConfig = {
  id: 'harlan-stampede',
  name: 'Harlan Stampede 7.4',
  class: 'muscle',
  backstory:
    'Harlan Motor Works never met a problem a bigger engine could not solve. The Stampede puts 7.4 litres ' +
    'of V8 in front of the driver and leaves the physics to sort out the rest. It goes sideways happily and often.',
  ratings: { speed: 7, acceleration: 7, handling: 4, braking: 5 },

  chassis: {
    mass: 1690,
    weightFront: 0.55,
    cgHeight: 0.53,
    halfExtents: [0.98, 0.42, 2.45],
    colliderCenterY: 0.74,
    inertiaScale: [0.95, 0.95, 0.95],
  },

  geometry: { wheelbase: 2.85, trackFront: 1.6, trackRear: 1.6 },

  suspension: {
    front: { restLength: 0.24, maxCompression: 0.16, stiffness: 42000, bumpDamping: 3000, reboundDamping: 4600, antiRollBar: 24000 },
    rear: { restLength: 0.24, maxCompression: 0.16, stiffness: 36000, bumpDamping: 2800, reboundDamping: 4200, antiRollBar: 9000 },
  },

  wheels: {
    front: { radius: 0.35, width: 0.26, inertia: 1.5 },
    rear: { radius: 0.355, width: 0.32, inertia: 1.7 },
  },

  tires: {
    // Street tyres: moderate grip with a long, gentle plateau past the peak, so slides are catchable.
    front: { muLong: 1.08, muLat: 1.06, peakSlipRatio: 0.12, peakSlipAngleDeg: 8, shape: 1.3, loadSensitivity: 0.12, nominalLoad: 4600 },
    rear: { muLong: 1.16, muLat: 1.0, peakSlipRatio: 0.12, peakSlipAngleDeg: 8, shape: 1.26, loadSensitivity: 0.12, nominalLoad: 3800 },
  },

  steering: { maxAngleDeg: 36, speed: 3.0, speedSensitivity: 0.045, ackermann: 0.5 },

  engine: {
    idleRpm: 750,
    redlineRpm: 6200,
    limiterRpm: 6400,
    torqueCurve: [
      [800, 450], [1000, 520], [2000, 680], [3000, 760], [3800, 780],
      [4500, 770], [5500, 725], [6200, 640], [6600, 500],
    ],
    inertia: 0.32,
    engineBraking: 120,
    launchRpm: 2600,
  },

  gearbox: {
    ratios: [2.95, 1.94, 1.34, 1.0, 0.8],
    reverse: 2.8,
    finalDrive: 3.55,
    shiftTime: 0.16,
    autoUpshiftRpm: 6000,
    autoDownshiftRpm: 3000,
    efficiency: 0.88,
  },

  drivetrain: {
    layout: 'RWD',
    frontTorqueSplit: 0,
    front: { type: 'open', preload: 0, lockRatio: 0 },
    // A tight clutch-type diff: both rear tyres light up together, which is what drifting needs.
    rear: { type: 'lsd', preload: 200, lockRatio: 0.55 },
    center: { type: 'open', preload: 0, lockRatio: 0 },
  },

  brakes: { maxTorque: 6400, bias: 0.64, handbrakeTorque: 3000 },

  aero: { dragArea: 0.95, downforceArea: 0, balance: 0.5 },

  aids: { abs: true, tc: false, esc: false },

  // The AI drives this tail-happy car a little further from the limit than the others.
  ai: { gripScale: 0.92 },

  visual: {
    style: 'muscle',
    paints: [
      { name: 'Grabber Lime', color: 0x7fc31c, metalness: 0.2, flake: 0.2 },
      { name: 'Plum Crazy', color: 0x5a1a7a, flake: 0.6 },
      { name: 'Gloss Black', color: 0x0c0c0e, metalness: 0.3, roughness: 0.25, flake: 0.5 },
      { name: 'Candy Red', color: 0x9e0d14, flake: 0.8 },
    ],
    livery: { name: 'Twin Stripe No. 55', base: 0x1b3a8c, accents: [0xffffff], pattern: 'stripes', number: 55 },
    rims: { color: 0xd8dade, metalness: 1 },
    caliperColor: 0x1a1a1a,
    steeringRatio: 9,
    exhausts: [[-0.6, 0.3, 2.42], [0.6, 0.3, 2.42]],
  },
};
