import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { CarConfig } from '../vehicles/types';
import type { Vehicle } from '../vehicles/Vehicle';
import { tireTexture } from './proceduralTextures';
import { mergeByMaterial } from './mergeByMaterial';

/**
 * M1 procedural car: a sculpted body (deformed rounded boxes), cabin glass, rear wing, lights,
 * and fully articulated wheels (suspension travel, steering, spin) with non-rotating calipers.
 *
 * Mesh hierarchy per wheel:  root (suspension position) → steer (yaw) → spin (roll) → tire/rim
 *                                                        └→ caliper (steers, doesn't spin)
 * M3 replaces the body builder with per-class parametric bodies; the wheel/light rig stays.
 */
export class CarVisual {
  readonly root = new THREE.Group();
  readonly paint: THREE.MeshPhysicalMaterial;
  private readonly wheelRigs: { root: THREE.Group; steer: THREE.Group; spin: THREE.Group }[] = [];
  /** Wheel mount points in the car frame (from the sim's suspension geometry). */
  private readonly mounts: THREE.Vector3[] = [];
  private readonly brakeLightMat: THREE.MeshStandardMaterial;
  private readonly headLightMat: THREE.MeshStandardMaterial;

  constructor(config: CarConfig, vehicle: Vehicle, color = 0x1f5fd6) {
    const [hx, , hz] = config.chassis.halfExtents;
    const width = hx * 2;
    const length = hz * 2;

    this.paint = new THREE.MeshPhysicalMaterial({
      color, metalness: 0.25, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.04,
    });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b0f14, metalness: 0.2, roughness: 0.04, clearcoat: 1 });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x111214, metalness: 0.3, roughness: 0.45 });
    this.headLightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3dd, emissiveIntensity: 1.6 });
    this.brakeLightMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: 0.4 });

    const body = new THREE.Group();
    this.root.add(body);

    // Lower body: a rounded box with a sloped nose and tail, tapered in plan view.
    const lower = new RoundedBoxGeometry(width, 0.52, length, 5, 0.2);
    sculpt(lower, (x, y, z) => {
      const t = z / (length / 2); // -1 at nose, +1 at tail
      const topBlend = (y + 0.26) / 0.52; // 0 bottom .. 1 top
      // Nose drops ~22 cm, tail ~8 cm, only on the upper surface.
      const drop = (t < 0 ? Math.pow(-t, 2.4) * 0.22 : Math.pow(t, 3) * 0.08) * topBlend;
      // Plan-view taper toward the nose.
      const taper = 1 - (t < 0 ? Math.pow(-t, 3) * 0.12 : Math.pow(t, 4) * 0.05);
      return [x * taper, y - drop, z];
    });
    addMesh(body, lower, this.paint, 0, 0.53, 0);

    // Cabin / greenhouse: narrower at the roof, windscreen raked back.
    const cabin = new RoundedBoxGeometry(width * 0.74, 0.44, length * 0.44, 4, 0.14);
    sculpt(cabin, (x, y, z) => {
      const up = (y + 0.22) / 0.44;
      const rake = up * 0.45; // pull the roof's leading edge backwards
      const zz = z < 0 ? z + rake * (-z / (length * 0.22)) : z - up * 0.25 * (z / (length * 0.22));
      return [x * (1 - up * 0.18), y, zz];
    });
    addMesh(body, cabin, glass, 0, 0.99, 0.18);
    // Roof panel in body colour on top of the glass.
    const roof = new RoundedBoxGeometry(width * 0.56, 0.05, length * 0.2, 2, 0.02);
    addMesh(body, roof, this.paint, 0, 1.205, 0.32);

    // Rear wing on two pylons, front splitter, side skirts.
    addMesh(body, new THREE.BoxGeometry(width * 0.92, 0.035, 0.34), carbon, 0, 1.12, length / 2 - 0.25);
    for (const s of [-1, 1]) {
      addMesh(body, new THREE.BoxGeometry(0.03, 0.22, 0.28), carbon, s * width * 0.46, 1.12, length / 2 - 0.25);
      addMesh(body, new THREE.BoxGeometry(0.04, 0.28, 0.12), carbon, s * width * 0.3, 0.95, length / 2 - 0.25);
    }
    addMesh(body, new THREE.BoxGeometry(width * 0.95, 0.03, 0.35), carbon, 0, 0.27, -length / 2 + 0.2);
    for (const s of [-1, 1]) addMesh(body, new THREE.BoxGeometry(0.06, 0.08, length * 0.5), carbon, s * (hx - 0.02), 0.3, 0.05);

    // Lights: headlight pods, full-width tail light bar.
    for (const s of [-1, 1]) {
      addMesh(body, new THREE.BoxGeometry(0.42, 0.07, 0.08), this.headLightMat, s * width * 0.32, 0.6, -length / 2 + 0.28, false);
    }
    addMesh(body, new THREE.BoxGeometry(width * 0.86, 0.06, 0.05), this.brakeLightMat, 0, 0.7, length / 2 - 0.01, false);

    // Bake the static body parts into one mesh per material (paint, glass, carbon, lights).
    this.root.remove(body);
    this.root.add(mergeByMaterial(body));

    // Wheels.
    const rubber = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tireTexture(), roughness: 0.92, metalness: 0 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 1, roughness: 0.28 });
    const caliperMat = new THREE.MeshStandardMaterial({ color: 0xd8261c, metalness: 0.2, roughness: 0.45 });
    const discMat = new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 0.9, roughness: 0.55 });
    for (const w of vehicle.wheels) {
      const R = w.wheel.radius, W = w.wheel.width, side = w.lateral;
      const root = new THREE.Group();
      const steer = new THREE.Group();
      const spin = new THREE.Group();
      root.add(steer);
      steer.add(spin);

      const tire = new THREE.CylinderGeometry(R, R, W, 40, 1, false);
      tire.rotateZ(Math.PI / 2);
      spin.add(shadowMesh(tire, rubber));
      // Rim face, slightly inset from the outer sidewall.
      const rim = new THREE.CylinderGeometry(R * 0.66, R * 0.66, W * 0.9, 32);
      rim.rotateZ(Math.PI / 2);
      spin.add(shadowMesh(rim, rimMat));
      // Five spokes on the outer face.
      for (let i = 0; i < 5; i++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, R * 1.2, 0.07), rimMat);
        spoke.position.x = side * W * 0.42;
        spoke.rotation.x = (i / 5) * Math.PI * 2;
        spin.add(spoke);
      }
      const disc = new THREE.CylinderGeometry(R * 0.55, R * 0.55, 0.03, 28);
      disc.rotateZ(Math.PI / 2);
      const discMesh = new THREE.Mesh(disc, discMat);
      discMesh.position.x = side * W * 0.1;
      spin.add(discMesh);
      // Caliper: hugs the disc at the trailing top edge; attached to `steer`, so it never spins.
      const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.2), caliperMat);
      caliper.position.set(side * W * 0.18, R * 0.42, R * 0.22);
      steer.add(caliper);

      // Merge the rotating parts (tire, rim, spokes, disc) into one mesh per material.
      const spinMerged = mergeByMaterial(spin);
      steer.remove(spin);
      steer.add(spinMerged);
      this.root.add(root);
      this.wheelRigs.push({ root, steer, spin: spinMerged });
      this.mounts.push(new THREE.Vector3(w.mountLocal.x, w.mountLocal.y, w.mountLocal.z));
    }
  }

  /**
   * Pose the whole car from a packed snapshot (see vehicles/snapshot.ts): chassis transform, wheel
   * suspension/steer/spin, and brake lights. Live, replay, ghost and network cars all go through here.
   */
  applySnapshot(s: Float32Array): void {
    this.root.position.set(s[0], s[1], s[2]);
    this.root.quaternion.set(s[3], s[4], s[5], s[6]);
    for (let i = 0; i < 4; i++) {
      const rig = this.wheelRigs[i];
      const m = this.mounts[i];
      rig.root.position.set(m.x, m.y - s[7 + i * 3], m.z);
      // Sim steer angle is + to the right; a +Y rotation turns -Z toward -X (left), hence the minus.
      rig.steer.rotation.y = -s[8 + i * 3];
      // Rolling forward (toward -Z) is a negative rotation about +X.
      rig.spin.rotation.x = -s[9 + i * 3];
    }
    this.brakeLightMat.emissiveIntensity = s[19] > 0.5 ? 45 : 2.5;
  }

  setPaint(color: number): void {
    this.paint.color.set(color);
  }
}

function sculpt(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => [number, number, number]) {
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = fn(p.getX(i), p.getY(i), p.getZ(i));
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
}

function shadowMesh(g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addMesh(parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, shadow = true) {
  const mesh = shadow ? shadowMesh(g, m) : new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}
