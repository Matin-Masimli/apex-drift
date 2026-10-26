import { formatTime } from './LapHud';

export interface StandingRow {
  name: string;
  color: string;
  player: boolean;
  /** Text shown in the gap column ("Leader", "+1.234", "+1 lap", or a finish time). */
  gap: string;
  finished: boolean;
}

/** Race position, lap counter and the standings tower. */
export class RaceHud {
  private readonly pos: HTMLDivElement;
  private readonly tower: HTMLDivElement;
  readonly elements: HTMLElement[];

  constructor(parent: HTMLElement) {
    this.pos = document.createElement('div');
    this.pos.className = 'race-pos';
    this.tower = document.createElement('div');
    this.tower.className = 'tower';
    parent.append(this.pos, this.tower);
    this.elements = [this.pos, this.tower];
  }

  update(position: number, count: number, lap: number, laps: number, rows: StandingRow[]): void {
    this.pos.innerHTML = `<div class="p"><small>POS</small><b>${position}</b><span>/${count}</span></div>` +
      `<div class="l"><small>LAP</small><b>${Math.min(lap, laps)}</b><span>/${laps}</span></div>`;
    this.tower.innerHTML = rows.map((r, i) =>
      `<div class="row${r.player ? ' me' : ''}${r.finished ? ' fin' : ''}"><i>${i + 1}</i><s style="background:${r.color}"></s><span>${r.name}</span><em>${r.gap}</em></div>`,
    ).join('');
  }
}

/** Live time-trial delta against the ghost. */
export class DeltaHud {
  readonly element: HTMLDivElement;
  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'delta';
    parent.appendChild(this.element);
  }
  update(delta: number | null, ghostTime: number | null): void {
    if (ghostTime === null) { this.element.innerHTML = '<small>No ghost yet: set a clean lap</small>'; return; }
    const d = delta === null ? '' : `${delta <= 0 ? '−' : '+'}${Math.abs(delta).toFixed(2)}`;
    this.element.className = `delta ${delta === null ? '' : delta <= 0 ? 'ahead' : 'behind'}`;
    this.element.innerHTML = `<b>${d}</b><small>ghost ${formatTime(ghostTime)}</small>`;
  }
}

export interface ResultRow { name: string; car: string; color: string; time: string; best: string; player: boolean }

/** Modal panels: pause menu and race results. Buttons map to callbacks. */
export class MenuOverlay {
  readonly element: HTMLDivElement;
  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'overlay';
    this.element.hidden = true;
    parent.appendChild(this.element);
  }

  get open(): boolean { return !this.element.hidden; }

  hide(): void { this.element.hidden = true; }

  showPause(actions: { label: string; run: () => void }[]): void {
    this.render('<h2>Paused</h2>', actions);
  }

  showResults(title: string, rows: ResultRow[], actions: { label: string; run: () => void }[]): void {
    const table = `<table class="results"><thead><tr><th></th><th>Driver</th><th>Car</th><th>Time</th><th>Best lap</th></tr></thead><tbody>` +
      rows.map((r, i) => `<tr class="${r.player ? 'me' : ''}"><td>${i + 1}</td><td><s style="background:${r.color}"></s>${r.name}</td><td>${r.car}</td><td>${r.time}</td><td>${r.best}</td></tr>`).join('') +
      '</tbody></table>';
    this.render(`<h2>${title}</h2>${table}`, actions, 'results-panel');
  }

  private render(html: string, actions: { label: string; run: () => void }[], cls = ''): void {
    this.element.innerHTML = `<div class="panel ${cls}">${html}<div class="actions"></div></div>`;
    const bar = this.element.querySelector('.actions')!;
    actions.forEach((a, i) => {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (i === 0) b.className = 'primary';
      b.addEventListener('click', a.run);
      bar.appendChild(b);
    });
    this.element.hidden = false;
    (bar.querySelector('button') as HTMLButtonElement | null)?.focus();
  }
}
