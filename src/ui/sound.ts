// Alarm sounds, synthesised with the Web Audio API (no audio files): piezo-like beeps, and the
// buzzing of a vibration motor for the computers that vibrate. On phones that allow it
// (navigator.vibrate: Android, not iOS), a vibration is also played for real.

export type SoundKind = 'beep' | 'buzz' | 'both';
export type SoundLevel = 'alarm' | 'warning' | 'info';

/** On / off durations in ms, per urgency: beeps are short and fast, vibrations longer. */
const BEEPS: Record<SoundLevel, number[]> = {
  alarm: [90, 60, 90, 60, 90, 60, 90],
  warning: [160, 120, 160],
  info: [130],
};
const BUZZES: Record<SoundLevel, number[]> = {
  alarm: [420, 180, 420, 180, 420],
  warning: [350, 220, 350],
  info: [260],
};
/** Silence between two patterns when a sound is stretched over several seconds. */
const GAP = 350;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
/** Nothing new starts before the current sound has finished (no overlapping cacophony). */
let busyUntil = 0;

/** Creates (or wakes up) the audio output: must be called from a user gesture. */
export function unlockAudio(): void {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
  }
  wakeAudio();
}

/**
 * Resumes the audio output when the browser paused it (tab in the background, phone locked, a call,
 * audio device changed: Safari reports "interrupted"). Allowed without a gesture once the page has
 * had one; otherwise the next click or key press does it (see setupSound).
 */
export function wakeAudio(): void {
  if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
}

/**
 * Silences everything at once: the sounds already scheduled (a pattern can last up to 12 s) are cut
 * by detaching them from the output, and a running vibration is cancelled.
 */
export function stopAllSounds(): void {
  if (ctx && master) {
    master.disconnect();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
  }
  busyUntil = 0;
  try {
    navigator.vibrate?.(0);
  } catch {
    /* not allowed here */
  }
}

/** Repeats `pattern` (on/off ms) to last about `seconds` (one pattern if not given). */
function stretch(pattern: number[], seconds?: number): number[] {
  if (!seconds) return pattern;
  const one = pattern.reduce((a, b) => a + b, 0) + GAP;
  const n = Math.max(1, Math.round((seconds * 1000) / one));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(...pattern, GAP);
  out.pop();
  return out;
}

function beep(t: number, ms: number): void {
  const osc = ctx!.createOscillator();
  const env = ctx!.createGain();
  osc.type = 'square';
  osc.frequency.value = 3100;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.5, t + 0.004);
  env.gain.setValueAtTime(0.5, t + ms / 1000 - 0.006);
  env.gain.linearRampToValueAtTime(0, t + ms / 1000);
  osc.connect(env).connect(master!);
  osc.start(t);
  osc.stop(t + ms / 1000 + 0.01);
}

/** A small vibration motor against a case: low rough hum, shaking at a few tens of hertz. */
function buzz(t: number, ms: number): void {
  const end = t + ms / 1000;
  const motor = ctx!.createOscillator();
  motor.type = 'sawtooth';
  motor.frequency.value = 155;
  const harmonic = ctx!.createOscillator();
  harmonic.type = 'square';
  harmonic.frequency.value = 311;
  const hg = ctx!.createGain();
  hg.gain.value = 0.25;
  const filter = ctx!.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 650;
  filter.Q.value = 3;
  // Rattle: the amplitude wobbles like an eccentric mass hitting the case.
  const rattle = ctx!.createOscillator();
  rattle.frequency.value = 38;
  const depth = ctx!.createGain();
  depth.gain.value = 0.3;
  const env = ctx!.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.8, t + 0.03);
  env.gain.setValueAtTime(0.8, end - 0.04);
  env.gain.linearRampToValueAtTime(0, end);
  rattle.connect(depth).connect(env.gain);
  motor.connect(filter);
  harmonic.connect(hg).connect(filter);
  filter.connect(env).connect(master!);
  for (const o of [motor, harmonic, rattle]) {
    o.start(t);
    o.stop(end + 0.02);
  }
}

/**
 * Plays an alert. `seconds` stretches it (the pattern is repeated). Returns false when nothing was
 * played (audio not unlocked, or another sound still playing).
 */
export function playAlert(kind: SoundKind, level: SoundLevel, seconds?: number, onBuzz?: (ms: number) => void): boolean {
  if (!ctx || !master) return false;
  if (ctx.state !== 'running') {
    // Paused by the browser: wake it up; the alert is retried shortly (see alertSounds.ts).
    wakeAudio();
    return false;
  }
  const now = ctx.currentTime;
  if (now < busyUntil) return false;
  const pattern = stretch(kind === 'beep' ? BEEPS[level] : BUZZES[level], seconds);
  let t = now + 0.02;
  pattern.forEach((ms, i) => {
    if (i % 2 === 0) {
      if (kind !== 'buzz') beep(t, kind === 'both' ? Math.min(ms, 160) : ms);
      if (kind !== 'beep') buzz(t, ms);
    }
    t += ms / 1000;
  });
  busyUntil = t + 0.15;
  if (kind !== 'beep') {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* not allowed here */
    }
    onBuzz?.((t - now) * 1000);
  }
  return true;
}
