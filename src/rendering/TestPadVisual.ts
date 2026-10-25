import * as THREE from 'three';
import { Surface } from '../physics/surfaces';
import type { TestPadDef } from '../tracks/testPad';
import { noiseTexture, roughnessNoise, testPadAsphalt } from './proceduralTextures';

/** Renders the M1 test pad from the same data the physics builder uses. */
export function buildTestPadVisual(pad: TestPadDef): THREE.Group {
  const group = new THREE.Group();

  const asphaltMat = new THREE.MeshStandardMaterial({
    map: testPadAsphalt(pad.size / 10), roughnessMap: roughnessNoise(3, pad.size / 4), roughness: 0.95, metalness: 0,
  });
  const surfaceMats: Record<Surface, THREE.Material> = {
    [Surface.Asphalt]: asphaltMat,
    [Surface.Curb]: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }),
    [Surface.Grass]: new THREE.MeshStandardMaterial({ map: noiseTexture([62, 104, 44], 50, 40000, 11, 30), roughness: 1 }),
    [Surface.Gravel]: new THREE.MeshStandardMaterial({ map: noiseTexture([170, 150, 118], 70, 60000, 5, 25), roughness: 1 }),
    [Surface.Wet]: new THREE.MeshPhysicalMaterial({
      map: noiseTexture([34, 36, 40], 20, 20000, 9, 25), roughness: 0.12, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.08,
    }),
  };
  const curbRed = new THREE.MeshStandardMaterial({ color: 0xc4161c, roughness: 0.7 });
  const rampMat = new THREE.MeshStandardMaterial({ color: 0x6a6d72, roughness: 0.85 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xb8b4aa, roughness: 0.9 });

  for (const b of pad.boxes) {
    const geo = new THREE.BoxGeometry(b.half.x * 2, b.half.y * 2, b.half.z * 2);
    let mat: THREE.Material = surfaceMats[b.surface];
    if (b.kind === 'curb') mat = (b.stripeIndex ?? 0) % 2 ? curbRed : surfaceMats[Surface.Curb];
    if (b.kind === 'ramp') mat = rampMat;
    if (b.kind === 'wall') mat = wallMat;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(b.pos.x, b.pos.y, b.pos.z);
    if (b.pitch) m.rotation.x = b.pitch;
    if (b.yaw) m.rotation.y = b.yaw;
    m.receiveShadow = true;
    m.castShadow = b.kind === 'ramp' || b.kind === 'wall';
    group.add(m);
  }

  // Painted skid-pad ring and cones marking the strips.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(pad.skidpad.radius - 0.15, pad.skidpad.radius + 0.15, 128),
    new THREE.MeshBasicMaterial({ color: 0xf2f2e8 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pad.skidpad.center.x, 0.01, pad.skidpad.center.z);
  group.add(ring);

  const coneGeo = new THREE.ConeGeometry(0.18, 0.5, 12);
  coneGeo.translate(0, 0.25, 0);
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.6 });
  const cones = new THREE.InstancedMesh(coneGeo, coneMat, 48);
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const r = pad.skidpad.radius + 2;
    mtx.makeTranslation(pad.skidpad.center.x + Math.cos(a) * r, 0, pad.skidpad.center.z + Math.sin(a) * r);
    cones.setMatrixAt(i, mtx);
  }
  cones.castShadow = true;
  group.add(cones);

  return group;
}
