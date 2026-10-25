import * as THREE from 'three';
import type { Track } from '../tracks/Track';

interface CamSpot {
  /** Arc length the camera "covers" (cars are framed as they approach and pass it). */
  s: number;
  pos: THREE.Vector3;
  kind: 'trackside' | 'heli';
}

/**
 * TV-style replay camera. Trackside cameras are placed along the circuit, alternating sides at
 * barrier distance and varying heights; every few spots is a helicopter shot instead. The director
 * cuts to the spot the car is approaching and zooms the lens to keep the car a constant size.
 */
export class ReplayDirector {
  private readonly spots: CamSpot[] = [];
  private current = -1;
  private readonly look = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly nearestTmp = { index: 0, lateral: 0, distSq: 0 };

  constructor(private readonly track: Track) {
    const L = track.length;
    const step = 110;
    let k = 0;
    for (let s = 20; s < L; s += step, k++) {
      const smp = track.line.sampleAt(s);
      const idx = track.line.indexAt(s);
      if (k % 4 === 3) {
        this.spots.push({ s, pos: new THREE.Vector3(smp.pos.x, smp.pos.y, smp.pos.z), kind: 'heli' });
        continue;
      }
      // Place outside the barrier, on the outside of the corner when there is one (better angle).
      const side = smp.curvature > 0.002 ? -1 : smp.curvature < -0.002 ? 1 : k % 2 ? 1 : -1;
      const barrier = side < 0 ? track.barrierLeft[idx] : track.barrierRight[idx];
      const lat = side * ((Number.isNaN(barrier) ? track.def.width / 2 + 12 : barrier) + 4);
      const pos = new THREE.Vector3(smp.pos.x + smp.right.x * lat, 0, smp.pos.z + smp.right.z * lat);
      pos.y = Math.max(smp.pos.y, track.heightAt(pos.x, pos.z)) + 2.5 + (k % 3) * 1.8;
      this.spots.push({ s, pos, kind: 'trackside' });
    }
  }

  /** Point `camera` at a car at `carPos` with forward `carFwd`. */
  update(camera: THREE.PerspectiveCamera, carPos: THREE.Vector3, carFwd: THREE.Vector3, dt: number): void {
    const t = this.track;
    const near = t.line.nearest(carPos, this.nearestTmp);
    const s = t.line.samples[near.index].s;
    // Pick the first spot the car hasn't passed by more than 35 m.
    let best = 0, bestAhead = Infinity;
    this.spots.forEach((spot, i) => {
      const ahead = t.line.wrap(spot.s - s + 35);
      if (ahead < bestAhead) { bestAhead = ahead; best = i; }
    });
    const cut = best !== this.current;
    this.current = best;
    const spot = this.spots[best];

    if (spot.kind === 'heli') {
      // Helicopter: high, behind and to the side, smoothly tracking.
      const desired = this.tmp.copy(carPos).addScaledVector(carFwd, -22).add(new THREE.Vector3(14, 26, 0));
      if (cut) camera.position.copy(desired);
      else camera.position.lerp(desired, 1 - Math.exp(-1.5 * dt));
      camera.fov = 42;
    } else {
      camera.position.copy(spot.pos);
      // Zoom to keep a ~7 m tall frame around the car.
      const dist = camera.position.distanceTo(carPos);
      camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(3.5 / dist)), 6, 55);
    }
    this.look.copy(carPos).add(this.tmp.set(0, 0.8, 0));
    camera.lookAt(this.look);
    camera.updateProjectionMatrix();
  }

  reset(): void { this.current = -1; }
}
