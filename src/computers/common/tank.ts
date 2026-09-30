// Tank pressure alerts set on the computer (reserve, half tank, turn pressure…), within each model's
// own range and defaults (from its manual). Values are stored in bar.
import type { Bi, SettingDef } from '../base';

/**
 * A pressure setting from `min` to `max` bar by `step`, `def` by default. `off` adds a first choice
 * that switches the alert off (its label on the device), stored as 'off'.
 */
export function pressureSetting(key: string, label: Bi, min: number, max: number, step: number, def: number | 'off', off?: string | Bi): SettingDef {
  const options: SettingDef['options'] = off ? [{ value: 'off', label: off }] : [];
  for (let b = min; b <= max + 1e-9; b += step) options.push({ value: String(b), label: `${b} bar` });
  if (def !== 'off' && !options.some((o) => o.value === String(def))) {
    options.push({ value: String(def), label: `${def} bar` });
    options.sort((a, b) => (a.value === 'off' ? -1 : b.value === 'off' ? 1 : Number(a.value) - Number(b.value)));
  }
  return { key, label, options, default: String(def) };
}

/** Pressure (bar) of a setting made by pressureSetting(), null when switched off. */
export function pressureValue(settings: Record<string, string>, key: string): number | null {
  const v = settings[key];
  return v === undefined || v === 'off' ? null : Number(v);
}
