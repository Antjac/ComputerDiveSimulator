// Boat at the surface: BOAT_DELAY s after surfacing during a dive, with the tank below BOAT_MAX_FILL
// (or after the dive, until the next descent), a boat comes alongside and offers a full tank. Yes:
// the diver climbs aboard, the dive ends and the tank is refilled (session.boardBoat), so the next
// descent is a new dive. No: it leaves. It also leaves if the diver goes back down. Offered once per
// surfacing. After an ascent judged too fast (session.rapidAscent, the rescue alert's criterion),
// it comes whatever the tank and first says so: the diver should start the procedure of their
// training (a teaching reminder, the procedures differ between agencies).
import { DIVE_START_DEPTH } from '../engine/session';
import type { RapidAscent } from '../engine/session';
import { t } from '../i18n';
import { pressText, pressUnit } from '../units';
import { refresh, scene } from './render';
import { fillRapid } from './rescue';
import { $, app, session } from './state';

const BOAT_DELAY = 5; // s at the surface (simulated time)
const BOAT_MAX_FILL = 0.9;
/** ask: tank offered (after the rapid ascent warning, if any); warn: only the warning (tank still full). */
let boat: 'away' | 'ask' | 'warn' | 'reply' = 'away';
let boatAsked = false;
/** Rapid ascent reported by the boat now alongside. */
let rapid: RapidAscent | null = null;
let boatTimer = 0;

const tankText = () => `${pressText(session.tankPressure)} ${pressUnit()}`;

function setBoat(state: typeof boat, text = ''): void {
  boat = state;
  scene.boatWanted = state !== 'away';
  if (app.scene3d) app.scene3d.boatWanted = scene.boatWanted;
  clearTimeout(boatTimer);
  if (state === 'reply') boatTimer = window.setTimeout(() => setBoat('away'), 2600);
  if (state === 'away' || state === 'reply') rapid = null;
  $('boat-text').textContent = text;
  $('boat-note').hidden = $('boat-btns').hidden = state !== 'ask';
  $('boat-ok-btns').hidden = state !== 'warn';
  renderBoatText();
}

/** Texts of the boat alongside (again at each refresh: the language or the units may change). */
function renderBoatText(): void {
  const warn = $('boat-warn');
  warn.hidden = !rapid;
  if (rapid) warn.textContent = fillRapid(t('boatRapid'), rapid);
  if (boat === 'ask') $('boat-text').textContent = t('boatAsk').replace('{p}', tankText());
  $('boat-text').hidden = boat === 'warn';
}

export function updateBoat(): void {
  const s = session;
  const underwater = s.depth >= DIVE_START_DEPTH;
  if (underwater) boatAsked = false;
  // Gone back down, rescue alert, or reset.
  if ((boat === 'ask' || boat === 'warn') && (underwater || s.emergency || (!s.inDive && s.lastDiveEnd === null))) setBoat('away');
  // At the surface during a dive, or after one (the dive may have been closed between two checks at
  // high time speeds).
  const surfaced = s.inDive ? s.surfaceTimer >= BOAT_DELAY : s.lastDiveEnd !== null;
  const offer = s.tankPressure < s.tank.fill * BOAT_MAX_FILL;
  if (boat === 'away' && !boatAsked && !underwater && surfaced && !s.emergency && (offer || s.rapidAscent)) {
    boatAsked = true;
    rapid = s.rapidAscent;
    setBoat(offer ? 'ask' : 'warn');
  }
  if (boat === 'ask' || boat === 'warn') renderBoatText();
  if (app.scene3d) app.scene3d.boatWanted = scene.boatWanted; // the 3D view may have been opened since
}

/** The speech bubble points at the boat once it is alongside: above it if there is room, else below. */
export function placeBoatBubble(): void {
  const el = $('boat-offer');
  const a = boat === 'away' ? null : app.view === '3d' && app.scene3d ? app.scene3d.boatAnchor() : scene.boatAnchor();
  el.hidden = !a;
  if (!a) return;
  const pr = $('scene-panel').getBoundingClientRect();
  const cr = $(app.view === '3d' ? 'scene3d' : 'scene').getBoundingClientRect();
  const ax = cr.left - pr.left + a.x;
  const top = cr.top - pr.top + a.top;
  const bottom = cr.top - pr.top + a.bottom;
  const bw = el.offsetWidth;
  const bh = el.offsetHeight;
  const below = top - 14 - bh < 8;
  let y = below ? bottom + 14 : top - 14 - bh;
  // Short water column (phones): no room above or below, the bubble stays whole, without its tail.
  const fits = y + bh <= pr.height - 8;
  if (!fits) y = Math.max(8, pr.height - bh - 8);
  const x = Math.max(8, Math.min(ax - bw * 0.65, pr.width - bw - 8));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.setProperty('--tail', `${Math.max(14, Math.min(ax - x, bw - 14))}px`);
  el.classList.toggle('above', !below);
  el.classList.toggle('no-tail', !fits);
}

export function setupBoat(): void {
  $('boat-yes').addEventListener('click', () => {
    session.boardBoat();
    setBoat('reply', t('boatYesReply').replace('{p}', tankText()));
    refresh(true);
  });
  $('boat-no').addEventListener('click', () => setBoat('reply', t('boatNoReply')));
  $('boat-ok').addEventListener('click', () => setBoat('away'));
}
