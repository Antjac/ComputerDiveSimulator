// Driving the dive: vertical speed, 2D / 3D view, time speed, pause, surface interval, reset,
// keyboard shortcuts.
import { t } from '../i18n';
import type { Environment } from '../ui/scene3d';
import { renderLog } from './logbook';
import { advance } from './loop';
import { SPEEDS } from './options';
import { savePrefs } from './prefs';
import { refresh } from './render';
import { resetRescue } from './rescue';
import { renderControls } from './settings';
import { $, app, computers, session } from './state';

let hintShown = false;

/** 2D water column / 3D view. Three.js is only loaded when the 3D view is first shown. */
export async function setView(v: '2d' | '3d'): Promise<void> {
  if (v === '3d' && !app.scene3d) {
    try {
      const { Scene3D } = await import('../ui/scene3d');
      const scene3d = (app.scene3d = new Scene3D($<HTMLCanvasElement>('scene3d'), session));
      scene3d.environment = app.env;
      scene3d.onInteract = () => {
        hintShown = true;
        $('scene-hint').hidden = true;
      };
    } catch (err) {
      console.warn(err);
      $('hud-state').textContent = t('view3dError');
      v = '2d';
    }
  }
  app.view = v;
  $('scene').hidden = v === '3d';
  $('scene3d').hidden = v === '2d';
  $('env-select').hidden = v === '2d';
  $('scene-hint').hidden = v === '2d' || hintShown;
  $('turn-ctl').hidden = v === '2d';
  // Only the 3D view has a seabed under the diver.
  if (v === '2d') session.seabed = Infinity;
  savePrefs();
  renderControls();
}

/** Full reset: fresh tissues and logbook, computers unlocked. */
export function resetAll(): void {
  session.reset();
  resetRescue();
  for (const c of computers) {
    c.locked = false;
    c.onDiveStart(session);
  }
  app.selectedLog = -1;
  renderLog();
  renderControls();
  refresh(true);
}

export function setupDiveControls(): void {
  // Vertical speed controls: each step changes the speed by 1 m/min (▲ = faster up / slower down).
  // Keeping a button pressed repeats the step.
  let rateRepeat = 0;
  const stopRateRepeat = () => window.clearTimeout(rateRepeat);
  document.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((b) => {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const step = Number(b.dataset.move);
      const repeat = (delay: number) => {
        session.nudgeRate(step);
        rateRepeat = window.setTimeout(() => repeat(120), delay);
      };
      stopRateRepeat();
      repeat(400);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stopRateRepeat);
  });
  document.querySelector('[data-stop]')!.addEventListener('click', () => session.setRate(0));
  document.querySelectorAll<HTMLButtonElement>('[data-turn]').forEach((b) =>
    b.addEventListener('click', () => app.scene3d?.steer(Number(b.dataset.turn), Math.PI / 4)),
  );

  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
    b.addEventListener('click', () => void setView(b.dataset.view as '2d' | '3d')),
  );

  $('env-select').addEventListener('change', (e) => {
    app.env = (e.target as HTMLSelectElement).value as Environment;
    if (app.scene3d) app.scene3d.environment = app.env;
    savePrefs();
  });

  $('speed-group').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-speed]');
    if (!b) return;
    app.speed = Number(b.dataset.speed);
    renderControls();
  });

  $('btn-pause').addEventListener('click', () => {
    app.paused = !app.paused;
    renderControls();
  });

  $('btn-skip').addEventListener('click', () => {
    if (session.inDive) return;
    advance(3600, 5);
    refresh(true);
  });

  $('btn-reset').addEventListener('click', resetAll);

  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'SELECT') return;
    if (e.key === 'ArrowDown') session.nudgeRate(1);
    else if (e.key === 'ArrowUp') session.nudgeRate(-1);
    else if (e.key === '0' || e.key === 'Enter') session.setRate(0);
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && app.view === '3d' && app.scene3d) app.scene3d.steer(e.key === 'ArrowLeft' ? -1 : 1);
    else if (e.key === ' ') {
      if (session.emergency) return;
      app.paused = !app.paused;
      renderControls();
    } else if (e.key === '+' || e.key === '=' || e.key === '-') {
      const i = SPEEDS.indexOf(app.speed) + (e.key === '-' ? -1 : 1);
      app.speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i))];
      renderControls();
    } else return;
    e.preventDefault();
  });
}
