import type { CarConfig } from '../types';

/**
 * Seraph Vanta: mid-engined, rear-drive hypercar. The highest top speed in the roster and a snappy
 * tyre/inertia combination that punishes clumsy inputs at the limit.
 */
export const seraphVanta: CarConfig = {
  id: 'seraph-vanta',
  name: 'Seraph Vanta',
  class: 'hyper',
  backstory:
    'Seraph built the Vanta to settle a single argument about top speed, then sold the prototypes to people who ' +
    'wanted to keep having it. Over a thousand horsepower, a slippery body, and very little patience for mistakes.',
  ratings: { speed: 10, acceleration: 9, handling: 6, braking: 8 },

  chassis: {
    mass: 1420,
    weightFront: 0.42,
    cgHeight: 0.4,
    halfExtents: [1.02, 0.33, 2.35],
    colliderCenterY: 0.6,
    inertiaScale: [0.8, 0.78, 0.8],
  },

  geometry: { wheelbase: 2.75, trackFront: 1.7, trackRear: 1.66 },

  suspension: {
    front: { restLength: 0.18, maxCompression: 0.12, stiffness: 68000, bumpDamping: 3600, reboundDamping: 5800, antiRollBar: 30000 },
    rear: { restLength: 0.18, maxCompression: 0.12, stiffness: 78000, bumpDamping: 4000, reboundDamping: 6400, antiRollBar: 22000 },
  },

  wheels: {
    front: { radius: 0.35, width: 0.28, inertia: 1.3 },
    rear: { radius: 0.36, width: 0.35, inertia: 1.5 },
  },

  tires: {
    // Sharp semi-slicks: high peak, early and steep fall-off.
    front: { muLong: 1.42, muLat: 1.4, peakSlipRatio: 0.09, peakSlipAngleDeg: 6, shape: 1.72, loadSensitivity: 0.13, nominalLoad: 3000 },
    rear: { muLong: 1.48, muLat: 1.44, peakSlipRatio: 0.09, peakSlipAngleDeg: 6, shape: 1.75, loadSensitivity: 0.13, nominalLoad: 4100 },
  },

  steering: { maxAngleDeg: 30, speed: 3.4, speedSensitivity: 0.06, ackermann: 0.5 },

  engine: {
    idleRpm: 1000,
    redlineRpm: 9000,
    limiterRpm: 9200,
    torqueCurve: [
      [1000, 500], [2500, 800], [4000, 930], [6000, 1000], [7500, 960],
      [8500, 880], [9200, 760], [9600, 600],
    ],
    inertia: 0.22,
    engineBraking: 110,
    launchRpm: 4500,
  },

  gearbox: {
    ratios: [3.1, 2.25, 1.75, 1.42, 1.19, 1.0, 0.84],
    reverse: 2.9,
    finalDrive: 3.1,
    shiftTime: 0.06,
    autoUpshiftRpm: 8800,
    autoDownshiftRpm: 5200,
    efficiency: 0.91,
  },

  drivetrain: {
    layout: 'RWD',
    frontTorqueSplit: 0,
    front: { type: 'open', preload: 0, lockRatio: 0 },
    rear: { type: 'lsd', preload: 150, lockRatio: 0.4 },
    center: { type: 'open', preload: 0, lockRatio: 0 },
  },

  brakes: { maxTorque: 9200, bias: 0.6, handbrakeTorque: 2400 },

  aero: { dragArea: 0.64, downforceArea: 1.6, balance: 0.4 },

  aids: { abs: true, tc: true, esc: false },

  visual: {
    style: 'hyper',
    paints: [
      { name: 'Vanta Violet Pearl', color: 0x3a1f6e, pearl: true, flake: 0.8 },
      { name: 'Liquid Chrome', color: 0xd4d6da, metalness: 1, roughness: 0.12, flake: 0.3 },
      { name: 'Acid Green', color: 0x9be81a, metalness: 0.3, flake: 0.5 },
      { name: 'Stealth Matte', color: 0x1c1e22, matte: true },
    ],
    livery: { name: 'Record Run', base: 0x0d0e10, accents: [0x24d6ff, 0xff2bd6], pattern: 'split', number: 0, sponsor: 'SERAPH' },
    rims: { color: 0x101112, metalness: 0.7 },
    caliperColor: 0x24d6ff,
    steeringRatio: 7,
    exhausts: [[-0.18, 0.62, 2.33], [0.18, 0.62, 2.33]],
  },
};
