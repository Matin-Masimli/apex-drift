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

/** Track asphalt: u runs across the road (0 = left edge, 1 = right edge), with white edge lines. */
export function roadTexture(withLines: boolean, wet = false) {
  const size = 512;
  const [c, ctx] = canvas(size);
  const r = rng(wet ? 23 : 17);
  ctx.fillStyle = wet ? 'rgb(30,31,34)' : 'rgb(54,55,58)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 50000; i++) {
    const v = (wet ? 20 : 38) + r() * 40;
    ctx.fillStyle = `rgba(${v},${v},${v + 3},0.5)`;
    ctx.fillRect(r() * size, r() * size, 1.5, 1.5);
  }
  // Darker racing line rubber down the middle-ish band.
  const g = ctx.createLinearGradient(0, 0, size, 0);
  g.addColorStop(0.25, 'rgba(0,0,0,0)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.18)');
  g.addColorStop(0.75, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  if (withLines) {
    ctx.fillStyle = 'rgba(235,235,228,0.92)';
    ctx.fillRect(size * 0.012, 0, size * 0.018, size);
    ctx.fillRect(size * 0.97, 0, size * 0.018, size);
  }
  const t = toTexture(c, 1);
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}

/** Curb stripes along v: one red and one white block per texture repeat. */
export function curbTexture() {
  const [c, ctx] = canvas(128);
  ctx.fillStyle = '#d01818';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#f1f1ea';
  ctx.fillRect(0, 64, 128, 64);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < 128; i += 16) ctx.fillRect(i, 0, 2, 128);
  return toTexture(c, 1);
}

/** Armco-style steel barrier: ribbed rail on the inner face. */
export function barrierTexture() {
  const [c, ctx] = canvas(256);
  ctx.fillStyle = '#9ea3a8';
  ctx.fillRect(0, 0, 256, 256);
  // u across the profile (0..0.45 inner face); horizontal ribs.
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? '#b9bec3' : '#7f8489';
    ctx.fillRect(i * 20, 0, 20, 256);
  }
  ctx.fillStyle = '#5c6166';
  for (let y = 0; y < 256; y += 128) ctx.fillRect(0, y, 120, 10); // posts every 2 m
  return toTexture(c, 1);
}

export function checkerTexture(cols: number, rows: number) {
  const [c, ctx] = canvas(256);
  const cw = 256 / cols, rh = 256 / rows;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
    ctx.fillRect(x * cw, y * rh, cw, rh);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Crowd: dense multicoloured dots, for grandstand tiers. */
export function crowdTexture() {
  const [c, ctx] = canvas(512);
  const r = rng(99);
  ctx.fillStyle = '#2a2d33';
  ctx.fillRect(0, 0, 512, 512);
  const palette = ['#e8e8e8', '#d33', '#36c', '#fc3', '#2a2', '#f80', '#222', '#c9a', '#9cf'];
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = palette[Math.floor(r() * palette.length)];
    ctx.fillRect(r() * 512, r() * 512, 4, 5);
  }
  return toTexture(c, 1);
}

/** Text panel (billboards, brake boards). */
export function textTexture(text: string, bg: string, fg: string, w = 1024, h = 256) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.font = `italic 800 ${Math.round(h * 0.55)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + h * 0.03, w * 0.92);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
