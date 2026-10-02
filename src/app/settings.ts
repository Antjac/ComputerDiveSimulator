// Settings panel: the chosen computer's settings, gas, dive parameters, and the controls' state.
import type { DiveComputer, SettingDef, SettingGroup, SettingOption } from '../computers/base';
import { gasLabel } from '../engine/buhlmann';
import { type I18nKey, lang, t } from '../i18n';
import { depthLabel, imperial, setUnits, units, type UnitSystem } from '../units';
import { renderLog } from './logbook';
import { ENVS, GASES, RMVS, SITES, SPEEDS, TANKS, applyTank, tankLabel } from './options';
import { savePrefs } from './prefs';
import { refresh } from './render';
import { $, app, computers, session } from './state';

/**
 * Plain words the manuals print on the devices (On / Off, the G2's Visual / Audible / Both…): shown
 * in the interface language, like the other words of the settings.
 */
const DEVICE_WORDS: Record<string, { fr: string; en: string }> = {
  on: { fr: 'Activé', en: 'On' },
  off: { fr: 'Désactivé', en: 'Off' },
  visual: { fr: 'Visuel', en: 'Visual' },
  audible: { fr: 'Sonore', en: 'Audible' },
  both: { fr: 'Visuel et sonore', en: 'Both' },
  none: { fr: 'Aucune', en: 'None' },
};

/** Setting option text: device values as printed, words in the interface language. */
export function optText(o: SettingOption): string {
  if (typeof o.label !== 'string') return o.label[lang()];
  const word = DEVICE_WORDS[o.label.toLowerCase()];
  return word && lang() === 'fr' ? word.fr : o.label;
}

/** Keys of the alert settings (thresholds, warnings on or off, tank pressure alerts). */
const ALERT_KEYS = new Set([
  'reserve', 'halfTank', 'halfWarn', 'tankWarn', 'tankWarnP', 'tankAlarm', 'turnAl', 'ndlAlert', 'depthAlert', 'timeAlert',
  'depthAlarm', 'timeAlarm', 'gasTimeAlarm', 'po2Warn', 'po2Crit', 'depthAl', 'diveTAl', 'n2Al', 'dtrAl', 'runaway', 'ttsx',
]);
const SOUND_KEYS = new Set(['sound', 'silent', 'alrm', 'alerts', 'vibration', 'audible', 'tones', 'alsp', 'buttons']);
const DECO_KEYS = new Set([
  'gf', 'gfLow', 'gfHigh', 'level', 'personal', 'deepstop', 'deepStop', 'safety', 'ssTime', 'ssDepth', 'lastStop', 'pdis',
  'repetitive', 'rep', 'multiday', 'physio', 'dive', 'itoday', 'cf', 'sf', 'algo', 'ppo2', 'maxdepth', 'fast', 'ascviol',
]);

/** The computer's alert settings (for the details dialog). */
export function alertSettings(c: DiveComputer): SettingDef[] {
  return c.settingDefs.filter((d) => settingGroup(d) === 'alerts' && (!d.showIf || d.showIf(c.settings)));
}

/** Theme of a computer setting: given by the model, or guessed from its key. */
function settingGroup(def: SettingDef): SettingGroup {
  if (def.group) return def.group;
  if (ALERT_KEYS.has(def.key) || /^w[A-Z]/.test(def.key)) return 'alerts';
  if (SOUND_KEYS.has(def.key)) return 'sound';
  if (DECO_KEYS.has(def.key)) return 'deco';
  return 'display';
}

const GROUPS: { id: SettingGroup; title: I18nKey }[] = [
  { id: 'deco', title: 'grpDeco' },
  { id: 'alerts', title: 'grpAlerts' },
  { id: 'sound', title: 'grpSound' },
  { id: 'display', title: 'grpDisplay' },
];

/** Fidelity badge text: ✓ public algorithm reproduced, ≈ proprietary or undocumented variant. */
export function fidelityLabel(c: DiveComputer): string {
  return c.exact ? `✓ ${t('exact')}` : `≈ ${t(c.undocumentedVariant ? 'approxVariant' : 'approx')}`;
}

