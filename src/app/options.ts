// Choices offered by the settings panel.
import type { I18nKey } from '../i18n';
import type { Environment } from '../ui/scene3d';
import { tankCapacityLabel } from '../units';
import { MAX_DECO_GASES } from '../engine/session';
import { app, session } from './state';

export const SPEEDS = [1, 2, 5, 10, 30, 60, 120, 300];
export const GASES = [21, 28, 32, 36, 40];
/** Decompression gases offered (oxygen %), nitrox and pure oxygen. */
export const DECO_GASES = [40, 50, 60, 70, 80, 100];
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

// Stage tanks of the decompression gases.
export const STAGES: { id: string; volume: number; fill: number; name?: string }[] = [
  { id: '7-200', volume: 7, fill: 200 },
  { id: 'al40', volume: 5.7, fill: 207, name: 'AL40' },
  { id: 'al80', volume: 11.1, fill: 207, name: 'AL80' },
];

/** Puts the chosen deco gases on the diver, in full stage tanks (not during a dive). */
export function applyDecoGases(): void {
  if (session.inDive) return;
  // Rising oxygen content, as several models require it (Mares: G1 < G2 < G3, e.g. Quad Ci §13).
  app.decoO2 = [...app.decoO2].sort((a, b) => a - b);
  const k = STAGES.find((x) => x.id === app.stageId) ?? STAGES[0];
  session.decoGases = app.decoO2.slice(0, MAX_DECO_GASES).map((o2) => ({ gas: { o2: o2 / 100, he: 0 }, tank: { volume: k.volume, fill: k.fill }, pressure: k.fill }));
  session.breathing = 0;
}

/** Puts the chosen tank on the diver (full, when not diving). */
export function applyTank(): void {
  const k = TANKS.find((x) => x.id === app.tankId)!;
  session.tank = { ...session.tank, volume: k.volume, fill: k.fill };
  if (!session.inDive) session.refillTank();
}
