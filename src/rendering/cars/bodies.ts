import * as THREE from 'three';
import type { CarConfig } from '../../vehicles/types';
import { wheelLayout } from '../../vehicles/layout';
import { loft, profile, smooth } from './loft';
import type { CarMaterials } from './materials';

/**
 * Procedural, parametric car bodies. Every model is original by construction: proportions come from
 * the car's own physics config (length, width, wheelbase, track, wheel sizes), and each racing class
 * gets its own profile keys and detail set.
 *
 * Car frame: forward = −Z, right = +X, up = +Y, origin on the ground at the middle of the wheelbase.
 */

export interface BodyBuild {
  /** Static meshes (safe to merge by material). */
  group: THREE.Group;
  /** Headlight lens centres (car frame), for spot lights. */
  headlights: THREE.Vector3[];
  /** Steering wheel placement: position, tilt from vertical (rad), radius. */
  steering: { pos: THREE.Vector3; tilt: number; radius: number };
}

/** Small helper for placing primitive detail parts. */
class Parts {
  constructor(readonly group: THREE.Group) {}
  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
    return this.add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
  }
  /** Cylinder along Z (lights, exhausts) or Y (posts) depending on `axis`. */
  cyl(mat: THREE.Material, r: number, len: number, x: number, y: number, z: number, axis: 'z' | 'y' | 'x' = 'z', seg = 20): THREE.Mesh {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    return this.add(g, mat, x, y, z);
  }
  add(g: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }
  /** Mirror a part builder on both sides (x and −x). */
  both(fn: (side: -1 | 1) => void): void { fn(-1); fn(1); }
}

interface ClosedSpec {
  /** Body top line (hood, belt, deck), as (z, y) keys from nose to tail. */
  top: [number, number][];
  /** Floor line before wheel arches are cut, (z, y). */
  bottom: [number, number][];
  /** Plan-view half-width as a fraction of W/2, (z, frac). */
  width: [number, number][];
  nTop: number;
  nBot: number;
  tumble: number;
  /** Extra half-width (m) over the wheel arches. */
  flare: number;
  cabin: {
    z0: number; z1: number;
    /** Roof line (z, y). Must meet the body top at z0 and z1. */
    roof: [number, number][];
    /** Fraction of body half-width at the cabin base. */
    baseFrac: number;
    tumble: number;
    nTop: number;
    /** Flat-roof span (painted). */
    roofZ: [number, number];
    /** B-pillar position (painted band), if any. */
    bPillar?: number;
  };
}

