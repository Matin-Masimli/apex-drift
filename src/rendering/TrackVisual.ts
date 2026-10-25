import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeByMaterial } from './mergeByMaterial';
import type { MeshData, MeshLayer, Track } from '../tracks/Track';
import type { TrackProp } from '../tracks/types';
import {
  barrierTexture, checkerTexture, crowdTexture, curbTexture, noiseTexture, roadTexture, roughnessNoise, textTexture,
} from './proceduralTextures';

/**
 * Renders a built Track: surfaces from the shared mesh data, then props and scenery placed in
 * track space (distance along the centreline + lateral offset).
 */
export class TrackVisual {
  readonly group = new THREE.Group();
  /** Tree instanced meshes, so quality presets can thin them out live via `.count`. */
  private readonly treeMeshes: { mesh: THREE.InstancedMesh; full: number }[] = [];

  constructor(private readonly track: Track) {
    this.buildSurfaces();
    const props = new THREE.Group();
    this.propRoot = props;
    this.buildStartLine();
    for (const p of track.def.props) this.buildProp(p);
    this.group.add(mergeByMaterial(props));
    this.buildTrees();
  }

  /** Props are built here, then merged into one mesh per material (dynamic parts excluded). */
  private propRoot: THREE.Group | null = null;

  /** 0..1 fraction of trees to draw (quality presets). */
  setTreeDensity(f: number): void {
    for (const t of this.treeMeshes) t.mesh.count = Math.floor(t.full * f);
  }

  private buildSurfaces(): void {
    const mats: Record<MeshLayer, THREE.Material> = {
      road: new THREE.MeshStandardMaterial({ map: roadTexture(true), roughnessMap: roughnessNoise(4, 6), roughness: 0.92 }),
      roadWet: new THREE.MeshPhysicalMaterial({ map: roadTexture(true, true), roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1 }),
      curb: new THREE.MeshStandardMaterial({ map: curbTexture(), roughness: 0.6 }),
      grass: new THREE.MeshStandardMaterial({ map: noiseTexture([66, 108, 46], 46, 40000, 11, 1), roughness: 1 }),
      gravel: new THREE.MeshStandardMaterial({ map: noiseTexture([178, 160, 128], 70, 60000, 5, 1), roughness: 1 }),
      runoffAsphalt: new THREE.MeshStandardMaterial({ map: roadTexture(false), roughness: 0.9 }),
      barrier: new THREE.MeshStandardMaterial({ map: barrierTexture(), metalness: 0.75, roughness: 0.38 }),
      terrain: new THREE.MeshStandardMaterial({ map: noiseTexture([72, 112, 50], 40, 50000, 21, 1), roughness: 1 }),
    };
    // Shoulder textures tile along the track; repeat across their width too.
    for (const k of ['grass', 'gravel'] as const) (mats[k] as THREE.MeshStandardMaterial).map!.repeat.set(2, 1);

    for (const [layer, data] of this.track.meshes) {
      const mesh = new THREE.Mesh(toGeometry(data), mats[layer]);
      mesh.receiveShadow = true;
      mesh.castShadow = layer === 'barrier';
      mesh.name = `track-${layer}`;
      // Avoid z-fighting where thin layers overlap the road edge.
      if (layer === 'curb') mesh.renderOrder = 1;
      this.group.add(mesh);
    }
  }

  /** Place an object in track space: local −Z along the track, +X to the right. */
  private place(obj: THREE.Object3D, s: number, lateral: number, dy = 0): THREE.Object3D {
    const smp = this.track.line.sampleAt(s);
    obj.position.set(smp.pos.x + smp.right.x * lateral, 0, smp.pos.z + smp.right.z * lateral);
    obj.position.y = Math.max(smp.pos.y, this.track.heightAt(obj.position.x, obj.position.z)) + dy;
    obj.rotation.y = Math.atan2(-smp.tangent.x, -smp.tangent.z);
    (this.propRoot ?? this.group).add(obj);
    return obj;
  }

