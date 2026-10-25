import * as THREE from 'three';
import { damp } from '../core/math';

export type CameraMode = 'chase' | 'hood' | 'bumper';
export const CAMERA_MODES: CameraMode[] = ['chase', 'hood', 'bumper'];

/**
 * Player cameras. The chase cam follows a *smoothed heading* rather than the car's exact yaw, so it
 * swings out naturally during slides, and widens the FOV with speed for a sense of velocity.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';
  private yaw = 0;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private initialised = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.1, 6000);
  }

  cycle(): void {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
  }

  update(carPos: THREE.Vector3, carRot: THREE.Quaternion, speedMs: number, velocity: THREE.Vector3, dt: number): void {
    const cam = this.camera;
    this.fwd.set(0, 0, -1).applyQuaternion(carRot);

    if (this.mode === 'chase') {
      // Heading: blend car facing with velocity direction when moving, so drifts look right.
      let heading = Math.atan2(-this.fwd.x, -this.fwd.z);
      if (speedMs > 4 && velocity.dot(this.fwd) > 0) {
        const velHeading = Math.atan2(-velocity.x, -velocity.z);
        heading = lerpAngle(heading, velHeading, 0.35);
      }
      if (!this.initialised) { this.yaw = heading; this.initialised = true; }
      this.yaw = lerpAngle(this.yaw, heading, 1 - Math.exp(-5 * dt));

      const dist = 6.2 + Math.min(speedMs, 80) * 0.012;
      const height = 2.0;
      this.tmp.set(-Math.sin(this.yaw) * -dist, height, -Math.cos(this.yaw) * -dist);
      const desired = this.tmp.add(carPos);
      // Positional smoothing is light: heading smoothing does the heavy lifting.
      this.pos.lerp(desired, 1 - Math.exp(-14 * dt));
      if (this.pos.distanceTo(desired) > 30) this.pos.copy(desired); // after a reset
      cam.position.copy(this.pos);
      this.look.copy(carPos).add(this.tmp.set(0, 1.0, 0)).addScaledVector(this.fwd, 2.5);
      cam.lookAt(this.look);
      cam.fov = damp(cam.fov, 60 + Math.min(speedMs, 90) * 0.17, 4, dt);
    } else {
      const offset = this.mode === 'hood' ? new THREE.Vector3(0, 1.22, -0.25) : new THREE.Vector3(0, 0.62, -2.35);
      cam.position.copy(offset.applyQuaternion(carRot).add(carPos));
      cam.quaternion.copy(carRot);
      cam.fov = damp(cam.fov, 70 + Math.min(speedMs, 90) * 0.12, 4, dt);
      this.initialised = false;
    }
    cam.updateProjectionMatrix();
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
