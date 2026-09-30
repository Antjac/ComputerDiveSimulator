// Choices offered by the settings panel.
import type { I18nKey } from '../i18n';
import type { Environment } from '../ui/scene3d';
import { tankCapacityLabel } from '../units';
import { app, session } from './state';

export const SPEEDS = [1, 2, 5, 10, 30, 60, 120, 300];
export const GASES = [21, 28, 32, 36, 40];
export const SITES = [20, 30, 40, 60, 80];
export const RMVS = [12, 14, 16, 18, 20, 22, 25, 28, 32];
export const ENVS: { id: Environment; key: I18nKey }[] = [
  { id: 'reef', key: 'envReef' },
  { id: 'wreck', key: 'envWreck' },
  { id: 'wall', key: 'envWall' },
];

// Tanks: water capacity (L) and working pressure (bar).
export const TANKS: { id: string; volume: number; fill: number; name?: string }[] = [
  { id: '10-200', volume: 10, fill: 200 },
  { id: '12-200', volume: 12, fill: 200 },
  { id: '12-232', volume: 12, fill: 232 },
  { id: '15-200', volume: 15, fill: 200 },
  { id: '15-232', volume: 15, fill: 232 },
  { id: 'al80', volume: 11.1, fill: 207, name: 'AL80' },
  { id: 'hp100', volume: 12.9, fill: 237, name: 'HP100' },
  { id: 'd12-232', volume: 24, fill: 232, name: '2×12 L' },
];

export function tankLabel(k: (typeof TANKS)[number]): string {
  const cap = tankCapacityLabel(k.volume, k.fill);
  return k.name ? `${k.name} · ${cap}` : cap;
}

/** Puts the chosen tank on the diver (full, when not diving). */
export function applyTank(): void {
  const k = TANKS.find((x) => x.id === app.tankId)!;
  session.tank = { ...session.tank, volume: k.volume, fill: k.fill };
  if (!session.inDive) session.refillTank();
}
