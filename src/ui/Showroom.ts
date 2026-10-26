import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CARS } from '../vehicles/cars';
import { wheelLayout } from '../vehicles/layout';
import { carSpecs } from '../vehicles/specs';
import { SNAPSHOT_SIZE } from '../vehicles/snapshot';
import type { CarClass, CarConfig } from '../vehicles/types';
import { CarVisual, LIVERY_INDEX } from '../rendering/CarVisual';

const CLASS_LABEL: Record<CarClass, string> = {
  formula: 'Open-wheel formula',
  gt: 'GT endurance',
  rally: 'Rally · AWD',
  muscle: 'Muscle · RWD',
  hyper: 'Hypercar',
  hatch: 'Hot hatch · FWD',
};

const STORAGE_KEY = 'apexdrift.garage';

/**
 * Garage / car select: a studio scene with a rotating turntable, studio IBL, soft shadows and a
 * subtle depth of field, plus the car's story, measured specs, rating bars and paint choices.
 */
export class Showroom {
  /** Called when the player picks a car and presses Drive. */
  onDrive: (carId: string, paintIndex: number) => void = () => {};

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  private readonly composer: EffectComposer;
  private readonly bokeh: BokehPass;
  private readonly turntable = new THREE.Group();
  private readonly el: HTMLDivElement;
  private car: CarVisual | null = null;
  private index = 0;
  private paint = 0;
  private raf = 0;
  private active = false;
  private orbit = 0.6;
  private dragging = false;
  private lastX = 0;
  private idle = 0;
  private envRT: THREE.WebGLRenderTarget;
  private readonly keyHandler = (e: KeyboardEvent) => this.onKey(e);

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const s = this.scene;
    s.background = new THREE.Color(0x0c0e12);
    s.fog = new THREE.Fog(0x0c0e12, 14, 40);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    pmrem.dispose();
    s.environment = this.envRT.texture;
    s.environmentIntensity = 0.75;

