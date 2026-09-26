import './style.css';
import { gasLabel, pressureToDepth } from './engine/buhlmann';
import { DiveSession } from './engine/session';
import { createComputers, type DiveComputer } from './computers';
import { hmm, type ButtonAction, type ButtonHelp, type ComputerView } from './computers/base';
import { I18nKey, isI18nKey, lang, setLang, t } from './i18n';
import { ProfileChart, TissueChart } from './ui/charts';
import { Scene } from './ui/scene';
import type { Environment, Scene3D } from './ui/scene3d';
import { renderGauge } from './ui/gauge';
import {
  UnitSystem, depthLabel, depthUnit, depthVal, imperial, pressText, pressUnit, rateLabel, setUnits, tankCapacityLabel,
  tempUnit, tempVal, units,
} from './units';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const session = new DiveSession();
const computers = createComputers();

// ---------------------------------------------------------------------------
// Persisted preferences

interface Prefs {
  computer: string;
  settings: Record<string, Record<string, string>>;
  o2: number;
  site: number;
  units: UnitSystem;
  tank: string;
  rmv: number;
  reserve: number;
  transmitter: boolean;
  view: '2d' | '3d';
  env: Environment;
}

function loadPrefs(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem('divesim.prefs') ?? '{}');
  } catch {
    return {};
  }
}

function savePrefs(): void {
  const prefs: Prefs = {
    computer: active.id,
    settings: Object.fromEntries(computers.map((c) => [c.id, c.settings])),
    o2: Math.round(session.gas.o2 * 100),
    site: session.siteDepth,
    units: units(),
    tank: tankId,
    rmv: session.rmv,
    reserve: session.tank.reserve,
    transmitter: session.transmitterOn,
    view,
    env,
  };
  try {
    localStorage.setItem('divesim.prefs', JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}

const prefs = loadPrefs();
for (const c of computers) {
  const saved = prefs.settings?.[c.id];
  if (saved) for (const def of c.settingDefs) if (def.options.some((o) => o.value === saved[def.key])) c.settings[def.key] = saved[def.key];
}
let active: DiveComputer = computers.find((c) => c.id === prefs.computer) ?? computers[0];
if (prefs.o2) session.gas = { o2: prefs.o2 / 100, he: 0 };
if (prefs.site) session.siteDepth = prefs.site;

// Tanks: water capacity (L) and working pressure (bar).
const TANKS: { id: string; volume: number; fill: number; name?: string }[] = [
  { id: '10-200', volume: 10, fill: 200 },
  { id: '12-200', volume: 12, fill: 200 },
  { id: '12-232', volume: 12, fill: 232 },
  { id: '15-200', volume: 15, fill: 200 },
  { id: '15-232', volume: 15, fill: 232 },
  { id: 'al80', volume: 11.1, fill: 207, name: 'AL80' },
  { id: 'hp100', volume: 12.9, fill: 237, name: 'HP100' },
  { id: 'd12-232', volume: 24, fill: 232, name: '2×12 L' },
];
const RMVS = [12, 14, 16, 18, 20, 22, 25, 28, 32];
const RESERVES = [30, 50, 70];
let tankId = TANKS.some((k) => k.id === prefs.tank) ? prefs.tank! : '12-200';
function applyTank(): void {
  const k = TANKS.find((x) => x.id === tankId)!;
  session.tank = { ...session.tank, volume: k.volume, fill: k.fill };
  if (!session.inDive) session.refillTank();
}
if (prefs.units === 'imperial') setUnits('imperial');
if (prefs.rmv) session.rmv = prefs.rmv;
if (prefs.reserve) session.tank.reserve = prefs.reserve;
if (prefs.transmitter === false) session.transmitterOn = false;
applyTank();

session.on((e) => {
  for (const c of computers) {
    if (e === 'start') c.onDiveStart(session);
    else c.onDiveEnd(session);
  }
  if (e === 'end') {
    selectedLog = session.log.length - 1;
    renderLog();
  }
  renderControls();
});

// ---------------------------------------------------------------------------
// Controls

const SPEEDS = [1, 2, 5, 10, 30, 60, 120, 300];
let speed = 1;
let paused = false;
const GASES = [21, 28, 32, 36, 40];
const SITES = [20, 30, 40, 60, 80];
const ENVS: { id: Environment; key: I18nKey }[] = [
  { id: 'reef', key: 'envReef' },
  { id: 'wreck', key: 'envWreck' },
  { id: 'wall', key: 'envWall' },
];
let view: '2d' | '3d' = prefs.view === '3d' ? '3d' : '2d';
let env: Environment = ENVS.some((e) => e.id === prefs.env) ? prefs.env! : 'reef';

function applyI18n(): void {
  document.documentElement.lang = lang();
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n!;
    if (isI18nKey(key)) el.textContent = t(key);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang()));
  profileChart.labels = { time: t('time'), depth: t('depth'), ceiling: t('ceiling') };
  tissueChart.labels = lang() === 'fr' ? { compartment: 'Compartiment', halfTime: 'Période' } : { compartment: 'Compartment', halfTime: 'Half-time' };
  renderControls();
  renderLog();
}

