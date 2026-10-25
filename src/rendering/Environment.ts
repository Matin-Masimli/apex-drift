import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export interface TimeOfDayPreset {
  /** Sun elevation above the horizon (degrees). */
  elevation: number;
  /** Sun azimuth (degrees). */
  azimuth: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  turbidity: number;
  rayleigh: number;
  exposure: number;
}

export const TIME_OF_DAY: Record<'midday' | 'sunset', TimeOfDayPreset> = {
  midday: { elevation: 58, azimuth: 140, sunColor: 0xfff4e5, sunIntensity: 4.5, hemiSky: 0xbcd6ff, hemiGround: 0x5a5040, hemiIntensity: 0.5, turbidity: 2.5, rayleigh: 1.0, exposure: 0.42 },
  sunset: { elevation: 6, azimuth: 250, sunColor: 0xffa060, sunIntensity: 2.6, hemiSky: 0xffb48a, hemiGround: 0x3a2a30, hemiIntensity: 0.35, turbidity: 6, rayleigh: 2.6, exposure: 0.5 },
};

/**
 * Sky dome, sun (shadow-casting directional light that follows the player), hemisphere fill, and
 * image-based lighting: the sky is rendered into a PMREM so PBR materials pick up matching reflections.
 * M2 adds cascaded shadow maps and HDRI presets on top of this.
 */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private readonly sky: Sky;
  private readonly sunDir = new THREE.Vector3();
  private envTarget: THREE.WebGLRenderTarget | null = null;

  constructor(private readonly scene: THREE.Scene, private readonly renderer: THREE.WebGLRenderer) {
    this.sky = new Sky();
    this.sky.scale.setScalar(4500);
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(2048, 2048);
    s.camera.near = 1;
    s.camera.far = 300;
    s.camera.left = s.camera.bottom = -45;
    s.camera.right = s.camera.top = 45;
    s.bias = -0.0004;
    s.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
    scene.add(this.hemi);
  }

  apply(p: TimeOfDayPreset): void {
    const u = this.sky.material.uniforms;
    u['turbidity'].value = p.turbidity;
    u['rayleigh'].value = p.rayleigh;
    u['mieCoefficient'].value = 0.005;
    u['mieDirectionalG'].value = 0.8;
    const phi = THREE.MathUtils.degToRad(90 - p.elevation);
    const theta = THREE.MathUtils.degToRad(p.azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u['sunPosition'].value.copy(this.sunDir);

    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.renderer.toneMappingExposure = p.exposure;

    // Bake the sky into a prefiltered environment map for IBL reflections.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const skyClone = new Sky();
    skyClone.scale.setScalar(4500);
    skyClone.material.uniforms = THREE.UniformsUtils.clone(this.sky.material.uniforms);
    envScene.add(skyClone);
    this.envTarget?.dispose();
    this.envTarget = pmrem.fromScene(envScene, 0, 1, 5000);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 1.0;
    pmrem.dispose();
  }

  /** Keep the shadow frustum centred on the player so shadows stay crisp everywhere. */
  follow(target: THREE.Vector3): void {
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, 150);
  }
}
