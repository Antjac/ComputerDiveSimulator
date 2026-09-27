// Tissues tab: GF99 / SurfGF (every computer shares the diver's tissues), and the compartment chart
// either at the current depth or at the surface.
import type { ComputerView } from '../computers/base';
import { N2_HALF, SURFACE_PRESSURE } from '../engine/buhlmann';
import { t } from '../i18n';
import { refresh, tissueChart } from './render';
import { $, session } from './state';

let tissueMode: 'now' | 'surf' = 'now';

export function renderTissues(v: ComputerView): void {
  const gfCls = (gf: number) => (gf > 100 ? 'crit' : gf > v.gfHigh ? 'warn' : '');
  const setStat = (id: string, gf: number) => {
    $(id).textContent = `${Math.round(gf)} %`;
    $(id).className = gfCls(gf);
  };
  setStat('gf99-val', v.gf99);
  setStat('surfgf-val', v.surfGf);
  const values = session.tissues.gradientPercents(tissueMode === 'surf' ? SURFACE_PRESSURE : session.pressure);
  const lead = values.indexOf(Math.max(...values));
  $('lead-val').textContent = `${lead + 1} · ${N2_HALF[lead]} min`;
  document.querySelectorAll<HTMLButtonElement>('[data-tmode]').forEach((b) => b.classList.toggle('on', b.dataset.tmode === tissueMode));
  $('tissues-help').textContent = t(tissueMode === 'surf' ? 'tissuesHelpSurf' : 'tissuesHelp');
  tissueChart.draw(values, v.gfHigh);
}

export function setupTissues(): void {
  $('tissue-mode').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tmode]');
    if (!b) return;
    tissueMode = b.dataset.tmode as 'now' | 'surf';
    refresh();
  });
}
