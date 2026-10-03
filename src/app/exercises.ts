// Exercises tab (definitions in exerciseDefs.ts): the list with the exercises already passed, then
// one exercise at a time. Starting one resets the dive, prepares the described situation and waits,
// paused; "Go" runs it and the simulator's state is checked at each refresh until success or
// failure; a debrief then shows what the chosen computer signalled and what its rules say. Passed
// exercises (per computer) are kept in the browser.
import { openModelInfo } from './modelInfo';
import type { ComputerView } from '../computers/base';
import type { Gas } from '../engine/buhlmann';
import { lang, t, isI18nKey } from '../i18n';
import { depthLabel, imperial, rateLabel } from '../units';
import { resetAll } from './diveControls';
import { EXERCISES, type Bi, type ExContext, type Exercise, type SetupTools } from './exerciseDefs';
import { advance } from './loop';
import { applyDecoGases, applyTank } from './options';
import { savePrefs } from './prefs';
import { renderControls } from './settings';
import { $, app, compactMq, computers, session } from './state';
import { paneShown, showTabs } from './tabs';

type Phase = 'list' | 'ready' | 'running' | 'success' | 'failed';

const STORE = 'divesim.exercises';

const run = {
  phase: 'list' as Phase,
  ex: null as Exercise | null,
  vars: {} as Record<string, string>,
  t0: 0,
  lastClock: 0,
  seen: new Map<string, number>(),
  mem: {} as Record<string, number | boolean>,
  why: null as Bi | null,
  /** Dive parameters changed by the exercise, put back when leaving it. */
  saved: null as { gas: Gas; deco: number[]; site: number; rescue: boolean; rmv: number; tank: string } | null,
};

/** Passed exercises: exercise id → ids of the computers it was passed with. */
function loadDone(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}');
  } catch {
    return {};
  }
}

function markDone(exId: string, computerId: string): void {
  const done = loadDone();
  done[exId] = [...new Set([...(done[exId] ?? []), computerId])];
  try {
    localStorage.setItem(STORE, JSON.stringify(done));
  } catch {
    /* storage unavailable */
  }
}

const tr = (b: Bi) => b[lang()];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** Exercise texts are written in metres: converted for imperial units. */
function units(text: string): string {
  if (!imperial()) return text;
  return text
    .replace(/(\d+(?:[.,]\d+)?) m\/min/g, (_, n) => rateLabel(Number(n.replace(',', '.'))))
    .replace(/(\d+(?:[.,]\d+)?) m(?![\w/])/g, (_, n) => depthLabel(Number(n.replace(',', '.')), 0));
}

/** An exercise text in the interface language, with its {placeholders} and the unit system. */
function text(b: Bi): string {
  let s = tr(b);
  for (const [k, v] of Object.entries(run.vars)) s = s.replace(`{${k}}`, v);
  return esc(units(s));
}

function tools(): SetupTools {
  const c = app.active;
  const reach = (depth: number) => {
    session.setTarget(depth);
    for (let i = 0; i < 60 && Math.abs(session.depth - depth) > 0.2; i++) advance(10, 1);
  };
  return {
    s: session,
    c,
    go: (depth, sec) => {
      session.setTarget(depth);
      advance(sec, 1);
    },
    stayUntil: (depth, until, maxSec) => {
      const start = session.clock;
      reach(depth);
      while (session.clock - start < maxSec && !until(c.compute(session))) advance(20, 1);
      return session.clock - start;
    },
    toFirstStop: () => {
      for (let i = 0; i < 800; i++) {
        const v = c.compute(session);
        if (v.atStop || !v.inDeco) return;
        session.setTarget(v.stopDepth);
        advance(10, 0.5);
      }
    },
  };
}

function restoreParams(): void {
  if (!run.saved) return;
  session.gas = run.saved.gas;
  app.decoO2 = run.saved.deco;
  applyDecoGases();
  session.siteDepth = run.saved.site;
  session.rescueAlert = run.saved.rescue;
  session.rmv = run.saved.rmv;
  app.tankId = run.saved.tank;
  applyTank();
  run.saved = null;
}

