// Maximum ppO2 of the gas (its MOD), set within each computer's own limits (from its manual).
import type { SettingDef } from '../base';

/**
 * A "ppo2" setting from `min` to `max` bar by `step`, `def` by default. `term` is the name of the
 * setting on the device (PPO2max, MOD PPO2, pO2…), shown in brackets.
 */
export function ppo2Setting(min: number, max: number, def: number, term: string, step = 0.1): SettingDef {
  const options: SettingDef['options'] = [];
  for (let v = min; v <= max + 1e-9; v += step) {
    const value = v.toFixed(2);
    options.push({ value, label: `${v.toFixed(step < 0.1 ? 2 : 1)} bar` });
  }
  return {
    key: 'ppo2',
    label: { fr: `ppO2 max (${term})`, en: `Max ppO2 (${term})` },
    options,
    default: def.toFixed(2),
  };
}
