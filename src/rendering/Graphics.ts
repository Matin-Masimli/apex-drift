import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Environment } from './Environment';
import { DEFAULT_QUALITY, QUALITY_PRESETS, type QualityPreset } from './quality';

/**
 * Radial "speed blur": samples along the vector from the screen centre, strongest at the edges.
 * A cheap stand-in for per-object motion blur that sells speed in a chase view.
 */
const SpeedBlurShader = {
  name: 'SpeedBlurShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    strength: { value: 0 },
    center: { value: new THREE.Vector2(0.5, 0.45) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform vec2 center;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - center;
      // No blur in the middle of the screen where the car is; ramps up toward the edges.
      float edge = smoothstep(0.12, 0.65, length(dir));
      vec4 acc = vec4(0.0);
      float total = 0.0;
      for (int i = 0; i < 10; i++) {
        float t = float(i) / 9.0;
        float w = 1.0 - 0.6 * t;
        acc += texture2D(tDiffuse, vUv - dir * strength * edge * t) * w;
        total += w;
      }
      gl_FragColor = acc / total;
    }`,
};

/**
 * Owns the WebGL renderer and the full frame pipeline:
 *   scene → [MSAA HDR target] → GTAO → bloom → speed blur → output (ACES tone map + sRGB)
 * plus cascaded shadow maps for the sun, and live-switchable quality presets.
 */
export class Graphics {
  readonly renderer: THREE.WebGLRenderer;
  preset: QualityPreset;
  presetIndex = DEFAULT_QUALITY;
  private csm: CSM | null = null;
  private composer!: EffectComposer;
  private renderPass!: RenderPass;
  private gtao!: GTAOPass;
  private bloom!: UnrealBloomPass;
  private speedBlur!: ShaderPass;
  private camera: THREE.PerspectiveCamera | null = null;
  /** Bloom threshold in *exposed* units (≈ display brightness before tone mapping). */
  bloomThreshold = 12;
  /** Hooks for scene content that depends on quality (trees, particles). */
  onPresetChanged: ((p: QualityPreset) => void)[] = [];

  /** Supplies the sun direction/colour for the shadow cascades. */
  env: Environment | null = null;

  constructor(container: HTMLElement, private readonly scene: THREE.Scene) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    const r = this.renderer;
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    // Post-processing issues many render calls per frame; count them all and reset once per frame.
    r.info.autoReset = false;
    container.appendChild(r.domElement);
    this.preset = QUALITY_PRESETS[this.presetIndex];
  }

  /** Bind the camera the pipeline renders with (rebuilds camera-dependent passes). */
  setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
    this.applyPreset(this.presetIndex);
  }

  cyclePreset(): QualityPreset {
    this.applyPreset((this.presetIndex + 1) % QUALITY_PRESETS.length);
    return this.preset;
  }

  applyPreset(index: number): void {
    this.presetIndex = index;
    const p = (this.preset = QUALITY_PRESETS[index]);
    const camera = this.camera;
    if (!camera) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, p.maxPixelRatio));

    // --- Cascaded shadow maps (rebuilt: cascade count and map size are fixed at creation) ---
    if (this.csm) { this.csm.remove(); this.csm.dispose(); }
    this.csm = new CSM({
      camera,
      parent: this.scene,
      cascades: p.shadowCascades,
      maxFar: p.shadowFar,
      mode: 'practical',
      shadowMapSize: p.shadowMapSize,
      lightDirection: new THREE.Vector3(0, -1, 0),
      lightIntensity: 3,
      lightMargin: 120,
      shadowBias: -0.0002,
    });
    this.csm.fade = p.shadowCascades > 1;
    for (const light of this.csm.lights) light.shadow.normalBias = 0.04;
    this.setupMaterials();
    this.syncSun();

    // --- Post-processing chain ---
    this.composer?.dispose();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: p.msaa });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.renderPass = new RenderPass(this.scene, camera);
    this.composer.addPass(this.renderPass);

    this.gtao = new GTAOPass(this.scene, camera, size.x, size.y);
    this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1, scale: 1 });
    this.gtao.blendIntensity = 0.8;
    // Render AO at a fraction of the resolution on High.
    const gtaoSetSize = this.gtao.setSize.bind(this.gtao);
    this.gtao.setSize = (w: number, h: number) => gtaoSetSize(Math.round(w * p.aoScale), Math.round(h * p.aoScale));
    this.gtao.setSize(size.x, size.y);
    this.gtao.enabled = p.ao;
    this.composer.addPass(this.gtao);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.28, 0.35, 4);
    this.bloom.enabled = p.bloom;
    this.composer.addPass(this.bloom);

    this.speedBlur = new ShaderPass(SpeedBlurShader);
    this.speedBlur.enabled = false;
    this.composer.addPass(this.speedBlur);

    this.composer.addPass(new OutputPass());

    for (const cb of this.onPresetChanged) cb(p);
  }

  /** Enable CSM on every lit material in the scene. Call again after adding new objects. */
  setupMaterials(root: THREE.Object3D = this.scene): void {
    if (!this.csm) return;
    const csm = this.csm;
    root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial && !(m.defines && m.defines['USE_CSM'] && csm.shaders.has(m))) {
          csm.setupMaterial(m);
          m.needsUpdate = true;
        }
      }
    });
  }

  /** Push the environment's sun into the shadow-casting cascade lights. */
  syncSun(): void {
    if (!this.csm || !this.env) return;
    this.csm.lightDirection.copy(this.env.sunDirection).negate();
    for (const l of this.csm.lights) {
      l.color.copy(this.env.sunColor);
      l.intensity = this.env.sunIntensity;
    }
  }

  onResize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.csm?.updateFrustums();
    }
  }

  /** Render a frame. `speed01` (0..1) drives the speed blur. */
  render(speed01 = 0): void {
    if (!this.camera) return;
    this.csm?.update();
    // Bloom runs on HDR values *before* tone mapping, so its threshold must follow exposure:
    // only pixels that will still be well above white after exposure (sun glints, lights) bloom.
    this.bloom.threshold = this.bloomThreshold / this.renderer.toneMappingExposure;
    const strength = this.preset.speedBlur ? Math.max(0, speed01 - 0.35) * 0.09 : 0;
    this.speedBlur.enabled = strength > 0.002;
    this.speedBlur.uniforms['strength'].value = strength;
    this.renderer.info.reset();
    this.composer.render();
  }

  get info() { return this.renderer.info; }
}
