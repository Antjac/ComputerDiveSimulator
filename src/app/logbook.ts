// Logbook tab: the closed dives; a click on a row draws its profile.
import { hmm } from '../computers/base';
import { gasLabel } from '../engine/buhlmann';
import { isI18nKey, t, type I18nKey } from '../i18n';
import { depthLabel, pressText, pressUnit, tempUnit, tempVal } from '../units';
import { refresh } from './render';
import { $, app, session } from './state';

/** Dive type from the surface interval before it (s): under 15 min consecutive, under 12 h repetitive. */
function diveType(si: number | null): I18nKey {
  if (si === null || si >= 12 * 3600) return 'diveSingle';
  return si < 15 * 60 ? 'diveConsecutive' : 'diveRepetitive';
}

export function renderLog(): void {
  const el = $('logbook');
  if (!session.log.length) {
    el.innerHTML = `<p class="muted">${t('noDives')}</p>`;
    return;
  }
  const head = `<thead><tr><th>#</th><th>${t('duration')}</th><th>${t('maxDepth')}</th><th>${t('avgDepth')}</th><th>${t('gas')}</th><th>${t('minTemp')}</th><th>${t('si')}</th><th title="${t('diveTypeHelp')}">${t('diveType')}</th><th>${t('tankCol')}</th><th>CNS</th><th>${t('alarms')}</th></tr></thead>`;
  const rows = session.log
    .map((d, i) => `<tr data-log="${i}" class="${i === app.selectedLog ? 'active' : ''}">
      <td>${d.number}</td><td class="num">${Math.round(d.duration / 60)} min</td><td class="num">${depthLabel(d.maxDepth)}</td>
      <td class="num">${depthLabel(d.avgDepth)}</td><td>${(d.gasesUsed ?? [d.gas]).map((g) => (g.o2 >= 0.995 ? 'O₂' : gasLabel(g))).join(' + ')}</td><td class="num">${tempVal(d.minTemp).toFixed(0)} ${tempUnit()}</td>
      <td class="num">${d.surfaceIntervalBefore === null ? '—' : hmm(d.surfaceIntervalBefore / 60)}</td><td>${t(diveType(d.surfaceIntervalBefore))}</td>
      <td class="num">${pressText(d.tankStart)} → ${pressText(d.tankEnd)} ${pressUnit()}</td><td class="num">${d.cnsEnd.toFixed(0)} %</td>
      <td>${d.alarms.length ? d.alarms.map((a) => (isI18nKey(a) ? t(a) : a)).join(', ') : t('none')}</td></tr>`)
    .reverse()
    .join('');
  el.innerHTML = `<table class="compare">${head}<tbody>${rows}</tbody></table>`;
}

export function setupLogbook(): void {
  $('logbook').addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-log]');
    if (!row) return;
    app.selectedLog = Number(row.dataset.log);
    renderLog();
    refresh();
  });
}
