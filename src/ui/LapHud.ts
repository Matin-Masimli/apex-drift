import type { LapEvent, LapTimer } from '../tracks/LapTimer';
import type { Track } from '../tracks/Track';

export const formatTime = (t: number | null): string => {
  if (t === null || !Number.isFinite(t)) return '–:––.–––';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};

/**
 * Lap timing panel (current/last/best, sector boxes coloured by delta), a centre-screen message
 * toast, and a minimap drawn from the track centreline.
 */
export class LapHud {
  private readonly el: HTMLDivElement;
  private readonly lapEl: HTMLElement;
  private readonly curEl: HTMLElement;
  private readonly lastEl: HTMLElement;
  private readonly bestEl: HTMLElement;
  private readonly sectorEls: HTMLElement[] = [];
  private readonly toastEl: HTMLDivElement;
  private toastTimer = 0;
  private readonly map: HTMLCanvasElement;
  private readonly mapCtx: CanvasRenderingContext2D;
  private readonly mapPath: Path2D;
  private readonly mapXform: { sx: number; ox: number; oz: number };

  constructor(parent: HTMLElement, private readonly track: Track, private readonly timer: LapTimer) {
    this.el = document.createElement('div');
    this.el.className = 'lap-hud';
    const sectorCount = track.sectorOffsets.length + 1;
    this.el.innerHTML = `
      <div class="lap-row"><span class="lap-label">LAP</span><span class="lap-num">–</span><span class="lap-invalid" hidden>INVALID</span></div>
      <div class="lap-cur">0:00.000</div>
      <div class="lap-sectors">${Array.from({ length: sectorCount }, (_, i) => `<div class="sector">S${i + 1}<b>–</b></div>`).join('')}</div>
      <div class="lap-row small"><span>LAST</span><span class="lap-last">–</span></div>
      <div class="lap-row small"><span>BEST</span><span class="lap-best">–</span></div>`;
    parent.appendChild(this.el);
    this.lapEl = this.el.querySelector('.lap-num')!;
    this.curEl = this.el.querySelector('.lap-cur')!;
    this.lastEl = this.el.querySelector('.lap-last')!;
    this.bestEl = this.el.querySelector('.lap-best')!;
    this.el.querySelectorAll<HTMLElement>('.sector').forEach(e => this.sectorEls.push(e));

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    parent.appendChild(this.toastEl);

    // Minimap: fit the centreline into the canvas, with north up.
    this.map = document.createElement('canvas');
    this.map.className = 'minimap';
    this.map.width = this.map.height = 360;
    parent.appendChild(this.map);
    this.mapCtx = this.map.getContext('2d')!;
    const xs = track.line.samples.map(s => s.pos.x), zs = track.line.samples.map(s => s.pos.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const sx = (this.map.width - 40) / Math.max(maxX - minX, maxZ - minZ);
    this.mapXform = { sx, ox: 20 - minX * sx + (this.map.width - 40 - (maxX - minX) * sx) / 2, oz: 20 - minZ * sx + (this.map.height - 40 - (maxZ - minZ) * sx) / 2 };
    this.mapPath = new Path2D();
    track.line.samples.forEach((s, i) => {
      const [x, y] = this.toMap(s.pos.x, s.pos.z);
      if (i === 0) this.mapPath.moveTo(x, y); else this.mapPath.lineTo(x, y);
    });
    this.mapPath.closePath();
  }

  private toMap(x: number, z: number): [number, number] {
    return [x * this.mapXform.sx + this.mapXform.ox, z * this.mapXform.sx + this.mapXform.oz];
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' | 'best' = 'info', seconds = 2.5): void {
    this.toastEl.textContent = text;
    this.toastEl.className = `toast show ${kind}`;
    this.toastTimer = seconds;
  }

  onEvents(events: LapEvent[]): void {
    for (const e of events) {
      if (e.type === 'lap') {
        if (!e.valid) this.toast(`Lap ${formatTime(e.lapTime)}  (invalid)`, 'bad');
        else if (e.best) this.toast(`Best lap ${formatTime(e.lapTime)}`, 'best', 3.5);
        else this.toast(`Lap ${formatTime(e.lapTime)}`, 'info');
      } else if (e.type === 'invalidated') this.toast('Track limits: lap invalidated', 'bad');
      else if (e.type === 'wrongWay') this.toast('WRONG WAY', 'bad', 1.5);
      else if (e.type === 'sector') {
        const el = this.sectorEls[e.index];
        const b = el.querySelector('b')!;
        b.textContent = e.delta === null ? formatTime(e.time).slice(2) : `${e.delta >= 0 ? '+' : '−'}${Math.abs(e.delta).toFixed(3)}`;
        el.className = `sector ${e.delta === null ? 'done' : e.delta <= 0 ? 'faster' : 'slower'}`;
      } else if (e.type === 'lapStart') {
        for (const el of this.sectorEls) { el.className = 'sector'; el.querySelector('b')!.textContent = '–'; }
      }
    }
  }

  update(dt: number, cars: { x: number; z: number; color: string; player?: boolean }[]): void {
    const t = this.timer;
    this.lapEl.textContent = t.lapRunning ? String(t.lapsCompleted + 1) : '–';
    this.curEl.textContent = t.lapRunning ? formatTime(t.currentLapTime) : 'OUT LAP';
    this.lastEl.textContent = formatTime(t.lastLapTime);
    this.bestEl.textContent = formatTime(t.bestLapTime);
    (this.el.querySelector('.lap-invalid') as HTMLElement).hidden = t.valid || !t.lapRunning;
    const curSector = t.sector;
    this.sectorEls.forEach((el, i) => el.classList.toggle('current', t.lapRunning && i === curSector));

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }

    // Minimap.
    const ctx = this.mapCtx;
    ctx.clearRect(0, 0, this.map.width, this.map.height);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 14;
    ctx.stroke(this.mapPath);
    ctx.strokeStyle = 'rgba(240,240,235,0.9)';
    ctx.lineWidth = 6;
    ctx.stroke(this.mapPath);
    // Start line tick.
    const st = this.track.line.sampleAt(this.track.startS);
    const [sx, sy] = this.toMap(st.pos.x, st.pos.z);
    ctx.fillStyle = '#ff5a1f';
    ctx.fillRect(sx - 9, sy - 2, 18, 4);
    for (const c of cars) {
      const [x, y] = this.toMap(c.x, c.z);
      ctx.fillStyle = c.color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, c.player ? 8 : 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}
