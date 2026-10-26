import * as THREE from 'three';
import { FixedStepLoop } from '../core/FixedStepLoop';
import { MS_TO_KMH } from '../core/math';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { buildTestPadPhysics, makeTestPad, type TestPadDef } from '../tracks/testPad';
import { Track } from '../tracks/Track';
import type { LapEvent } from '../tracks/LapTimer';
import { kestrelValley } from '../tracks/circuits/kestrelValley';
import { Vehicle } from '../vehicles/Vehicle';
import { CARS, getCar } from '../vehicles/cars';
import { neutralInput, type DriverInput } from '../vehicles/types';
import { lerpSnapshot, SNAPSHOT_SIZE, SnapshotRecorder, writeSnapshot } from '../vehicles/snapshot';
import { RacingLine } from '../ai/RacingLine';
import type { Difficulty } from '../ai/AIDriver';
import { orderGridByPace, RaceSim, type Racer, type RacerSpec } from './RaceSim';
import { GhostRecorder, loadGhost, saveGhost, type GhostLap } from './Ghost';
import { Graphics } from '../rendering/Graphics';
import { Environment, TIME_OF_DAY, type TimeOfDay } from '../rendering/Environment';
import { CarVisual } from '../rendering/CarVisual';
import { buildTestPadVisual } from '../rendering/TestPadVisual';
import { TrackVisual } from '../rendering/TrackVisual';
import { ChaseCamera } from '../rendering/ChaseCamera';
import { ReplayDirector } from '../rendering/ReplayDirector';
import { Podium } from '../rendering/Podium';
import { VehicleEffects } from '../rendering/effects/VehicleEffects';
import { DEFAULT_QUALITY } from '../rendering/quality';
import type { InputManager } from '../ui/input';
import { DebugOverlay } from '../ui/DebugOverlay';
import { Hud } from '../ui/Hud';
import { formatTime, LapHud } from '../ui/LapHud';
import { DeltaHud, MenuOverlay, RaceHud, type StandingRow } from '../ui/RaceHud';
import { nextFrame, setProgress } from '../ui/loading';

export type GameMode =
  | { kind: 'practice' }
  | { kind: 'timeTrial' }
  | { kind: 'race'; opponents: number; difficulty: Difficulty; laps: number; rubberBand: boolean; field: 'same' | 'mixed' };

export interface DriveOptions {
  carId: string;
  paintIndex: number;
  level: 'kestrel' | 'testpad';
  mode: GameMode;
}

const PHYSICS_HZ = 120;
const RECORD_HZ = 60;
const LIGHT_INTERVAL = 0.9;
/** Invented driver names for AI opponents. */
const AI_NAMES = ['K. Varga', 'M. Okafor', 'L. Brandt', 'R. Delgado', 'A. Novak', 'T. Lindqvist', 'J. Moreau', 'D. Halloran', 'E. Kowalski', 'S. Imre'];

/** Quality preset survives between sessions. */
let lastQuality = DEFAULT_QUALITY;

/** Everything needed to draw one car: its visual and interpolation/replay buffers. */
interface CarSlot {
  vehicle: Vehicle;
  racer: Racer | null;
  visual: CarVisual;
  prev: Float32Array;
  curr: Float32Array;
  render: Float32Array;
  recorder: SnapshotRecorder;
  name: string;
}

/**
 * One driving session: a level, the player's car, optional AI opponents, the render pipeline, HUD,
 * replays and the mode rules (practice, time trial with ghost, quick race with results and podium).
 * The rules themselves live in the headless RaceSim; this class renders and drives it.
 */
export class DriveSession {
  /** Called when the player leaves to the garage. */
  onExit: () => void = () => {};
  /** Called when the player asks to restart with the same options. */
  onRestart: () => void = () => {};

  private readonly ui: HTMLElement[] = [];
  private raf = 0;
  private disposed = false;
  private readonly cleanups: (() => void)[] = [];

  private constructor(
    private readonly opts: DriveOptions,
    private readonly input: InputManager,
    private readonly physics: PhysicsWorld,
    private readonly scene: THREE.Scene,
    private readonly graphics: Graphics,
    private readonly env: Environment,
    private readonly sim: RaceSim | null,
    private readonly cars: CarSlot[],
    private readonly effects: VehicleEffects,
    private readonly chase: ChaseCamera,
    private readonly track: Track | null,
    private readonly pad: TestPadDef | null,
    private readonly trackVisual: TrackVisual | null,
    private timeOfDay: TimeOfDay,
  ) {}

