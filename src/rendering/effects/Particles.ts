import * as THREE from 'three';

export interface ParticleSpawn {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  size0: number;
  size1: number;
  alpha: number;
  r: number; g: number; b: number;
  /** Vertical acceleration (m/s², negative = falls). */
  gravity: number;
  /** Velocity damping per second (0..~5). */
  drag: number;
}

/**
 * CPU-simulated point-sprite particles: one Points draw call per system.
 * Size grows from size0 to size1 over the particle's life; alpha fades in quickly and out slowly.
 * Two instances are used: alpha-blended (smoke, dust) and additive (sparks, flames).
 */
export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly max: number;
  private limit: number;
  private count = 0;
  // Struct-of-arrays state.
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly params: Float32Array; // per particle: age, life, size0, size1, alpha0, gravity, drag
  private readonly material: THREE.ShaderMaterial;

  constructor(max: number, additive: boolean) {
    this.max = this.limit = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.params = new Float32Array(max * 7);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 800 }, soft: { value: additive ? 0.0 : 1.0 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        uniform float scale;
        varying float vAlpha;
        varying vec3 vColor;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(-mvPosition.z, 0.1);
          gl_Position = projectionMatrix * mvPosition;
          vAlpha = alpha;
          vColor = color;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float soft;
        varying float vAlpha;
        varying vec3 vColor;
        #include <fog_pars_fragment>
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          // Smoke: wide soft falloff. Sparks/flames: tighter, hotter core.
          float a = soft > 0.5 ? smoothstep(1.0, 0.1, r) : pow(max(0.0, 1.0 - r), 2.0);
          gl_FragColor = vec4(vColor, a * vAlpha);
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.material.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, this.material.uniforms]);
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 4 : 3;
  }

  /** Cap live particles (quality presets). */
  setLimit(n: number): void {
    this.limit = Math.min(n, this.max);
    if (this.count > this.limit) this.count = this.limit;
  }

  spawn(p: ParticleSpawn): void {
    if (this.count >= this.limit) return;
    const i = this.count++;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([p.vx, p.vy, p.vz], i * 3);
    this.col.set([p.r, p.g, p.b], i * 3);
    this.params.set([0, p.life, p.size0, p.size1, p.alpha, p.gravity, p.drag], i * 7);
    this.size[i] = p.size0;
    this.alpha[i] = 0;
  }

  /** Advance particles and upload. `viewportHeight` and `fov` set the point-size scale. */
  update(dt: number, viewportHeight: number, fovDeg: number): void {
    this.material.uniforms.scale.value = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
    let i = 0;
    while (i < this.count) {
      const pi = i * 7;
      const age = (this.params[pi] += dt);
      const life = this.params[pi + 1];
      if (age >= life) {
        // Swap-remove with the last live particle.
        const last = --this.count;
        if (i !== last) this.copy(last, i);
        continue;
      }
      const t = age / life;
      const drag = Math.max(0, 1 - this.params[pi + 6] * dt);
      const v = i * 3;
      this.vel[v] *= drag; this.vel[v + 2] *= drag;
      this.vel[v + 1] = this.vel[v + 1] * drag + this.params[pi + 5] * dt;
      this.pos[v] += this.vel[v] * dt;
      this.pos[v + 1] += this.vel[v + 1] * dt;
      this.pos[v + 2] += this.vel[v + 2] * dt;
      this.size[i] = this.params[pi + 2] + (this.params[pi + 3] - this.params[pi + 2]) * Math.sqrt(t);
      this.alpha[i] = this.params[pi + 4] * Math.min(1, t * 8) * (1 - t);
      i++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.count);
    for (const name of ['position', 'color', 'size', 'alpha']) {
      const a = g.attributes[name] as THREE.BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
  }

  private copy(from: number, to: number): void {
    this.pos.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.vel.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.col.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.params.copyWithin(to * 7, from * 7, from * 7 + 7);
    this.size[to] = this.size[from];
    this.alpha[to] = this.alpha[from];
  }

  get liveCount(): number { return this.count; }
}