/** Build the shared closed-body structure: shell with arches, greenhouse with painted roof, tub, glass. */
function closedBody(cfg: CarConfig, m: CarMaterials, spec: ClosedSpec, parts: Parts) {
  const [hx, , hz] = cfg.chassis.halfExtents;
  const W2 = hx;
  const layout = wheelLayout(cfg);
  const axles = [layout[0], layout[2]].map(w => ({ z: w.mount.z, R: w.wheel.radius }));

  const top = (z: number) => profile(spec.top, z);
  /** Floor height with circular wheel arches around each axle. */
  const floor = (z: number) => {
    let y = profile(spec.bottom, z);
    for (const a of axles) {
      const Ra = a.R * 1.06 + 0.07;
      const dz = z - a.z;
      if (Math.abs(dz) < Ra) y = Math.max(y, a.R + Math.sqrt(Ra * Ra - dz * dz));
    }
    return Math.min(y, top(z) - 0.12);
  };
  const halfWidth = (z: number) => {
    let w = W2 * profile(spec.width, z);
    for (const a of axles) w += spec.flare * (1 - smooth(0, a.R * 1.6, Math.abs(z - a.z)));
    return w;
  };

  // Main shell (paint, carries the livery).
  const [shell] = loft(-hz, hz, 96, 48, z => ({
    hw: halfWidth(z), y0: floor(z), y1: top(z), nTop: spec.nTop, nBot: spec.nBot, tumble: spec.tumble,
  }), { capStart: true, capEnd: true });
  parts.add(shell, m.paint, 0, 0, 0);

  // Greenhouse: glass with painted roof, A/C pillars and B pillar.
  const c = spec.cabin;
  const cabinZ = (t: number) => c.z0 + (c.z1 - c.z0) * t;
  const [glass, paint] = loft(c.z0, c.z1, 48, 40, z => ({
    hw: Math.min(halfWidth(z) - 0.05, W2 * c.baseFrac) * (1 - 0.06 * (1 - smooth(c.z0, c.z0 + 0.4, z))),
    y0: top(z) - 0.06,
    y1: Math.max(top(z) + 0.01, profile(c.roof, z)),
    nTop: c.nTop, nBot: 8, tumble: c.tumble,
  }), {
    slots: 2,
    classify: (t, th) => {
      const z = cabinZ(t), s = Math.sin(th), co = Math.abs(Math.cos(th));
      if (s < 0) return 0;
      // Roof panel: the superellipse's flat top spans a wide angle band, so be generous.
      if (z > c.roofZ[0] && z < c.roofZ[1] && s > 0.6) return 1;
      if (z <= c.roofZ[0] && co > 0.62) return 1;                 // A pillars
      if (z >= c.roofZ[1] && co > 0.55) return 1;                 // C pillars
      if (c.bPillar !== undefined && Math.abs(z - c.bPillar) < 0.05 && co > 0.3) return 1;
      return 0;
    },
  });
  parts.add(glass, m.glass, 0, 0, 0);
  parts.add(paint, m.trim, 0, 0, 0);

  // Dark tub between the wheels: fills the arches and underside so the car never looks hollow.
  const tubW = Math.min(cfg.geometry.trackFront, cfg.geometry.trackRear) - Math.max(cfg.wheels.front.width, cfg.wheels.rear.width) - 0.08;
  const tubTop = Math.min(top(axles[0].z), top(axles[1].z)) - 0.1;
  const tubBottom = profile(spec.bottom, 0) + 0.02;
  parts.box(m.dark, tubW, tubTop - tubBottom, hz * 2 - 0.5, 0, (tubTop + tubBottom) / 2, 0);

  // Simple interior visible through the tinted glass: dash and two seats.
  parts.box(m.interior, W2 * 1.4, 0.18, 0.3, 0, top(c.z0 + 0.4) + 0.02, c.z0 + 0.45);
  parts.both(s => parts.box(m.interior, 0.45, 0.55, 0.15, s * 0.36, top(c.z0 + 1.1) + 0.1, c.z0 + 1.2, -0.2));

  // Mirrors on stalks at the A-pillars.
  parts.both(s => {
    const z = c.z0 + 0.3;
    const x = s * (Math.min(halfWidth(z), W2 * c.baseFrac) + 0.1);
    parts.box(m.trim, 0.16, 0.09, 0.1, x, top(z) + 0.14, z);
    parts.box(m.dark, 0.12, 0.03, 0.03, x - s * 0.08, top(z) + 0.1, z);
  });

  // Exhausts from the config.
  for (const [x, y, z] of cfg.visual.exhausts) parts.cyl(m.chrome, 0.045, 0.16, x, y, z - 0.04, 'z', 16);

  return {
    top, floor, halfWidth, hz, W2,
    steering: { pos: new THREE.Vector3(-W2 * 0.4, top(c.z0 + 0.5) + 0.1, c.z0 + 0.6), tilt: 1.15, radius: 0.18 },
  };
}

