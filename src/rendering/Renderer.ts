import * as THREE from 'three';

/** WebGL2 renderer configured for PBR: ACES tone mapping, sRGB output, soft shadows. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(r.domElement);
  }

  get domElement() { return this.renderer.domElement; }

  onResize(camera: THREE.PerspectiveCamera): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.render(scene, camera);
  }
}
