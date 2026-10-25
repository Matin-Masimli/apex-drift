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
  /** Distance fog colour (matches the horizon) and range. */
  fogColor: number;
  fogNear: number;
  fogFar: number;
}

export type TimeOfDay = 'midday' | 'sunset';

export const TIME_OF_DAY: Record<TimeOfDay, TimeOfDayPreset> = {
  midday: {
    elevation: 58, azimuth: 140, sunColor: 0xfff4e5, sunIntensity: 4.5, hemiSky: 0xbcd6ff, hemiGround: 0x5a5040,
    hemiIntensity: 0.5, turbidity: 2.5, rayleigh: 1.0, exposure: 0.42, fogColor: 0xc4d3e2, fogNear: 500, fogFar: 2600,
  },
  sunset: {
    elevation: 6, azimuth: 250, sunColor: 0xffa060, sunIntensity: 2.6, hemiSky: 0xffb48a, hemiGround: 0x3a2a30,
    hemiIntensity: 0.35, turbidity: 6, rayleigh: 2.6, exposure: 0.5, fogColor: 0xd9a080, fogNear: 400, fogFar: 2200,
  },
};

/**
 * Sky dome, hemisphere fill, distance fog and image-based lighting: the sky is rendered into a
 * PMREM so PBR materials pick up matching reflections. The sun's direct light and shadows are owned
 * by `Graphics` (cascaded shadow maps); this class only supplies its direction, colour and intensity.
 */
export class Environment {
  readonly hemi: THREE.HemisphereLight;
  /** Unit vector pointing *toward* the sun. */
  readonly sunDirection = new THREE.Vector3(0, 1, 0);
  readonly sunColor = new THREE.Color();
  sunIntensity = 3;
  current: TimeOfDayPreset = TIME_OF_DAY.midday;
  private readonly sky: Sky;
  private envTarget: THREE.WebGLRenderTarget | null = null;

  constructor(private readonly scene: THREE.Scene, private readonly renderer: THREE.WebGLRenderer) {
    this.sky = new Sky();
    this.sky.scale.setScalar(9000);
    scene.add(this.sky);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
    scene.add(this.hemi);
    scene.fog = new THREE.Fog(0xffffff, 500, 2500);
  }

  apply(p: TimeOfDayPreset): void {
    this.current = p;
    const u = this.sky.material.uniforms;
    u['turbidity'].value = p.turbidity;
    u['rayleigh'].value = p.rayleigh;
    u['mieCoefficient'].value = 0.005;
    u['mieDirectionalG'].value = 0.8;
    const phi = THREE.MathUtils.degToRad(90 - p.elevation);
    const theta = THREE.MathUtils.degToRad(p.azimuth);
    this.sunDirection.setFromSphericalCoords(1, phi, theta);
    u['sunPosition'].value.copy(this.sunDirection);

    this.sunColor.set(p.sunColor);
    this.sunIntensity = p.sunIntensity;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.renderer.toneMappingExposure = p.exposure;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set(p.fogColor);
    fog.near = p.fogNear;
    fog.far = p.fogFar;

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

  /** Keep the sky dome centred on the camera so it never clips. */
  follow(cameraPos: THREE.Vector3): void {
    this.sky.position.copy(cameraPos);
  }
}