function renderControls(): void {
  const sel = $<HTMLSelectElement>('computer-select');
  sel.innerHTML = computers
    .map((c) => `<option value="${c.id}" ${c === active ? 'selected' : ''}>${c.name} ${c.exact ? '✓' : '≈'}</option>`)
    .join('');

  $('device-hint').textContent = t('deviceHint');
  $('algo-info').innerHTML = `
    <div class="muted">${t('algorithm')} : ${active.algorithm}</div>
    <span class="badge ${active.exact ? 'exact' : 'approx'}">${active.exact ? '✓ ' + t('exact') : '≈ ' + t('approx')}</span>
    <p>${active.notes[lang()]}</p>`;

  $('computer-settings').innerHTML = active.settingDefs
    .map(
      (def) => `<label class="field"><span>${def.label[lang()]}</span>
        <select data-setting="${def.key}">${def.options
          .map((o) => `<option value="${o.value}" ${active.settings[def.key] === o.value ? 'selected' : ''}>${o.label}</option>`)
          .join('')}</select></label>`,
    )
    .join('');

  const gasSel = $<HTMLSelectElement>('gas-select');
  gasSel.innerHTML = GASES.map((o2) => {
    const label = gasLabel({ o2: o2 / 100, he: 0 });
    const mod = depthLabel(pressureToDepth(1.4 / (o2 / 100)), 0);
    return `<option value="${o2}" ${Math.round(session.gas.o2 * 100) === o2 ? 'selected' : ''}>${label} (MOD ${mod})</option>`;
  }).join('');

  $<HTMLSelectElement>('units-select').innerHTML = (['metric', 'imperial'] as const)
    .map((u) => `<option value="${u}" ${units() === u ? 'selected' : ''}>${t(u)}</option>`).join('');
  const tankSel = $<HTMLSelectElement>('tank-select');
  tankSel.innerHTML = TANKS.map((k) => {
    const cap = tankCapacityLabel(k.volume, k.fill);
    return `<option value="${k.id}" ${k.id === tankId ? 'selected' : ''}>${k.name ? `${k.name} · ${cap}` : cap}</option>`;
  }).join('');
  tankSel.disabled = session.inDive;
  $<HTMLSelectElement>('rmv-select').innerHTML = RMVS.map((l) =>
    `<option value="${l}" ${session.rmv === l ? 'selected' : ''}>${imperial() ? `${(l / 28.3168).toFixed(2)} cuft/min` : `${l} L/min`}</option>`).join('');
  $<HTMLSelectElement>('reserve-select').innerHTML = RESERVES.map((b) =>
    `<option value="${b}" ${session.tank.reserve === b ? 'selected' : ''}>${pressText(b)} ${pressUnit()}</option>`).join('');
  const txSel = $<HTMLSelectElement>('tx-select');
  txSel.innerHTML = `<option value="on" ${session.transmitterOn ? 'selected' : ''}>${t('on')}</option><option value="off" ${session.transmitterOn ? '' : 'selected'}>${t('off')}</option>`;
  $('tx-hint').textContent = active.transmitter ? `${t('transmitterModel')} : ${active.transmitter}` : t('noTransmitter');
  gasSel.disabled = session.inDive;
  gasSel.title = session.inDive ? t('gasLocked') : '';

  $<HTMLSelectElement>('site-select').innerHTML = SITES.map((d) => `<option value="${d}" ${session.siteDepth === d ? 'selected' : ''}>${depthLabel(d, 0)}</option>`).join('');

  $<HTMLSelectElement>('env-select').innerHTML = ENVS.map((e) => `<option value="${e.id}" ${e.id === env ? 'selected' : ''}>${t(e.key)}</option>`).join('');
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));

  $('speed-group').innerHTML = SPEEDS.map((s) => `<button data-speed="${s}" class="${s === speed ? 'on' : ''}">×${s}</button>`).join('');
  $('btn-pause').textContent = paused ? `▶ ${t('play')}` : `❚❚ ${t('pause')}`;
  $<HTMLButtonElement>('btn-skip').disabled = session.inDive;
}

