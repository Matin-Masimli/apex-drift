import { Surface } from '../../physics/surfaces';
import type { TrackDef, TrackPos } from '../types';

/** Reference a control point (by index) plus an offset in metres along the track. */
const at = (cp: number, offset = 0): TrackPos => ({ cp, offset });

/**
 * Kestrel Valley Circuit: original layout, ~2.8 km, clockwise.
 *
 *   Main straight (north, gentle climb) → T1 right-hander → fast climbing esses along the ridge
 *   → Ridge sweeper right → long downhill right-left on the east side → Kink left → Hairpin right
 *   → south run with the Mill chicane → Final corner right onto the straight.
 *
 * Coordinates: x east, z south (−z is north), y elevation. Units: metres.
 */
export const kestrelValley: TrackDef = {
  id: 'kestrel-valley',
  name: 'Kestrel Valley Circuit',
  description: 'A rolling valley circuit: a long climbing straight, fast ridge esses, a tight hairpin and the Mill chicane.',
  controlPoints: [
    // 0-4: main straight, heading north.
    { x: 0, y: 0, z: 150 },
    { x: 0, y: 0.5, z: 0 },
    { x: 0, y: 1.5, z: -200 },
    { x: 0, y: 3, z: -400 },
    { x: 0, y: 4, z: -490 },
    // 5-6: T1, medium right-hander onto the ridge.
    { x: 16, y: 4.5, z: -529 },
    { x: 55, y: 5.5, z: -545 },
    // 7-11: ridge esses, climbing east.
    { x: 130, y: 8, z: -552 },
    { x: 220, y: 12, z: -532 },
    { x: 300, y: 15, z: -560 },
    { x: 380, y: 17, z: -590 },
    { x: 450, y: 18, z: -572 },
    // 12-14: ridge sweeper, turning south.
    { x: 510, y: 18, z: -530 },
    { x: 545, y: 17, z: -460 },
    { x: 555, y: 15, z: -380 },
    // 15-18: long downhill right-left.
    { x: 550, y: 12, z: -280 },
    { x: 568, y: 9, z: -180 },
    { x: 562, y: 6, z: -80 },
    { x: 540, y: 4, z: 10 },
    // 19-25: kink left, then the hairpin right.
    { x: 556, y: 3, z: 62 },
    { x: 600, y: 2.5, z: 82 },
    { x: 645, y: 2, z: 86 },
    { x: 668, y: 2, z: 94 },
    { x: 678, y: 2, z: 113 },
    { x: 668, y: 2, z: 132 },
    { x: 645, y: 2, z: 140 },
    // 26-35: south run, west, with the Mill chicane (30-33).
    { x: 590, y: 2, z: 152 },
    { x: 520, y: 1.5, z: 190 },
    { x: 440, y: 1, z: 228 },
    { x: 370, y: 1, z: 250 },
    { x: 330, y: 1, z: 250 },
    { x: 305, y: 1, z: 242 },
    { x: 285, y: 1, z: 241 },
    { x: 260, y: 1, z: 250 },
    { x: 220, y: 1, z: 252 },
    { x: 150, y: 0.5, z: 250 },
    // 36-38: final corner, right, onto the straight.
    { x: 70, y: 0.2, z: 250 },
    { x: 22, y: 0.1, z: 232 },
    { x: 0, y: 0, z: 192 },
  ],
  width: 13,
  shoulderWidth: 9,
  curbs: { minCurvature: 1 / 260, width: 1.4, height: 0.06, outsideCurvature: 1 / 80 },
  runoff: [
    // Gravel traps on the outside of the heavy braking zones (outside of a right-hander = left).
    { from: at(4, -10), to: at(7), side: 'left', surface: Surface.Gravel, width: 14 },
    { from: at(21), to: at(26), side: 'left', surface: Surface.Gravel, width: 14 },
    { from: at(36, -10), to: at(38), side: 'left', surface: Surface.Gravel, width: 10 },
    // Chicane: tarmac runoff both sides, so cutting it is possible but obvious (and invalidates the lap).
    { from: at(29), to: at(34), side: 'both', surface: Surface.Asphalt, width: 6 },
  ],
  // A damp patch under the trees on the downhill section.
  wetPatches: [{ from: at(16, -20), to: at(16, 40) }],
  barrierOffset: 16,
  startLine: 140,
  sectors: [at(11), at(21)],
  checkpointCount: 12,
  props: [
    { type: 'gantry', s: 140, side: 'both', offset: 0 },
    { type: 'grandstand', s: 60, side: 'left', offset: 14, length: 90 },
    { type: 'grandstand', s: 230, side: 'left', offset: 14, length: 70 },
    { type: 'grandstand', s: at(23), side: 'right', offset: 24, length: 50 },
    { type: 'brakeBoards', s: at(4, -40), side: 'right', offset: 3 },
    { type: 'brakeBoards', s: at(21, -20), side: 'left', offset: 3 },
    { type: 'tireWall', s: at(23), side: 'left', offset: 14, length: 60 },
    { type: 'billboard', s: at(9), side: 'left', offset: 10, label: 'VOLTAR FUELS' },
    { type: 'billboard', s: at(15), side: 'right', offset: 10, label: 'NORTHWIND TYRES' },
    { type: 'billboard', s: at(30), side: 'right', offset: 9, label: 'MILL CHICANE' },
    { type: 'billboard', s: at(2), side: 'right', offset: 10, label: 'APEX DRIFT' },
    { type: 'marshalPost', s: at(6), side: 'left', offset: 18 },
    { type: 'marshalPost', s: at(13), side: 'left', offset: 18 },
    { type: 'marshalPost', s: at(18), side: 'right', offset: 18 },
    { type: 'marshalPost', s: at(27), side: 'right', offset: 18 },
  ],
  scenery: { trees: 1800, baseHeight: -2, terrainHalfSize: 1300, hillAmplitude: 16 },
  timeOfDay: 'midday',
};
