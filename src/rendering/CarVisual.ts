import * as THREE from 'three';
import type { BodyStyle, CarConfig } from '../vehicles/types';
import { wheelLayout } from '../vehicles/layout';
import { buildBody } from './cars/bodies';
import { applyLivery, applyPaint, createCarMaterials, type CarMaterials } from './cars/materials';
import { mergeByMaterial } from './mergeByMaterial';

/** Paint choice: 0..3 = the car's four paints, 4 = its livery. */
export const LIVERY_INDEX = 4;

/**
 * A complete procedural car model: body from the class builder, articulated wheels
 * (suspension travel, steering, spin), non-rotating calipers, a steering wheel that turns with the
 * front wheels, brake/tail lights and switchable headlights.
 *
 * Mesh hierarchy per wheel:  root (suspension) → steer (yaw) → spin (roll) → tire, rim, disc
 *                                                └→ caliper (steers, doesn't spin)
 * Driven entirely by packed snapshots (vehicles/snapshot.ts), so the same class renders the
 * player, replays, ghosts and network cars.
 */
export class CarVisual {
  readonly root = new THREE.Group();
  readonly materials: CarMaterials;
  private readonly wheelRigs: { root: THREE.Group; steer: THREE.Group; spin: THREE.Object3D }[] = [];
  private readonly mounts: THREE.Vector3[] = [];
  private readonly steeringWheel: THREE.Group;
  private readonly steeringRatio: number;
  private readonly spots: THREE.SpotLight[] = [];
  private headlightsOn = false;
  paintIndex = 0;