$('computer-select').addEventListener('change', (e) => {
  active = computers.find((c) => c.id === (e.target as HTMLSelectElement).value) ?? active;
  savePrefs();
  renderControls();
  refresh(true);
});

$('computer-settings').addEventListener('change', (e) => {
  const el = e.target as HTMLSelectElement;
  if (el.dataset.setting) {
    active.settings[el.dataset.setting] = el.value;
    savePrefs();
    refresh(true);
  }
});

$('gas-select').addEventListener('change', (e) => {
  if (session.inDive) return;
  session.gas = { o2: Number((e.target as HTMLSelectElement).value) / 100, he: 0 };
  savePrefs();
  refresh(true);
});

$('site-select').addEventListener('change', (e) => {
  session.siteDepth = Number((e.target as HTMLSelectElement).value);
  session.setTarget(session.targetDepth);
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
  tankId = (e.target as HTMLSelectElement).value;
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

$('tx-select').addEventListener('change', (e) => {
  session.transmitterOn = (e.target as HTMLSelectElement).value === 'on';
  savePrefs();
  refresh(true);
});

// Touch-friendly depth controls (replace the mouse wheel on tablets and phones).
document.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((b) =>
  b.addEventListener('click', () => session.setTarget(Math.round(session.targetDepth) + Number(b.dataset.move))),
);

// 2D water column / 3D view. Three.js is only loaded when the 3D view is first shown.
let scene3d: Scene3D | null = null;
let hintShown = false;

async function setView(v: '2d' | '3d'): Promise<void> {
  if (v === '3d' && !scene3d) {
    try {
      const { Scene3D } = await import('./ui/scene3d');
      scene3d = new Scene3D($<HTMLCanvasElement>('scene3d'), session);
      scene3d.environment = env;
      scene3d.onInteract = () => {
        hintShown = true;
        $('scene-hint').hidden = true;
      };
    } catch (err) {
      console.warn(err);
      $('hud-state').textContent = t('view3dError');
      v = '2d';
    }
  }
  view = v;
  $('scene').hidden = v === '3d';
  $('scene3d').hidden = v === '2d';
  $('env-select').hidden = v === '2d';
  $('scene-hint').hidden = v === '2d' || hintShown;
  savePrefs();
  renderControls();
}

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
  b.addEventListener('click', () => void setView(b.dataset.view as '2d' | '3d')),
);

$('env-select').addEventListener('change', (e) => {
  env = (e.target as HTMLSelectElement).value as Environment;
  if (scene3d) scene3d.environment = env;
  savePrefs();
});

$('speed-group').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-speed]');
  if (!b) return;
  speed = Number(b.dataset.speed);
  renderControls();
});

$('btn-pause').addEventListener('click', () => {
  paused = !paused;
  renderControls();
});

$('btn-skip').addEventListener('click', () => {
  if (session.inDive) return;
  advance(3600, 5);
  refresh(true);
});

$('btn-reset').addEventListener('click', () => {
  session.reset();
  for (const c of computers) {
    c.locked = false;
    c.onDiveStart(session);
  }
  selectedLog = -1;
  renderLog();
  renderControls();
  refresh(true);
});

document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) =>
  b.addEventListener('click', () => {
    setLang(b.dataset.lang as 'fr' | 'en');
    applyI18n();
    refresh(true);
  }),
);

// Side panel tabs.
let activeTab = 'settings';
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
  b.addEventListener('click', () => {
    activeTab = b.dataset.tab!;
    document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== activeTab));
    refresh();
  }),
);

// Device buttons. The device is re-rendered several times per second, so the pressed look and the
// tooltip are tracked by button id and re-applied after each render (decorateButtons).
const HOLD_MS = 700;
let pressed: { id: string; held: boolean; timer: number } | null = null;
let released: { id: string; until: number } | null = null;
let hoverBtn: string | null = null;
let touchTip: { id: string; until: number } | null = null;

