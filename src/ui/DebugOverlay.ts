import { DEG, MS_TO_KMH } from '../core/math';
import { SURFACES } from '../physics/surfaces';
import { WHEEL_NAMES, type Vehicle } from '../vehicles/Vehicle';

/**
 * Tuning overlay (toggle: F3 or `). Per wheel: load, slip ratio, slip angle, grip used,
 * suspension compression, surface, wheel speed, drive/brake torque, plus a live friction-circle
 * plot showing where each tire sits relative to its grip limit.
 */
export class DebugOverlay {
  readonly el: HTMLDivElement;
  private readonly text: HTMLPreElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  visible = false;
  private textTimer = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'debug-overlay';
    this.el.hidden = true;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2 * 150;
    this.canvas.height = 2 * 150;
    this.canvas.className = 'debug-circles';
    this.text = document.createElement('pre');
    this.el.append(this.canvas, this.text);
    parent.appendChild(this.el);
    this.ctx = this.canvas.getContext('2d')!;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
  }

  update(v: Vehicle, dt: number, stats: { fps: number; physicsMs: number; drawCalls?: number; triangles?: number; quality?: string }): void {
    if (!this.visible) return;
    this.drawCircles(v);
    this.textTimer -= dt;
    if (this.textTimer > 0) return;
    this.textTimer = 0.1;

    const pt = v.powertrain;
    const f = (n: number, d = 0, w = 7) => n.toFixed(d).padStart(w);
    const on = (b: boolean) => (b ? 'ON ' : 'off');
    const act = (b: boolean) => (b ? '●' : ' ');
    const bar = (x: number, n = 10) => '█'.repeat(Math.round(Math.max(0, Math.min(1, x)) * n)).padEnd(n, '·');

    let s = '';
    s += `${v.config.name}  [${v.config.drivetrain.layout}]\n`;
    s += `speed ${f(v.speed * MS_TO_KMH, 1)} km/h   fwd ${f(v.forwardSpeed, 2)} m/s\n`;
    s += `rpm   ${f(pt.rpm)}   gear ${pt.gear < 0 ? 'R' : pt.gear === 0 ? 'N' : pt.gear} ${pt.automatic ? '(auto)' : '(manual)'}  clutch ${pt.clutchLocked ? 'locked' : 'slip  '}${pt.isShifting ? ' SHIFT' : ''}\n`;
    s += `thr  ${bar(v.appliedThrottle)}  brk ${bar(v.appliedBrake)}  hb ${bar(v.appliedHandbrake, 4)}\n`;
    s += `steer ${f(v.steerInput, 2, 6)}  δ ${f(((v.wheels[0].steerAngle + v.wheels[1].steerAngle) / 2) / DEG, 1, 6)}°\n`;
    s += `g long ${f(v.accelG.long, 2, 6)}  lat ${f(v.accelG.lat, 2, 6)}   β ${f(v.bodySlip / DEG, 1, 6)}°  yaw ${f(v.yawRate, 2, 6)}\n`;
    s += `ABS ${on(v.aids.abs)}${act(v.aidsActive.abs)}  TC ${on(v.aids.tc)}${act(v.aidsActive.tc)}  ESC ${on(v.aids.esc)}${act(v.aidsActive.esc)}\n\n`;
    s += 'wheel   load N  slipR  slipα°  grip  comp  ω rad/s  drive  brake  surface\n';
    v.wheels.forEach((w, i) => {
      const comp = w.compression / w.susp.maxCompression;
      s += `${WHEEL_NAMES[i]}   ${f(w.load, 0, 7)} ${f(w.slipRatio, 2, 6)} ${f(w.slipAngle / DEG, 1, 7)}  ${f(w.gripUsed * 100, 0, 3)}%  ${f(comp * 100, 0, 3)}% ${f(w.omega, 1, 8)} ${f(w.driveTorque, 0, 6)} ${f(w.brakeTorque, 0, 6)}  ${w.grounded ? SURFACES[w.surface].name : 'AIR'}${w.absFactor < 0.95 ? ' ABS' : ''}\n`;
    });
    s += `\nfps ${f(stats.fps, 0, 4)}   physics ${stats.physicsMs.toFixed(2)} ms/frame`;
    if (stats.drawCalls !== undefined) {
      s += `\ndraw calls ${stats.drawCalls}   triangles ${((stats.triangles ?? 0) / 1000).toFixed(0)}k   graphics ${stats.quality}`;
    }
    this.text.textContent = s;
  }

  /** Friction ellipse per wheel: unit circle = available grip, dot = (lateral, longitudinal) force. */
  private drawCircles(v: Vehicle): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const cell = W / 2;
    ctx.clearRect(0, 0, W, W);
    v.wheels.forEach((w, i) => {
      const cx = (i % 2) * cell + cell / 2;
      const cy = Math.floor(i / 2) * cell + cell / 2;
      const r = cell * 0.4;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '20px monospace';
      ctx.fillText(WHEEL_NAMES[i], cx - r, cy - r + 4);
      if (!w.grounded || w.load <= 0) return;
      const mx = w.tire.muLong * w.load, my = w.tire.muLat * w.load;
      const x = cx + (w.fy / my) * r;
      const y = cy - (w.fx / mx) * r; // up = drive force
      const used = w.gripUsed;
      ctx.fillStyle = w.combinedSlip > 1.05 ? '#ff4040' : used > 0.85 ? '#ffc040' : '#40ff90';
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
    });
  }
}