  static async create(renderer: THREE.WebGLRenderer, input: InputManager, opts: DriveOptions): Promise<DriveSession> {
    setProgress(0.12, opts.level === 'testpad' ? 'Building test pad…' : 'Building circuit…');
    await nextFrame();
    const physics = new PhysicsWorld(1 / PHYSICS_HZ);
    const pad = opts.level === 'testpad' ? makeTestPad() : null;
    const track = pad ? null : new Track(kestrelValley);
    if (pad) buildTestPadPhysics(physics, pad);
    if (track) track.buildPhysics(physics);

    // --- Entrants ---
    const playerSpec: RacerSpec = { name: 'You', carId: opts.carId, paintIndex: opts.paintIndex, player: true };
    let sim: RaceSim | null = null;
    const cars: { vehicle: Vehicle; racer: Racer | null; spec: RacerSpec }[] = [];
    if (track) {
      setProgress(0.3, opts.mode.kind === 'race' ? 'Preparing opponents…' : 'Preparing session…');
      await nextFrame();
      const line = new RacingLine(track);
      let specs: RacerSpec[] = [playerSpec];
      if (opts.mode.kind === 'race') {
        const m = opts.mode;
        let ai: RacerSpec[] = Array.from({ length: m.opponents }, (_, i) => ({
          name: AI_NAMES[i % AI_NAMES.length],
          carId: m.field === 'same' ? opts.carId : CARS[(CARS.findIndex(c => c.id === opts.carId) + 1 + i) % CARS.length].id,
          // Opponents in the same car get the other paints and the livery.
          paintIndex: m.field === 'same' ? (opts.paintIndex + 1 + i) % 5 : i % 5,
          player: false,
          difficulty: m.difficulty,
        }));
        if (m.field === 'mixed') ai = orderGridByPace(ai, line);
        specs = [...ai, playerSpec]; // the player starts from the back of the grid
      }
      sim = new RaceSim(physics, track, line, specs, {
        laps: opts.mode.kind === 'race' ? opts.mode.laps : 0,
        rubberBand: opts.mode.kind === 'race' && opts.mode.rubberBand,
      });
      for (const r of sim.racers) cars.push({ vehicle: r.vehicle, racer: r, spec: r.spec });
    } else {
      cars.push({ vehicle: new Vehicle(physics, getCar(opts.carId), pad!.spawn), racer: null, spec: playerSpec });
    }

    setProgress(0.45, 'Setting up lighting…');
    await nextFrame();
    const scene = new THREE.Scene();
    const graphics = new Graphics(renderer, scene, lastQuality);
    const env = new Environment(scene, renderer);
    graphics.env = env;
    const timeOfDay: TimeOfDay = track?.def.timeOfDay ?? 'midday';
    env.apply(TIME_OF_DAY[timeOfDay]);

    setProgress(0.6, 'Generating scenery and cars…');
    await nextFrame();
    const trackVisual = track ? new TrackVisual(track) : null;
    scene.add(trackVisual ? trackVisual.group : buildTestPadVisual(pad!));
    const slots: CarSlot[] = cars.map(c => {
      const visual = new CarVisual(c.vehicle.config, c.spec.paintIndex);
      scene.add(visual.root);
      const slot: CarSlot = {
        vehicle: c.vehicle, racer: c.racer, visual, name: c.spec.name,
        prev: new Float32Array(SNAPSHOT_SIZE), curr: new Float32Array(SNAPSHOT_SIZE), render: new Float32Array(SNAPSHOT_SIZE),
        recorder: new SnapshotRecorder(RECORD_HZ * 90),
      };
      writeSnapshot(c.vehicle, slot.curr);
      slot.prev.set(slot.curr);
      visual.applySnapshot(slot.curr);
      return slot;
    });
    const effects = new VehicleEffects();
    scene.add(effects.group);

    setProgress(0.8, 'Compiling shaders…');
    await nextFrame();
    const chase = new ChaseCamera(window.innerWidth / window.innerHeight);
    graphics.onPresetChanged.push(p => {
      trackVisual?.setTreeDensity(p.treeDensity);
      effects.setParticleLimit(p.particles);
      lastQuality = graphics.presetIndex;
    });
    graphics.setCamera(chase.camera);
    graphics.onResize();
    renderer.compile(scene, chase.camera);

    const session = new DriveSession(opts, input, physics, scene, graphics, env, sim, slots, effects, chase, track, pad, trackVisual, timeOfDay);
    // Headlights only on the player's car (each costs two spot lights).
    slots.find(s => s.racer?.spec.player || !s.racer)?.visual.setHeadlights(timeOfDay === 'sunset');
    return session;
  }

