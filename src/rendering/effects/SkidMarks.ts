import * as THREE from 'three';

/**
 * Skid marks: one ring buffer of quads shared by all wheels. Each wheel that is sliding extends
 * its own strip; old marks are overwritten when the buffer wraps. One draw call total.
 */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private next = 0;
  private filled = false;
  /** Last left/right edge point per strip id (wheel). */
  private readonly last = new Map<string, { l: THREE.Vector3; r: THREE.Vector3; c: THREE.Vector3; alpha: number }>();
  private readonly tmpL = new THREE.Vector3();
  private readonly tmpR = new THREE.Vector3();

  constructor(private readonly capacity = 8000) {
    this.positions = new Float32Array(capacity * 4 * 3);
    this.colors = new Float32Array(capacity * 4 * 4);
    const indices = new Uint32Array(capacity * 6);
    for (let q = 0; q < capacity; q++) {
      const v = q * 4;
      // Quad: last L (v), last R (v+1), new L (v+2), new R (v+3). Double-sided, since a car
      // sliding backwards lays the strip in the opposite direction.
      indices.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], q * 6);
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(this.geometry, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /**
   * Extend (or start) the strip `id`. `intensity` 0 ends the strip.
   * @param point contact point, @param side unit vector across the tire, @param width tire width
   */
  add(id: string, intensity: number, point: THREE.Vector3, side: THREE.Vector3, width: number, color: THREE.Color): void {
    if (intensity <= 0.02) { this.last.delete(id); return; }
    const hw = width / 2;
    const l = this.tmpL.copy(point).addScaledVector(side, -hw);
    const r = this.tmpR.copy(point).addScaledVector(side, hw);
    const prev = this.last.get(id);
    if (!prev) {
      this.last.set(id, { l: l.clone(), r: r.clone(), c: point.clone(), alpha: intensity });
      return;
    }
    const dist = prev.c.distanceTo(point);
    if (dist < 0.3) return;
    if (dist > 3) { prev.l.copy(l); prev.r.copy(r); prev.c.copy(point); return; } // teleport/reset: break the strip

    const q = this.next;
    const p = this.positions, c = this.colors;
    const pts = [prev.l, prev.r, l, r];
    const alphas = [prev.alpha, prev.alpha, intensity, intensity];
    for (let k = 0; k < 4; k++) {
      p.set([pts[k].x, pts[k].y + 0.02, pts[k].z], (q * 4 + k) * 3);
      c.set([color.r, color.g, color.b, alphas[k] * 0.75], (q * 4 + k) * 4);
    }
    const posAttr = this.geometry.attributes.position as THREE.BufferAttribute;
    const colAttr = this.geometry.attributes.color as THREE.BufferAttribute;
    posAttr.addUpdateRange(q * 12, 12);
    colAttr.addUpdateRange(q * 16, 16);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    this.next = (q + 1) % this.capacity;
    if (this.next === 0) this.filled = true;
    this.geometry.setDrawRange(0, (this.filled ? this.capacity : this.next) * 6);
    prev.l.copy(l); prev.r.copy(r); prev.c.copy(point); prev.alpha = intensity;
  }

  clear(): void {
    this.next = 0;
    this.filled = false;
    this.last.clear();
    this.geometry.setDrawRange(0, 0);
  }
}
