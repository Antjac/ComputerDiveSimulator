// Refresh of everything that follows the dive: the computer, its alarms, the comparison, the water
// column overlays, the HUD, the profile and tissue charts.
import { hmm, type ComputerView } from '../computers/base';
import { lang, t, type I18nKey } from '../i18n';
import { ProfileChart, TissueChart } from '../ui/charts';
import { renderGauge } from '../ui/gauge';
import { Scene } from '../ui/scene';
import { depthLabel, depthUnit, depthVal, rateLabel } from '../units';
import { updateBoat } from './boat';
import { renderCompare } from './compare';
import { decorateButtons, fitDevice } from './device';
import { renderRescue } from './rescue';
import { renderControls } from './settings';
import { $, app, computers, session } from './state';
import { paneShown } from './tabs';
import { renderTissues } from './tissues';

export const scene = new Scene($<HTMLCanvasElement>('scene'), session);
export const profileChart = new ProfileChart($<HTMLCanvasElement>('profile'), $('profile-tip'));
export const tissueChart = new TissueChart($<HTMLCanvasElement>('tissues'), $('tissue-tip'));

function fmtClock(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${d > 0 ? `J${d + 1} ` : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Analog pressure gauge next to the computer when the tank data is not shown on it. */
function renderSpg(v: ComputerView): void {
  const el = $('spg');
  el.hidden = v.tank.ai;
  if (v.tank.ai) return;
  el.innerHTML = renderGauge(v.tank.pressure, v.tank.reserve, t('spg'));
}

/** `full`: also re-renders the controls (settings panel, buttons' state). */
export function refresh(full = false): void {
  const views = computers.map((c) => [c, c.compute(session)] as const);
  const v = views.find(([c]) => c === app.active)![1];
  session.reportedCeiling = v.ceiling;
  app.active.render($('device'), v, session, lang());
  decorateButtons();
  fitDevice();
  renderSpg(v);

  // Alarms under the device
  $('device-alarms').innerHTML = v.alarms
    .map((a) => {
      const sev = ['ASCENT', 'CEILING', 'PPO2_HIGH', 'LOCKED', 'OUT_OF_GAS'].includes(a) ? 'crit' : a === 'DECO' ? 'serious' : 'warn';
      const icon = sev === 'crit' ? '⛔' : '⚠';
      return `<span class="alarm ${sev}">${icon} ${t(a as I18nKey)}</span>`;
    })
    .join('');

  renderCompare(views);

  // Scene overlays
  scene.ceiling = v.inDive ? v.ceiling : 0;
  scene.safetyBand = v.inDive && (v.safety.state === 'pending' || v.safety.state === 'active') && !v.inDeco;
  scene.stopDepth = v.stopDepth;
  const scene3d = app.scene3d;
  if (scene3d) {
    scene3d.ceiling = scene.ceiling;
    scene3d.safetyBand = scene.safetyBand;
    scene3d.stopDepth = scene.stopDepth;
    scene3d.paused = app.paused || !!session.emergency;
  }

  renderRescue();
  updateBoat();

  // HUD
  $('hud-clock').textContent = `${t('simClock')} ${fmtClock(session.clock)}`;
  $('hud-state').textContent = session.inDive
    ? `${t('diving')} · ${depthLabel(session.depth)} · ${session.ascentRate > 0.5 ? '↑' : session.ascentRate < -0.5 ? '↓' : '·'} ${rateLabel(Math.abs(session.ascentRate))}${
      session.control === 'rate'
        ? ` · ${t('rateCmd')} ${session.commandRate < 0 ? '↑' : session.commandRate > 0 ? '↓' : ''} ${rateLabel(Math.abs(session.commandRate))}`
        : Math.abs(session.targetDepth - session.depth) > 0.3
          ? ` · ${t('rateTarget')} ${depthLabel(session.targetDepth)} ${session.targetDepth < session.depth ? `↑ ${rateLabel(session.ascentSpeed)}` : `↓ ${rateLabel(session.descentSpeed)}`}`
          : ''}`
    : `${t('atSurface')}${session.surfaceInterval !== null ? ` · ${t('surfaceSince')} ${hmm(session.surfaceInterval / 60)}` : ''}`;

  // Charts
  const samples = session.inDive
    ? [...session.profile, { t: session.diveTime, depth: session.depth, ceiling: v.ceiling }]
    : app.selectedLog >= 0 && session.log[app.selectedLog]
      ? session.log[app.selectedLog].profile
      : [];
  profileChart.unit = depthUnit();
  const shown = samples.map((p) => ({ t: p.t, depth: depthVal(p.depth), ceiling: depthVal(p.ceiling) }));
  if ($('profile').clientWidth > 0) profileChart.draw(shown);
  if (paneShown('tissues')) renderTissues(v);
  if (full) renderControls();
}
