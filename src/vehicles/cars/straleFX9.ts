import { Surface } from '../../physics/surfaces';
import type { CarConfig } from '../types';

/**
 * Strale FX-9: open-wheel single-seater. Light, enormous downforce, sharp tires and low inertia:
 * the fastest car through corners, and the least forgiving when you exceed the limit.
 */
export const straleFX9: CarConfig = {
  id: 'strale-fx9',
  name: 'Strale FX-9',
  class: 'formula',
  backstory:
    'Strale builds one chassis a year and destroys most of it in testing. The FX-9 is the survivor: ' +
    'a carbon tub, a 12,800 rpm engine and wings that press it into the road at three times its own weight.',
  ratings: { speed: 8, acceleration: 10, handling: 10, braking: 10 },

  chassis: {
    mass: 730,
    weightFront: 0.44,
    cgHeight: 0.3,
    halfExtents: [0.5, 0.3, 2.45],
    colliderCenterY: 0.42,
    inertiaScale: [0.7, 0.65, 0.7],
  },

  geometry: { wheelbase: 3.4, trackFront: 1.62, trackRear: 1.56 },

  suspension: {
    // Very stiff (~3.5 Hz) with little travel: the car runs on its aero platform.
    front: { restLength: 0.12, maxCompression: 0.08, stiffness: 92000, bumpDamping: 3600, reboundDamping: 5400, antiRollBar: 42000 },
    rear: { restLength: 0.12, maxCompression: 0.08, stiffness: 98000, bumpDamping: 3800, reboundDamping: 5800, antiRollBar: 30000 },
  },

  wheels: {
    front: { radius: 0.33, width: 0.3, inertia: 0.85 },
    rear: { radius: 0.34, width: 0.4, inertia: 1.0 },
  },

  tires: {
    // Slicks: huge grip that peaks early and drops off hard.
    front: { muLong: 1.8, muLat: 1.75, peakSlipRatio: 0.09, peakSlipAngleDeg: 5.5, shape: 1.62, loadSensitivity: 0.14, nominalLoad: 2400 },
    rear: { muLong: 1.85, muLat: 1.78, peakSlipRatio: 0.09, peakSlipAngleDeg: 6, shape: 1.6, loadSensitivity: 0.14, nominalLoad: 2600 },
    // Slicks hate grass and gravel.
    surfaceGrip: { [Surface.Grass]: 0.85, [Surface.Gravel]: 0.75 },
  },

  steering: { maxAngleDeg: 22, speed: 3.6, speedSensitivity: 0.04, ackermann: 0.3 },

  engine: {
    idleRpm: 4000,
    redlineRpm: 12500,
    limiterRpm: 12800,
    torqueCurve: [
      [3000, 230], [5000, 300], [7000, 355], [9000, 395], [10500, 420],
      [11500, 412], [12500, 380], [13000, 330],
    ],
    inertia: 0.08,
    engineBraking: 70,
    launchRpm: 8000,
  },

  gearbox: {
    ratios: [2.9, 2.2, 1.78, 1.5, 1.3, 1.15, 1.03],
    reverse: 2.8,
    finalDrive: 4.8,
    shiftTime: 0.05,
    autoUpshiftRpm: 12300,
    autoDownshiftRpm: 8200,
    efficiency: 0.93,
  },

  drivetrain: {
    layout: 'RWD',
    frontTorqueSplit: 0,
    front: { type: 'open', preload: 0, lockRatio: 0 },
    rear: { type: 'lsd', preload: 80, lockRatio: 0.3 },
    center: { type: 'open', preload: 0, lockRatio: 0 },
  },

  brakes: { maxTorque: 9000, bias: 0.58, handbrakeTorque: 1200 },

  aero: { dragArea: 1.1, downforceArea: 4.6, balance: 0.42 },

  aids: { abs: false, tc: true, esc: false },

  visual: {
    style: 'formula',
    paints: [
      { name: 'Strale Red', color: 0xd0101a, metalness: 0.2, flake: 0.2 },
      { name: 'Papaya', color: 0xff7a00, metalness: 0.1, flake: 0 },
      { name: 'Arctic White', color: 0xeeeeea, metalness: 0.1, flake: 0 },
      { name: 'Teal Carbon', color: 0x0f6d72, metalness: 0.5, flake: 0.5 },
    ],
    livery: { name: 'Works Team No. 1', base: 0x101215, accents: [0xffd400, 0xd0101a], pattern: 'chevron', number: 1, sponsor: 'VOLTAR' },
    rims: { color: 0x1a1b1e, metalness: 0.4 },
    caliperColor: 0x222222,
    steeringRatio: 3.5,
    exhausts: [[0, 0.52, 2.4]],
  },
};
