import { MS_TO_KMH } from '../core/math';
import type { Vehicle } from '../vehicles/Vehicle';

/** Minimal M1 HUD: speed, gear, rev bar with shift light, aid indicators. M6 replaces the styling. */
export class Hud {
  private readonly el: HTMLDivElement;
  private readonly speed: HTMLDivElement;
  private readonly gear: HTMLDivElement;
  private readonly revFill: HTMLDivElement;
  private readonly aids: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-rev"><div class="hud-rev-fill"></div></div>
      <div class="hud-row"><div class="hud-speed">0</div><div class="hud-unit">km/h</div><div class="hud-gear">N</div></div>
      <div class="hud-aids"></div>`;
    parent.appendChild(this.el);
    this.speed = this.el.querySelector('.hud-speed')!;
    this.gear = this.el.querySelector('.hud-gear')!;
    this.revFill = this.el.querySelector('.hud-rev-fill')!;
    this.aids = this.el.querySelector('.hud-aids')!;
  }

  update(v: Vehicle): void {
    const e = v.config.engine;
    const pt = v.powertrain;
    this.speed.textContent = Math.round(Math.abs(v.forwardSpeed) * MS_TO_KMH).toString();
    this.gear.textContent = pt.gear < 0 ? 'R' : pt.gear === 0 ? 'N' : String(pt.gear);
    this.gear.classList.toggle('manual', !pt.automatic);
    const frac = Math.min(1, pt.rpm / e.limiterRpm);
    this.revFill.style.width = `${frac * 100}%`;
    this.revFill.classList.toggle('shift', pt.rpm > e.redlineRpm * 0.96);
    const tag = (name: string, enabled: boolean, active: boolean) =>
      `<span class="aid ${enabled ? 'on' : 'off'} ${active ? 'active' : ''}">${name}</span>`;
    this.aids.innerHTML =
      tag('ABS', v.aids.abs, v.aidsActive.abs) + tag('TC', v.aids.tc, v.aidsActive.tc) + tag('ESC', v.aids.esc, v.aidsActive.esc) +
      `<span class="aid on">${pt.automatic ? 'AUTO' : 'MAN'}</span>`;
  }
}
