import * as THREE from 'three';
import { FixedStepLoop } from './core/FixedStepLoop';
import { MS_TO_KMH } from './core/math';
import { initPhysics, PhysicsWorld } from './physics/PhysicsWorld';
import { buildTestPadPhysics, makeTestPad } from './tracks/testPad';
import { Track } from './tracks/Track';
import { LapTimer } from './tracks/LapTimer';
import { kestrelValley } from './tracks/circuits/kestrelValley';
import { Vehicle } from './vehicles/Vehicle';
import { getCar } from './vehicles/cars';
import { neutralInput, type DriverInput } from './vehicles/types';
import { lerpSnapshot, SNAPSHOT_SIZE, SnapshotRecorder, writeSnapshot } from './vehicles/snapshot';
import { Graphics } from './rendering/Graphics';
import { Environment, TIME_OF_DAY, type TimeOfDay } from './rendering/Environment';
import { CarVisual } from './rendering/CarVisual';
import { buildTestPadVisual } from './rendering/TestPadVisual';
import { TrackVisual } from './rendering/TrackVisual';
import { ChaseCamera } from './rendering/ChaseCamera';
import { ReplayDirector } from './rendering/ReplayDirector';
import { VehicleEffects } from './rendering/effects/VehicleEffects';
import { InputManager } from './ui/input';
import { DebugOverlay } from './ui/DebugOverlay';
import { Hud } from './ui/Hud';
import { LapHud } from './ui/LapHud';

/**
 * M2 entry point: drive the Kestrel Valley circuit (or `?level=testpad`) with lap timing,
 * the full graphics pipeline, effects and replays. Game modes and menus arrive in M4/M6.
 */

const PHYSICS_HZ = 120;
const RECORD_HZ = 60;

const loading = document.getElementById('loading')!;
const setProgress = (frac: number, status: string) => {
  (loading.querySelector('.fill') as HTMLElement).style.width = `${frac * 100}%`;
  loading.querySelector('.status')!.textContent = status;
};
/** Yield to the browser so the loading bar repaints between heavy steps. */
const nextFrame = () => new Promise<void>(r => setTimeout(r, 0));