  constructor(readonly config: CarConfig, paintIndex = 0) {
    const v = config.visual;
    this.materials = createCarMaterials(v.rims, v.caliperColor);
    this.steeringRatio = v.steeringRatio;

    const body = buildBody(config, this.materials);
    this.root.add(mergeByMaterial(body.group));

    // Steering wheel: rim, three spokes, hub; spins about its own column axis.
    const sw = new THREE.Group();
    const swInner = new THREE.Group();
    const r = body.steering.radius;
    swInner.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 6, 20), this.materials.interior));
    for (const a of [Math.PI / 2, Math.PI * 7 / 6, -Math.PI / 6]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.02, r, 0.012), this.materials.interior);
      spoke.position.set(Math.cos(a) * r / 2, Math.sin(a) * r / 2, 0);
      spoke.rotation.z = a - Math.PI / 2;
      swInner.add(spoke);
    }
    swInner.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 12).rotateX(Math.PI / 2), this.materials.carbon));
    // One mesh per material for the whole wheel (rim, spokes, hub).
    const swMerged = mergeByMaterial(swInner);
    sw.add(swMerged);
    sw.position.copy(body.steering.pos);
    sw.rotation.x = -(Math.PI / 2 - body.steering.tilt);
    this.steeringWheel = swMerged;
    this.root.add(sw);

    // Headlight spot lights (off by default; on for sunset and on request).
    for (const p of body.headlights) {
      const spot = new THREE.SpotLight(0xfff1dd, 0, 140, 0.42, 0.55, 1.4);
      spot.position.copy(p);
      spot.target.position.set(p.x * 1.4, p.y - 0.9, p.z - 25);
      spot.castShadow = false;
      spot.visible = false;
      this.root.add(spot, spot.target);
      this.spots.push(spot);
    }

    this.buildWheels(v.style);
    this.setPaint(paintIndex);
    // Only parts that shape the car's silhouette cast shadows; small or enclosed parts sit inside the
    // body's own shadow anyway. With 3–4 shadow cascades this removes most of a car's draw calls.
    const m = this.materials;
    const noShadow = new Set<THREE.Material>([m.interior, m.headlight, m.taillight, m.grille, m.chrome, m.dark, m.caliper, m.disc]);
    this.root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && noShadow.has(mesh.material as THREE.Material)) mesh.castShadow = false;
    });
  }

  private buildWheels(style: BodyStyle): void {
    const m = this.materials;
    for (const w of wheelLayout(this.config)) {
      const R = w.wheel.radius, W = w.wheel.width, side = w.lateral;
      const root = new THREE.Group();
      const steer = new THREE.Group();
      const spin = new THREE.Group();
      root.add(steer);
      steer.add(spin);

      spin.add(new THREE.Mesh(tireGeometry(R, W), m.rubber));
      const rimR = R * (style === 'formula' ? 0.62 : style === 'rally' ? 0.68 : 0.74);
      // Rim barrel and face.
      spin.add(new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, W * 0.92, 20, 1, true).rotateZ(Math.PI / 2), m.rim));
      const face = new THREE.CylinderGeometry(rimR * 0.22, rimR * 0.22, 0.05, 16).rotateZ(Math.PI / 2);
      const hub = new THREE.Mesh(face, m.rim);
      hub.position.x = side * W * 0.36;
      spin.add(hub);
      const spokes = { gt: 5, formula: 6, rally: 6, muscle: 5, hyper: 10, hatch: 7 }[style];
      const spokeW = { gt: 0.07, formula: 0.035, rally: 0.11, muscle: 0.12, hyper: 0.03, hatch: 0.05 }[style];
      for (let i = 0; i < spokes; i++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.035, rimR * 0.95, spokeW), m.rim);
        const a = (i / spokes) * Math.PI * 2;
        spoke.rotation.x = a;
        spoke.position.set(side * W * 0.38, Math.cos(a) * rimR * 0.48, Math.sin(a) * rimR * 0.48);
        spin.add(spoke);
        if (style === 'gt') { // split spokes
          const s2 = spoke.clone();
          s2.rotation.x = a + 0.22;
          s2.position.set(side * W * 0.38, Math.cos(a + 0.22) * rimR * 0.48, Math.sin(a + 0.22) * rimR * 0.48);
          spin.add(s2);
        }
      }
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.85, rimR * 0.85, 0.03, 28).rotateZ(Math.PI / 2), m.disc);
      disc.position.x = side * W * 0.05;
      spin.add(disc);
      const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.08, rimR * 0.5, rimR * 0.6), m.caliper);
      caliper.position.set(side * W * 0.16, rimR * 0.55, rimR * 0.3);
      steer.add(caliper);

      const merged = mergeByMaterial(spin);
      merged.traverse(o => { o.castShadow = true; });
      steer.remove(spin);
      steer.add(merged);
      caliper.castShadow = true;
      this.root.add(root);
      this.wheelRigs.push({ root, steer, spin: merged });
      this.mounts.push(new THREE.Vector3(w.mount.x, w.mount.y, w.mount.z));
      // Static pose until the first snapshot arrives.
      root.position.set(w.mount.x, w.mount.y - w.staticLength, w.mount.z);
    }
  }

  /** 0..3 = paint options, 4 = livery. */
  setPaint(index: number): void {
    this.paintIndex = index;
    const v = this.config.visual;
    if (index === LIVERY_INDEX) applyLivery(this.materials, v.livery, v.paints[0]);
    else applyPaint(this.materials, v.paints[index] ?? v.paints[0]);
  }

  /** Render as a translucent ghost (time-trial best lap): no shadows, no depth writes. */
  setGhost(): void {
    this.root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = mesh.receiveShadow = false;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        m.transparent = true;
        m.opacity = 0.32;
        m.depthWrite = false;
      }
      mesh.renderOrder = 5;
    });
    this.setHeadlights(false);
  }

  /** CSS colour of the current paint (for the minimap and standings). */
  get paintCss(): string {
    const c = this.paintIndex === LIVERY_INDEX ? this.config.visual.livery.base : this.config.visual.paints[this.paintIndex]?.color ?? 0xffffff;
    return `#${c.toString(16).padStart(6, '0')}`;
  }

  setHeadlights(on: boolean): void {
    this.headlightsOn = on;
    for (const s of this.spots) {
      s.visible = on;
      s.intensity = on ? 220 : 0;
    }
    this.materials.headlight.emissiveIntensity = on ? 9 : 2;
  }
  get headlights(): boolean { return this.headlightsOn; }

  /**
   * Pose the whole car from a packed snapshot (see vehicles/snapshot.ts): chassis transform, wheel
   * suspension/steer/spin, steering wheel and brake lights.
   */
  applySnapshot(s: Float32Array): void {
    this.root.position.set(s[0], s[1], s[2]);
    this.root.quaternion.set(s[3], s[4], s[5], s[6]);
    for (let i = 0; i < 4; i++) {
      const rig = this.wheelRigs[i];
      const m = this.mounts[i];
      rig.root.position.set(m.x, m.y - s[7 + i * 3], m.z);
      // Sim steer angle is + to the right; a +Y rotation turns −Z toward −X (left), hence the minus.
      rig.steer.rotation.y = -s[8 + i * 3];
      // Rolling forward (toward −Z) is a negative rotation about +X.
      rig.spin.rotation.x = -s[9 + i * 3];
    }
    // Steering wheel turns clockwise (as seen by the driver) for a right turn.
    this.steeringWheel.rotation.z = -((s[8] + s[11]) / 2) * this.steeringRatio;
    this.materials.taillight.emissiveIntensity = s[19] > 0.5 ? 45 : 2.5;
  }

  dispose(): void {
    this.root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    for (const mat of Object.values(this.materials)) (mat as THREE.Material).dispose();
    this.materials.paint.map?.dispose();
  }
}

/** Tire with rounded shoulders: a lathe profile (radius, axial position) revolved around the axle. */
function tireGeometry(R: number, W: number): THREE.BufferGeometry {
  const hw = W / 2;
  const bead = R * 0.72;
  const pts: THREE.Vector2[] = [];
  const shoulder = Math.min(0.05, R * 0.15);
  // Profile from inner bead, out along the sidewall, across the tread, back down the other side.
  pts.push(new THREE.Vector2(bead, -hw * 0.92));
  pts.push(new THREE.Vector2(R - shoulder, -hw));
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI / 2 - (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - shoulder + Math.sin(Math.PI / 2 - a) * shoulder, -hw + shoulder - Math.cos(Math.PI / 2 - a) * shoulder));
  }
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - shoulder + Math.cos(a) * shoulder, hw - shoulder + Math.sin(a) * shoulder));
  }
  pts.push(new THREE.Vector2(R - shoulder, hw));
  pts.push(new THREE.Vector2(bead, hw * 0.92));
  // Lathe revolves around +Y; lay the axle along X.
  const g = new THREE.LatheGeometry(pts, 28).rotateZ(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}
