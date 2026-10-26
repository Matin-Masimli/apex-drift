import type { Difficulty } from '../ai/AIDriver';
import type { GameMode } from '../game/DriveSession';
import { loadGhost } from '../game/Ghost';
import { formatTime } from './LapHud';

const STORAGE_KEY = 'apexdrift.mode';

interface Settings {
  kind: GameMode['kind'];
  opponents: number;
  difficulty: Difficulty;
  laps: number;
  rubberBand: boolean;
  field: 'same' | 'mixed';
}

const DEFAULTS: Settings = { kind: 'race', opponents: 5, difficulty: 'medium', laps: 3, rubberBand: false, field: 'same' };

/** Mode select panel shown over the garage: Quick Race (with options), Time Trial, Free Practice. */
export class ModeSelect {
  onStart: (mode: GameMode) => void = () => {};
  onCancel: () => void = () => {};
  private readonly el: HTMLDivElement;
  private s: Settings;
  private readonly keys = (e: KeyboardEvent) => {
    if (e.code === 'Escape') { e.preventDefault(); this.close(); this.onCancel(); }
    else if (e.code === 'Enter') { e.preventDefault(); this.start(); }
  };

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'overlay mode-select';
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.s = { ...DEFAULTS };
    try { Object.assign(this.s, JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')); } catch { /* defaults */ }
  }

  get open(): boolean { return !this.el.hidden; }

  show(carId: string, carName: string): void {
    const ghost = loadGhost('kestrel-valley', carId);
    this.render(carName, ghost ? formatTime(ghost.lapTime) : null);
    this.el.hidden = false;
    window.addEventListener('keydown', this.keys);
  }

  close(): void {
    this.el.hidden = true;
    window.removeEventListener('keydown', this.keys);
  }

  private start(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.s)); } catch { /* ignore */ }
    const s = this.s;
    const mode: GameMode = s.kind === 'race'
      ? { kind: 'race', opponents: s.opponents, difficulty: s.difficulty, laps: s.laps, rubberBand: s.rubberBand, field: s.field }
      : { kind: s.kind };
    this.close();
    this.onStart(mode);
  }

  private render(carName: string, ghostTime: string | null): void {
    const s = this.s;
    const card = (kind: Settings['kind'], title: string, desc: string) =>
      `<button class="mode-card${s.kind === kind ? ' selected' : ''}" data-kind="${kind}"><b>${title}</b><span>${desc}</span></button>`;
    const seg = <T extends string | number | boolean>(name: string, options: [T, string][], value: T) =>
      `<div class="seg" data-name="${name}">${options.map(([v, l]) => `<button data-value="${String(v)}" class="${v === value ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    this.el.innerHTML = `
      <div class="panel mode-panel">
        <h2>Choose a mode <small>${carName}</small></h2>
        <div class="mode-cards">
          ${card('race', 'Quick Race', 'Race AI opponents from the back of the grid')}
          ${card('timeTrial', 'Time Trial', ghostTime ? `Beat your ghost: ${ghostTime}` : 'Set a lap and race your ghost')}
          ${card('practice', 'Free Practice', 'Open track, lap timing, no opponents')}
        </div>
        <div class="race-options" ${s.kind === 'race' ? '' : 'hidden'}>
          <label>Opponents ${seg('opponents', [[3, '3'], [4, '4'], [5, '5'], [6, '6'], [7, '7']], s.opponents)}</label>
          <label>Difficulty ${seg('difficulty', [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], s.difficulty)}</label>
          <label>Laps ${seg('laps', [[1, '1'], [2, '2'], [3, '3'], [5, '5'], [10, '10']], s.laps)}</label>
          <label>Field ${seg('field', [['same', 'Same car'], ['mixed', 'Mixed classes']], s.field)}</label>
          <label>Catch-up ${seg('rubberBand', [[false, 'Off'], [true, 'On']], s.rubberBand)}</label>
        </div>
        <div class="actions"><button class="primary start">Start ▶</button><button class="back">Back</button></div>
      </div>`;
    this.el.querySelectorAll<HTMLButtonElement>('.mode-card').forEach(b => b.addEventListener('click', () => {
      this.s.kind = b.dataset.kind as Settings['kind'];
      this.render(carName, ghostTime);
    }));
    this.el.querySelectorAll<HTMLDivElement>('.seg').forEach(seg => seg.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.addEventListener('click', () => {
      const name = seg.dataset.name as keyof Settings;
      const raw = b.dataset.value!;
      const value = raw === 'true' ? true : raw === 'false' ? false : /^\d+$/.test(raw) ? Number(raw) : raw;
      (this.s as unknown as Record<string, unknown>)[name] = value;
      this.render(carName, ghostTime);
    })));
    this.el.querySelector('.start')!.addEventListener('click', () => this.start());
    this.el.querySelector('.back')!.addEventListener('click', () => { this.close(); this.onCancel(); });
  }
}