const isActive = (h: ButtonHelp | undefined) => !!h && (!!h.press?.simulated || !!h.hold?.simulated);

function tipHtml(id: string): string {
  const h = active.buttons()[id];
  const L = lang();
  if (!h) return `<div class="tip-off">${t('btnInactive')}</div>`;
  const line = (label: string, a: ButtonAction) =>
    `<div class="${a.simulated ? '' : 'tip-off'}"><b>${label} :</b> ${a.real[L]}${
      a.simulated ? (a.note ? ` <em>(${a.note[L]})</em>` : '') : ` <span class="tip-tag">${t('notSimulated')}</span>`
    }</div>`;
  return [
    `<div class="tip-name">${h.name}${isActive(h) ? '' : ` · <span class="tip-tag">${t('btnInactive')}</span>`}</div>`,
    h.press ? line(t('btnPress'), h.press) : '',
    h.hold ? line(t('btnHold'), h.hold) : '',
  ].join('');
}

function updateTip(): void {
  const tip = $('btn-tip');
  const id = hoverBtn ?? (touchTip && performance.now() < touchTip.until ? touchTip.id : null);
  const btn = id ? $('device').querySelector<HTMLElement>(`[data-btn="${id}"]`) : null;
  if (!id || !btn) {
    tip.hidden = true;
    return;
  }
  const html = tipHtml(id);
  if (tip.innerHTML !== html) tip.innerHTML = html;
  tip.hidden = false;
  // Beside the button, inside the device panel.
  const panel = tip.parentElement!.getBoundingClientRect();
  const r = btn.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const cx = r.left + r.width / 2 - panel.left;
  const below = r.top + r.height / 2 - panel.top < panel.height / 2;
  const top = below ? r.bottom - panel.top + 8 : r.top - panel.top - h - 8;
  tip.style.left = `${Math.max(6, Math.min(panel.width - w - 6, cx - w / 2))}px`;
  tip.style.top = `${Math.max(6, Math.min(panel.height - h - 6, top))}px`;
}

function decorateButtons(): void {
  const help = active.buttons();
  const now = performance.now();
  $('device').querySelectorAll<HTMLElement>('[data-btn]').forEach((b) => {
    const id = b.dataset.btn!;
    b.classList.toggle('inactive', !isActive(help[id]));
    b.classList.toggle('pressed', pressed?.id === id || (released?.id === id && now < released.until));
    b.setAttribute('aria-label', help[id]?.name ?? id);
  });
  updateTip();
}

$('device').addEventListener('pointerdown', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-btn]');
  if (!btn) return;
  e.preventDefault();
  const id = btn.dataset.btn!;
  if (e.pointerType !== 'mouse') touchTip = { id, until: performance.now() + 3000 };
  // Buttons with a simulated long press act on release (or after HOLD_MS); the others at once.
  const holdable = !!active.buttons()[id]?.hold?.simulated;
  pressed = { id, held: false, timer: 0 };
  if (holdable) {
    pressed.timer = window.setTimeout(() => {
      if (pressed?.id !== id) return;
      pressed.held = true;
      active.hold(id, session);
      refresh();
    }, HOLD_MS);
  } else {
    active.press(id, session);
  }
  refresh();
});

function releaseButton(): void {
  if (!pressed) return;
  const p = pressed;
  window.clearTimeout(p.timer);
  pressed = null;
  if (active.buttons()[p.id]?.hold?.simulated && !p.held) active.press(p.id, session);
  released = { id: p.id, until: performance.now() + 120 };
  refresh();
  window.setTimeout(decorateButtons, 140);
}
window.addEventListener('pointerup', releaseButton);
window.addEventListener('pointercancel', releaseButton);

$('device').addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const id = (e.target as HTMLElement).closest<HTMLElement>('[data-btn]')?.dataset.btn ?? null;
  if (id !== hoverBtn) {
    hoverBtn = id;
    updateTip();
  }
});
$('device').addEventListener('pointerleave', () => {
  hoverBtn = null;
  updateTip();
});