export function renderControls(): void {
  const active = app.active;
  const sel = $<HTMLSelectElement>('computer-select');
  sel.innerHTML = computers
    .map((c) => `<option value="${c.id}" ${c === active ? 'selected' : ''}>${c.name} ${c.exact ? '✓' : '≈'}</option>`)
    .join('');

  $('device-hint').textContent = t('deviceHint');
  $('about-models').innerHTML = `<tr><th>${t('aboutModel')}</th><th>${t('algorithm')}</th><th>${t('aboutFidelity')}</th></tr>`
    + computers.map((c) => `<tr><td>${c.name}</td><td>${c.algorithm.replace(' (≈)', '')}</td>
      <td><span class="badge small ${c.exact ? 'exact' : 'approx'}">${fidelityLabel(c)}</span></td></tr>`).join('');
  $('device-caption').innerHTML = `<span class="badge small ${active.exact ? 'exact' : 'approx'}">${active.exact ? '✓' : '≈'}</span>
    <span>${active.name} · ${t(active.exact ? 'captionExact' : active.undocumentedVariant ? 'captionApproxVariant' : 'captionApprox')}</span>`;
  // The model's notes are long: they open in a dialog (app/modelInfo.ts).
  $('algo-info').innerHTML = `
    <div class="algo-line"><span class="muted">${t('algorithm')} : ${active.algorithm}</span>
      <span class="badge ${active.exact ? 'exact' : 'approx'}">${fidelityLabel(active)}</span></div>
    <button class="btn small info-btn" data-model-info><span class="icon" aria-hidden="true">i</span>${t('modelNotes')}</button>`;

  // Essential settings (screen layout) are always shown, the others only in the advanced section.
  const settingField = (def: SettingDef) => `<label class="field"><span>${def.label[lang()]}</span>
    <select data-setting="${def.key}">${def.options
      .map((o) => `<option value="${o.value}" ${active.settings[def.key] === o.value ? 'selected' : ''}>${optText(o)}</option>`)
      .join('')}</select></label>`;
  const shown = active.settingDefs.filter((d) => !d.showIf || d.showIf(active.settings));
  const advDefs = shown.filter((d) => !d.essential);
  $('computer-settings').innerHTML = shown.filter((d) => d.essential).map(settingField).join('');
  $('computer-settings-adv').innerHTML = GROUPS.map(({ id, title }) => {
    const defs = advDefs.filter((d) => settingGroup(d) === id);
    if (!defs.length) return '';
    const hint = id === 'alerts' ? `<p class="muted small grid-hint">${t('grpAlertsHint')}</p>` : '';
    return `<section class="adv-group ${id}"><h4>${t(title)}</h4>${hint}<div class="settings-grid">${defs.map(settingField).join('')}</div></section>`;
  }).join('');
  // Collapsed: remind the values in use, so a changed setting is not forgotten.
  const optLabel = (def: SettingDef) => {
    const o = def.options.find((x) => x.value === active.settings[def.key]);
    return `${def.label[lang()]} ${o ? optText(o) : ''}`;
  };
  $('adv-summary').textContent = [
    // Same order as the fields: the dive, then the computer.
    units() === 'imperial' ? t('imperialShort') : '',
    tankLabel(TANKS.find((k) => k.id === app.tankId)!),
    imperial() ? `${(session.rmv / 28.3168).toFixed(2)} cuft/min` : `${session.rmv} L/min`,
    ...advDefs.map(optLabel),
  ].filter(Boolean).join(' · ');

  const gasSel = $<HTMLSelectElement>('gas-select');
  gasSel.innerHTML = GASES.map((o2) => {
    const label = gasLabel({ o2: o2 / 100, he: 0 });
    const mod = depthLabel(app.active.modDepth(o2 / 100), 0);
    return `<option value="${o2}" ${Math.round(session.gas.o2 * 100) === o2 ? 'selected' : ''}>${label} (MOD ${mod})</option>`;
  }).join('');

  $<HTMLSelectElement>('units-select').innerHTML = (['metric', 'imperial'] as const)
    .map((u) => `<option value="${u}" ${units() === u ? 'selected' : ''}>${t(u)}</option>`).join('');
  const tankSel = $<HTMLSelectElement>('tank-select');
  tankSel.innerHTML = TANKS.map((k) => `<option value="${k.id}" ${k.id === app.tankId ? 'selected' : ''}>${tankLabel(k)}</option>`).join('');
  tankSel.disabled = session.inDive;
  $<HTMLSelectElement>('rmv-select').innerHTML = RMVS.map((l) =>
    `<option value="${l}" ${session.rmv === l ? 'selected' : ''}>${imperial() ? `${(l / 28.3168).toFixed(2)} cuft/min` : `${l} L/min`}</option>`).join('');
  $<HTMLSelectElement>('rescue-select').innerHTML = `<option value="off" ${session.rescueAlert ? '' : 'selected'}>${t('disabled')}</option><option value="on" ${session.rescueAlert ? 'selected' : ''}>${t('enabled')}</option>`;
  const txSel = $<HTMLSelectElement>('tx-select');
  const txMode = !session.transmitterOn ? 'off' : app.spgWithTx ? 'on-spg' : 'on';
  txSel.innerHTML = ([['on', t('on')], ['on-spg', t('onSpg')], ['off', t('off')]] as const)
    .map(([value, label]) => `<option value="${value}" ${txMode === value ? 'selected' : ''}>${label}</option>`).join('');
  $('tx-hint').textContent = active.transmitter ? `${t('transmitterModel')} : ${active.transmitter}` : t('noTransmitter');
  // Models without a transmitter: nothing to switch on or off, only the hint remains.
  $('tx-field').style.display = active.transmitter ? '' : 'none';
  gasSel.disabled = session.inDive;
  gasSel.title = session.inDive ? t('gasLocked') : '';

  $<HTMLSelectElement>('site-select').innerHTML = SITES.map((d) => `<option value="${d}" ${session.siteDepth === d ? 'selected' : ''}>${depthLabel(d, 0)}</option>`).join('');

  $<HTMLSelectElement>('env-select').innerHTML = ENVS.map((e) => `<option value="${e.id}" ${e.id === app.env ? 'selected' : ''}>${t(e.key)}</option>`).join('');
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === app.view));

  $('speed-group').innerHTML = SPEEDS.map((s) => `<button data-speed="${s}" class="${s === app.speed ? 'on' : ''}">×${s}</button>`).join('');
  // Icon and label: a narrow time bar keeps only the icon (the label stays as the tooltip).
  const pause = $('btn-pause');
  const label = t(app.paused ? 'play' : 'pause');
  pause.innerHTML = `<span aria-hidden="true">${app.paused ? '▶' : '❚❚'}</span> <span class="lbl">${label}</span>`;
  pause.title = label;
  pause.setAttribute('aria-label', label);
  // After a rescue alert, only a reset restarts the simulation.
  const stopped = !!session.emergency;
  $<HTMLButtonElement>('btn-pause').disabled = stopped;
  $<HTMLButtonElement>('btn-skip').disabled = session.inDive || stopped;
  $('speed-group').querySelectorAll('button').forEach((b) => (b.disabled = stopped));
}

