import { initPhysics } from './physics/PhysicsWorld';
import { Graphics } from './rendering/Graphics';
import { DriveSession, type DriveOptions, type GameMode } from './game/DriveSession';
import { CARS } from './vehicles/cars';
import { InputManager } from './ui/input';
import { Showroom } from './ui/Showroom';
import { hideLoading, nextFrame, setProgress, showLoading } from './ui/loading';

/**
 * App entry: boot → garage (car select) → drive session → back to the garage on Esc.
 * Mode select, menus and settings arrive in M4/M6.
 *
 * URL shortcuts for development:
 *   ?drive               skip the garage (free practice)
 *   ?car=<id>&paint=<n>  choose the car/paint for ?drive
 *   &mode=race|tt        quick race (&ai=5&laps=3&difficulty=medium&field=same|mixed) or time trial
 *   ?level=testpad       drive the M1 test pad instead of the circuit
 */
async function boot() {
  const params = new URLSearchParams(location.search);
  const level = params.get('level') === 'testpad' ? 'testpad' : 'kestrel';
  setProgress(0.05, 'Initialising physics (WASM)…');
  await initPhysics();
  await nextFrame();

  const renderer = Graphics.createRenderer(document.getElementById('app')!);
  const input = new InputManager();
  setProgress(0.5, 'Preparing garage…');
  await nextFrame();
  const showroom = new Showroom(renderer);
  let session: DriveSession | null = null;

  const drive = async (opts: DriveOptions) => {
    showroom.hide();
    showLoading('Loading…');
    try {
      session = await DriveSession.create(renderer, input, opts);
    } catch (err) {
      console.error(err);
      setProgress(1, `Failed to load: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setProgress(1, 'Ready');
    hideLoading();
    session.onExit = () => {
      session?.dispose();
      session = null;
      showroom.show();
    };
    session.onRestart = () => {
      session?.dispose();
      session = null;
      void drive(opts);
    };
    session.start();
  };

  showroom.onDrive = (carId, paintIndex, mode) => { void drive({ carId, paintIndex, level, mode }); };

  if (params.has('drive')) {
    const carId = CARS.find(c => c.id === params.get('car'))?.id ?? CARS[1].id;
    const m = params.get('mode');
    const mode: GameMode = m === 'race'
      ? { kind: 'race', opponents: Number(params.get('ai') ?? 5), difficulty: (params.get('difficulty') ?? 'medium') as 'medium', laps: Number(params.get('laps') ?? 3), rubberBand: false, field: params.get('field') === 'mixed' ? 'mixed' : 'same' }
      : m === 'tt' ? { kind: 'timeTrial' } : { kind: 'practice' };
    await drive({ carId, paintIndex: Number(params.get('paint') ?? 0), level, mode });
  } else {
    setProgress(1, 'Ready');
    hideLoading();
    showroom.show();
  }
}

boot().catch(err => {
  console.error(err);
  setProgress(1, `Failed to start: ${err instanceof Error ? err.message : String(err)}`);
});
