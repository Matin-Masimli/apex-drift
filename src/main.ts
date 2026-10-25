import * as THREE from 'three';
import { FixedStepLoop } from './core/FixedStepLoop';
import { Quat, Vec3 } from './core/math';
import { initPhysics, PhysicsWorld } from './physics/PhysicsWorld';
import { buildTestPadPhysics, makeTestPad } from './tracks/testPad';
import { Vehicle } from './vehicles/Vehicle';
import { getCar } from './vehicles/cars';
import { neutralInput, type DriverInput } from './vehicles/types';
import { Renderer } from './rendering/Renderer';
import { Environment, TIME_OF_DAY } from './rendering/Environment';
import { CarVisual } from './rendering/CarVisual';
import { buildTestPadVisual } from './rendering/TestPadVisual';
import { ChaseCamera } from './rendering/ChaseCamera';
import { InputManager } from './ui/input';
import { DebugOverlay } from './ui/DebugOverlay';
import { Hud } from './ui/Hud';

/** M1 entry point: one car on the test pad with full physics, chase/hood/bumper cams, HUD and debug overlay. */

const PHYSICS_HZ = 120;

const loading = document.getElementById('loading')!;
const setProgress = (frac: number, status: string) => {
  (loading.querySelector('.fill') as HTMLElement).style.width = `${frac * 100}%`;
  loading.querySelector('.status')!.textContent = status;
};

async function boot() {
  setProgress(0.1, 'Initialising physics (WASM)…');
  await initPhysics();

  setProgress(0.35, 'Building test pad…');
  const physics = new PhysicsWorld(1 / PHYSICS_HZ);
  const pad = makeTestPad();
  buildTestPadPhysics(physics, pad);

  const carConfig = getCar('meridian-gte');
  const vehicle = new Vehicle(physics, carConfig, pad.spawn);

  setProgress(0.55, 'Creating renderer…');
  const app = document.getElementById('app')!;
  const renderer = new Renderer(app);
  const scene = new THREE.Scene();
  const env = new Environment(scene, renderer.renderer);
  let timeOfDay: keyof typeof TIME_OF_DAY = 'midday';
  env.apply(TIME_OF_DAY[timeOfDay]);

  setProgress(0.75, 'Generating textures…');
  scene.add(buildTestPadVisual(pad));
  const carVisual = new CarVisual(carConfig, vehicle);
  scene.add(carVisual.root);

  const chase = new ChaseCamera(window.innerWidth / window.innerHeight);
  window.addEventListener('resize', () => renderer.onResize(chase.camera));

  const input = new InputManager();
  const hud = new Hud(document.body);
  const debug = new DebugOverlay(document.body);
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent =
    'W/S throttle·brake  A/D steer  Space handbrake  Q/E shift  M auto/manual\n' +
    'C camera  R reset  T time of day  1/2/3 ABS/TC/ESC  F3 or ` debug';
  document.body.appendChild(hint);

  // Render interpolation: keep the last two physics poses and blend by the loop's alpha.
  const prevPos = new Vec3(), currPos = new Vec3();
  const prevRot = new Quat(), currRot = new Quat();
  vehicle.getPose(currPos, currRot);
  prevPos.copy(currPos); prevRot.copy(currRot);
  const renderPos = new THREE.Vector3();
  const renderRot = new THREE.Quaternion();
  const velocity = new THREE.Vector3();
  const tmpQ = new Quat();
  const tmpV = new Vec3();

  const loop = new FixedStepLoop(1 / PHYSICS_HZ);
  let last = performance.now();
  let fpsSmoothed = 60, physicsMs = 0;

  setProgress(1, 'Ready');
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 600);

  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    fpsSmoothed += (1 / Math.max(dt, 1e-4) - fpsSmoothed) * 0.05;

    for (const action of input.drainUiActions()) {
      switch (action) {
        case 'camera': chase.cycle(); break;
        case 'reset': vehicle.reset(pad.spawn.position, pad.spawn.yaw); break;
        case 'debug': debug.toggle(); break;
        case 'toggleAbs': vehicle.aids.abs = !vehicle.aids.abs; break;
        case 'toggleTc': vehicle.aids.tc = !vehicle.aids.tc; break;
        case 'toggleEsc': vehicle.aids.esc = !vehicle.aids.esc; break;
        case 'toggleGearbox': vehicle.powertrain.automatic = !vehicle.powertrain.automatic; break;
        case 'timeOfDay':
          timeOfDay = timeOfDay === 'midday' ? 'sunset' : 'midday';
          env.apply(TIME_OF_DAY[timeOfDay]);
          break;
      }
    }

    const t0 = performance.now();
    const driverInput = input.sampleDriver();
    loop.advance(dt, stepDt => {
      prevPos.copy(currPos); prevRot.copy(currRot);
      vehicle.step(driverInput, stepDt);
      physics.step();
      vehicle.getPose(currPos, currRot);
      input.consumeShifts();
      driverInput.shiftUp = driverInput.shiftDown = false;
    });
    physicsMs += (performance.now() - t0 - physicsMs) * 0.1;

    // Interpolated chassis pose for rendering.
    tmpV.copy(prevPos).lerp(currPos, loop.alpha);
    renderPos.set(tmpV.x, tmpV.y, tmpV.z);
    tmpQ.copy(prevRot).slerp(currRot, loop.alpha);
    renderRot.set(tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w);
    carVisual.root.position.copy(renderPos);
    carVisual.root.quaternion.copy(renderRot);
    carVisual.updateFromSim(vehicle);

    const lv = vehicle.body.linvel();
    velocity.set(lv.x, lv.y, lv.z);
    chase.update(renderPos, renderRot, vehicle.speed, velocity, dt);
    env.follow(renderPos);

    renderer.render(scene, chase.camera);
    hud.update(vehicle);
    debug.update(vehicle, dt, { fps: fpsSmoothed, physicsMs });

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Expose for console tinkering during tuning (e.g. __apex.vehicle.config.tires.rear.muLat = 1.2).
  // simulate() steps physics synchronously, independent of frame rate (handy for automated checks):
  //   __apex.simulate(5, { throttle: 1 })  → returns speed in km/h
  const simulate = (seconds: number, inp: Partial<DriverInput> = {}) => {
    const di = { ...neutralInput(), ...inp };
    for (let i = 0; i < Math.round(seconds * PHYSICS_HZ); i++) {
      vehicle.step(di, 1 / PHYSICS_HZ);
      physics.step();
    }
    vehicle.getPose(currPos, currRot);
    prevPos.copy(currPos); prevRot.copy(currRot);
    return +(vehicle.forwardSpeed * 3.6).toFixed(1);
  };
  (window as unknown as { __apex: unknown }).__apex = { vehicle, physics, scene, simulate };
}

boot().catch(err => {
  console.error(err);
  setProgress(1, `Failed to start: ${err instanceof Error ? err.message : String(err)}`);
});