export function buildBody(cfg: CarConfig, m: CarMaterials): BodyBuild {
  const group = new THREE.Group();
  const parts = new Parts(group);
  const style = cfg.visual.style;
  if (style === 'formula') return buildFormula(cfg, m, parts);

  const [hx, , hz] = cfg.chassis.halfExtents;
  const zN = -hz, zT = hz;
  const wb = cfg.geometry.wheelbase;
  const zF = -wb / 2, zR = wb / 2;
  const headlights: THREE.Vector3[] = [];
  let b: ReturnType<typeof closedBody>;

  switch (style) {
    case 'gt': {
      b = closedBody(cfg, m, {
        top: [[zN, 0.55], [zN + 0.27, 0.74], [zF + 0.04, 0.88], [-0.6, 0.94], [0.7, 0.98], [1.6, 1.0], [zT - 0.17, 0.97], [zT, 0.84]],
        bottom: [[zN, 0.22], [zN + 0.42, 0.14], [zT - 0.42, 0.16], [zT, 0.4]],
        width: [[zN, 0.78], [zN + 0.42, 0.94], [zF, 1.0], [zR, 1.0], [zT - 0.2, 0.96], [zT, 0.88]],
        nTop: 3, nBot: 5, tumble: 0.1, flare: 0.04,
        cabin: { z0: -0.62, z1: 1.55, roof: [[-0.62, 0.94], [-0.05, 1.2], [0.55, 1.22], [1.55, 0.99]], baseFrac: 0.84, tumble: 0.3, nTop: 2.6, roofZ: [-0.05, 0.55], bPillar: 0.22 },
      }, parts);
      // Slim swept headlights, full-width tail light, splitter, diffuser, side skirts, rear wing.
      parts.both(s => {
        const z = zN + 0.32;
        parts.box(m.headlight, 0.36, 0.05, 0.2, s * 0.6, b.top(z) - 0.03, z, -0.35, s * 0.25);
        headlights.push(new THREE.Vector3(s * 0.6, b.top(z) - 0.03, z - 0.1));
      });
      parts.box(m.taillight, hx * 1.7, 0.05, 0.05, 0, b.top(zT - 0.05) - 0.07, zT - 0.02);
      parts.box(m.grille, hx * 1.1, 0.14, 0.06, 0, 0.32, zN + 0.06);
      parts.box(m.carbon, hx * 1.9, 0.025, 0.32, 0, 0.13, zN + 0.18);
      parts.box(m.dark, hx * 1.4, 0.14, 0.42, 0, 0.24, zT - 0.22, 0.18);
      for (let i = -2; i <= 2; i++) parts.box(m.carbon, 0.02, 0.14, 0.4, i * 0.25, 0.22, zT - 0.22, 0.18);
      parts.both(s => parts.box(m.carbon, 0.07, 0.07, wb - 0.9, s * (hx + 0.01), 0.2, 0));
      const wz = zT - 0.32, wy = b.top(wz) + 0.32;
      parts.box(m.carbon, hx * 1.86, 0.035, 0.38, 0, wy, wz, 0.12);
      parts.both(s => {
        parts.box(m.carbon, 0.02, 0.3, 0.5, s * hx * 0.93, wy - 0.05, wz);
        parts.box(m.carbon, 0.04, 0.32, 0.18, s * 0.42, wy - 0.17, wz + 0.03);
      });
      parts.box(m.dark, 0.5, 0.06, 0.45, 0, b.top(-1.2) + 0.02, -1.2); // hood vent
      break;
    }
    case 'rally': {
      b = closedBody(cfg, m, {
        top: [[zN, 0.74], [zN + 0.22, 0.88], [zF + 0.1, 0.99], [-0.6, 1.04], [1.0, 1.08], [zT - 0.1, 1.08], [zT, 1.0]],
        bottom: [[zN, 0.44], [zN + 0.4, 0.33], [zT - 0.4, 0.35], [zT, 0.5]],
        width: [[zN, 0.86], [zN + 0.3, 0.97], [zF, 1.0], [zR, 1.0], [zT, 0.94]],
        nTop: 4, nBot: 5, tumble: 0.06, flare: 0.07,
        cabin: { z0: -0.65, z1: zT - 0.04, roof: [[-0.65, 1.04], [0.05, 1.46], [1.4, 1.48], [zT - 0.12, 1.36], [zT - 0.04, 1.08]], baseFrac: 0.88, tumble: 0.22, nTop: 3.2, roofZ: [0.05, 1.45], bPillar: 0.55 },
      }, parts);
      parts.both(s => {
        const z = zN + 0.12;
        parts.box(m.headlight, 0.3, 0.12, 0.08, s * 0.55, b.top(z) - 0.1, z, 0, 0);
        headlights.push(new THREE.Vector3(s * 0.55, b.top(z) - 0.1, z - 0.05));
        parts.box(m.taillight, 0.12, 0.22, 0.05, s * 0.72, b.top(zT) - 0.12, zT - 0.01);
        // Mud flaps behind each wheel.
        for (const az of [zF, zR]) parts.box(m.dark, 0.26, 0.24, 0.015, s * (cfg.geometry.trackFront / 2), 0.2, az + 0.42);
        // Wide arch flares in black plastic.
        for (const az of [zF, zR]) {
          const g = new THREE.TorusGeometry(cfg.wheels.front.radius + 0.1, 0.035, 6, 20, Math.PI);
          parts.add(g, m.dark, s * (hx + 0.04), cfg.wheels.front.radius, az, 0, Math.PI / 2, 0);
        }
      });
      // Four-lamp light pod on the bumper.
      for (let i = 0; i < 4; i++) {
        const x = (i - 1.5) * 0.27;
        parts.cyl(m.dark, 0.1, 0.06, x, 0.6, zN - 0.03);
        parts.cyl(m.headlight, 0.085, 0.02, x, 0.6, zN - 0.07);
      }
      parts.box(m.grille, hx * 1.0, 0.16, 0.05, 0, 0.5, zN + 0.03);
      parts.box(m.chrome, hx * 1.2, 0.04, 0.5, 0, 0.36, zN + 0.2, 0.25); // skid plate
      parts.box(m.trim, 0.3, 0.08, 0.4, 0, 1.5, 0.45); // roof scoop
      parts.box(m.dark, 0.24, 0.05, 0.02, 0, 1.5, 0.25);
      parts.box(m.trim, hx * 1.7, 0.04, 0.36, 0, 1.5, zT - 0.3, 0.08); // roof spoiler
      break;
    }
    case 'muscle': {
      b = closedBody(cfg, m, {
        top: [[zN, 0.8], [zN + 0.1, 0.9], [zF, 0.96], [-0.2, 0.98], [0.9, 0.98], [1.5, 0.99], [zT - 0.15, 0.99], [zT, 0.9]],
        bottom: [[zN, 0.3], [zN + 0.25, 0.22], [zT - 0.25, 0.24], [zT, 0.34]],
        width: [[zN, 0.92], [zN + 0.25, 0.99], [zT - 0.15, 1.0], [zT, 0.96]],
        nTop: 6, nBot: 6, tumble: 0.03, flare: 0.05,
        cabin: { z0: -0.25, z1: 1.5, roof: [[-0.25, 0.98], [0.3, 1.3], [1.0, 1.32], [1.4, 1.1], [1.5, 0.99]], baseFrac: 0.82, tumble: 0.25, nTop: 3.5, roofZ: [0.3, 1.0], bPillar: 0.62 },
      }, parts);
      // Full-width black grille with quad round headlights, chrome bumpers, hood scoop, ducktail.
      parts.box(m.grille, hx * 1.84, 0.28, 0.05, 0, 0.64, zN + 0.01);
      parts.both(s => {
        for (const x of [0.62, 0.38]) {
          parts.cyl(m.chrome, 0.1, 0.04, s * x, 0.66, zN - 0.02);
          parts.cyl(m.headlight, 0.085, 0.02, s * x, 0.66, zN - 0.045);
        }
        headlights.push(new THREE.Vector3(s * 0.5, 0.66, zN - 0.05));
        parts.box(m.taillight, 0.6, 0.12, 0.04, s * 0.5, 0.78, zT + 0.005);
      });
      parts.box(m.chrome, hx * 2.0, 0.1, 0.14, 0, 0.38, zN - 0.02);
      parts.box(m.chrome, hx * 2.0, 0.1, 0.14, 0, 0.4, zT + 0.02);
      parts.box(m.trim, 0.55, 0.1, 0.7, 0, b.top(-1.0) + 0.04, -1.0);
      parts.box(m.grille, 0.45, 0.07, 0.02, 0, b.top(-1.0) + 0.05, -1.36);
      parts.box(m.trim, hx * 1.9, 0.05, 0.12, 0, b.top(zT - 0.1) + 0.03, zT - 0.08, -0.35);
      break;
    }
    case 'hyper': {
      b = closedBody(cfg, m, {
        top: [[zN, 0.42], [zN + 0.25, 0.56], [zF - 0.03, 0.72], [-0.9, 0.78], [0.6, 0.98], [1.5, 1.0], [zT - 0.25, 0.92], [zT, 0.78]],
        bottom: [[zN, 0.13], [zN + 0.45, 0.11], [zT - 0.45, 0.13], [zT, 0.3]],
        width: [[zN, 0.8], [zN + 0.45, 0.95], [zF + 0.05, 1.0], [0, 0.9], [zR - 0.05, 1.0], [zT - 0.25, 0.98], [zT, 0.86]],
        nTop: 2.6, nBot: 4, tumble: 0.14, flare: 0.07,
        cabin: { z0: -1.0, z1: 0.9, roof: [[-1.0, 0.78], [-0.35, 1.1], [0.15, 1.12], [0.9, 0.97]], baseFrac: 0.7, tumble: 0.35, nTop: 2.4, roofZ: [-0.35, 0.15] },
      }, parts);
      parts.both(s => {
        const z = zN + 0.36;
        parts.box(m.headlight, 0.42, 0.03, 0.12, s * 0.66, b.top(z) - 0.02, z, -0.3, s * 0.4);
        headlights.push(new THREE.Vector3(s * 0.66, b.top(z) - 0.02, z - 0.08));
        // Side intakes ahead of the rear wheels.
        parts.box(m.grille, 0.06, 0.26, 0.6, s * (b.halfWidth(0.55) - 0.02), 0.5, 0.55, 0, s * 0.12);
      });
      parts.box(m.taillight, hx * 1.8, 0.025, 0.04, 0, b.top(zT) - 0.04, zT - 0.03);
      parts.box(m.grille, hx * 1.3, 0.12, 0.05, 0, 0.24, zN + 0.12);
      parts.box(m.carbon, hx * 1.9, 0.02, 0.36, 0, 0.1, zN + 0.2);
      parts.box(m.dark, hx * 1.7, 0.22, 0.55, 0, 0.27, zT - 0.27, 0.3);
      for (let i = -3; i <= 3; i++) parts.box(m.carbon, 0.02, 0.24, 0.52, i * 0.22, 0.26, zT - 0.27, 0.3);
      // Active wing on short stalks, louvres over the engine, dorsal fin.
      const wz = zT - 0.28, wy = b.top(wz) + 0.14;
      parts.box(m.carbon, hx * 1.7, 0.025, 0.3, 0, wy, wz, 0.08);
      parts.both(s => parts.box(m.carbon, 0.03, 0.14, 0.12, s * 0.5, wy - 0.07, wz));
      for (let i = 0; i < 6; i++) parts.box(m.grille, 0.7, 0.015, 0.05, 0, b.top(1.2 + i * 0.1) + 0.006, 1.2 + i * 0.1);
      parts.box(m.trim, 0.025, 0.12, 1.2, 0, b.top(1.3) + 0.04, 1.3);
      break;
    }
    case 'hatch':
    default: {
      b = closedBody(cfg, m, {
        top: [[zN, 0.62], [zN + 0.2, 0.78], [zF + 0.08, 0.9], [-0.65, 0.96], [1.2, 1.0], [zT - 0.05, 1.02], [zT, 0.95]],
        bottom: [[zN, 0.3], [zN + 0.4, 0.2], [zT - 0.4, 0.22], [zT, 0.36]],
        width: [[zN, 0.84], [zN + 0.3, 0.96], [zF + 0.08, 1.0], [zR, 1.0], [zT, 0.93]],
        nTop: 3.4, nBot: 4.5, tumble: 0.08, flare: 0.035,
        cabin: { z0: -0.7, z1: zT - 0.03, roof: [[-0.7, 0.96], [0.0, 1.38], [1.5, 1.4], [zT - 0.08, 1.3], [zT - 0.03, 1.02]], baseFrac: 0.86, tumble: 0.24, nTop: 3, roofZ: [0.0, 1.5], bPillar: 0.5 },
      }, parts);
      parts.both(s => {
        const z = zN + 0.22;
        parts.box(m.headlight, 0.34, 0.09, 0.14, s * 0.56, b.top(z) - 0.06, z, -0.2, s * 0.15);
        headlights.push(new THREE.Vector3(s * 0.56, b.top(z) - 0.06, z - 0.07));
        parts.box(m.taillight, 0.1, 0.32, 0.05, s * 0.7, b.top(zT) - 0.22, zT - 0.02);
      });
      parts.box(m.grille, hx * 1.2, 0.2, 0.05, 0, 0.42, zN + 0.04);
      parts.box(m.carbon, hx * 1.7, 0.02, 0.18, 0, 0.18, zN + 0.12);
      parts.box(m.trim, hx * 1.6, 0.035, 0.3, 0, 1.38, zT - 0.22, -0.18); // roof spoiler
      break;
    }
  }

  return { group, headlights, steering: b.steering };
}

