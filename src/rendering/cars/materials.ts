import * as THREE from 'three';
import type { LiveryDef, PaintOption } from '../../vehicles/types';

/** Shared car materials (one set per car instance, so paint swaps don't affect other cars). */
export interface CarMaterials {
  /** Main body paint: carries the livery map when a livery is selected. */
  paint: THREE.MeshPhysicalMaterial;
  /** Secondary painted parts (roof, mirrors, wing plates): same finish, never the livery map. */
  trim: THREE.MeshPhysicalMaterial;
  glass: THREE.MeshPhysicalMaterial;
  /** Black plastic / underbody. */
  dark: THREE.MeshStandardMaterial;
  carbon: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  grille: THREE.MeshStandardMaterial;
  headlight: THREE.MeshStandardMaterial;
  taillight: THREE.MeshStandardMaterial;
  rim: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  caliper: THREE.MeshStandardMaterial;
  disc: THREE.MeshStandardMaterial;
  interior: THREE.MeshStandardMaterial;
}

let flakeMap: THREE.CanvasTexture | null = null;
let carbonMap: THREE.CanvasTexture | null = null;

/**
 * Metallic flake: a fine random normal map on the *base* layer only. The clear coat keeps its own
 * smooth normal, so you get sharp clear-coat reflections over a sparkling base, like real paint.
 */
function getFlakeMap(): THREE.CanvasTexture {
  if (flakeMap) return flakeMap;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < size * size; i++) {
    const x = rnd() * 2 - 1, y = rnd() * 2 - 1;
    img.data[i * 4] = 128 + x * 110;
    img.data[i * 4 + 1] = 128 + y * 110;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  flakeMap = new THREE.CanvasTexture(c);
  flakeMap.wrapS = flakeMap.wrapT = THREE.RepeatWrapping;
  flakeMap.repeat.set(40, 40);
  return flakeMap;
}

function getCarbonMap(): THREE.CanvasTexture {
  if (carbonMap) return carbonMap;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  // 2x2 twill weave.
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const on = (x + y) % 4 < 2;
    ctx.fillStyle = on ? '#2a2c30' : '#141517';
    ctx.fillRect(x * 8, y * 8, 8, 8);
  }
  carbonMap = new THREE.CanvasTexture(c);
  carbonMap.colorSpace = THREE.SRGBColorSpace;
  carbonMap.wrapS = carbonMap.wrapT = THREE.RepeatWrapping;
  carbonMap.repeat.set(30, 30);
  return carbonMap;
}

export function createCarMaterials(rims: { color: number; metalness: number }, caliper: number): CarMaterials {
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: 0xffffff }),
    trim: new THREE.MeshPhysicalMaterial({ color: 0xffffff }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0d12, metalness: 0.1, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.75, metalness: 0.1 }),
    carbon: new THREE.MeshStandardMaterial({ map: getCarbonMap(), roughness: 0.35, metalness: 0.3 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe8eaee, metalness: 1, roughness: 0.08 }),
    grille: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.6, metalness: 0.3 }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, emissive: 0xfff4e0, emissiveIntensity: 2, roughness: 0.1, metalness: 0.2 }),
    taillight: new THREE.MeshStandardMaterial({ color: 0x3a0306, emissive: 0xff1010, emissiveIntensity: 2.5, roughness: 0.2 }),
    rim: new THREE.MeshStandardMaterial({ color: rims.color, metalness: rims.metalness, roughness: 0.25 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.92 }),
    caliper: new THREE.MeshStandardMaterial({ color: caliper, metalness: 0.2, roughness: 0.4 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x5a5d61, metalness: 0.9, roughness: 0.5 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.85 }),
  };
}

/** Apply a solid paint option (clears any livery). */
export function applyPaint(m: CarMaterials, p: PaintOption): void {
  for (const mat of [m.paint, m.trim]) configurePaint(mat, p.color, p);
  m.paint.map = null;
  m.paint.needsUpdate = true;
}

/** Apply a livery: the body gets the painted texture; trim parts take the livery base colour. */
export function applyLivery(m: CarMaterials, l: LiveryDef, finish: PaintOption): void {
  configurePaint(m.paint, 0xffffff, finish);
  configurePaint(m.trim, l.base, finish);
  m.paint.map?.dispose();
  m.paint.map = drawLivery(l);
  m.paint.needsUpdate = true;
}

function configurePaint(mat: THREE.MeshPhysicalMaterial, color: number, p: PaintOption): void {
  mat.color.set(color);
  mat.metalness = p.matte ? 0.15 : p.metalness ?? 0.5;
  mat.roughness = p.matte ? 0.55 : p.roughness ?? 0.35;
  mat.clearcoat = p.matte ? 0 : 1;
  mat.clearcoatRoughness = 0.03;
  const flake = p.matte ? 0 : p.flake ?? 0.4;
  mat.normalMap = flake > 0 ? getFlakeMap() : null;
  mat.normalScale.set(flake * 0.25, flake * 0.25);
  mat.iridescence = p.pearl ? 0.8 : 0;
  mat.iridescenceIOR = 1.45;
  mat.iridescenceThicknessRange = [200, 600];
  mat.needsUpdate = true;
}

/**
 * Draw a livery onto a canvas laid out in the body loft's UV space.
 * Canvas x = u (around: 0 bottom, 0.25 right side, 0.5 top, 0.75 left side);
 * canvas y = 1 − v (v = 0 at the nose), because textures are flipped on upload.
 */
