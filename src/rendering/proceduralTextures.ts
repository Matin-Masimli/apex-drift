import * as THREE from 'three';

/**
 * Small procedural textures drawn on a canvas at startup. Original by construction,
 * no external image assets, and tiny to ship.
 */

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

/** Deterministic PRNG so textures look the same every load. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function toTexture(c: HTMLCanvasElement, repeat: number, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Speckled noise over a base colour: asphalt, gravel, grass. */
export function noiseTexture(base: [number, number, number], spread: number, grains: number, seed: number, repeat: number) {
  const size = 512;
  const [c, ctx] = canvas(size);
  const r = rng(seed);
  ctx.fillStyle = `rgb(${base.join(',')})`;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < grains; i++) {
    const v = (r() - 0.5) * spread;
    ctx.fillStyle = `rgb(${base.map(b => Math.max(0, Math.min(255, b + v))).join(',')})`;
    const s = 1 + r() * 2.5;
    ctx.fillRect(r() * size, r() * size, s, s);
  }
  return toTexture(c, repeat);
}

/** Asphalt with a faint 10 m grid, so speed and slip are readable on the open test pad. */
export function testPadAsphalt(repeat: number) {
  const size = 1024;
  const [c, ctx] = canvas(size);
  const r = rng(7);
  ctx.fillStyle = 'rgb(58,59,62)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 60000; i++) {
    const v = 40 + r() * 40;
    ctx.fillStyle = `rgba(${v},${v},${v + 3},0.55)`;
    ctx.fillRect(r() * size, r() * size, 1.5, 1.5);
  }
  ctx.strokeStyle = 'rgba(220,220,210,0.22)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, size - 3, size - 3);
  return toTexture(c, repeat);
}

/** Roughness variation for asphalt: breaks up the specular so it doesn't look like plastic. */
export function roughnessNoise(seed: number, repeat: number) {
  const size = 256;
  const [c, ctx] = canvas(size);
  const r = rng(seed);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 170 + r() * 70;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, repeat, false);
}

/** Tire sidewall/tread: dark rubber with a subtle tread pattern around U. */
export function tireTexture() {
  const [c, ctx] = canvas(256);
  ctx.fillStyle = '#141414';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#1d1d1d';
  for (let i = 0; i < 32; i++) ctx.fillRect(i * 8, 0, 3, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
