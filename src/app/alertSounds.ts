// Alarm sounds of the active computer: plays each alert cue (see DiveComputer.alertCues) when it
// appears, repeats it as its manual describes (while the condition lasts, or until a button of the
// computer is pressed), and shakes the device while it vibrates. Off until the user turns the sound
// on (browsers only allow audio after a click); the choice is saved with the preferences.
import type { AlertCue, ComputerView } from '../computers/base';
import { t } from '../i18n';
import { playAlert, unlockAudio } from '../ui/sound';
import { savePrefs } from './prefs';
import { $, app, session } from './state';

interface Live {
  cue: AlertCue;
  /** performance.now() of the next repeat, or Infinity. */
  next: number;
  acked: boolean;
}

let live = new Map<string, Live>();
let forComputer = '';

function shake(ms: number): void {
  const dev = $('device');
  dev.classList.add('buzzing');
  window.setTimeout(() => dev.classList.remove('buzzing'), ms);
}

function play(cue: AlertCue, seconds?: number): boolean {
  return playAlert(cue.kind, cue.level, seconds, shake);
}

/** Called on every refresh with the active computer's view. */
export function updateAlertSounds(v: ComputerView): void {
  const running = !app.paused && !session.emergency;
  if (forComputer !== app.active.id) {
    forComputer = app.active.id;
    live = new Map();
  }
  const cues = app.active.alertCues(v);
  const now = performance.now();
  const seen = new Set<string>();
  for (const cue of cues) {
    seen.add(cue.key);
    const known = live.get(cue.key);
    if (!known) {
      // New alert: sound it now (if the sound is on and the dive is running).
      const played = app.sound && running && play(cue, cue.first);
      const every = cue.until === 'once' || !cue.every ? Infinity : cue.every * 1000;
      // A sound skipped because another one was playing is retried shortly.
      live.set(cue.key, { cue, next: app.sound && running && !played ? now + 500 : now + every, acked: false });
      continue;
    }
    known.cue = cue; // the repeat interval may change (e.g. G2 ascent rate)
    if (!app.sound || !running || known.acked || now < known.next) continue;
    const every = cue.until === 'once' || !cue.every ? Infinity : cue.every * 1000;
    known.next = play(cue, cue.repeat) ? now + every : now + 500;
  }
  for (const key of [...live.keys()]) if (!seen.has(key)) live.delete(key);
}

/** Button `id` of the computer was pressed: alerts waiting for it stop repeating. */
export function ackAlertSounds(id: string): void {
  if (app.active.acknowledgeAlerts(id)) return;
  const ack = app.active.ackButtons;
  if (ack && !ack.includes(id)) return;
  for (const l of live.values()) if (l.cue.until === 'ack') l.acked = true;
}

function renderSoundButton(): void {
  const b = $<HTMLButtonElement>('sound-toggle');
  b.setAttribute('aria-pressed', String(app.sound));
  b.querySelector('.icon')!.textContent = app.sound ? '🔊' : '🔇';
  const label = t(app.sound ? 'soundOn' : 'soundOff');
  b.title = label;
  b.setAttribute('aria-label', label);
}

export function setupSound(): void {
  renderSoundButton();
  $('sound-toggle').addEventListener('click', () => {
    app.sound = !app.sound;
    if (app.sound) {
      unlockAudio();
      // Short sample of the active computer's alerts (beep or vibration), so the user hears it works.
      window.setTimeout(() => playAlert(app.active.soundKind, 'info', undefined, shake), 60);
    }
    renderSoundButton();
    savePrefs();
  });
  // The saved choice needs a gesture before any sound: the first click anywhere unlocks the audio.
  const unlock = () => {
    if (app.sound) unlockAudio();
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
}

/** Also re-labels the button when the language changes. */
export function renderSound(): void {
  renderSoundButton();
}
