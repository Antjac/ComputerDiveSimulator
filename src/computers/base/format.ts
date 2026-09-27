import { DiveSession } from '../../engine/session';
import { depthText } from '../../units';

// ---------------------------------------------------------------------------
// Formatting helpers shared by the screens.

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function hmm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Time of day of the simulated clock (dives start at 09:00 on day 1). */
export function clockOfDay(s: DiveSession): { h: number; m: number } {
  const t = (s.clock + 9 * 3600) % 86400;
  return { h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60) };
}

/** Depth as displayed by the computers, in the selected unit system. */
export function depthStr(d: number): string {
  return depthText(d);
}
