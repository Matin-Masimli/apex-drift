import * as THREE from 'three';

/**
 * Cross-section of a lofted body at one station along the car (car frame: forward = −Z).
 * The section is a superellipse:  |x/hw|^n + |(y − cy)/hh|^n = 1, with separate exponents for the
 * upper and lower halves (n = 2 is an ellipse; larger n is boxier).
 */
export interface Section {
  /** Half width (m). */
  hw: number;
  /** Bottom and top heights (m). */
  y0: number;
  y1: number;
  nTop: number;
  nBot: number;
  /** Tumblehome: narrows the upper half by this fraction at the very top. */
  tumble?: number;
  /** Lateral centre offset (m), for side pods and other off-centre lofts. */
  cx?: number;
}

/** Assigns each face to a material slot from its position: t (0..1 along), angle θ (0 = right side, π/2 = top). */
export type FaceClassifier = (t: number, theta: number) => number;

/**
 * Sweep a section function from z0 to z1. UVs: u runs around the section (0 = bottom centre,
 * 0.25 = right side, 0.5 = top, 0.75 = left side), v runs along the length (0 at z0).
 * Returns one geometry per material slot used by `classify` (slot 0 if no classifier).
 */
export function loft(
  z0: number, z1: number, slices: number, around: number,
  section: (z: number, t: number) => Section,
  opts: { capStart?: boolean; capEnd?: boolean; classify?: FaceClassifier; slots?: number } = {},
): THREE.BufferGeometry[] {
  const positions: number[] = [];
  const uvs: number[] = [];
  const ring = around + 1; // duplicated seam vertex for clean UVs
  const sections: Section[] = [];
  for (let i = 0; i <= slices; i++) {
    const t = i / slices;
    const z = z0 + (z1 - z0) * t;
    const sec = section(z, t);
    sections.push(sec);
    for (let j = 0; j <= around; j++) {
      const theta = -Math.PI / 2 + (j / around) * Math.PI * 2;
      const [x, y] = sectionPoint(sec, theta);
      positions.push(x, y, z);
      uvs.push(j / around, t);
    }
  }
  const slots = opts.slots ?? 1;
  const indexBySlot: number[][] = Array.from({ length: slots }, () => []);
  for (let i = 0; i < slices; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * ring + j, b = a + 1, c = a + ring, d = c + 1;
      // With θ increasing counter-clockwise (viewed from +Z) and z increasing along the loft,
      // (a, b, c) is wound so the face normal points outward.
      const slot = opts.classify ? opts.classify((i + 0.5) / slices, -Math.PI / 2 + ((j + 0.5) / around) * Math.PI * 2) : 0;
      indexBySlot[slot].push(a, b, c, b, d, c);
    }
  }
  // End caps (fans) go in slot 0.
  const capVertex = (i: number) => {
    const sec = sections[i];
    const z = z0 + ((z1 - z0) * i) / slices;
    positions.push(sec.cx ?? 0, (sec.y0 + sec.y1) / 2, z);
    uvs.push(0.5, i / slices);
    return positions.length / 3 - 1;
  };
  if (opts.capStart) {
    const c = capVertex(0);
    for (let j = 0; j < around; j++) indexBySlot[0].push(c, j + 1, j);
  }
  if (opts.capEnd) {
    const c = capVertex(slices);
    const base = slices * ring;
    for (let j = 0; j < around; j++) indexBySlot[0].push(c, base + j, base + j + 1);
  }

  return indexBySlot.map(idx => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
}

export function sectionPoint(sec: Section, theta: number): [number, number] {
  const c = Math.cos(theta), s = Math.sin(theta);
  const n = s > 0 ? sec.nTop : sec.nBot;
  const e = 2 / n;
  const hh = (sec.y1 - sec.y0) / 2;
  const cy = (sec.y0 + sec.y1) / 2;
  const narrow = 1 - (sec.tumble ?? 0) * Math.max(0, s);
  const x = (sec.cx ?? 0) + sec.hw * Math.sign(c) * Math.pow(Math.abs(c), e) * narrow;
  const y = cy + hh * Math.sign(s) * Math.pow(Math.abs(s), e);
  return [x, y];
}

/** Smoothstep between edges. */
export const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Piecewise-smooth profile through (z, value) keys: smoothstep blending between consecutive keys. */
export function profile(keys: [number, number][], z: number): number {
  if (z <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [za, va] = keys[i - 1], [zb, vb] = keys[i];
    if (z <= zb) return va + (vb - va) * smooth(za, zb, z);
  }
  return keys[keys.length - 1][1];
}