/** Resets the dive and prepares the exercise's starting situation, paused. */
function start(ex: Exercise): void {
  run.phase = 'list'; // nothing is checked while the dive is reset and prepared
  restoreParams();
  run.saved = { gas: { ...session.backGas }, deco: app.decoO2, site: session.siteDepth, rescue: session.rescueAlert, rmv: session.rmv, tank: app.tankId };
  resetAll();
  session.gas = { o2: 0.21, he: 0 };
  // Single gas: the exercises are not about gas switching.
  app.decoO2 = [];
  applyDecoGases();
  session.siteDepth = Math.max(session.siteDepth, 50);
  session.rescueAlert = false; // the exercises provoke what the rescue alert would stop
  // Enough gas for the deco exercises, which are not about gas management.
  session.rmv = Math.min(session.rmv, 14);
  app.tankId = '15-232';
  applyTank();
  run.ex = ex;
  run.vars = ex.setup(tools());
  session.setRate(0); // holds the depth reached
  run.phase = 'ready';
  run.seen = new Map();
  run.mem = {};
  run.why = null;
  app.paused = true;
  app.speed = 1;
  renderControls();
}

function go(): void {
  run.phase = 'running';
  run.t0 = run.lastClock = session.clock;
  app.paused = false;
  // Phones: the sheet covers the water column; the banner under the computer keeps the task.
  if (compactMq.matches) {
    app.sheetOpen = false;
    showTabs(false);
  }
  renderControls();
}

function quit(): void {
  run.phase = 'list';
  run.ex = null;
  resetAll();
  restoreParams();
  renderControls();
}

/** End of the exercise: the simulation stops and the debrief is shown. */
function finish(phase: 'success' | 'failed', why: Bi | null = null): void {
  run.phase = phase;
  run.why = why;
  if (phase === 'success') markDone(run.ex!.id, app.active.id);
  app.paused = true;
  app.activeTab = 'exercises';
  app.sheetOpen = true;
  showTabs(false);
  renderControls();
}

/** Called at each refresh with the shown computer's view: records its signals, checks the exercise. */
export function updateExercise(v: ComputerView): void {
  if (run.phase === 'ready' && !app.paused) {
    // Resumed with the pause button or the space bar.
    run.phase = 'running';
    run.t0 = run.lastClock = session.clock;
  }
  if (run.phase === 'running' && run.ex) check(run.ex, v);
  renderExercises(v);
}

function check(ex: Exercise, v: ComputerView): void {
  const dt = session.clock - run.lastClock;
  run.lastClock = session.clock;
  const tt = session.clock - run.t0;
  for (const a of v.alarms) if (!run.seen.has(a)) run.seen.set(a, tt);
  const x: ExContext = { s: session, c: app.active, v, t: tt, dt, seen: run.seen, mem: run.mem };
  if (session.emergency) finish('failed', { fr: 'La simulation s’est arrêtée (bloc vide).', en: 'The simulation stopped (empty tank).' });
  else if (ex.done(x)) finish('success');
  else {
    const why = ex.fail?.(x) ?? null;
    if (why) finish('failed', why);
  }
}

let shown = '';

/** The tab's content and the banner under the computer. */
export function renderExercises(v: ComputerView): void {
  const banner = $('ex-banner');
  const on = run.phase !== 'list' && !!run.ex;
  if (paneShown('exercises')) {
    const html = run.phase === 'list' || !run.ex ? listHtml() : exerciseHtml(run.ex, v);
    if (html !== shown) {
      shown = html;
      $('exercises').innerHTML = html;
    }
  }
  banner.hidden = !on;
  if (on) {
    const b = run.phase === 'success' ? `✓ ${t('exSuccess')}` : run.phase === 'failed' ? `✗ ${t('exFailed')}` : `🎯 ${tr(run.ex!.title)}`;
    const html2 = `<span>${esc(b)}</span><button class="btn small" data-ex="open">${t('exBannerOpen')}</button>`;
    if (banner.dataset.html !== html2) {
      banner.dataset.html = html2;
      banner.innerHTML = html2;
    }
  }
}

