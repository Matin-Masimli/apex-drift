import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Collapse a static hierarchy into one mesh per material, with transforms baked relative to `root`.
 * Many small parts then cost one draw call per material in every pass (colour, each shadow
 * cascade, AO normals), which matters far more than triangle count here.
 *
 * Instanced meshes, multi-material meshes and anything tagged `userData.dynamic` are kept as
 * separate objects (re-parented with their transform preserved).
 * Returns a new group whose local space equals `root`'s local space.
 */
export function mergeByMaterial(root: THREE.Object3D): THREE.Group {
  const out = new THREE.Group();
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const byMaterial = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean; receive: boolean }>();
  const keep: THREE.Object3D[] = [];
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if ((mesh as THREE.InstancedMesh).isInstancedMesh || mesh.userData.dynamic || Array.isArray(mesh.material)) {
      keep.push(mesh);
      return;
    }
    const m = toRoot.clone().multiply(mesh.matrixWorld);
    let g = mesh.geometry.clone().applyMatrix4(m);
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    let entry = byMaterial.get(mesh.material as THREE.Material);
    if (!entry) byMaterial.set(mesh.material as THREE.Material, (entry = { geos: [], cast: false, receive: false }));
    entry.geos.push(g);
    entry.cast ||= mesh.castShadow;
    entry.receive ||= mesh.receiveShadow;
  });
  for (const [mat, { geos, cast, receive }] of byMaterial) {
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    out.add(m);
  }
  for (const o of keep) {
    const local = toRoot.clone().multiply(o.matrixWorld);
    local.decompose(o.position, o.quaternion, o.scale);
    out.add(o);
  }
  return out;
}