    // Glossy studio floor and the turntable.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color: 0x15171c, roughness: 0.35, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.2 }));
    floor.receiveShadow = true;
    s.add(floor);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 3.75, 0.08, 96),
      new THREE.MeshPhysicalMaterial({ color: 0x23262d, roughness: 0.3, metalness: 0.6, clearcoat: 0.5 }));
    plate.position.y = 0.04;
    plate.receiveShadow = true;
    this.turntable.add(plate);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.74, 0.02, 8, 128).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff5a1f, emissiveIntensity: 3 }));
    ring.position.y = 0.08;
    this.turntable.add(ring);
    s.add(this.turntable);

    // Key light with soft shadow, a cool rim light, and overhead softboxes for paint reflections.
    const key = new THREE.DirectionalLight(0xfff3e6, 2.6);
    key.position.set(-5, 9, -4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
    key.shadow.radius = 6;
    key.shadow.bias = -0.0004;
    s.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 1.4);
    rim.position.set(6, 4, 7);
    s.add(rim);
    for (const x of [-2.2, 0, 2.2]) {
      const box = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 7).rotateX(Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
      box.position.set(x, 7.5, 0);
      s.add(box);
    }

    // Post: render → subtle depth of field focused on the car → tone map.
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(s, this.camera));
    this.bokeh = new BokehPass(s, this.camera, { focus: 9, aperture: 0.0016, maxblur: 0.006 });
    this.composer.addPass(this.bokeh);
    this.composer.addPass(new OutputPass());

    this.el = this.buildUi();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { car?: string; paint?: number } | null;
      const i = CARS.findIndex(c => c.id === saved?.car);
      if (i >= 0) { this.index = i; this.paint = saved?.paint ?? 0; }
    } catch { /* storage unavailable: start from defaults */ }
  }

  show(): void {
    this.active = true;
    this.el.hidden = false;
    this.renderer.toneMappingExposure = 1.0;
    this.selectCar(this.index, this.paint);
    (window as unknown as { __garage: unknown }).__garage = this; // debugging/automation hook
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('resize', this.resize);
    this.resize();
    let last = performance.now();
    const frame = (now: number) => {
      if (!this.active) return;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      this.idle += dt;
      if (!this.dragging && this.idle > 2) this.turntable.rotation.y += dt * 0.25;
      const dist = 9.2;
      this.camera.position.set(Math.sin(this.orbit) * dist, 1.9, Math.cos(this.orbit) * dist);
      this.camera.lookAt(0, 0.55, 0);
      (this.bokeh.uniforms as Record<string, THREE.IUniform>)['focus'].value = dist;
      this.composer.render();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  hide(): void {
    this.active = false;
    this.el.hidden = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('resize', this.resize);
  }

  private readonly resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // Frame the car to the right of the info panel on wide screens.
    this.camera.setViewOffset(w, h, w > 900 ? -w * 0.13 : 0, 0, w, h);
    this.camera.updateProjectionMatrix();
  };

  private selectCar(index: number, paint = 0): void {
    this.index = (index + CARS.length) % CARS.length;
    const cfg = CARS[this.index];
    if (this.car) { this.turntable.remove(this.car.root); this.car.dispose(); }
    this.car = new CarVisual(cfg, paint);
    // Pose at static ride height with the wheels straight.
    const snap = new Float32Array(SNAPSHOT_SIZE);
    snap[1] = 0.08; snap[6] = 1;
    wheelLayout(cfg).forEach((w, i) => { snap[7 + i * 3] = w.staticLength; });
    this.car.applySnapshot(snap);
    this.car.root.traverse(o => { o.castShadow = true; });
    this.turntable.add(this.car.root);
    this.setPaint(paint);
    this.renderInfo(cfg);
  }

  private setPaint(paint: number): void {
    this.paint = paint;
    this.car?.setPaint(paint);
    const cfg = CARS[this.index];
    this.el.querySelectorAll<HTMLButtonElement>('.swatch').forEach((b, i) => b.classList.toggle('selected', i === paint));
    const name = paint === LIVERY_INDEX ? `Livery: ${cfg.visual.livery.name}` : cfg.visual.paints[paint].name;
    this.el.querySelector('.paint-name')!.textContent = name;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ car: cfg.id, paint })); } catch { /* ignore */ }
  }

  private renderInfo(cfg: CarConfig): void {
    const q = <T extends Element>(sel: string) => this.el.querySelector<T>(sel)!;
    q('.car-class').textContent = CLASS_LABEL[cfg.class];
    q('.car-name').textContent = cfg.name;
    q('.car-story').textContent = cfg.backstory;
    const sp = carSpecs(cfg);
    q('.car-specs').innerHTML = [
      ['Power', `${sp.powerHp} hp`], ['Torque', `${sp.peakTorqueNm} Nm`], ['Weight', `${sp.weightKg} kg`],
      ['Drive', cfg.drivetrain.layout], ['Top speed', `${sp.topSpeedKmh} km/h`], ['0–100', `${sp.zeroToHundred.toFixed(1)} s`],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    q('.car-bars').innerHTML = (Object.entries(cfg.ratings) as [string, number][])
      .map(([k, v]) => `<div class="bar-row"><span>${k}</span><div class="bar"><i style="width:${v * 10}%"></i></div></div>`).join('');
    const swatches = q<HTMLDivElement>('.swatches');
    swatches.innerHTML = '';
    [...cfg.visual.paints.map(p => p.color), -1].forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.title = i === LIVERY_INDEX ? cfg.visual.livery.name : cfg.visual.paints[i].name;
      if (c >= 0) b.style.background = `#${c.toString(16).padStart(6, '0')}`;
      else {
        const l = cfg.visual.livery;
        const hx = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
        b.style.background = `linear-gradient(135deg, ${hx(l.base)} 45%, ${hx(l.accents[0])} 45% 70%, ${hx(l.accents[1] ?? l.accents[0])} 70%)`;
        b.classList.add('livery');
      }
      b.addEventListener('click', () => this.setPaint(i));
      swatches.appendChild(b);
    });
    q('.dots').innerHTML = CARS.map((_, i) => `<i class="${i === this.index ? 'on' : ''}"></i>`).join('');
    this.setPaint(Math.min(this.paint, LIVERY_INDEX));
  }

  private onKey(e: KeyboardEvent): void {
    if (e.repeat) return;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') this.selectCar(this.index + 1, 0);
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.selectCar(this.index - 1, 0);
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.setPaint((this.paint + LIVERY_INDEX) % (LIVERY_INDEX + 1));
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') this.setPaint((this.paint + 1) % (LIVERY_INDEX + 1));
    else if (e.code === 'Enter' || e.code === 'Space') this.onDrive(CARS[this.index].id, this.paint);
    else return;
    e.preventDefault();
    this.idle = 0;
  }

  private buildUi(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'garage';
    el.hidden = true;
    el.innerHTML = `
      <div class="garage-top"><span class="logo">APEX<b>DRIFT</b></span><span class="where">Garage</span></div>
      <div class="garage-info">
        <div class="car-class"></div>
        <h1 class="car-name"></h1>
        <p class="car-story"></p>
        <div class="car-specs"></div>
        <div class="car-bars"></div>
      </div>
      <div class="garage-bottom">
        <div class="paint-picker"><div class="swatches"></div><div class="paint-name"></div></div>
        <div class="car-nav"><button class="nav prev" aria-label="Previous car">◀</button><div class="dots"></div><button class="nav next" aria-label="Next car">▶</button></div>
        <button class="drive">Drive ▶</button>
      </div>
      <div class="garage-hint">← → car · ↑ ↓ paint · Enter drive · drag to rotate</div>`;
    document.body.appendChild(el);
    el.querySelector('.prev')!.addEventListener('click', () => this.selectCar(this.index - 1, 0));
    el.querySelector('.next')!.addEventListener('click', () => this.selectCar(this.index + 1, 0));
    el.querySelector('.drive')!.addEventListener('click', () => this.onDrive(CARS[this.index].id, this.paint));
    // Drag anywhere on the canvas to orbit.
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', e => { if (this.active) { this.dragging = true; this.lastX = e.clientX; } });
    window.addEventListener('pointerup', () => { this.dragging = false; });
    window.addEventListener('pointermove', e => {
      if (!this.dragging || !this.active) return;
      this.orbit -= (e.clientX - this.lastX) * 0.006;
      this.lastX = e.clientX;
      this.idle = 0;
    });
    return el;
  }
}