async function boot() {
  const params = new URLSearchParams(location.search);
  const testPad = params.get('level') === 'testpad';

  setProgress(0.05, 'Initialising physics (WASM)…');
  await initPhysics();
  await nextFrame();

  setProgress(0.2, testPad ? 'Building test pad…' : 'Building circuit…');
  await nextFrame();
  const physics = new PhysicsWorld(1 / PHYSICS_HZ);
  const pad = testPad ? makeTestPad() : null;
  const track = testPad ? null : new Track(kestrelValley);
  if (pad) buildTestPadPhysics(physics, pad);
  if (track) track.buildPhysics(physics);
  const spawn = track ? track.grid[0] : pad!.spawn;

  const carConfig = getCar('meridian-gte');
  const vehicle = new Vehicle(physics, carConfig, spawn);

  setProgress(0.45, 'Creating renderer…');
  await nextFrame();
  const app = document.getElementById('app')!;
  const scene = new THREE.Scene();
  const graphics = new Graphics(app, scene);
  const env = new Environment(scene, graphics.renderer);
  graphics.env = env;
  let timeOfDay: TimeOfDay = track?.def.timeOfDay ?? 'midday';
  env.apply(TIME_OF_DAY[timeOfDay]);

  setProgress(0.6, 'Generating scenery…');
  await nextFrame();
  const trackVisual = track ? new TrackVisual(track) : null;
  scene.add(trackVisual ? trackVisual.group : buildTestPadVisual(pad!));
  const carVisual = new CarVisual(carConfig, vehicle);
  scene.add(carVisual.root);
  const effects = new VehicleEffects();
  scene.add(effects.group);

  setProgress(0.8, 'Compiling shaders…');
  await nextFrame();
  const chase = new ChaseCamera(window.innerWidth / window.innerHeight);
  graphics.onPresetChanged.push(p => {
    trackVisual?.setTreeDensity(p.treeDensity);
    effects.setParticleLimit(p.particles);
  });
  graphics.setCamera(chase.camera);
  window.addEventListener('resize', () => graphics.onResize());
  graphics.renderer.compile(scene, chase.camera);

  // --- UI ---
  const input = new InputManager();
  const hud = new Hud(document.body);
  const debug = new DebugOverlay(document.body);
  const lapTimer = track ? new LapTimer(track) : null;
  const lapHud = track && lapTimer ? new LapHud(document.body, track, lapTimer) : null;
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent =
    'W/S throttle·brake  A/D steer  Space handbrake  Q/E shift  M auto/manual\n' +
    'C camera  R recover  P replay  T time of day  G graphics  1/2/3 ABS/TC/ESC  F3 debug  H hide';
  document.body.appendChild(hint);
  const banner = document.createElement('div');
  banner.className = 'banner';
  document.body.appendChild(banner);

  // --- State ---
  const loop = new FixedStepLoop(1 / PHYSICS_HZ);
  const prevSnap = new Float32Array(SNAPSHOT_SIZE);
  const currSnap = new Float32Array(SNAPSHOT_SIZE);
  const renderSnap = new Float32Array(SNAPSHOT_SIZE);
  writeSnapshot(vehicle, currSnap);
  prevSnap.set(currSnap);
  const recorder = new SnapshotRecorder(RECORD_HZ * 90);
  const director = track ? new ReplayDirector(track) : null;
  let simTime = 0;
  let replay: { time: number; start: number; end: number } | null = null;
  const renderPos = new THREE.Vector3();
  const renderRot = new THREE.Quaternion();
  const velocity = new THREE.Vector3();
  const carFwd = new THREE.Vector3();
  let last = performance.now();
  let fpsSmoothed = 60, physicsMs = 0;

  // Race-style standing start: five lights, then lights out. The car is held on the brakes until GO.
  let startSequence = track ? 0 : -1; // seconds into the sequence; -1 = not running
  const LIGHT_INTERVAL = 0.9;

  const recover = () => {
    // Put the car back on the centreline at its current track position, facing forward.
    if (track) {
      const p = vehicle.body.translation();
      const near = track.line.nearest(p, { index: 0, lateral: 0, distSq: 0 });
      const smp = track.line.samples[near.index];
      vehicle.reset(smp.pos, Math.atan2(-smp.tangent.x, -smp.tangent.z));
      lapTimer?.resetLap();
      lapHud?.toast('Recovered: lap reset', 'info');
    } else {
      vehicle.reset(pad!.spawn.position, pad!.spawn.yaw);
    }
    writeSnapshot(vehicle, currSnap);
    prevSnap.set(currSnap);
    chase.snap();
  };

  setProgress(1, 'Ready');
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 600);
  setTimeout(() => hint.classList.add('faded'), 15000);

  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    fpsSmoothed += (1 / Math.max(dt, 1e-4) - fpsSmoothed) * 0.05;

    for (const action of input.drainUiActions()) {
      switch (action) {
        case 'camera': chase.cycle(); chase.snap(); break;
        case 'reset': if (!replay) recover(); break;
        case 'debug': debug.toggle(); break;
        case 'toggleAbs': vehicle.aids.abs = !vehicle.aids.abs; break;
        case 'toggleTc': vehicle.aids.tc = !vehicle.aids.tc; break;
        case 'toggleEsc': vehicle.aids.esc = !vehicle.aids.esc; break;
        case 'toggleGearbox': vehicle.powertrain.automatic = !vehicle.powertrain.automatic; break;
        case 'timeOfDay':
          timeOfDay = timeOfDay === 'midday' ? 'sunset' : 'midday';
          env.apply(TIME_OF_DAY[timeOfDay]);
          graphics.syncSun();
          break;
        case 'quality': {
          const p = graphics.cyclePreset();
          if (lapHud) lapHud.toast(`Graphics: ${p.name}`);
          break;
        }
        case 'hideHint': hint.classList.toggle('faded'); break;
        case 'replay':
          if (replay) {
            replay = null;
            director?.reset();
            chase.snap();
            banner.className = 'banner';
            document.body.classList.remove('replaying');
          } else if (recorder.count > RECORD_HZ * 2 && director) {
            const start = Math.max(recorder.startTime, recorder.endTime - 60);
            replay = { time: start, start, end: recorder.endTime };
            document.body.classList.add('replaying');
          }
          break;
      }
    }

    if (replay && director) {
      // ----- Replay playback: physics paused, TV-style cameras -----
      replay.time += dt;
      if (replay.time > replay.end) replay.time = replay.start;
      recorder.sample(replay.time, renderSnap);
      carVisual.applySnapshot(renderSnap);
      renderPos.set(renderSnap[0], renderSnap[1], renderSnap[2]);
      carFwd.set(0, 0, -1).applyQuaternion(renderRot.set(renderSnap[3], renderSnap[4], renderSnap[5], renderSnap[6]));
      director.update(chase.camera, renderPos, carFwd, dt);
      banner.textContent = 'REPLAY  ·  P to exit';
      banner.className = 'banner show replay';
      effects.step(dt, chase.camera, graphics.renderer.domElement.height);
      env.follow(chase.camera.position);
      graphics.render(0);
      requestAnimationFrame(frame);
      return;
    }

    // ----- Start lights -----
    let inputLocked = false;
    if (startSequence >= 0 && trackVisual) {
      startSequence += dt;
      const lit = Math.min(5, Math.floor(startSequence / LIGHT_INTERVAL));
      const out = startSequence > LIGHT_INTERVAL * 6;
      trackVisual.setStartLights(out ? 0 : lit);
      inputLocked = !out;
      if (lit >= 1 && !out) { banner.textContent = '●'.repeat(lit) + '○'.repeat(5 - lit); banner.className = 'banner show lights'; }
      if (out) {
        startSequence = -1;
        lapTimer?.startNow();
        banner.textContent = 'GO!';
        banner.className = 'banner show go';
        setTimeout(() => banner.classList.remove('show'), 900);
      }
    }

    // ----- Fixed-step simulation -----
    const t0 = performance.now();
    // Held on the handbrake (not the brake pedal, which would engage auto-reverse at a standstill).
    const driverInput: DriverInput = inputLocked ? { ...neutralInput(), handbrake: 1 } : input.sampleDriver();
    loop.advance(dt, stepDt => {
      prevSnap.set(currSnap);
      vehicle.step(driverInput, stepDt);
      physics.step();
      simTime += stepDt;
      writeSnapshot(vehicle, currSnap);
      if (lapTimer) lapHud?.onEvents(lapTimer.update(stepDt, vehicle.body.translation(), vehicle.forwardSpeed));
      if (loop.tick % (PHYSICS_HZ / RECORD_HZ) === 0) recorder.record(vehicle, simTime);
      input.consumeShifts();
      driverInput.shiftUp = driverInput.shiftDown = false;
    });
    physicsMs += (performance.now() - t0 - physicsMs) * 0.1;

    // ----- Render -----
    lerpSnapshot(prevSnap, 0, currSnap, 0, loop.alpha, renderSnap);
    carVisual.applySnapshot(renderSnap);
    renderPos.set(renderSnap[0], renderSnap[1], renderSnap[2]);
    renderRot.set(renderSnap[3], renderSnap[4], renderSnap[5], renderSnap[6]);

    effects.update(vehicle, 'player', dt);
    effects.step(dt, chase.camera, graphics.renderer.domElement.height);

    const lv = vehicle.body.linvel();
    velocity.set(lv.x, lv.y, lv.z);
    chase.update(renderPos, renderRot, vehicle.speed, velocity, dt);
    env.follow(chase.camera.position);
    const speed01 = chase.mode === 'hood' ? 0 : Math.min(1, (vehicle.speed * MS_TO_KMH) / 300);
    graphics.render(speed01);

    hud.update(vehicle);
    lapHud?.update(dt, [{ x: renderPos.x, z: renderPos.z, color: '#ff5a1f', player: true }]);
    const info = graphics.info.render;
    debug.update(vehicle, dt, { fps: fpsSmoothed, physicsMs, drawCalls: info.calls, triangles: info.triangles, quality: graphics.preset.name });

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // simulate() steps physics synchronously, independent of frame rate (handy for automated checks):
  //   __apex.simulate(5, { throttle: 1 })  → returns speed in km/h
  const simulate = (seconds: number, inp: Partial<DriverInput> = {}) => {
    if (startSequence >= 0) { startSequence = -1; trackVisual?.setStartLights(0); lapTimer?.startNow(); }
    const di = { ...neutralInput(), ...inp };
    for (let i = 0; i < Math.round(seconds * PHYSICS_HZ); i++) {
      vehicle.step(di, 1 / PHYSICS_HZ);
      physics.step();
      simTime += 1 / PHYSICS_HZ;
      if (lapTimer) lapHud?.onEvents(lapTimer.update(1 / PHYSICS_HZ, vehicle.body.translation(), vehicle.forwardSpeed));
      if (i % 2 === 0) recorder.record(vehicle, simTime);
      if (i % 4 === 0) effects.update(vehicle, 'player', 4 / PHYSICS_HZ);
    }
    writeSnapshot(vehicle, currSnap);
    prevSnap.set(currSnap);
    return +(vehicle.forwardSpeed * 3.6).toFixed(1);
  };
  (window as unknown as { __apex: unknown }).__apex = { vehicle, physics, scene, simulate, graphics, track, lapTimer, chase, recover };
}

boot().catch(err => {
  console.error(err);
  setProgress(1, `Failed to start: ${err instanceof Error ? err.message : String(err)}`);
});