// Scale the device to the space available in its panel.
function fitDevice(): void {
  const host = $('device');
  const dev = host.firstElementChild as HTMLElement | null;
  if (!dev) return;
  const w = dev.offsetWidth;
  const h = dev.offsetHeight;
  if (!w || !h) return;
  const scale = Math.min((host.clientWidth - 8) / w, (host.clientHeight - 8) / h, 1.5);
  host.style.setProperty('--dev-scale', String(Math.max(0.3, scale)));
}
new ResizeObserver(() => fitDevice()).observe($('device'));

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'SELECT') return;
  if (e.key === 'ArrowDown') session.setTarget(Math.round(session.targetDepth) + 1);
  else if (e.key === 'ArrowUp') session.setTarget(Math.round(session.targetDepth) - 1);
  else if (e.key === ' ') {
    paused = !paused;
    renderControls();
  } else if (e.key === '+' || e.key === '=' || e.key === '-') {
    const i = SPEEDS.indexOf(speed) + (e.key === '-' ? -1 : 1);
    speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i))];
    renderControls();
  } else return;
  e.preventDefault();
});

// ---------------------------------------------------------------------------
// Rendering

const scene = new Scene($<HTMLCanvasElement>('scene'), session);
const profileChart = new ProfileChart($<HTMLCanvasElement>('profile'), $('profile-tip'));
const tissueChart = new TissueChart($<HTMLCanvasElement>('tissues'), $('tissue-tip'));
let selectedLog = -1;

