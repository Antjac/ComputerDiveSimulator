// Tissues tab: GF99 / SurfGF (every computer shares the diver's tissues), and the compartment chart
// either at the current depth or at the surface.
import type { ComputerView } from '../computers/base';
import { AIR, COMPARTMENTS, N2_HALF, SURFACE_PRESSURE, WATER_VAPOUR } from '../engine/buhlmann';
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
  // Same two scales as the Shearwater tissue graph (and Subsurface's heat map): a tissue below the
  // ambient pressure is shown as its pressure relative to ambient (−100 % = empty, 0 % = ambient);
  // above ambient, as % of the M-value gradient (the GF, 100 % = Bühlmann limit). The GF alone
  // is unbounded below zero (−500 % for a slow tissue at depth), hence this split.
  const surf = tissueMode === 'surf';
  const pAmb = surf ? SURFACE_PRESSURE : session.pressure;
  const gf = session.tissues.gradientPercents(pAmb);
  const pressures = Array.from({ length: COMPARTMENTS }, (_, i) => session.tissues.n2[i] + session.tissues.he[i]);
  const values = pressures.map((p, i) => (p <= pAmb ? (p / pAmb - 1) * 100 : gf[i]));
  const gas = surf ? AIR : session.gas;
  const inspired = (pAmb - WATER_VAPOUR) * (1 - gas.o2); // inert gas (N2 + He)
  const lead = gf.indexOf(Math.max(...gf));
  $('lead-val').textContent = `${lead + 1} · ${N2_HALF[lead]} min`;
  document.querySelectorAll<HTMLButtonElement>('[data-tmode]').forEach((b) => b.classList.toggle('on', b.dataset.tmode === tissueMode));
  $('tissues-help').textContent = t(tissueMode === 'surf' ? 'tissuesHelpSurf' : 'tissuesHelp');
  tissueChart.draw(values, v.gfHigh, { pressures, pAmb, inspired: (inspired / pAmb - 1) * 100 });
}

export function setupTissues(): void {
  $('tissue-mode').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tmode]');
    if (!b) return;
    tissueMode = b.dataset.tmode as 'now' | 'surf';
    refresh();
  });
}
