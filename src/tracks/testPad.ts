import { Quat, type V3 } from '../core/math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { Surface } from '../physics/surfaces';

/**
 * M1 test pad: a big asphalt square with strips of every surface type, a curb run,
 * a skid-pad circle marking, and a couple of ramps for suspension testing.
 *
 * The level is pure data: the physics builder below and the renderer both read the same
 * description, so the server can build the identical collision world headless.
 */

export interface PadBox {
  /** Box centre. */
  pos: V3;
  /** Half extents. */
  half: V3;
  surface: Surface;
  /** Optional rotation about X (pitch, radians), used for ramps. */
  pitch?: number;
  /** Optional rotation about Y (radians). */
  yaw?: number;
  /** Render hint. */
  kind: 'ground' | 'strip' | 'curb' | 'ramp' | 'wall';
  /** Curbs alternate colours along their length. */
  stripeIndex?: number;
}

export interface TestPadDef {
  size: number;
  boxes: PadBox[];
  spawn: { position: V3; yaw: number };
  /** Skid-pad circle (painted, not physical). */
  skidpad: { center: V3; radius: number };
}

const GROUND_THICK = 0.5;

export function makeTestPad(size = 600): TestPadDef {
  const boxes: PadBox[] = [];
  // Base asphalt: top surface at y = 0.
  boxes.push({ pos: { x: 0, y: -GROUND_THICK, z: 0 }, half: { x: size / 2, y: GROUND_THICK, z: size / 2 }, surface: Surface.Asphalt, kind: 'ground' });

  // Surface strips, 30 m wide, 160 m long, running along Z on the +X side. They sit 1 mm proud
  // of the base so the wheel ray always hits the strip first.
  const strips: [Surface, number][] = [[Surface.Grass, 60], [Surface.Gravel, 100], [Surface.Wet, 140]];
  for (const [surface, x] of strips) {
    boxes.push({ pos: { x, y: -0.049, z: -40 }, half: { x: 15, y: 0.05, z: 80 }, surface, kind: 'strip' });
  }

  // A run of curbs: 40 segments, alternating colours, 1.2 m wide, 6 cm tall.
  for (let i = 0; i < 40; i++) {
    boxes.push({
      pos: { x: -30, y: 0.03 - 0.03, z: -100 + i * 2 },
      half: { x: 0.6, y: 0.03, z: 1 },
      surface: Surface.Curb, kind: 'curb', stripeIndex: i,
    });
  }

  // Ramps: gentle (jump) and steep (suspension compression).
  const ramp = (x: number, z: number, length: number, angleDeg: number) => {
    const a = (angleDeg * Math.PI) / 180;
    const halfLen = length / 2;
    // Rotated about X: rises toward -Z (the spawn faces -Z).
    boxes.push({
      pos: { x, y: Math.sin(a) * halfLen - 0.25 * Math.cos(a), z },
      half: { x: 3, y: 0.25, z: halfLen },
      surface: Surface.Asphalt, pitch: a, kind: 'ramp',
    });
  };
  ramp(-70, -80, 14, 9);
  ramp(-90, -80, 8, 16);

  // Perimeter walls.
  const h = size / 2;
  for (const [x, z, hx, hz] of [[0, -h, h, 1], [0, h, h, 1], [-h, 0, 1, h], [h, 0, 1, h]]) {
    boxes.push({ pos: { x, y: 1, z }, half: { x: hx, y: 1, z: hz }, surface: Surface.Asphalt, kind: 'wall' });
  }

  return {
    size,
    boxes,
    spawn: { position: { x: 0, y: 0, z: 60 }, yaw: 0 },
    skidpad: { center: { x: -120, y: 0, z: 80 }, radius: 40 },
  };
}

/** Build the collision world for a test pad. */
export function buildTestPadPhysics(physics: PhysicsWorld, pad: TestPadDef): void {
  const q = new Quat();
  for (const b of pad.boxes) {
    if (b.pitch) q.setFromAxisAngle({ x: 1, y: 0, z: 0 }, b.pitch);
    else if (b.yaw) q.setFromAxisAngle({ x: 0, y: 1, z: 0 }, b.yaw);
    else q.set(0, 0, 0, 1);
    physics.addStaticBox(b.pos, b.half, b.surface, q, b.kind === 'wall' ? 0.2 : 0.9);
  }
}