export function setupSettings(): void {
  $('computer-select').addEventListener('change', (e) => {
    app.active = computers.find((c) => c.id === (e.target as HTMLSelectElement).value) ?? app.active;
    savePrefs();
    renderControls();
    refresh(true);
  });

  for (const id of ['computer-settings', 'computer-settings-adv']) {
    $(id).addEventListener('change', (e) => {
      const el = e.target as HTMLSelectElement;
      if (el.dataset.setting) {
        const previous = app.active.settings[el.dataset.setting];
        app.active.settings[el.dataset.setting] = el.value;
        app.active.settingChanged(el.dataset.setting, previous);
        savePrefs();
        // Other settings may appear, disappear or change with this one.
        renderControls();
        refresh(true);
      }
    });
  }

  $('advanced').addEventListener('toggle', savePrefs);

  $('gas-select').addEventListener('change', (e) => {
    if (session.inDive) return;
    session.gas = { o2: Number((e.target as HTMLSelectElement).value) / 100, he: 0 };
    savePrefs();
    refresh(true);
  });

  $('site-select').addEventListener('change', (e) => {
    session.siteDepth = Number((e.target as HTMLSelectElement).value);
    if (session.control === 'target') session.setTarget(session.targetDepth);
    savePrefs();
  });

  $('units-select').addEventListener('change', (e) => {
    setUnits((e.target as HTMLSelectElement).value as UnitSystem);
    savePrefs();
    renderLog();
    refresh(true);
  });

  $('tank-select').addEventListener('change', (e) => {
    if (session.inDive) return;
    app.tankId = (e.target as HTMLSelectElement).value;
    applyTank();
    savePrefs();
    refresh(true);
  });

  $('rmv-select').addEventListener('change', (e) => {
    session.rmv = Number((e.target as HTMLSelectElement).value);
    savePrefs();
    refresh();
  });

  $('rescue-select').addEventListener('change', (e) => {
    session.rescueAlert = (e.target as HTMLSelectElement).value === 'on';
    savePrefs();
    renderControls();
  });

  $('tx-select').addEventListener('change', (e) => {
    const mode = (e.target as HTMLSelectElement).value;
    session.transmitterOn = mode !== 'off';
    app.spgWithTx = mode === 'on-spg';
    savePrefs();
    refresh(true);
  });
}
