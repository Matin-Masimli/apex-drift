import { neutralInput, type DriverInput } from '../vehicles/types';

/**
 * Keyboard + Gamepad input mapped to abstract actions. Bindings are data (rebinding UI comes in M6).
 * Driving axes are produced as a DriverInput; one-shot actions (camera, reset, toggles) are queued
 * and drained once per frame.
 */

export type UiAction = 'camera' | 'reset' | 'debug' | 'toggleAbs' | 'toggleTc' | 'toggleEsc' | 'toggleGearbox' | 'timeOfDay';

export interface KeyBindings {
  throttle: string[];
  brake: string[];
  left: string[];
  right: string[];
  handbrake: string[];
  shiftUp: string[];
  shiftDown: string[];
  ui: Record<UiAction, string[]>;
}

export const DEFAULT_KEYS: KeyBindings = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  shiftUp: ['KeyE'],
  shiftDown: ['KeyQ'],
  ui: {
    camera: ['KeyC'],
    reset: ['KeyR'],
    debug: ['F3', 'Backquote'],
    toggleAbs: ['Digit1'],
    toggleTc: ['Digit2'],
    toggleEsc: ['Digit3'],
    toggleGearbox: ['KeyM'],
    timeOfDay: ['KeyT'],
  },
};

/** Standard-mapping gamepad button indices. */
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9 };

export class InputManager {
  private readonly down = new Set<string>();
  private readonly uiQueue: UiAction[] = [];
  private pendingShiftUp = false;
  private pendingShiftDown = false;
  private readonly prevPadButtons: boolean[] = [];
  /** Last device used, for HUD prompts. */
  lastDevice: 'keyboard' | 'gamepad' = 'keyboard';

  constructor(private readonly keys: KeyBindings = DEFAULT_KEYS) {
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      if (this.isBound(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.lastDevice = 'keyboard';
      if (keys.shiftUp.includes(e.code)) this.pendingShiftUp = true;
      if (keys.shiftDown.includes(e.code)) this.pendingShiftDown = true;
      for (const [action, codes] of Object.entries(keys.ui) as [UiAction, string[]][]) {
        if (codes.includes(e.code)) this.uiQueue.push(action);
      }
    });
    window.addEventListener('keyup', e => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  private isBound(code: string): boolean {
    const k = this.keys;
    return [k.throttle, k.brake, k.left, k.right, k.handbrake, k.shiftUp, k.shiftDown, ...Object.values(k.ui)].some(l => l.includes(code));
  }

  private any(codes: string[]): boolean {
    return codes.some(c => this.down.has(c));
  }

  /** Drain one-shot UI actions since the last call. */
  drainUiActions(): UiAction[] {
    return this.uiQueue.splice(0);
  }

  /**
   * Current driving input. Shift requests are edge-triggered: they stay pending until a physics
   * step consumes them, so they're never lost on frames that run zero physics steps.
   */
  sampleDriver(): DriverInput {
    const k = this.keys;
    const inp = neutralInput();
    inp.throttle = this.any(k.throttle) ? 1 : 0;
    inp.brake = this.any(k.brake) ? 1 : 0;
    inp.steer = (this.any(k.right) ? 1 : 0) - (this.any(k.left) ? 1 : 0);
    inp.handbrake = this.any(k.handbrake) ? 1 : 0;

    const pad = navigator.getGamepads?.().find(p => p && p.connected && p.mapping === 'standard');
    if (pad) {
      const b = (i: number) => pad.buttons[i]?.value ?? 0;
      const pressed = (i: number) => pad.buttons[i]?.pressed ?? false;
      const edge = (i: number) => {
        const now = pressed(i);
        const was = this.prevPadButtons[i] ?? false;
        this.prevPadButtons[i] = now;
        return now && !was;
      };
      const stick = applyDeadzone(pad.axes[0] ?? 0, 0.12);
      const padActive = Math.abs(stick) > 0 || b(PAD.RT) > 0.05 || b(PAD.LT) > 0.05 || pressed(PAD.A);
      if (padActive) this.lastDevice = 'gamepad';
      // A mild response curve gives finer control near centre without losing full lock.
      inp.steer = clampUnit(inp.steer + Math.sign(stick) * Math.pow(Math.abs(stick), 1.6));
      inp.throttle = Math.max(inp.throttle, b(PAD.RT));
      inp.brake = Math.max(inp.brake, b(PAD.LT));
      inp.handbrake = Math.max(inp.handbrake, pressed(PAD.A) ? 1 : 0);
      if (edge(PAD.RB)) this.pendingShiftUp = true;
      if (edge(PAD.LB)) this.pendingShiftDown = true;
      if (edge(PAD.Y)) this.uiQueue.push('camera');
      if (edge(PAD.BACK)) this.uiQueue.push('reset');
      if (edge(PAD.X)) this.uiQueue.push('toggleGearbox');
    }

    inp.shiftUp = this.pendingShiftUp;
    inp.shiftDown = this.pendingShiftDown;
    return inp;
  }

  /** Call after a physics step has used the input, to clear one-shot shift requests. */
  consumeShifts(): void {
    this.pendingShiftUp = false;
    this.pendingShiftDown = false;
  }
}

function applyDeadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  return a < dz ? 0 : Math.sign(v) * ((a - dz) / (1 - dz));
}

const clampUnit = (v: number) => Math.max(-1, Math.min(1, v));