function listHtml(): string {
  const done = loadDone();
  const byId = new Map(computers.map((c) => [c.id, c.name]));
  const items = EXERCISES.map((ex, i) => {
    const passed = (done[ex.id] ?? []).map((id) => byId.get(id)).filter(Boolean);
    return `<li class="ex-item ${passed.length ? 'passed' : ''}">
      <div class="ex-head"><b>${i + 1}. ${esc(tr(ex.title))}</b>${passed.length ? `<span class="badge small exact">✓ ${t('exPassed')}</span>` : ''}</div>
      <p>${esc(tr(ex.goal))}</p>
      ${passed.length ? `<p class="muted small">${t('exDoneWith')} ${esc(passed.join(', '))}</p>` : ''}
      <button class="btn" data-ex="start" data-id="${ex.id}">${t('exStart')}</button>
    </li>`;
  }).join('');
  return `<p class="ex-intro">${t('exIntro')}</p><ol class="ex-list">${items}</ol><p class="muted small">${t('exResetNote')}</p>`;
}

function exerciseHtml(ex: Exercise, v: ComputerView): string {
  const c = app.active;
  const head = `<div class="ex-top"><button class="btn small" data-ex="quit">← ${t('exQuit')}</button></div>
    <h3 class="ex-title">${esc(tr(ex.title))}</h3>
    <p class="ex-sit"><b>${t('exSituation')}</b> ${text(ex.situation)}</p>
    <p class="ex-task"><b>${t('exTask')}</b> ${text(ex.task)}</p>
    <div class="ex-obs"><b>${t('exObserve')}</b><ul>${ex.observe.map((o) => `<li>${text(o)}</li>`).join('')}</ul></div>`;
  if (run.phase === 'ready') {
    return `${head}<p class="muted small">${t('exReady').replace('{name}', esc(c.name))}</p>
      <button class="btn primary" data-ex="go">▶ ${t('exGo')}</button>`;
  }
  if (run.phase === 'running') {
    return `${head}<p class="ex-status">⏱ ${mmss(session.clock - run.t0)} · ${t('exRunning')}</p>
      <button class="btn small" data-ex="restart">↺ ${t('exRestart')}</button>`;
  }
  // Debrief.
  const signals = [...run.seen.entries()].sort((a, b) => a[1] - b[1])
    .map(([k, tt]) => `<li>${esc(k === 'MOD' ? t('exMod') : isI18nKey(k) ? t(k) : k)} <span class="muted">— ${mmss(tt)}</span></li>`).join('');
  const others = computers.filter((x) => x !== c)
    .map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  return `${head}
    <div class="ex-result ${run.phase}">${run.phase === 'success' ? `✓ ${t('exSuccess')}` : `✗ ${t('exFailed')}`}${run.why ? ` — ${esc(units(tr(run.why)))}` : ''}</div>
    <div class="ex-debrief">
      <b>${t('exSignals').replace('{name}', esc(c.name))}</b>
      ${signals ? `<ul>${signals}</ul>` : `<p class="muted small">${t('exNoSignal')}</p>`}
      <p class="muted small">${t('exSignalsNote')}</p>
      <b>${t('exRules')}</b>
      <ul>${ex.rules(c, session, v, { vars: run.vars, mem: run.mem }).map((r) => `<li>${esc(tr(r))}</li>`).join('')}</ul>
      <button class="btn small" data-ex="details">${t('exDetails')}</button>
    </div>
    <div class="ex-again">
      <button class="btn" data-ex="restart">↺ ${t('exRestart')}</button>
      <label class="field"><span>${t('exRedoWith')}</span><select data-ex="other"><option value="">${t('exChoose')}</option>${others}</select></label>
    </div>`;
}

export function setupExercises(): void {
  const onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ex]');
    if (!b || b.tagName === 'SELECT') return;
    switch (b.dataset.ex) {
      case 'start': {
        const ex = EXERCISES.find((x) => x.id === b.dataset.id);
        if (ex) start(ex);
        break;
      }
      case 'go': go(); break;
      case 'restart': if (run.ex) start(run.ex); break;
      case 'quit': quit(); break;
      case 'open':
        app.activeTab = 'exercises';
        app.sheetOpen = true;
        showTabs(false);
        break;
      case 'details':
        openModelInfo();
        break;
      default: return;
    }
    renderExercises(app.active.compute(session));
  };
  $('exercises').addEventListener('click', onClick);
  $('ex-banner').addEventListener('click', onClick);
  $('exercises').addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    if (sel.dataset.ex !== 'other' || !sel.value || !run.ex) return;
    app.active = computers.find((c) => c.id === sel.value) ?? app.active;
    savePrefs();
    start(run.ex);
    renderExercises(app.active.compute(session));
  });
}
