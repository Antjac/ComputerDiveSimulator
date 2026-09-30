// "Simulation details" dialog of the chosen computer: its algorithm and fidelity, what is simulated,
// what is assumed, what is not, and its alert settings with the values in use.
import type { DiveComputer, SettingDef } from '../computers/base';
import { lang, t } from '../i18n';
import { alertSettings, optText } from './settings';
import { type Section, noteItems } from './noteItems';
import { $, app } from './state';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function optionText(def: SettingDef, c: DiveComputer): string {
  const o = def.options.find((x) => x.value === c.settings[def.key]);
  return o ? optText(o) : '';
}

function render(c: DiveComputer): string {
  const items = noteItems(c.notes[lang()]);
  const list = (section: Section, title: string, icon: string) => items[section].length
    ? `<section class="mi-sec ${section}"><h3><span class="mi-ico" aria-hidden="true">${icon}</span>${title}</h3><ul>${items[section].map((i) => `<li>${esc(i)}</li>`).join('')}</ul></section>`
    : '';
  const alerts = alertSettings(c);
  const alertRows = alerts.map((d) => `<tr><td>${esc(d.label[lang()])}</td><td>${esc(optionText(d, c))}</td></tr>`).join('');
  return `
    <header class="mi-head">
      <h2 id="model-info-title">${esc(c.name)}</h2>
      <div class="mi-tags">
        <span class="mi-tag">${t('algorithm')} : <b>${esc(c.algorithm.replace(' (≈)', ''))}</b></span>
        <span class="badge ${c.exact ? 'exact' : 'approx'}">${c.exact ? '✓ ' + t('exact') : '≈ ' + t('approx')}</span>
        ${c.transmitter ? `<span class="mi-tag">${t('transmitterModel')} : <b>${esc(c.transmitter)}</b></span>` : ''}
      </div>
    </header>
    ${list('simulated', t('miSimulated'), '✓')}
    ${list('assumed', t('miAssumed'), '?')}
    ${list('missing', t('miMissing'), '✕')}
    ${alerts.length ? `<section class="mi-sec alerts"><h3><span class="mi-ico" aria-hidden="true">!</span>${t('miAlerts')}</h3>
      <table class="mi-table">${alertRows}</table><p class="muted small">${t('miAlertsHint')}</p></section>` : ''}
    <form method="dialog"><button class="btn primary">${t('close')}</button></form>`;
}

/** Opens the dialog for the chosen computer. */
export function openModelInfo(): void {
  const dlg = $<HTMLDialogElement>('model-info');
  dlg.innerHTML = render(app.active);
  dlg.showModal();
}

export function setupModelInfo(): void {
  const dlg = $<HTMLDialogElement>('model-info');
  // The button is redrawn with the settings panel: listened to on its container.
  $('algo-info').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-model-info]')) openModelInfo();
  });
  // Close when clicking the backdrop.
  dlg.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) dlg.close();
  });
}
