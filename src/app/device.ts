// The computer on screen: its buttons (press, long press, pressed look), their tooltip (mouse only), and its scale.
// The device is re-rendered several times per second, so the pressed look and the tooltip are tracked
// by button id and re-applied after each render (decorateButtons).
import { ackAlertSounds } from './alertSounds';
import type { ButtonAction, ButtonHelp } from '../computers/base';
import { lang, t } from '../i18n';
import { refresh } from './render';
import { $, app, session } from './state';

const HOLD_MS = 700;
let pressed: { id: string; held: boolean; timer: number } | null = null;
let released: { id: string; until: number } | null = null;
let hoverBtn: string | null = null;

const isActive = (h: ButtonHelp | undefined) => !!h && (!!h.press?.simulated || !!h.hold?.simulated);

function tipHtml(id: string): string {
  const h = app.active.buttons()[id];
  const L = lang();
  if (!h) return `<div class="tip-off">${t('btnInactive')}</div>`;
  const line = (label: string, a: ButtonAction) =>
    `<div class="${a.simulated ? '' : 'tip-off'}"><b>${label} :</b> ${a.real[L]}${
      a.simulated ? (a.note ? ` <em>(${a.note[L]})</em>` : '') : ` <span class="tip-tag">${t('notSimulated')}</span>`
    }</div>`;
  return [
    `<div class="tip-name">${h.name}${isActive(h) ? '' : ` · <span class="tip-tag">${t('btnInactive')}</span>`}</div>`,
    h.press ? line(t('btnPress'), h.press) : '',
    h.hold ? line(t('btnHold'), h.hold) : '',
  ].join('');
}

function updateTip(): void {
  const tip = $('btn-tip');
  const id = hoverBtn; // mouse hover only: on a phone the tooltip would cover the whole computer
  const btn = id ? $('device').querySelector<HTMLElement>(`[data-btn="${id}"]`) : null;
  if (!id || !btn) {
    tip.hidden = true;
    return;
  }
  const html = tipHtml(id);
  if (tip.innerHTML !== html) tip.innerHTML = html;
  tip.hidden = false;
  // Beside the button, inside the device panel.
  const panel = tip.parentElement!.getBoundingClientRect();
  const r = btn.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const cx = r.left + r.width / 2 - panel.left;
  const below = r.top + r.height / 2 - panel.top < panel.height / 2;
  const top = below ? r.bottom - panel.top + 8 : r.top - panel.top - h - 8;
  tip.style.left = `${Math.max(6, Math.min(panel.width - w - 6, cx - w / 2))}px`;
  tip.style.top = `${Math.max(6, Math.min(panel.height - h - 6, top))}px`;
}

export function decorateButtons(): void {
  const help = app.active.buttons();
  const now = performance.now();
  $('device').querySelectorAll<HTMLElement>('[data-btn]').forEach((b) => {
    const id = b.dataset.btn!;
    b.classList.toggle('inactive', !isActive(help[id]));
    b.classList.toggle('pressed', pressed?.id === id || (released?.id === id && now < released.until));
    b.setAttribute('aria-label', help[id]?.name ?? id);
  });
  updateTip();
}

function releaseButton(): void {
  if (!pressed) return;
  const p = pressed;
  window.clearTimeout(p.timer);
  pressed = null;
  if (app.active.buttons()[p.id]?.hold?.simulated && !p.held) app.active.press(p.id, session);
  released = { id: p.id, until: performance.now() + 120 };
  refresh();
  window.setTimeout(decorateButtons, 140);
}

/** Scales the device to the space available in its panel. */
export function fitDevice(): void {
  const host = $('device');
  const dev = host.firstElementChild as HTMLElement | null;
  if (!dev) return;
  const w = dev.offsetWidth;
  const h = dev.offsetHeight;
  if (!w || !h) return;
  const scale = Math.min((host.clientWidth - 8) / w, (host.clientHeight - 8) / h, 1.5);
  host.style.setProperty('--dev-scale', String(Math.max(0.3, scale)));
}

export function setupDevice(): void {
  $('device').addEventListener('pointerdown', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-btn]');
    if (!btn) return;
    e.preventDefault();
    const id = btn.dataset.btn!;
    ackAlertSounds(id); // alerts waiting for a button press stop repeating
    // Phones: the "tap a button" hint is dropped once the buttons have been found.
    document.body.classList.add('dev-used');
    // Buttons with a simulated long press act on release (or after HOLD_MS); the others at once.
    const holdable = !!app.active.buttons()[id]?.hold?.simulated;
    pressed = { id, held: false, timer: 0 };
    if (holdable) {
      pressed.timer = window.setTimeout(() => {
        if (pressed?.id !== id) return;
        pressed.held = true;
        app.active.hold(id, session);
        refresh();
      }, HOLD_MS);
    } else {
      app.active.press(id, session);
    }
    refresh();
  });
  window.addEventListener('pointerup', releaseButton);
  window.addEventListener('pointercancel', releaseButton);

  $('device').addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-btn]')?.dataset.btn ?? null;
    if (id !== hoverBtn) {
      hoverBtn = id;
      updateTip();
    }
  });
  $('device').addEventListener('pointerleave', () => {
    hoverBtn = null;
    updateTip();
  });

  new ResizeObserver(() => fitDevice()).observe($('device'));
}
