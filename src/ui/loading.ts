/** The full-screen loading overlay defined in index.html, reusable between scenes. */
const el = () => document.getElementById('loading')!;

export function showLoading(status = 'Loading…'): void {
  const l = el();
  l.classList.remove('done');
  l.style.display = '';
  setProgress(0, status);
}

export function setProgress(frac: number, status: string): void {
  const l = el();
  (l.querySelector('.fill') as HTMLElement).style.width = `${Math.round(frac * 100)}%`;
  l.querySelector('.status')!.textContent = status;
}

export function hideLoading(): void {
  const l = el();
  l.classList.add('done');
  setTimeout(() => { if (l.classList.contains('done')) l.style.display = 'none'; }, 450);
}

/** Yield to the browser so the loading bar repaints between heavy steps. */
export const nextFrame = () => new Promise<void>(r => setTimeout(r, 0));
