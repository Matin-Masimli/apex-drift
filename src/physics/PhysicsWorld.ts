import RAPIER from '@dimforge/rapier3d-compat';
import type { V3, Q4 } from '../core/math';
import { Surface } from './surfaces';

let rapierReady: Promise<void> | null = null;

/** Rapier's compat build must be initialised (WASM instantiation) once before use. */
export function initPhysics(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export interface WheelRayHit {
  /** Distance from ray origin to the hit point. */
  distance: number;
  normal: V3;
  surface: Surface;
}

/**
 * Thin wrapper around a Rapier world: static geometry tagged with surfaces,
 * and the ray-cast query the vehicle suspension uses.
 * Headless-safe: no rendering dependencies.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly surfaceByCollider = new Map<number, Surface>();
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private readonly hit: WheelRayHit = { distance: 0, normal: { x: 0, y: 1, z: 0 }, surface: Surface.Asphalt };

  constructor(readonly stepDt: number) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = stepDt;
  }

  /** Add a static oriented box. `pos` is the box centre, `half` its half-extents. */
  addStaticBox(pos: V3, half: V3, surface: Surface, rot?: Q4, friction = 0.9): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(pos.x, pos.y, pos.z)
      .setFriction(friction);
    if (rot) desc.setRotation(rot);
    const c = this.world.createCollider(desc);
    this.surfaceByCollider.set(c.handle, surface);
    return c;
  }

  /** Add a static triangle mesh (track surfaces, barriers). */
  addStaticTrimesh(vertices: Float32Array, indices: Uint32Array, surface: Surface, friction = 0.9): RAPIER.Collider {
    const c = this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(friction));
    this.surfaceByCollider.set(c.handle, surface);
    return c;
  }

  surfaceOf(collider: RAPIER.Collider): Surface {
    return this.surfaceByCollider.get(collider.handle) ?? Surface.Asphalt;
  }

  /**
   * Cast a ray, ignoring `exclude` (the car's own body). Returns a reused object, so copy what you need
   * before the next call.
   */
  castWheelRay(origin: V3, dir: V3, maxDist: number, exclude: RAPIER.RigidBody): WheelRayHit | null {
    this.ray.origin = origin;
    this.ray.dir = dir;
    const res = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, undefined, undefined, exclude);
    if (!res) return null;
    this.hit.distance = res.timeOfImpact;
    this.hit.normal = res.normal;
    this.hit.surface = this.surfaceOf(res.collider);
    return this.hit;
  }

  step(): void {
    this.world.step();
  }

  dispose(): void {
    this.world.free();
  }
}

export { RAPIER };
