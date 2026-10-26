import type { CarConfig, WheelConfig } from './types';

const GRAVITY = 9.81;

/** Static wheel placement derived from a car config (shared by the sim and the renderer). */
export interface WheelLayout {
  index: number;
  isFront: boolean;
  /** -1 = left, +1 = right */
  lateral: -1 | 1;
  /** Suspension top mount in the car frame. */
  mount: { x: number; y: number; z: number };
  wheel: WheelConfig;
  /** Spring length at rest under static load (wheel centre then sits at y = radius). */
  staticLength: number;
}

/**
 * Wheel order: FL, FR, RL, RR. Axles sit at ±wheelbase/2 around the chassis origin (front = −Z).
 * The mount height is chosen so that, under static load, the wheel centre sits exactly at
 * y = radius: the car rests at its design ride height with the chassis origin on the ground.
 */
export function wheelLayout(c: CarConfig): WheelLayout[] {
  const g = c.geometry;
  const staticLoad = (front: boolean) =>
    (c.chassis.mass * GRAVITY * (front ? c.chassis.weightFront : 1 - c.chassis.weightFront)) / 2;
  const mk = (index: number, isFront: boolean, lateral: -1 | 1): WheelLayout => {
    const susp = isFront ? c.suspension.front : c.suspension.rear;
    const wheel = isFront ? c.wheels.front : c.wheels.rear;
    const sag = Math.min(staticLoad(isFront) / susp.stiffness, susp.maxCompression * 0.8);
    const staticLength = susp.restLength - sag;
    const track = isFront ? g.trackFront : g.trackRear;
    return {
      index, isFront, lateral, wheel, staticLength,
      mount: { x: (lateral * track) / 2, y: wheel.radius + staticLength, z: (isFront ? -1 : 1) * (g.wheelbase / 2) },
    };
  };
  return [mk(0, true, -1), mk(1, true, 1), mk(2, false, -1), mk(3, false, 1)];
}