  private buildStartLine(): void {
    const t = this.track;
    const w = t.def.width;
    // Chequered finish line strip, laid on the road surface.
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(w, 1.6).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: checkerTexture(16, 2), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    line.receiveShadow = true;
    this.place(line, t.startS, 0, 0.012);

    // Grid boxes: an open white bracket in front of each slot.
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
    const bar = new THREE.PlaneGeometry(2.4, 0.18).rotateX(-Math.PI / 2);
    for (const slot of t.grid) {
      const m = new THREE.Mesh(bar, boxMat);
      m.position.set(slot.position.x, slot.position.y + 0.012, slot.position.z);
      m.rotation.y = slot.yaw;
      m.translateZ(-2.6);
      (this.propRoot ?? this.group).add(m);
    }
  }

  private buildProp(p: TrackProp): void {
    const t = this.track;
    const s = t.resolve(p.s);
    const hw = t.def.width / 2;
    const sides = p.side === 'both' ? [-1, 1] : p.side === 'left' ? [-1] : [1];

    switch (p.type) {
      case 'gantry': {
        const g = new THREE.Group();
        const steel = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.6, roughness: 0.45 });
        const span = t.def.width + 8;
        for (const sx of [-1, 1]) addBox(g, steel, 0.6, 8, 0.6, sx * span / 2, 4, 0);
        addBox(g, steel, span + 0.6, 1.4, 0.8, 0, 7.6, 0);
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.1),
          new THREE.MeshStandardMaterial({ map: textTexture('KESTREL VALLEY', '#14171c', '#ff5a1f'), emissive: 0xffffff, emissiveIntensity: 0.15, emissiveMap: null }));
        panel.position.set(0, 7.6, 0.41);
        g.add(panel);
        // Start lights: five pods facing the grid (+Z side faces approaching cars).
        this.startLights = [];
        for (let i = 0; i < 5; i++) {
          const mat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff0000, emissiveIntensity: 0 });
          const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 16).rotateX(Math.PI / 2), mat);
          pod.position.set((i - 2) * 0.9, 6.5, 0.45);
          pod.userData.dynamic = true;
          g.add(pod);
          this.startLights.push(mat);
        }
        g.traverse(o => { o.castShadow = true; });
        this.place(g, s, 0);
        break;
      }
      case 'grandstand': {
        for (const side of sides) {
          const g = buildGrandstand(p.length ?? 60);
          // Built facing +X; mirror for stands on the right so they face the track.
          if (side > 0) g.rotateY(Math.PI);
          const wrap = new THREE.Group();
          wrap.add(g);
          this.place(wrap, s, side * (hw + p.offset + 6));
        }
        break;
      }
      case 'billboard': {
        for (const side of sides) {
          const g = new THREE.Group();
          const tex = textTexture(p.label ?? '', '#f4f1e8', '#1a1d24');
          const board = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
          board.position.y = 3.2;
          // Face the track: plane normal is +Z; rotate so it points toward the centreline (−side · X).
          board.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
          g.add(board);
          const back = board.clone();
          back.material = new THREE.MeshStandardMaterial({ color: 0x30343a });
          back.rotation.y += Math.PI;
          back.position.x += side * 0.05;
          g.add(back);
          const post = new THREE.MeshStandardMaterial({ color: 0x44484f, metalness: 0.5, roughness: 0.5 });
          for (const z of [-4, 4]) addBox(g, post, 0.25, 4.7, 0.25, side * 0.15, 2.35, z);
          g.traverse(o => { o.castShadow = true; });
          this.place(g, s, side * (hw + Math.max(p.offset, t.def.barrierOffset + 4)));
        }
        break;
      }
      case 'brakeBoards': {
        for (const side of sides) {
          [300, 200, 100].forEach(dist => {
            const g = new THREE.Group();
            const board = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.0),
              new THREE.MeshStandardMaterial({ map: textTexture(String(dist), '#f4f4f4', '#111', 512, 360), roughness: 0.6 }));
            // Faces approaching cars (+Z local).
            board.position.y = 1.3;
            g.add(board);
            addBox(g, new THREE.MeshStandardMaterial({ color: 0x555a60 }), 0.12, 0.85, 0.12, 0, 0.42, -0.05);
            this.place(g, s - dist, side * (hw + p.offset));
          });
        }
        break;
      }
      case 'tireWall': {
        const len = p.length ?? 40;
        const tireGeo = new THREE.TorusGeometry(0.32, 0.14, 8, 16).rotateX(Math.PI / 2);
        const count = Math.floor(len / 0.9) * 3;
        const inst = new THREE.InstancedMesh(tireGeo, new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }), count * sides.length);
        const m = new THREE.Matrix4();
        let k = 0;
        for (const side of sides) {
          for (let i = 0; i < count / 3; i++) {
            const ss = s - len / 2 + i * 0.9;
            const smp = t.line.sampleAt(ss);
            const barrier = side < 0 ? t.barrierLeft[t.line.indexAt(ss)] : t.barrierRight[t.line.indexAt(ss)];
            const lat = side * ((Number.isNaN(barrier) ? hw + p.offset : barrier) - 0.5);
            for (let layer = 0; layer < 3; layer++) {
              m.makeTranslation(smp.pos.x + smp.right.x * lat, smp.pos.y + 0.15 + layer * 0.28, smp.pos.z + smp.right.z * lat);
              inst.setMatrixAt(k++, m);
            }
          }
        }
        inst.castShadow = true;
        this.group.add(inst);
        break;
      }
      case 'marshalPost': {
        for (const side of sides) {
          const g = new THREE.Group();
          addBox(g, new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.8 }), 2.2, 2.4, 2.2, 0, 1.2, 0);
          addBox(g, new THREE.MeshStandardMaterial({ color: 0xff7a00, roughness: 0.6 }), 2.5, 0.2, 2.5, 0, 2.5, 0);
          g.traverse(o => { o.castShadow = true; });
          this.place(g, s, side * (hw + Math.max(p.offset, t.def.barrierOffset + 3)));
        }
        break;
      }
    }
  }

  /** Start light materials (left to right), for the race start sequence. */
  startLights: THREE.MeshStandardMaterial[] = [];

  /** Light `n` start-light pods (0 = all off). */
  setStartLights(n: number): void {
    this.startLights.forEach((m, i) => { m.emissiveIntensity = i < n ? 40 : 0; });
  }

  /**
   * Trees: two species (conifer, broadleaf), instanced and grouped into spatial chunks so the
   * renderer can frustum-cull them, with a cheap far LOD per chunk.
   */
  private buildTrees(): void {
    const t = this.track;
    const { half, centerX, centerZ } = t.terrain;
    const rand = mulberry(42);
    const tmp = { index: 0, lateral: 0, distSq: 0 };
    const clear = t.def.width / 2 + t.def.barrierOffset + 10;

    const conifer = mergeColored([
      [new THREE.CylinderGeometry(0.18, 0.28, 2.4, 6).translate(0, 1.2, 0), 0x4a3424],
      [new THREE.ConeGeometry(2.4, 5.5, 8).translate(0, 4.2, 0), 0x2e5a2c],
      [new THREE.ConeGeometry(1.8, 4.2, 8).translate(0, 6.6, 0), 0x356a33],
    ]);
    const broadleaf = mergeColored([
      [new THREE.CylinderGeometry(0.22, 0.32, 3, 6).translate(0, 1.5, 0), 0x56402c],
      [new THREE.IcosahedronGeometry(2.8, 1).scale(1, 0.85, 1).translate(0, 5, 0), 0x4c7a34],
    ]);
    const farConifer = new THREE.ConeGeometry(2.2, 9, 5).translate(0, 4.5, 0);
    const farBroad = new THREE.IcosahedronGeometry(2.8, 0).translate(0, 4.5, 0);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const farMat = new THREE.MeshStandardMaterial({ color: 0x3a6431, roughness: 1 });

    const CHUNK = 650;
    const chunks = new Map<string, { m: THREE.Matrix4; c: THREE.Color; type: number }[]>();
    let placed = 0, attempts = 0;
    while (placed < t.def.scenery.trees && attempts < t.def.scenery.trees * 20) {
      attempts++;
      const x = centerX + (rand() * 2 - 1) * (half - 20);
      const z = centerZ + (rand() * 2 - 1) * (half - 20);
      const near = t.line.nearest({ x, y: 0, z }, tmp, false);
      if (near.index >= 0 && Math.sqrt(near.distSq) < clear) continue;
      // Clustered placement: favour areas where a low-frequency field is high (woods and clearings).
      const field = Math.sin(x * 0.011) * Math.cos(z * 0.013) + Math.sin((x + z) * 0.004);
      if (field < 0.1 && rand() > 0.15) continue;
      const scale = 0.75 + rand() * 0.6;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, t.heightAt(x, z) - 0.2, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2),
        new THREE.Vector3(scale, scale * (0.85 + rand() * 0.35), scale),
      );
      const c = new THREE.Color().setHSL(0.27 + rand() * 0.06, 0.35 + rand() * 0.2, 0.75 + rand() * 0.3);
      const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
      let list = chunks.get(key);
      if (!list) chunks.set(key, (list = []));
      list.push({ m, c, type: rand() < 0.55 ? 0 : 1 });
      placed++;
    }

    for (const [key, list] of chunks) {
      const [cx, cz] = key.split(',').map(Number);
      const lod = new THREE.LOD();
      lod.position.set((cx + 0.5) * CHUNK, 0, (cz + 0.5) * CHUNK);
      const near = new THREE.Group(), far = new THREE.Group();
      for (const type of [0, 1]) {
        const items = list.filter(i => i.type === type);
        if (!items.length) continue;
        const nearMesh = new THREE.InstancedMesh(type === 0 ? conifer : broadleaf, mat, items.length);
        const farMesh = new THREE.InstancedMesh(type === 0 ? farConifer : farBroad, farMat, items.length);
        const inv = new THREE.Matrix4().makeTranslation(-lod.position.x, 0, -lod.position.z);
        items.forEach((it, i) => {
          const local = inv.clone().multiply(it.m);
          nearMesh.setMatrixAt(i, local);
          nearMesh.setColorAt(i, it.c);
          farMesh.setMatrixAt(i, local);
        });
        nearMesh.castShadow = true;
        nearMesh.computeBoundingSphere();
        farMesh.computeBoundingSphere();
        near.add(nearMesh);
        far.add(farMesh);
        this.treeMeshes.push({ mesh: nearMesh, full: items.length }, { mesh: farMesh, full: items.length });
      }
      lod.addLevel(near, 0);
      lod.addLevel(far, 600);
      this.group.add(lod);
    }
  }
}