function fmtClock(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${d > 0 ? `J${d + 1} ` : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function refresh(full = false): void {
  const views = computers.map((c) => [c, c.compute(session)] as const);
  const v = views.find(([c]) => c === active)![1];
  session.reportedCeiling = v.ceiling;
  active.render($('device'), v, session, lang());
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

  // Comparison table
  const head = `<thead><tr><th>${t('computer')}</th><th>${t('algorithm')}</th><th>GF</th><th>${t('ndl')}</th><th>${t('stop')}</th><th>${t('tts')}</th><th>${t('gasTime')}</th></tr></thead>`;
  const rows = views
    .map(([c, cv]) => {
      const s = c.summary(cv);
      return `<tr data-id="${c.id}" class="${c === active ? 'active' : ''}">
        <td>${c.name}</td>
        <td><span class="badge small ${c.exact ? 'exact' : 'approx'}">${c.exact ? '✓' : '≈'}</span> ${c.algorithm}</td>
        <td class="num">${c.exact ? `${cv.gfLow}/${cv.gfHigh}` : `≈${cv.gfLow}/${cv.gfHigh}`}</td>
        <td class="num">${s.ndl}</td><td class="num ${cv.inDeco ? 'deco' : ''}">${s.stop}</td><td class="num">${s.tts}</td>
        <td class="num">${cv.tank.gasTime !== null ? `${cv.tank.gasTime} <span class="muted">${c.gasTimeName}</span>` : '—'}</td></tr>`;
    })
    .join('');
  $('compare-table').innerHTML = head + `<tbody>${rows}</tbody>`;

  // Scene overlays
  scene.ceiling = v.inDive ? v.ceiling : 0;
  scene.safetyBand = v.inDive && (v.safety.state === 'pending' || v.safety.state === 'active') && !v.inDeco;
  scene.stopDepth = v.stopDepth;
  if (scene3d) {
    scene3d.ceiling = scene.ceiling;
    scene3d.safetyBand = scene.safetyBand;
    scene3d.stopDepth = scene.stopDepth;
    scene3d.paused = paused;
  }

  // HUD
  $('hud-clock').textContent = `${t('simClock')} ${fmtClock(session.clock)}`;
  $('hud-state').textContent = session.inDive
    ? `${t('diving')} · ${depthLabel(session.depth)} · ${session.ascentRate > 0.5 ? '↑' : session.ascentRate < -0.5 ? '↓' : '·'} ${rateLabel(Math.abs(session.ascentRate))}`
    : `${t('atSurface')}${session.surfaceInterval !== null ? ` · ${t('surfaceSince')} ${hmm(session.surfaceInterval / 60)}` : ''}`;

  // Charts
  const samples = session.inDive
    ? [...session.profile, { t: session.diveTime, depth: session.depth, ceiling: v.ceiling }]
    : selectedLog >= 0 && session.log[selectedLog]
      ? session.log[selectedLog].profile
      : [];
  profileChart.unit = depthUnit();
  const shown = samples.map((p) => ({ t: p.t, depth: depthVal(p.depth), ceiling: depthVal(p.ceiling) }));
  if ($('profile').clientWidth > 0) profileChart.draw(shown);
  if (activeTab === 'tissues') tissueChart.draw(session.tissues.gradientPercents(session.pressure), v.gfHigh);
  if (full) renderControls();
}

/** Analog pressure gauge next to the computer when the tank data is not shown on it. */
function renderSpg(v: ComputerView): void {
  const el = $('spg');
  el.hidden = v.tank.ai;
  if (v.tank.ai) return;
  el.innerHTML = renderGauge(v.tank.pressure, v.tank.reserve, t('spg'));
}

function renderLog(): void {
  const el = $('logbook');
  if (!session.log.length) {
    el.innerHTML = `<p class="muted">${t('noDives')}</p>`;
    return;
  }
  const head = `<thead><tr><th>#</th><th>${t('duration')}</th><th>${t('maxDepth')}</th><th>${t('avgDepth')}</th><th>${t('gas')}</th><th>${t('minTemp')}</th><th>${t('si')}</th><th>${t('tankCol')}</th><th>CNS</th><th>${t('alarms')}</th></tr></thead>`;
  const rows = session.log
    .map((d, i) => `<tr data-log="${i}" class="${i === selectedLog ? 'active' : ''}">
      <td>${d.number}</td><td class="num">${Math.round(d.duration / 60)} min</td><td class="num">${depthLabel(d.maxDepth)}</td>
      <td class="num">${depthLabel(d.avgDepth)}</td><td>${gasLabel(d.gas)}</td><td class="num">${tempVal(d.minTemp).toFixed(0)} ${tempUnit()}</td>
      <td class="num">${d.surfaceIntervalBefore === null ? '—' : hmm(d.surfaceIntervalBefore / 60)}</td>
      <td class="num">${pressText(d.tankStart)} → ${pressText(d.tankEnd)} ${pressUnit()}</td><td class="num">${d.cnsEnd.toFixed(0)} %</td>
      <td>${d.alarms.length ? d.alarms.map((a) => (isI18nKey(a) ? t(a) : a)).join(', ') : t('none')}</td></tr>`)
    .reverse()
    .join('');
  el.innerHTML = `<table class="compare">${head}<tbody>${rows}</tbody></table>`;
}

$('logbook').addEventListener('click', (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('[data-log]');
  if (!row) return;
  selectedLog = Number(row.dataset.log);
  renderLog();
  refresh();
});

$('compare-table').addEventListener('click', (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
  if (!row) return;
  active = computers.find((c) => c.id === row.dataset.id) ?? active;
  savePrefs();
  renderControls();
  refresh(true);
});

// ---------------------------------------------------------------------------
// Simulation loop

function advance(seconds: number, maxStep = 1): void {
  let left = seconds;
  while (left > 1e-9) {
    const dt = Math.min(maxStep, left);
    session.step(dt);
    for (const c of computers) c.tick(session, dt);
    left -= dt;
  }
}

// The simulation runs on a timer driven by real elapsed time, so the dive keeps going when the tab
// is in the background (requestAnimationFrame is paused there). Drawing uses requestAnimationFrame.
let lastTick = performance.now();
let pendingSimDt = 0;
let sinceRefresh = 0;
setInterval(() => {
  const now = performance.now();
  const realDt = Math.min(60, (now - lastTick) / 1000);
  lastTick = now;
  if (!paused) {
    const simDt = realDt * speed;
    // Coarser steps for big jumps (background tab, surface interval): Schreiner stays exact on
    // linear segments, only the kinematics and timers get less granular.
    advance(simDt, !session.inDive ? 5 : simDt > 30 ? 1 : 0.5);
    pendingSimDt += simDt;
  }
  sinceRefresh += realDt;
  if (sinceRefresh >= 0.2) {
    sinceRefresh = 0;
    refresh();
  }
}, 50);

let lastFrame = performance.now();
function frame(now: number): void {
  const realDt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (view === '3d' && scene3d) scene3d.draw(pendingSimDt, realDt);
  else scene.draw(pendingSimDt, realDt);
  pendingSimDt = 0;
  requestAnimationFrame(frame);
}

// Dev-only hook for scripted checks (stripped from production builds).
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__divesim = {
    session,
    computers,
    advance,
    refresh,
    select: (id: string) => {
      active = computers.find((c) => c.id === id) ?? active;
      renderControls();
      refresh(true);
    },
  };
}

applyI18n();
refresh(true);
if (view === '3d') void setView('3d');
requestAnimationFrame(frame);
