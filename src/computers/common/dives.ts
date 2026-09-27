// Dive history rules shared by several computers.
import type { DiveSession } from '../../engine/session';

/** Days of diving in the current series (dives less than 24 h apart), for multiday conservatism. */
export function divingDays(s: DiveSession): number {
  const dayOf = (t: number) => Math.floor((t + 9 * 3600) / 86400);
  let t = s.inDive ? s.diveStart : s.clock;
  const days = new Set<number>([dayOf(t)]);
  for (let i = s.log.length - 1; i >= 0; i--) {
    const e = s.log[i];
    if (t - (e.start + e.duration) >= 24 * 3600) break;
    days.add(dayOf(e.start));
    t = e.start;
  }
  return days.size;
}

/**
 * Standard no-fly countdown (NOAA, DAN): 12 h after a no-deco non-repetitive dive, 24 h after a
 * deco or repetitive dive, in minutes left.
 */
export function standardNoFly(long: boolean, s: DiveSession): number {
  if (s.surfaceInterval === null) return 0;
  return Math.max(0, (long ? 24 : 12) * 60 - s.surfaceInterval / 60);
}