/** Open-wheel single seater: monocoque, side pods, wings, halo, exposed suspension. */
function buildFormula(cfg: CarConfig, m: CarMaterials, parts: Parts): BodyBuild {
  const [, , hz] = cfg.chassis.halfExtents;
  const zN = -hz, zT = hz - 0.35;
  const layout = wheelLayout(cfg);

  const tub = loft(zN, zT, 96, 40, z => ({
    hw: profile([[zN, 0.08], [zN + 0.55, 0.14], [-1.0, 0.26], [-0.3, 0.4], [0.6, 0.42], [1.5, 0.28], [zT, 0.16]], z),
    y0: profile([[zN, 0.2], [zN + 0.55, 0.16], [-1.0, 0.12], [zT, 0.14]], z),
    y1: profile([[zN, 0.32], [zN + 0.55, 0.42], [-1.0, 0.55], [-0.3, 0.62], [0.3, 0.66], [0.6, 0.92], [1.0, 0.86], [1.6, 0.6], [zT, 0.46]], z),
    nTop: 2.6, nBot: 6, tumble: 0.15,
  }), { capStart: true, capEnd: true })[0];
  parts.add(tub, m.paint, 0, 0, 0);

  // Side pods.
  parts.both(s => {
    const [pod] = loft(-0.5, 1.4, 40, 24, z => ({
      hw: profile([[-0.5, 0.2], [0, 0.26], [0.9, 0.2], [1.4, 0.08]], z),
      y0: 0.1,
      y1: profile([[-0.5, 0.46], [0.2, 0.52], [1.4, 0.26]], z),
      nTop: 3, nBot: 6, cx: s * 0.56,
    }), { capStart: true, capEnd: true });
    parts.add(pod, m.paint, 0, 0, 0);
    parts.box(m.grille, 0.32, 0.3, 0.03, s * 0.56, 0.3, -0.52); // pod inlet
    parts.box(m.trim, 0.12, 0.07, 0.08, s * 0.62, 0.62, -0.25); // mirror
  });

  // Cockpit opening, driver helmet, halo.
  const opening = new THREE.SphereGeometry(1, 24, 12).scale(0.3, 0.06, 0.55);
  parts.add(opening, m.grille, 0, 0.63, -0.15);
  parts.add(new THREE.SphereGeometry(0.14, 20, 14), new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.3 }), 0, 0.74, 0.02);
  parts.box(m.grille, 0.22, 0.06, 0.1, 0, 0.75, -0.1);
  // Halo: an arc of ~207° laid flat, centred on the front of the cockpit. Euler XYZ applies the Z
  // rotation first (positions the arc within its own plane), then X lays the plane horizontal,
  // mapping in-plane angle a to the direction (cos a, 0, sin a). Centre the arc at a = −π/2 (front).
  const arc = Math.PI * 1.15;
  const halo = new THREE.TorusGeometry(0.36, 0.025, 8, 24, arc);
  parts.add(halo, m.carbon, 0, 0.83, 0.05, Math.PI / 2, 0, -Math.PI / 2 - arc / 2);
  parts.box(m.carbon, 0.04, 0.22, 0.04, 0, 0.74, -0.36, 0.3);

  // Floor, front wing, rear wing.
  parts.box(m.carbon, 1.36, 0.03, 3.4, 0, 0.07, 0.25);
  const fz = zN + 0.22;
  parts.box(m.carbon, 1.85, 0.025, 0.42, 0, 0.11, fz, 0.06);
  parts.box(m.trim, 1.85, 0.02, 0.18, 0, 0.17, fz + 0.12, 0.35);
  parts.both(s => parts.box(m.carbon, 0.02, 0.22, 0.55, s * 0.93, 0.18, fz));
  const rz = zT + 0.12;
  parts.box(m.carbon, 1.0, 0.03, 0.34, 0, 0.92, rz, 0.15);
  parts.box(m.trim, 1.0, 0.025, 0.16, 0, 1.04, rz + 0.12, 0.45);
  parts.both(s => parts.box(m.trim, 0.02, 0.48, 0.62, s * 0.5, 0.84, rz));
  parts.box(m.carbon, 0.04, 0.4, 0.12, 0, 0.66, rz - 0.05);
  parts.box(m.taillight, 0.12, 0.08, 0.03, 0, 0.42, rz + 0.1);

  // Wishbones: two thin arms from the tub to each upright (at static ride height).
  for (const w of layout) {
    const wy = w.wheel.radius, wz = w.mount.z, wx = w.mount.x - w.lateral * w.wheel.width * 0.35;
    for (const [y0, dz] of [[wy + 0.1, 0.18], [wy - 0.08, -0.18]] as const) {
      for (const dzz of [dz, -dz * 0.2]) {
        const a = new THREE.Vector3(w.lateral * 0.3, y0 + 0.06, wz + dzz);
        const bb = new THREE.Vector3(wx, y0, wz);
        const len = a.distanceTo(bb);
        const g = new THREE.CylinderGeometry(0.015, 0.015, len, 6);
        const mesh = parts.add(g, m.carbon, (a.x + bb.x) / 2, (a.y + bb.y) / 2, (a.z + bb.z) / 2);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bb.clone().sub(a).normalize());
      }
    }
  }
  for (const [x, y, z] of cfg.visual.exhausts) parts.cyl(m.dark, 0.05, 0.14, x, y, z - 0.04, 'z', 16);

  return {
    group: parts.group,
    headlights: [],
    steering: { pos: new THREE.Vector3(0, 0.62, -0.42), tilt: 1.3, radius: 0.13 },
  };
}
