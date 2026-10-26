import * as THREE from 'three';
import type { Track } from '../tracks/Track';
import { textTexture } from './proceduralTextures';

/**
 * Finish podium: three stepped blocks on the open (right) side of the start/finish straight, beyond
 * the barrier and clear of the grandstands. The race
 * session parks the top three cars on it and orbits the camera around it for the results screen.
 */
export class Podium {
  readonly group = new THREE.Group();
  /** Car poses (world position of the chassis origin, yaw) for P1, P2, P3. */
  readonly slots: { position: THREE.Vector3; yaw: number }[] = [];
  readonly center = new THREE.Vector3();

  constructor(track: Track) {
    const s = track.startS + 60;
    const smp = track.line.sampleAt(s);
    const idx = track.line.indexAt(s);
    const barrier = track.barrierRight[idx];
    const lat = (Number.isNaN(barrier) ? track.def.width / 2 + 16 : barrier) + 14;
    const base = new THREE.Vector3(smp.pos.x + smp.right.x * lat, 0, smp.pos.z + smp.right.z * lat);
    base.y = track.heightAt(base.x, base.z);
    this.center.copy(base);
    // Cars face back toward the track, i.e. along −right. (Yaw θ maps local −Z to (−sin θ, −cos θ).)
    const yaw = Math.atan2(smp.right.x, smp.right.z);
    const along = new THREE.Vector3(-smp.tangent.x, 0, -smp.tangent.z); // P2 on one side, P3 on the other

    const mat = new THREE.MeshStandardMaterial({ color: 0xe9e7e1, roughness: 0.6 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.4, emissive: 0xff5a1f, emissiveIntensity: 0.4 });
    const steps: [number, number][] = [[0, 1.3], [-5.4, 0.85], [5.4, 0.5]]; // (offset along, height)
    steps.forEach(([off, h], i) => {
      const block = new THREE.Mesh(new THREE.BoxGeometry(5.2, h, 6), mat);
      const p = base.clone().addScaledVector(along, off);
      block.position.set(p.x, base.y + h / 2, p.z);
      block.rotation.y = yaw;
      block.castShadow = block.receiveShadow = true;
      this.group.add(block);
      const band = new THREE.Mesh(new THREE.BoxGeometry(5.25, 0.12, 6.05), trim);
      band.position.set(p.x, base.y + h - 0.05, p.z); // top 1 cm proud of the block: no z-fighting
      band.rotation.y = yaw;
      this.group.add(band);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8),
        new THREE.MeshBasicMaterial({ map: textTexture(String(i + 1), '#151515', '#ffffff', 256, 128) }));
      const front = new THREE.Vector3(-smp.right.x, 0, -smp.right.z).multiplyScalar(3.02);
      label.position.set(p.x + front.x, base.y + h / 2, p.z + front.z);
      label.rotation.y = yaw + Math.PI;
      this.group.add(label);
      this.slots.push({ position: new THREE.Vector3(p.x, base.y + h, p.z), yaw });
    });
  }

  /** Orbit the camera slowly around the podium. */
  updateCamera(camera: THREE.PerspectiveCamera, time: number): void {
    const a = Math.sin(time * 0.15) * 0.7;
    const front = this.slots[0].yaw;
    const dir = new THREE.Vector3(-Math.sin(front + a), 0, -Math.cos(front + a));
    camera.position.copy(this.center).addScaledVector(dir, 17).add(new THREE.Vector3(0, 5.5, 0));
    camera.lookAt(this.center.x, this.center.y + 1.6, this.center.z);
    camera.fov = 45;
    camera.updateProjectionMatrix();
  }
}
