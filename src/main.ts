import { initPhysics } from './physics/PhysicsWorld';
import { Graphics } from './rendering/Graphics';
import { DriveSession, type DriveOptions } from './game/DriveSession';
import { CARS } from './vehicles/cars';
import { InputManager } from './ui/input';
import { Showroom } from './ui/Showroom';
import { hideLoading, nextFrame, setProgress, showLoading } from './ui/loading';

/**
 * App entry: boot → garage (car select) → drive session → back to the garage on Esc.
 * Mode select, menus and settings arrive in M4/M6.
 *
 * URL shortcuts for development:
 *   ?drive               skip the garage and drive the last-selected car
 *   ?car=<id>&paint=<n>  choose the car/paint for ?drive
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
    session.start();
  };

  showroom.onDrive = (carId, paintIndex) => { void drive({ carId, paintIndex, level }); };

  if (params.has('drive')) {
    const carId = CARS.find(c => c.id === params.get('car'))?.id ?? CARS[1].id;
    await drive({ carId, paintIndex: Number(params.get('paint') ?? 0), level });
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
