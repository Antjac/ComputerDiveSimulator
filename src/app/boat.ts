// Boat at the surface: BOAT_DELAY s after surfacing during a dive, with the tank below BOAT_MAX_FILL
// (or after the dive, until the next descent), a boat comes alongside and offers a full tank. Yes:
// the diver climbs aboard, the dive ends and the tank is refilled (session.boardBoat), so the next
// descent is a new dive. No: it leaves. It also leaves if the diver goes back down. Offered once per
// surfacing.
import { DIVE_START_DEPTH } from '../engine/session';
import { t } from '../i18n';
import { pressText, pressUnit } from '../units';
import { refresh, scene } from './render';
import { $, app, session } from './state';

const BOAT_DELAY = 5; // s at the surface (simulated time)
const BOAT_MAX_FILL = 0.9;
let boat: 'away' | 'ask' | 'reply' = 'away';
let boatAsked = false;
let boatTimer = 0;

const tankText = () => `${pressText(session.tankPressure)} ${pressUnit()}`;

function setBoat(state: typeof boat, text = ''): void {
  boat = state;
  scene.boatWanted = state !== 'away';
  if (app.scene3d) app.scene3d.boatWanted = scene.boatWanted;
  clearTimeout(boatTimer);
  if (state === 'reply') boatTimer = window.setTimeout(() => setBoat('away'), 2600);
  $('boat-text').textContent = text;
  $('boat-note').hidden = $('boat-btns').hidden = state !== 'ask';
}

export function updateBoat(): void {
  const s = session;
  const underwater = s.depth >= DIVE_START_DEPTH;
  if (underwater) boatAsked = false;
  // Gone back down, rescue alert, or reset.
  if (boat === 'ask' && (underwater || s.emergency || (!s.inDive && s.lastDiveEnd === null))) setBoat('away');
  // At the surface during a dive, or after one (the dive may have been closed between two checks at
  // high time speeds).
  const surfaced = s.inDive ? s.surfaceTimer >= BOAT_DELAY : s.lastDiveEnd !== null;
  if (boat === 'away' && !boatAsked && !underwater && surfaced && !s.emergency && s.tankPressure < s.tank.fill * BOAT_MAX_FILL) {
    boatAsked = true;
    setBoat('ask');
  }
  if (boat === 'ask') $('boat-text').textContent = t('boatAsk').replace('{p}', tankText());
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
}
