import { Surface } from '../../physics/surfaces';
import type { CarConfig } from '../types';

/**
 * Talvi RX4: rally hatchback with permanent AWD and long-travel suspension. Modest on tarmac,
 * superb on loose surfaces, and happy to be thrown sideways with the handbrake.
 */
export const talviRX4: CarConfig = {
  id: 'talvi-rx4',
  name: 'Talvi RX4',
  class: 'rally',
  backstory:
    'Talvi was born on frozen forest stages, where the only straight road is the one to the service park. ' +
    'The RX4 trades top speed for traction: four driven wheels, a soft long-travel chassis and gravel-cut tyres.',
  ratings: { speed: 5, acceleration: 7, handling: 7, braking: 6 },

  chassis: {
    mass: 1230,
    weightFront: 0.56,
    cgHeight: 0.54,
    halfExtents: [0.9, 0.42, 2.0],
    colliderCenterY: 0.86,
    inertiaScale: [0.85, 0.8, 0.85],
  },

  geometry: { wheelbase: 2.55, trackFront: 1.56, trackRear: 1.55 },

  suspension: {
    // Soft (~1.6 Hz) with lots of travel to soak up ruts and crests.
    front: { restLength: 0.34, maxCompression: 0.24, stiffness: 31000, bumpDamping: 2700, reboundDamping: 4300, antiRollBar: 11000 },
    rear: { restLength: 0.34, maxCompression: 0.24, stiffness: 27000, bumpDamping: 2500, reboundDamping: 4000, antiRollBar: 9000 },
  },

  wheels: {
    front: { radius: 0.33, width: 0.22, inertia: 1.0 },
    rear: { radius: 0.33, width: 0.22, inertia: 1.0 },
  },

  tires: {
    // Gravel tyres: soft carcass (large peak slip, gentle fall-off), mediocre on tarmac.
    front: { muLong: 1.15, muLat: 1.12, peakSlipRatio: 0.13, peakSlipAngleDeg: 9.5, shape: 1.22, loadSensitivity: 0.1, nominalLoad: 3400 },
    rear: { muLong: 1.15, muLat: 1.1, peakSlipRatio: 0.13, peakSlipAngleDeg: 9.5, shape: 1.2, loadSensitivity: 0.1, nominalLoad: 2700 },
    surfaceGrip: { [Surface.Grass]: 1.35, [Surface.Gravel]: 1.5, [Surface.Wet]: 1.1 },
  },

  steering: { maxAngleDeg: 34, speed: 3.4, speedSensitivity: 0.05, ackermann: 0.5 },

  engine: {
    idleRpm: 1000,
    redlineRpm: 7000,
    limiterRpm: 7200,
    torqueCurve: [
      [1000, 190], [2000, 280], [3000, 355], [4000, 385], [5000, 380],
      [6000, 350], [7000, 300], [7400, 250],
    ],
    inertia: 0.16,
    engineBraking: 80,
    launchRpm: 4200,
  },

  gearbox: {
    ratios: [3.0, 2.1, 1.6, 1.3, 1.07, 0.9],
    reverse: 3.2,
    finalDrive: 4.2,
    shiftTime: 0.08,
    autoUpshiftRpm: 6800,
    autoDownshiftRpm: 3800,
    efficiency: 0.88,
  },

  drivetrain: {
    layout: 'AWD',
    frontTorqueSplit: 0.45,
    front: { type: 'lsd', preload: 60, lockRatio: 0.25 },
    rear: { type: 'lsd', preload: 80, lockRatio: 0.4 },
    center: { type: 'lsd', preload: 100, lockRatio: 0.35 },
  },

  brakes: { maxTorque: 5600, bias: 0.62, handbrakeTorque: 3200 },

  aero: { dragArea: 0.85, downforceArea: 0.25, balance: 0.4 },

  aids: { abs: true, tc: false, esc: false },

  visual: {
    style: 'rally',
    paints: [
      { name: 'Forest Green', color: 0x1f5a34, flake: 0.4 },
      { name: 'Snow White', color: 0xf0f0ea, metalness: 0.1, flake: 0 },
      { name: 'Midnight Blue', color: 0x14224a, flake: 0.6 },
      { name: 'Hi-Vis Yellow', color: 0xf2d01a, metalness: 0.1, flake: 0 },
    ],
    livery: { name: 'Stage Rally No. 23', base: 0xffffff, accents: [0x0f6fd1, 0xff6a00, 0x101010], pattern: 'rally', number: 23, sponsor: 'TUNDRA OIL' },
    rims: { color: 0xf2f2f2, metalness: 0.2 },
    caliperColor: 0xd82a1c,
    steeringRatio: 6,
    exhausts: [[0.55, 0.38, 2.0]],
  },
};