export function drawLivery(l: LiveryDef): THREE.CanvasTexture {
  const W = 1024, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const [a0 = 0xffffff, a1 = a0, a2 = a1] = l.accents;
  const X = (u: number) => u * W;
  const Y = (v: number) => (1 - v) * H;

  ctx.fillStyle = hex(l.base);
  ctx.fillRect(0, 0, W, H);

  /** Text along a side, reading front-to-back as seen from that side. */
  const sideText = (side: 'right' | 'left', text: string, v: number, u: number, size: number, color: string) => {
    ctx.save();
    ctx.translate(X(u), Y(v));
    ctx.rotate(side === 'right' ? Math.PI / 2 : -Math.PI / 2);
    ctx.fillStyle = color;
    ctx.font = `italic 900 ${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };
  const roundel = (side: 'right' | 'left', v: number, u: number) => {
    ctx.fillStyle = '#f4f4f0';
    ctx.beginPath();
    ctx.ellipse(X(u), Y(v), 54, 54, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#111';
    ctx.stroke();
    sideText(side, String(l.number), v, u, 72, '#111');
  };

  switch (l.pattern) {
    case 'endurance': {
      // Twin stripes over the top, diagonal colour sweep from the nose, door roundels.
      ctx.fillStyle = hex(a0);
      ctx.fillRect(X(0.465), 0, X(0.03), H);
      ctx.fillRect(X(0.505), 0, X(0.03), H);
      for (const [u0, u1] of [[0.12, 0.38], [0.62, 0.88]]) {
        ctx.beginPath();
        ctx.moveTo(X(u0), Y(0)); ctx.lineTo(X(u1), Y(0)); ctx.lineTo(X(u1), Y(0.18)); ctx.lineTo(X(u0), Y(0.42));
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = hex(a1);
      ctx.fillRect(X(0.12), Y(0.47), X(0.26), 10);
      ctx.fillRect(X(0.62), Y(0.47), X(0.26), 10);
      break;
    }
    case 'chevron': {
      // Yellow chevron down the nose and engine cover, red flanks.
      ctx.fillStyle = hex(a0);
      for (let k = 0; k < 6; k++) {
        const v = 0.05 + k * 0.15;
        ctx.beginPath();
        ctx.moveTo(X(0.3), Y(v)); ctx.lineTo(X(0.5), Y(v + 0.08)); ctx.lineTo(X(0.7), Y(v));
        ctx.lineTo(X(0.7), Y(v + 0.04)); ctx.lineTo(X(0.5), Y(v + 0.12)); ctx.lineTo(X(0.3), Y(v + 0.04));
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = hex(a1);
      ctx.fillRect(X(0.15), 0, X(0.08), H);
      ctx.fillRect(X(0.77), 0, X(0.08), H);
      break;
    }
    case 'rally': {
      // Diagonal colour bands on the flanks, black roof line, door number plates.
      const bands: [number, number][] = [[0.3, a0], [0.42, a1]];
      for (const [v0, col] of bands) {
        ctx.fillStyle = hex(col);
        for (const [u0, u1] of [[0.08, 0.42], [0.58, 0.92]]) {
          ctx.beginPath();
          ctx.moveTo(X(u0), Y(v0)); ctx.lineTo(X(u0), Y(v0 + 0.1)); ctx.lineTo(X(u1), Y(v0 + 0.32)); ctx.lineTo(X(u1), Y(v0 + 0.22));
          ctx.closePath(); ctx.fill();
        }
      }
      ctx.fillStyle = hex(a2);
      ctx.fillRect(X(0.44), 0, X(0.12), H);
      break;
    }
    case 'stripes': {
      // Classic twin stripes nose to tail.
      ctx.fillStyle = hex(a0);
      ctx.fillRect(X(0.44), 0, X(0.045), H);
      ctx.fillRect(X(0.515), 0, X(0.045), H);
      ctx.fillRect(X(0.2), 0, 8, H);
      ctx.fillRect(X(0.8), 0, 8, H);
      break;
    }
    case 'split': {
      // Two-tone with a sharp diagonal split and a neon pinstripe.
      ctx.fillStyle = hex(a0);
      for (const [u0, u1] of [[0, 0.3], [0.7, 1]]) {
        ctx.beginPath();
        ctx.moveTo(X(u0), Y(0)); ctx.lineTo(X(u1), Y(0)); ctx.lineTo(X(u1), Y(0.25)); ctx.lineTo(X(u0), Y(0.75));
        ctx.lineTo(X(u0), Y(1)); ctx.lineTo(X(u0), Y(0));
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = hex(a1);
      ctx.fillRect(X(0.3) - 4, 0, 8, H);
      ctx.fillRect(X(0.7) - 4, 0, 8, H);
      break;
    }
  }
  if (l.sponsor) {
    sideText('right', l.sponsor, 0.66, 0.2, 58, l.pattern === 'chevron' || l.base < 0x404040 ? '#f4f4f0' : '#111');
    sideText('left', l.sponsor, 0.66, 0.8, 58, l.pattern === 'chevron' || l.base < 0x404040 ? '#f4f4f0' : '#111');
  }
  if (l.number > 0) {
    roundel('right', 0.48, 0.27);
    roundel('left', 0.48, 0.73);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
