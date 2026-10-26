import type { CarConfig } from '../types';

/**
 * Nimbus Ziva RS: front-drive hot hatch. Light, nimble, and gently understeering at the limit:
 * the beginner's car, with every driver aid on by default.
 */
export const nimbusZiva: CarConfig = {
  id: 'nimbus-ziva',
  name: 'Nimbus Ziva RS',
  class: 'hatch',
  backstory:
    'The Ziva was meant to be a sensible commuter until the Nimbus engineers stiffened it, lowered it and ' +
    'fitted a turbo. It is still sensible. It just also happens to lap faster than cars twice its price.',
  ratings: { speed: 4, acceleration: 5, handling: 8, braking: 7 },

  chassis: {
    mass: 1150,
    weightFront: 0.62,
    cgHeight: 0.5,
    halfExtents: [0.88, 0.45, 2.0],
    colliderCenterY: 0.78,
    inertiaScale: [0.8, 0.75, 0.8],
  },

  geometry: { wheelbase: 2.55, trackFront: 1.53, trackRear: 1.51 },

  suspension: {
    front: { restLength: 0.2, maxCompression: 0.14, stiffness: 44000, bumpDamping: 2900, reboundDamping: 4300, antiRollBar: 18000 },
    // A firm rear bar helps the light rear rotate, so the car turns in rather than ploughing on.
    rear: { restLength: 0.2, maxCompression: 0.14, stiffness: 34000, bumpDamping: 2400, reboundDamping: 3700, antiRollBar: 20000 },
  },

  wheels: {
    front: { radius: 0.31, width: 0.23, inertia: 0.9 },
    rear: { radius: 0.31, width: 0.23, inertia: 0.9 },
  },

  tires: {
    // Sport tyres with a broad, forgiving peak.
    front: { muLong: 1.18, muLat: 1.15, peakSlipRatio: 0.11, peakSlipAngleDeg: 8.5, shape: 1.25, loadSensitivity: 0.1, nominalLoad: 3500 },
    rear: { muLong: 1.16, muLat: 1.13, peakSlipRatio: 0.11, peakSlipAngleDeg: 8.5, shape: 1.25, loadSensitivity: 0.1, nominalLoad: 2200 },
  },

  steering: { maxAngleDeg: 33, speed: 3.6, speedSensitivity: 0.05, ackermann: 0.6 },

  engine: {
    idleRpm: 850,
    redlineRpm: 6800,
    limiterRpm: 7000,
    torqueCurve: [
      [800, 160], [1500, 230], [2500, 300], [3500, 305], [4500, 300],
      [5500, 270], [6500, 225], [7200, 180],
    ],
    inertia: 0.14,
    engineBraking: 60,
    launchRpm: 3500,
  },

  gearbox: {
    ratios: [3.4, 2.1, 1.5, 1.18, 0.95, 0.8],
    reverse: 3.2,
    finalDrive: 4.1,
    shiftTime: 0.1,
    autoUpshiftRpm: 6500,
    autoDownshiftRpm: 3200,
    efficiency: 0.9,
  },

  drivetrain: {
    layout: 'FWD',
    frontTorqueSplit: 1,
    front: { type: 'lsd', preload: 40, lockRatio: 0.2 },
    rear: { type: 'open', preload: 0, lockRatio: 0 },
    center: { type: 'open', preload: 0, lockRatio: 0 },
  },

  brakes: { maxTorque: 5200, bias: 0.66, handbrakeTorque: 2400 },

  aero: { dragArea: 0.7, downforceArea: 0.2, balance: 0.5 },

  aids: { abs: true, tc: true, esc: true },

  visual: {
    style: 'hatch',
    paints: [
      { name: 'Electric Blue', color: 0x1b6ff2, flake: 0.5 },
      { name: 'Sunburst Yellow', color: 0xffc41a, metalness: 0.15, flake: 0.2 },
      { name: 'Pearl White', color: 0xf3f1ea, pearl: true, flake: 0.3 },
      { name: 'Flame Red', color: 0xd51f1f, metalness: 0.2, flake: 0.3 },
    ],
    livery: { name: 'Cup Racer No. 12', base: 0xf3f1ea, accents: [0xe5132a, 0x15161a], pattern: 'split', number: 12, sponsor: 'NIMBUS' },
    rims: { color: 0x9aa0a8, metalness: 1 },
    caliperColor: 0xe5132a,
    steeringRatio: 8,
    exhausts: [[0.0, 0.3, 2.02]],
  },
};
