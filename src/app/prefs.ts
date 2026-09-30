// Preferences saved in the browser: computer and its settings, dive parameters, view.
import type { Environment } from '../ui/scene3d';
import { setUnits, units, type UnitSystem } from '../units';
import { ENVS, TANKS, applyTank } from './options';
import { $, app, computers, session } from './state';

interface Prefs {
  computer: string;
  settings: Record<string, Record<string, string>>;
  o2: number;
  site: number;
  units: UnitSystem;
  tank: string;
  rmv: number;
  transmitter: boolean;
  rescue: boolean;
  view: '2d' | '3d';
  env: Environment;
  advanced: boolean;
  sound: boolean;
}

function loadPrefs(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem('divesim.prefs') ?? '{}');
  } catch {
    return {};
  }
}

export function savePrefs(): void {
  const prefs: Prefs = {
    computer: app.active.id,
    settings: Object.fromEntries(computers.map((c) => [c.id, c.settings])),
    o2: Math.round(session.gas.o2 * 100),
    site: session.siteDepth,
    units: units(),
    tank: app.tankId,
    rmv: session.rmv,
    transmitter: session.transmitterOn,
    rescue: session.rescueAlert,
    view: app.view,
    env: app.env,
    advanced: $<HTMLDetailsElement>('advanced').open,
    sound: app.sound,
  };
  try {
    localStorage.setItem('divesim.prefs', JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}

/** Restores the saved preferences (at start). */
export function applyPrefs(): void {
  const prefs = loadPrefs();
  for (const c of computers) {
    const saved = prefs.settings?.[c.id];
    if (saved) for (const def of c.settingDefs) if (def.options.some((o) => o.value === saved[def.key])) c.settings[def.key] = saved[def.key];
  }
  app.active = computers.find((c) => c.id === prefs.computer) ?? app.active;
  if (prefs.o2) session.gas = { o2: prefs.o2 / 100, he: 0 };
  if (prefs.site) session.siteDepth = prefs.site;
  app.tankId = TANKS.some((k) => k.id === prefs.tank) ? prefs.tank! : '12-200';
  if (prefs.units === 'imperial') setUnits('imperial');
  if (prefs.rmv) session.rmv = prefs.rmv;
  if (prefs.transmitter === false) session.transmitterOn = false;
  session.rescueAlert = prefs.rescue === true; // off unless chosen
  applyTank();
  app.view = prefs.view === '3d' ? '3d' : '2d';
  app.env = ENVS.some((e) => e.id === prefs.env) ? prefs.env! : 'reef';
  $<HTMLDetailsElement>('advanced').open = prefs.advanced === true;
  app.sound = prefs.sound === true;
}