  start(): void {
    const { input, physics, graphics, env, sim, cars, effects, chase, track, pad, trackVisual, opts } = this;
    const mode = opts.mode;
    const player = cars.find(c => !c.racer || c.racer.spec.player)!;
    const vehicle = player.vehicle;
    const timer = player.racer?.timer ?? null;
    const resize = () => graphics.onResize();
    window.addEventListener('resize', resize);
    this.cleanups.push(() => window.removeEventListener('resize', resize));
    input.drainUiActions(); // ignore keys pressed in the garage

    // --- UI ---
    const hud = new Hud(document.body);
    const debug = new DebugOverlay(document.body);
    const lapHud = track && timer ? new LapHud(document.body, track, timer) : null;
    const raceHud = mode.kind === 'race' && sim ? new RaceHud(document.body) : null;
    const deltaHud = mode.kind === 'timeTrial' ? new DeltaHud(document.body) : null;
    const menu = new MenuOverlay(document.body);
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent =
      'W/S throttle·brake  A/D steer  Space handbrake  Q/E shift  M auto/manual  L lights\n' +
      'C camera  R recover  P replay  T time of day  G graphics  1/2/3 ABS/TC/ESC  F3 debug  H hide  Esc pause';
    const banner = document.createElement('div');
    banner.className = 'banner';
    document.body.append(hint, banner);
    this.ui.push(hud.element, debug.el, hint, banner, menu.element, ...(lapHud?.elements ?? []), ...(raceHud?.elements ?? []));
    if (deltaHud) this.ui.push(deltaHud.element);
    const hintTimer = setTimeout(() => hint.classList.add('faded'), 15000);
    this.cleanups.push(() => clearTimeout(hintTimer));

    // --- Mode state ---
    const loop = new FixedStepLoop(1 / PHYSICS_HZ);
    const director = track ? new ReplayDirector(track) : null;
    let simTime = 0;
    let replay: { time: number; start: number; end: number } | null = null;
    let paused = false;
    let podium: Podium | null = null;
    let podiumTime = 0;
    const renderPos = new THREE.Vector3();
    const renderRot = new THREE.Quaternion();
    const velocity = new THREE.Vector3();
    const carFwd = new THREE.Vector3();
    let last = performance.now();
    let fpsSmoothed = 60, physicsMs = 0;
    // Practice and races start from the lights; a time trial starts immediately and times from the line.
    let lightsRunning = !!track && mode.kind !== 'timeTrial';
    let startSequence = 0; // seconds into the light sequence
    if (sim && mode.kind === 'timeTrial') sim.phase = 'racing';

    // Time trial ghost.
    let ghost: GhostLap | null = track && mode.kind === 'timeTrial' ? loadGhost(track.def.id, vehicle.config.id) : null;
    let ghostVisual: CarVisual | null = null;
    const ghostSnap = new Float32Array(SNAPSHOT_SIZE);
    const ghostRec = new GhostRecorder();
    const ensureGhostVisual = () => {
      if (ghostVisual || mode.kind !== 'timeTrial') return;
      ghostVisual = new CarVisual(vehicle.config, player.visual.paintIndex);
      ghostVisual.setGhost();
      ghostVisual.root.visible = false;
      this.scene.add(ghostVisual.root);
    };
    if (ghost) ensureGhostVisual();

    const showBanner = (text: string, cls: string, ms = 0) => {
      banner.textContent = text;
      banner.className = `banner show ${cls}`;
      if (ms) setTimeout(() => banner.classList.remove('show'), ms);
    };

    const recover = () => {
      if (sim && player.racer && mode.kind === 'race') {
        sim.recover(player.racer); // keeps race progress
        lapHud?.toast('Recovered', 'info');
      } else if (track) {
        const near = track.line.nearest(vehicle.body.translation(), { index: 0, lateral: 0, distSq: 0 });
        const smp = track.line.samples[near.index];
        vehicle.reset(smp.pos, Math.atan2(-smp.tangent.x, -smp.tangent.z));
        timer?.resetLap();
        lapHud?.toast('Recovered: lap reset', 'info');
      } else {
        vehicle.reset(pad!.spawn.position, pad!.spawn.yaw);
      }
      writeSnapshot(vehicle, player.curr);
      player.prev.set(player.curr);
      chase.snap();
    };

    const exitToGarage = () => this.onExit();
    const restart = () => this.onRestart();
    const togglePause = () => {
      if (podium) return;
      paused = !paused;
      if (paused) menu.showPause([
        { label: 'Resume', run: togglePause },
        { label: 'Restart', run: restart },
        { label: 'Garage', run: exitToGarage },
      ]);
      else menu.hide();
    };

    const startReplay = () => {
      const rec = player.recorder;
      if (rec.count < RECORD_HZ * 2 || !director) return;
      const start = Math.max(rec.startTime, rec.endTime - 60);
      replay = { time: start, start, end: rec.endTime };
      document.body.classList.add('replaying');
      menu.hide();
    };
    const stopReplay = () => {
      replay = null;
      director?.reset();
      chase.snap();
      banner.className = 'banner';
      document.body.classList.remove('replaying');
      if (podium) showResults();
    };

    const standings = (): StandingRow[] => {
      if (!sim || !track) return [];
      const order = sim.order();
      const leader = order[0];
      return order.map((r, i) => {
        const slot = cars[r.index];
        let gap: string;
        if (r.finished) gap = i === 0 ? formatTime(r.finishTime) : `+${(r.finishTime - leader.finishTime).toFixed(3)}`;
        else if (i === 0) gap = 'Leader';
        else {
          const behind = (leader.timer.raceDistance - r.timer.raceDistance);
          const laps = Math.floor(behind / track.length);
          gap = laps >= 1 ? `+${laps} lap${laps > 1 ? 's' : ''}` : `+${(behind / Math.max(15, r.vehicle.forwardSpeed)).toFixed(1)}`;
        }
        return { name: slot.name, color: slot.visual.paintCss, player: !!r.spec.player, gap, finished: r.finished };
      });
    };

    const showResults = () => {
      if (!sim) return;
      const order = sim.order();
      const winner = order[0];
      const rows = order.map((r, i) => ({
        name: cars[r.index].name,
        car: r.vehicle.config.name,
        color: cars[r.index].visual.paintCss,
        time: r.finished ? (i === 0 ? formatTime(r.finishTime) : `+${(r.finishTime - winner.finishTime).toFixed(3)}`) : `${r.laps} laps`,
        best: formatTime(r.timer.bestLapTime),
        player: !!r.spec.player,
      }));
      const pos = player.racer ? order.indexOf(player.racer) + 1 : 0;
      menu.showResults(`Finished P${pos} of ${order.length}`, rows, [
        { label: 'Race again', run: restart },
        { label: 'Watch replay', run: startReplay },
        { label: 'Garage', run: exitToGarage },
      ]);
    };

    const enterPodium = () => {
      if (!sim || !track || podium) return;
      podium = new Podium(track);
      document.body.classList.add('podium');
      this.scene.add(podium.group);
      graphics.setupMaterials(podium.group);
      const order = sim.order();
      const snap = new Float32Array(SNAPSHOT_SIZE);
      cars.forEach(c => { c.visual.root.visible = false; });
      order.slice(0, 3).forEach((r, i) => {
        const slot = podium!.slots[i];
        const v = cars[r.index].visual;
        snap.fill(0);
        snap[0] = slot.position.x; snap[1] = slot.position.y; snap[2] = slot.position.z;
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), slot.yaw);
        snap[3] = q.x; snap[4] = q.y; snap[5] = q.z; snap[6] = q.w;
        r.vehicle.wheels.forEach((w, k) => { snap[7 + k * 3] = w.suspensionLength; });
        v.applySnapshot(snap);
        v.root.visible = true;
      });
      showBanner(`P${order.indexOf(player.racer!) + 1}`, 'go', 2500);
      showResults();
    };

    const handleTimerEvents = (events: LapEvent[]) => {
      lapHud?.onEvents(events);
      if (mode.kind !== 'timeTrial' || !track) return;
      for (const e of events) {
        if (e.type === 'lapStart') ghostRec.begin();
        if (e.type === 'lap' && e.valid && (!ghost || e.lapTime < ghost.lapTime)) {
          const hadGhost = !!ghost;
          ghost = ghostRec.finish(e.lapTime);
          saveGhost(track.def.id, vehicle.config.id, ghost);
          ensureGhostVisual();
          lapHud?.toast(hadGhost ? `New best: ${formatTime(e.lapTime)}, ghost updated` : `Ghost saved: ${formatTime(e.lapTime)}`, 'best', 3.5);
        }
      }
    };

    /** One fixed physics step for the whole session. */
    const stepSim = (stepDt: number, inp: DriverInput) => {
      for (const c of cars) c.prev.set(c.curr);
      if (sim) {
        for (const ev of sim.step(stepDt, inp)) {
          if (ev.type !== 'done' && ev.racer !== player.racer) continue;
          if (ev.type === 'timer') handleTimerEvents([ev.event]);
          else if (ev.type === 'finish') showBanner(`FINISHED  P${ev.position}`, 'go', 3500);
          else if (ev.type === 'done') enterPodium();
        }
      } else {
        vehicle.step(inp, stepDt);
        physics.step();
      }
      simTime += stepDt;
      for (const c of cars) writeSnapshot(c.vehicle, c.curr);
      if (mode.kind === 'timeTrial' && timer?.lapRunning) ghostRec.record(timer.currentLapTime, timer.progress, vehicle);
      if (loop.tick % (PHYSICS_HZ / RECORD_HZ) === 0) for (const c of cars) c.recorder.record(c.vehicle, simTime);
    };

    const frame = (now: number) => {
      if (this.disposed) return;
      // The rAF timestamp of the first frame can be slightly *earlier* than `last` (taken when the
      // session started), so clamp at zero as well: a negative dt would run time backwards.
      const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
      last = now;
      fpsSmoothed += (1 / Math.max(dt, 1e-4) - fpsSmoothed) * 0.05;

      for (const action of input.drainUiActions()) {
        if (action === 'menu') {
          if (replay) stopReplay();
          else if (!podium) togglePause();
          continue;
        }
        if (paused && action !== 'debug') continue;
        switch (action) {
          case 'camera': chase.cycle(); chase.snap(); break;
          case 'reset': if (!replay && !podium) recover(); break;
          case 'debug': debug.toggle(); break;
          case 'toggleAbs': vehicle.aids.abs = !vehicle.aids.abs; break;
          case 'toggleTc': vehicle.aids.tc = !vehicle.aids.tc; break;
          case 'toggleEsc': vehicle.aids.esc = !vehicle.aids.esc; break;
          case 'toggleGearbox': vehicle.powertrain.automatic = !vehicle.powertrain.automatic; break;
          case 'headlights': player.visual.setHeadlights(!player.visual.headlights); break;
          case 'timeOfDay':
            this.timeOfDay = this.timeOfDay === 'midday' ? 'sunset' : 'midday';
            env.apply(TIME_OF_DAY[this.timeOfDay]);
            graphics.syncSun();
            player.visual.setHeadlights(this.timeOfDay === 'sunset');
            break;
          case 'quality': lapHud?.toast(`Graphics: ${graphics.cyclePreset().name}`); break;
          case 'hideHint': hint.classList.toggle('faded'); break;
          case 'replay': if (replay) stopReplay(); else startReplay(); break;
        }
      }

      // ----- Replay playback: simulation paused, TV-style cameras -----
      if (replay && director) {
        replay.time += dt;
        if (replay.time > replay.end) replay.time = replay.start;
        for (const c of cars) {
          c.recorder.sample(replay.time, c.render);
          c.visual.applySnapshot(c.render);
          c.visual.root.visible = true;
        }
        if (ghostVisual) ghostVisual.root.visible = false;
        renderPos.set(player.render[0], player.render[1], player.render[2]);
        carFwd.set(0, 0, -1).applyQuaternion(renderRot.set(player.render[3], player.render[4], player.render[5], player.render[6]));
        director.update(chase.camera, renderPos, carFwd, dt);
        showBanner('REPLAY  ·  P or Esc to exit', 'replay');
        effects.step(dt, chase.camera, graphics.renderer.domElement.height);
        env.follow(chase.camera.position);
        graphics.render(0);
        this.raf = requestAnimationFrame(frame);
        return;
      }

      // ----- Podium: race over, cars parked, camera orbits -----
      if (podium) {
        podiumTime += dt;
        podium.updateCamera(chase.camera, podiumTime);
        env.follow(chase.camera.position);
        effects.step(dt, chase.camera, graphics.renderer.domElement.height);
        graphics.render(0);
        this.raf = requestAnimationFrame(frame);
        return;
      }

      // ----- Start lights -----
      if (lightsRunning && trackVisual && !paused) {
        startSequence += dt;
        const lit = Math.min(5, Math.floor(startSequence / LIGHT_INTERVAL));
        const out = startSequence > LIGHT_INTERVAL * 6;
        trackVisual.setStartLights(out ? 0 : lit);
        if (lit === 0) showBanner('GET READY', 'lights');
        else if (!out) showBanner('●'.repeat(lit) + '○'.repeat(5 - lit), 'lights');
        if (out) {
          lightsRunning = false;
          sim?.start();
          showBanner('GO!', 'go', 900);
        }
      }

      // ----- Fixed-step simulation -----
      const t0 = performance.now();
      if (!paused) {
        const driverInput: DriverInput = input.sampleDriver();
        loop.advance(dt, stepDt => {
          stepSim(stepDt, driverInput);
          input.consumeShifts();
          driverInput.shiftUp = driverInput.shiftDown = false;
        });
      }
      physicsMs += (performance.now() - t0 - physicsMs) * 0.1;

      // ----- Render -----
      const alpha = paused ? 1 : loop.alpha;
      for (const c of cars) {
        lerpSnapshot(c.prev, 0, c.curr, 0, alpha, c.render);
        c.visual.applySnapshot(c.render);
        if (!paused) effects.update(c.vehicle, c.name, dt);
      }
      if (!paused) effects.step(dt, chase.camera, graphics.renderer.domElement.height);
      renderPos.set(player.render[0], player.render[1], player.render[2]);
      renderRot.set(player.render[3], player.render[4], player.render[5], player.render[6]);

      // Ghost and live delta.
      if (ghostVisual && ghost && timer) {
        ghostVisual.root.visible = timer.lapRunning;
        if (timer.lapRunning) {
          ghost.sample(timer.currentLapTime, ghostSnap);
          ghostVisual.applySnapshot(ghostSnap);
        }
      }
      if (deltaHud && timer) {
        const gt = ghost && timer.lapRunning ? ghost.timeAtProgress(timer.progress) : null;
        deltaHud.update(gt === null ? null : timer.currentLapTime - gt, ghost?.lapTime ?? null);
      }

      const lv = vehicle.body.linvel();
      velocity.set(lv.x, lv.y, lv.z);
      chase.update(renderPos, renderRot, vehicle.speed, velocity, dt);
      env.follow(chase.camera.position);
      const speed01 = chase.mode === 'hood' ? 0 : Math.min(1, (vehicle.speed * MS_TO_KMH) / 300);
      graphics.render(speed01);

      hud.update(vehicle);
      lapHud?.update(dt, cars.map(c => ({ x: c.render[0], z: c.render[2], color: c.visual.paintCss, player: c === player })));
      if (raceHud && sim && player.racer && mode.kind === 'race') {
        raceHud.update(sim.position(player.racer), sim.racers.length, player.racer.laps + 1, mode.laps, standings());
      }
      const info = graphics.info.render;
      debug.update(vehicle, dt, { fps: fpsSmoothed, physicsMs, drawCalls: info.calls, triangles: info.triangles, quality: graphics.preset.name });

      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);

    // Console/automation hooks. simulate() steps the session synchronously, independent of frame rate:
    //   __apex.simulate(5, { throttle: 1 })  → returns speed in km/h
    const simulate = (seconds: number, inp: Partial<DriverInput> = {}) => {
      if (lightsRunning) { lightsRunning = false; trackVisual?.setStartLights(0); sim?.start(); banner.className = 'banner'; }
      const di = { ...neutralInput(), ...inp };
      for (let i = 0; i < Math.round(seconds * PHYSICS_HZ); i++) {
        stepSim(1 / PHYSICS_HZ, di);
        if (i % 4 === 0) for (const c of cars) effects.update(c.vehicle, c.name, 4 / PHYSICS_HZ);
        if (podium) break;
      }
      for (const c of cars) { writeSnapshot(c.vehicle, c.curr); c.prev.set(c.curr); }
      return +(vehicle.forwardSpeed * 3.6).toFixed(1);
    };
    (window as unknown as { __apex: unknown }).__apex = {
      vehicle, physics, scene: this.scene, simulate, graphics, track, lapTimer: timer, chase, recover, carVisual: player.visual, sim,
      ghost: () => ghost,
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const c of this.cleanups) c();
    for (const el of this.ui) el.remove();
    document.body.classList.remove('replaying', 'podium');
    this.graphics.dispose();
    this.scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh && !(o as THREE.Points).isPoints) return;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m) continue;
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
        m.dispose();
      }
    });
    this.scene.environment?.dispose();
    this.physics.dispose();
    (window as unknown as { __apex?: unknown }).__apex = undefined;
  }
}
