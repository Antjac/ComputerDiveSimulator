// Compare tab: every computer's reading of the same dive; a click on a row shows that computer.
import type { ComputerView, DiveComputer } from '../computers/base';
import { t } from '../i18n';
import { savePrefs } from './prefs';
import { refresh } from './render';
import { renderControls } from './settings';
import { $, app, computers } from './state';

export function renderCompare(views: (readonly [DiveComputer, ComputerView])[]): void {
  const head = `<thead><tr><th>${t('computer')}</th><th>${t('algorithm')}</th><th>GF</th><th>${t('ndl')}</th><th>${t('stop')}</th><th>${t('tts')}</th><th>${t('gasTime')}</th></tr></thead>`;
  const rows = views
    .map(([c, cv]) => {
      const s = c.summary(cv);
      return `<tr data-id="${c.id}" class="${c === app.active ? 'active' : ''}">
        <td>${c.name}</td>
        <td><span class="badge small ${c.exact ? 'exact' : 'approx'}">${c.exact ? '✓' : '≈'}</span> ${c.algorithm}</td>
        <td class="num">${c.exact ? `${cv.gfLow}/${cv.gfHigh}` : `≈${cv.gfLow}/${cv.gfHigh}`}</td>
        <td class="num">${s.ndl}</td><td class="num ${cv.inDeco ? 'deco' : ''}">${s.stop}</td><td class="num">${s.tts}</td>
        <td class="num">${cv.tank.gasTime !== null ? `${cv.tank.gasTime} <span class="muted">${c.gasTimeName}</span>` : '—'}</td></tr>`;
    })
    .join('');
  $('compare-table').innerHTML = head + `<tbody>${rows}</tbody>`;
}

export function setupCompare(): void {
  $('compare-table').addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
    if (!row) return;
    app.active = computers.find((c) => c.id === row.dataset.id) ?? app.active;
    savePrefs();
    renderControls();
    refresh(true);
  });
}