function toGeometry(d: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(d.positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uvs, 2));
  g.setIndex(d.indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function addBox(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** Stepped seating with a crowd texture and a cantilever roof, built facing +X. */
function buildGrandstand(length: number): THREE.Group {
  const g = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa9a6a0, roughness: 0.9 });
  const crowd = new THREE.MeshStandardMaterial({ map: crowdTexture(), roughness: 0.9 });
  crowd.map!.repeat.set(length / 10, 1);
  const tiers = 8;
  for (let i = 0; i < tiers; i++) {
    // Single-material parts only, so the whole stand merges into two draw calls.
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, length), concrete);
    step.position.set(-i * 1.2, 0.3 + i * 0.6, 0);
    g.add(step);
    const seats = new THREE.Mesh(new THREE.PlaneGeometry(1.2, length).rotateX(-Math.PI / 2), crowd);
    seats.position.set(-i * 1.2, 0.61 + i * 0.6, 0);
    g.add(seats);
    const riser = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3 + i * 0.6, length), concrete);
    riser.position.set(-i * 1.2, (0.3 + i * 0.6) / 2, 0);
    g.add(riser);
  }
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.6, roughness: 0.4 });
  const roofH = tiers * 0.6 + 3.2;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(tiers * 1.2 + 3, 0.25, length + 2), steel);
  roof.position.set(-(tiers * 1.2) / 2 + 1, roofH, 0);
  roof.rotation.z = -0.06;
  g.add(roof);
  for (let z = -length / 2; z <= length / 2; z += 15) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.35, roofH, 0.35), steel);
    col.position.set(-tiers * 1.2, roofH / 2, z);
    g.add(col);
  }
  g.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
  return g;
}

/** Merge geometries, baking a flat colour per part into a vertex colour attribute. */
function mergeColored(parts: [THREE.BufferGeometry, number][]): THREE.BufferGeometry {
  const geos = parts.map(([geo, color]) => {
    const g = geo.toNonIndexed();
    const c = new THREE.Color(color);
    const arr = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    return g;
  });
  return mergeGeometries(geos)!;
}

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
