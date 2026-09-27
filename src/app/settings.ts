// Settings panel: the chosen computer's settings, gas, dive parameters, and the controls' state.
import type { SettingDef, SettingOption } from '../computers/base';
import { gasLabel, pressureToDepth } from '../engine/buhlmann';
import { lang, t } from '../i18n';
import { depthLabel, imperial, pressText, pressUnit, setUnits, units, type UnitSystem } from '../units';
import { renderLog } from './logbook';
import { ENVS, GASES, RESERVES, RMVS, SITES, SPEEDS, TANKS, applyTank, tankLabel } from './options';
import { savePrefs } from './prefs';
import { refresh } from './render';
import { $, app, computers, session } from './state';

/** Setting option text: device values as printed, words in the interface language. */
const optText = (o: SettingOption) => (typeof o.label === 'string' ? o.label : o.label[lang()]);

export function renderControls(): void {
  const active = app.active;
  const sel = $<HTMLSelectElement>('computer-select');
  sel.innerHTML = computers
    .map((c) => `<option value="${c.id}" ${c === active ? 'selected' : ''}>${c.name} ${c.exact ? '✓' : '≈'}</option>`)
    .join('');

  $('device-hint').textContent = t('deviceHint');
  $('about-models').innerHTML = `<tr><th>${t('aboutModel')}</th><th>${t('algorithm')}</th><th>${t('aboutFidelity')}</th></tr>`
    + computers.map((c) => `<tr><td>${c.name}</td><td>${c.algorithm.replace(' (≈)', '')}</td>
      <td><span class="badge small ${c.exact ? 'exact' : 'approx'}">${c.exact ? '✓ ' + t('exact') : '≈ ' + t('approx')}</span></td></tr>`).join('');
  $('device-caption').innerHTML = `<span class="badge small ${active.exact ? 'exact' : 'approx'}">${active.exact ? '✓' : '≈'}</span>
    <span>${active.name} · ${t(active.exact ? 'captionExact' : 'captionApprox')}</span>`;
  $('algo-info').innerHTML = `
    <div class="muted">${t('algorithm')} : ${active.algorithm}</div>
    <span class="badge ${active.exact ? 'exact' : 'approx'}">${active.exact ? '✓ ' + t('exact') : '≈ ' + t('approx')}</span>
    <p>${active.notes[lang()]}</p>`;

  // Essential settings (screen layout) are always shown, the others only in the advanced section.
  const settingField = (def: SettingDef) => `<label class="field"><span>${def.label[lang()]}</span>
    <select data-setting="${def.key}">${def.options
      .map((o) => `<option value="${o.value}" ${active.settings[def.key] === o.value ? 'selected' : ''}>${optText(o)}</option>`)
      .join('')}</select></label>`;
  const advDefs = active.settingDefs.filter((d) => !d.essential);
  $('computer-settings').innerHTML = active.settingDefs.filter((d) => d.essential).map(settingField).join('');
  $('computer-settings-adv').innerHTML = advDefs.map(settingField).join('');
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
    const mod = depthLabel(pressureToDepth(1.4 / (o2 / 100)), 0);
    return `<option value="${o2}" ${Math.round(session.gas.o2 * 100) === o2 ? 'selected' : ''}>${label} (MOD ${mod})</option>`;
  }).join('');

  $<HTMLSelectElement>('units-select').innerHTML = (['metric', 'imperial'] as const)
    .map((u) => `<option value="${u}" ${units() === u ? 'selected' : ''}>${t(u)}</option>`).join('');
  const tankSel = $<HTMLSelectElement>('tank-select');
  tankSel.innerHTML = TANKS.map((k) => `<option value="${k.id}" ${k.id === app.tankId ? 'selected' : ''}>${tankLabel(k)}</option>`).join('');
  tankSel.disabled = session.inDive;
  $<HTMLSelectElement>('rmv-select').innerHTML = RMVS.map((l) =>
    `<option value="${l}" ${session.rmv === l ? 'selected' : ''}>${imperial() ? `${(l / 28.3168).toFixed(2)} cuft/min` : `${l} L/min`}</option>`).join('');
  $<HTMLSelectElement>('reserve-select').innerHTML = RESERVES.map((b) =>
    `<option value="${b}" ${session.tank.reserve === b ? 'selected' : ''}>${pressText(b)} ${pressUnit()}</option>`).join('');
  $<HTMLSelectElement>('rescue-select').innerHTML = `<option value="off" ${session.rescueAlert ? '' : 'selected'}>${t('disabled')}</option><option value="on" ${session.rescueAlert ? 'selected' : ''}>${t('enabled')}</option>`;
  const txSel = $<HTMLSelectElement>('tx-select');
  txSel.innerHTML = `<option value="on" ${session.transmitterOn ? 'selected' : ''}>${t('on')}</option><option value="off" ${session.transmitterOn ? '' : 'selected'}>${t('off')}</option>`;
  $('tx-hint').textContent = active.transmitter ? `${t('transmitterModel')} : ${active.transmitter}` : t('noTransmitter');
  gasSel.disabled = session.inDive;
  gasSel.title = session.inDive ? t('gasLocked') : '';

  $<HTMLSelectElement>('site-select').innerHTML = SITES.map((d) => `<option value="${d}" ${session.siteDepth === d ? 'selected' : ''}>${depthLabel(d, 0)}</option>`).join('');

  $<HTMLSelectElement>('env-select').innerHTML = ENVS.map((e) => `<option value="${e.id}" ${e.id === app.env ? 'selected' : ''}>${t(e.key)}</option>`).join('');
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === app.view));

  $('speed-group').innerHTML = SPEEDS.map((s) => `<button data-speed="${s}" class="${s === app.speed ? 'on' : ''}">×${s}</button>`).join('');
  $('btn-pause').textContent = app.paused ? `▶ ${t('play')}` : `❚❚ ${t('pause')}`;
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
        app.active.settings[el.dataset.setting] = el.value;
        savePrefs();
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

  $('reserve-select').addEventListener('change', (e) => {
    session.tank.reserve = Number((e.target as HTMLSelectElement).value);
    savePrefs();
    refresh();
  });

  $('rescue-select').addEventListener('change', (e) => {
    session.rescueAlert = (e.target as HTMLSelectElement).value === 'on';
    savePrefs();
    renderControls();
  });

  $('tx-select').addEventListener('change', (e) => {
    session.transmitterOn = (e.target as HTMLSelectElement).value === 'on';
    savePrefs();
    refresh(true);
  });
}
