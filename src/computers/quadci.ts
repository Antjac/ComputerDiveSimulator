import { WATER_VAPOUR, ceilingDepth, depthToPressure, ndl, planAscent, pressureToDepth, type DecoParams } from '../engine/buhlmann';
import { DIVE_END_TIMEOUT, type DiveSession } from '../engine/session';
import type { Lang } from '../i18n';
import { depthInt, depthText, depthUnit, imperial, pressText, pressUnit, tempUnit, tempVal } from '../units';
import { ButtonHelp, ComputerView, DiveComputer, SettingDef, clockOfDay, desaturationTime, hmm, mmss } from './base';

/**
 * Gradient factor sets. The manual gives R0 (85/85), R2 (60/70), R3 (50/60), T0 (30/85) and
 * T3 (25/40); R1, T1 and T2 are interpolated.
 */
export const PRESETS: Record<string, [number, number]> = {
  R0: [85, 85], R1: [70, 80], R2: [60, 70], R3: [50, 60],
  T0: [30, 85], T1: [28, 70], T2: [27, 55], T3: [25, 40],
};

/** Maximum ascent rate by depth (m/min). */
export function quadAscentLimit(depth: number): number {
  return depth > 50 ? 20 : depth > 30 ? 15 : depth > 10 ? 10 : 5;
}

type Screen = 'ez' | 'full' | 'tissue' | 'profile' | 'stops';
const SCREENS: Screen[] = ['ez', 'full', 'tissue', 'profile', 'stops'];
/**
 * Fields at the right of the top (TR) and bottom (BR) rows of the FULL screen, cycled by their
 * buttons in the manual's order (the battery fields are not simulated).
 */
const TR_FIELDS = ['temp', 'max', 'avg', 'mod', 'deep', 'tts5', 'ceil'] as const;
const BR_FIELDS = ['gf', 'gfnow', 'gfrate', 'o2', 'cns', 'ppo2', 'time', 'sw', 'gas', 'ttr'];

const atm = (d: number) => depthToPressure(d) / 1.01325;

/**
 * Mares Quad Ci. Unmodified Bühlmann ZH-L16C with gradient factors (the model this simulator uses),
 * with the rules of the Quad Ci manual: depth-dependent ascent rate, multiday and optional
 * repetitive-dive conservatism, missed deco stop and uncontrolled ascent lock (48 h), TTR with the
 * LED tank module, E-Z / FULL / profile / tissue / stops screens. The E-Z layout and the look (white
 * figures on blue, "45:" minutes, button names printed on the case) follow footage of the device.
 */
export class MaresQuadCi extends DiveComputer {
  readonly id = 'quadci';
  readonly name = 'Mares Quad Ci';
  readonly algorithm = 'ZH-L16C + GF';
  readonly exact = true;
  readonly transmitter = 'LED Tank Module';
  readonly gasTimeName = 'TTR';
  readonly notes = {
    fr: 'Bühlmann ZH-L16C non modifié avec gradient factors : reproduit (R1, R2, T1, T2 interpolés, le manuel ne donnant que R0 85/85, R3 50/60, T0 30/85 et T3 25/40). Conservatisme multi-jours (−2 par jour, max −6) et, en option, en successives (−8 à la sortie, +1 par 15 min). Vitesse maximale selon la profondeur (5 / 10 / 15 / 20 m/min) ; plus de 120 % sur plus de 20 m ou palier manqué = verrouillage 48 h. TTR = temps jusqu’à la réserve. BL : écrans E-Z / FULL / profil / tissus / paliers ; TR / BR : champs du FULL ; TR long : rétroéclairage ; TL : chronomètre. Boussole, menu sous l’eau, changement de gaz et deep stops non simulés.',
    en: 'Unmodified Bühlmann ZH-L16C with gradient factors: reproduced (R1, R2, T1, T2 interpolated, the manual only giving R0 85/85, R3 50/60, T0 30/85 and T3 25/40). Multiday conservatism (−2 per day, max −6) and, optionally, repetitive-dive conservatism (−8 on surfacing, +1 per 15 min). Depth-dependent maximum ascent rate (5 / 10 / 15 / 20 m/min); more than 120 % over more than 20 m or a missed stop = 48 h lock. TTR = time to reserve. BL: E-Z / FULL / profile / tissue / stops screens; TR / BR: FULL fields; TR hold: backlight; TL: stopwatch. Compass, underwater menu, gas switching and deep stops are not simulated.',
  };
  readonly settingDefs: SettingDef[] = [
    {
      key: 'gf',
      label: { fr: 'Gradient factors', en: 'Gradient factors' },
      options: Object.entries(PRESETS).map(([k, [lo, hi]]) => ({ value: k, label: `${k} (${lo}/${hi})` })),
      default: 'R0',
    },
    {
      key: 'display',
      essential: true,
      label: { fr: 'Écran de plongée', en: 'Dive screen' },
      options: [{ value: 'ez', label: 'E-Z' }, { value: 'full', label: 'FULL' }],
      default: 'ez',
    },
    {
      key: 'deepstop',
      label: { fr: 'Deep stop', en: 'Deep stop' },
      options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }],
      default: 'off',
    },
    {
      key: 'repetitive',
      label: { fr: 'Marge successives', en: 'Repetitive conserv.' }, // short: one line in the settings grid
      options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }],
      default: 'off',
    },
  ];

  private trField = 0;
  private brField = 0;
  /** Dive screen setting last applied, so a change in the settings shows at once. */
  private appliedDisplay = '';
  private stopwatchFrom = 0;
  private fastFrom: number | null = null;
  private missedNear = 0;
  private missedFar = 0;
  private violation: 'deco' | 'ascent' | null = null;
  private hadDeco = false;
  private repetitiveDive = false;
  /** Session clock until which the last dive still desaturates (repetitive dive detection). */
  private desatUntil = -Infinity;
  /** The last dive needs the 24 h no-fly time (decompression or repetitive dive). */
  private longNoFly = false;
  private surfacePage: SurfacePage = 'home';
  private ezTop: { i: number; until: number } | null = null;
  private ezBottom: { i: number; until: number } | null = null;
  private acked = new Set<string>();
  private pendingAcks: string[] = [];
  private lastView: ComputerView | null = null;
  private deepState: 'none' | 'pending' | 'active' | 'done' = 'none';
  private deepDepth = 0;
  private deepRemaining = 120;
  /** GF @SURF change per minute, and the sample it is computed from. */

  constructor() {
    super();
    // Safety stop: dives deeper than 10 m, 3 minutes between 6 and 3 m.
    this.safetyStop = { trigger: 10, start: 6, top: 3, bottom: 6, reset: 10 };
    this.ceilingMargin = 0.3; // DECO STOP! when 0.3 m above the stop
    this.lockAfter = null; // handled in tick
    this.lockHours = 48;
    this.stopWindow = 1;
    this.screenTimeout = 0;
    this.init();
  }

  baseParams(): DecoParams {
    const [lo, hi] = PRESETS[this.settings.gf] ?? PRESETS.R0;
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: 3, stopStep: 3, ascentRate: 10 };
  }

  decoParams(s: DiveSession): DecoParams {
    const p = this.baseParams();
    let drop = Math.min(6, 2 * (this.divingDays(s) - 1));
    if (this.settings.repetitive === 'on' && s.lastDiveEnd !== null) {
      const si = ((s.inDive ? s.diveStart : s.clock) - s.lastDiveEnd) / 60;
      drop += Math.max(0, 8 - Math.floor(si / 15));
    }
    return { ...p, gfLow: Math.max(0.1, p.gfLow - drop / 100), gfHigh: Math.max(0.2, p.gfHigh - drop / 100) };
  }

  /** Days of diving in the current series (dives less than 24 h apart). */
  private divingDays(s: DiveSession): number {
    const dayOf = (t: number) => Math.floor((t + 9 * 3600) / 86400);
    let t = s.inDive ? s.diveStart : s.clock;
    const days = new Set<number>([dayOf(t)]);
    for (let i = s.log.length - 1; i >= 0; i--) {
      const e = s.log[i];
      if (t - (e.start + e.duration) >= 24 * 3600) break;
      days.add(dayOf(e.start));
      t = e.start;
    }
    return days.size;
  }

  /** SLOW! above the limit for the current depth, warning from 80 % of it. */
  ascentLevel(rate: number, depth: number): 0 | 1 | 2 {
    const lim = quadAscentLimit(depth);
    return rate > lim ? 2 : rate > lim * 0.8 ? 1 : 0;
  }

  /** TTR: minutes until the reserve at the current depth and breathing rate. */
  gasTime(s: DiveSession, _p: DecoParams, sacBar: number): number | null {
    return Math.max(0, Math.min(99, Math.floor((s.tankPressure - s.tank.reserve) / (sacBar * atm(s.depth)))));
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.fastFrom = null;
    this.missedNear = this.missedFar = 0;
    this.violation = null;
    this.hadDeco = false;
    this.repetitiveDive = s.clock < this.desatUntil;
    this.stopwatchFrom = 0;
    this.acked.clear();
    this.ezTop = this.ezBottom = null;
    this.deepState = 'none';
    this.deepRemaining = 120;
    this.appliedDisplay = this.settings.display;
    this.screen = SCREENS.indexOf(this.appliedDisplay === 'full' ? 'full' : 'ez');
  }

  onDiveEnd(s: DiveSession): void {
    this.desatUntil = s.clock + desaturationTime(s.tissues) * 60;
    this.longNoFly = this.hadDeco || this.repetitiveDive;
    this.surfacePage = 'postdive';
    // Violations lock the computer after surfacing: bottom timer for 48 hours.
    if (this.violation) this.lock(s);
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive || this.locked) return;

    // Uncontrolled ascent: more than 120 % of the allowed rate over more than 20 m.
    if (s.ascentRate > 1.2 * quadAscentLimit(s.depth)) {
      if (this.fastFrom === null) this.fastFrom = s.depth;
      if (this.fastFrom - s.depth > 20) this.violation = this.violation ?? 'ascent';
    } else {
      this.fastFrom = null;
    }

    // Missed stop: above it by less than 1 m for more than 3 min, or by more than 1 m for more than 1 min.
    const p = this.decoParams(s);
    const ceil = ceilingDepth(s.tissues, this.anchor, p);
    if (ceil > 0) {
      this.hadDeco = true;
      const stop = Math.max(p.lastStop, Math.ceil(ceil / p.stopStep - 1e-6) * p.stopStep);
      const above = stop - s.depth;
      if (above > 1) this.missedFar += dt;
      else if (above > 0.3) this.missedNear += dt;
      if (above <= 0.3) this.missedNear = this.missedFar = 0;
      if (this.missedNear > 180 || this.missedFar > 60) this.violation = 'deco';
    } else {
      this.missedNear = this.missedFar = 0;
    }

    // Deep stop (manual §4.5): depth at which the 5th tissue (27 min) switches from ongassing to
    // offgassing, suggested as the no deco limit approaches; optional, not part of the TTS.
    if (this.settings.deepstop === 'on' && this.deepState === 'none' && s.maxDepth > 15) {
      const near = ceil > 0 || ndl(s.tissues, s.depth, s.gas, p.gfHigh) <= 10;
      if (near) {
        this.deepDepth = Math.round(pressureToDepth(s.tissues.n2[4] / 0.7902 + 0.0627) * 10) / 10;
        this.deepState = this.deepDepth >= 9 && this.deepDepth < s.depth ? 'pending' : 'done';
      }
    }
    if (this.deepState === 'pending' || this.deepState === 'active') {
      if (Math.abs(s.depth - this.deepDepth) <= 1.5) {
        this.deepState = 'active';
        this.deepRemaining -= dt;
        if (this.deepRemaining <= 0) this.deepState = 'done';
      } else if (s.depth < this.deepDepth - 1.5) {
        this.deepState = 'done';
      } else if (this.deepState === 'active') {
        this.deepState = 'pending';
      }
    }
  }

  // Dive mode (manual §1.5): BL-SP cycles E-Z, FULL, tissue graph, profile, list of stops; TL-SP
  // resets the stopwatch; TR-SP / BR-SP change the top / bottom field (momentarily on E-Z); TR-LP:
  // backlight. At the surface BL-SP cycles HOME, PRE-DIVE and (with residual nitrogen) POST DIVE.
  // Any button acknowledges the messages that stay until then.
  press(button: string, s: DiveSession): boolean {
    this.acked = new Set([...this.acked, ...this.pendingAcks]);
    if (!s.inDive) {
      if (button !== 'bl') return true;
      const pages: SurfacePage[] = ['home', 'predive', ...(this.hasDesat(s) ? ['postdive' as const] : [])];
      this.surfacePage = pages[(pages.indexOf(this.surfacePage) + 1) % pages.length];
      return true;
    }
    const screen = SCREENS[this.screen];
    if (button === 'bl') {
      let next = (this.screen + 1) % SCREENS.length;
      if (SCREENS[next] === 'stops' && !(this.lastView && this.lastView.stopDepth > 3)) next = 0;
      this.setScreen(next);
    } else if (button === 'tl') {
      this.stopwatchFrom = s.diveTime;
    } else if (button === 'tr') {
      if (screen === 'ez') this.ezTop = this.momentary(this.ezTop, EZ_TOP.length);
      else this.trField = (this.trField + 1) % TR_FIELDS.length;
    } else if (button === 'br') {
      if (screen === 'ez') this.ezBottom = this.momentary(this.ezBottom, this.ezBottomFields(s).length);
      else this.brField = (this.brField + 1) % this.brFields(s).length;
    } else {
      return false;
    }
    return true;
  }

  /** Next momentary field; back to normal 2 s after the last press. */
  private momentary(cur: { i: number; until: number } | null, n: number): { i: number; until: number } {
    const now = performance.now();
    const i = cur && now < cur.until ? (cur.i + 1) % n : 0;
    return { i, until: now + 2000 };
  }

  hold(button: string): boolean {
    if (button !== 'tr') return false;
    this.backlightUntil = performance.now() + 6000;
    return true;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      tl: {
        name: 'TL',
        press: { real: { fr: 'Remise à zéro du chronomètre (même s’il n’est pas affiché)', en: 'Resets the stopwatch (even when not displayed)' }, simulated: true },
        hold: { real: { fr: 'Menu sous l’eau', en: 'Underwater menu' }, simulated: false },
      },
      bl: {
        name: 'BL',
        press: {
          real: { fr: 'Plongée : E-Z, FULL, tissus, profil, liste des paliers. Surface : HOME, PRE-DIVE, POST DIVE', en: 'Dive: E-Z, FULL, tissue graph, profile, list of stops. Surface: HOME, PRE-DIVE, POST DIVE' },
          simulated: true,
        },
        hold: { real: { fr: 'Boussole', en: 'Compass' }, simulated: false },
      },
      tr: {
        name: 'TR',
        press: {
          real: { fr: 'E-Z : température puis profondeur max à la place de la profondeur (2 s). FULL : champ en haut à droite (température, max, moyenne, MOD, deep stop, TTS @+5, plafond)', en: 'E-Z: temperature then max depth instead of the depth (2 s). FULL: top-right field (temperature, max, average, MOD, deep stop, TTS @+5, ceiling)' },
          simulated: true,
        },
        hold: { real: { fr: 'Rétroéclairage', en: 'Backlight' }, simulated: true },
      },
      br: {
        name: 'BR',
        press: {
          real: { fr: 'E-Z : TTR, consommation, O2 %, heure, batterie à la place du temps de plongée (2 s). FULL : champ en bas à droite (GF, GF NOW/@SURF, O2 %, CNS, ppO2, heure, chronomètre, batteries, consommation, TTR)', en: 'E-Z: TTR, gas consumption, O2 %, time, battery instead of the dive time (2 s). FULL: bottom-right field (GF, GF NOW/@SURF, O2 %, CNS, ppO2, time, stopwatch, batteries, gas consumption, TTR)' },
          simulated: true,
          note: { fr: 'sans les batteries', en: 'without the batteries' },
        },
        hold: { real: { fr: 'Table de changement de gaz (multigaz)', en: 'Gas switch table (multigas)' }, simulated: false },
      },
    };
  }

  // -------------------------------------------------------------------------
  // Display: black MIP screen, white figures, coloured blocks, magenta N2 divider, as in the manual's
  // figures (§10.3, §11).

  private hasDesat(s: DiveSession): boolean {
    return s.log.length > 0 && s.clock < this.desatUntil;
  }

  private ezBottomFields(s: DiveSession): string[] {
    return this.airIntegrated(s) ? ['ttr', 'gas', 'o2', 'time'] : ['o2', 'time'];
  }

  private brFields(s: DiveSession): string[] {
    return this.airIntegrated(s) ? BR_FIELDS : BR_FIELDS.filter((f) => f !== 'ttr' && f !== 'gas');
  }

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    this.lastView = v;
    let html: string;
    let layout = 'qc-dive';
    if (!v.inDive) {
      html = this.surfaceScreen(v, s);
      layout = 'qc-surf';
    } else if (this.locked) {
      html = this.bottomTimer(v);
      layout = 'qc-dive qc-bt';
    } else {
      if (this.settings.display !== this.appliedDisplay) {
        this.appliedDisplay = this.settings.display;
        this.setScreen(SCREENS.indexOf(this.appliedDisplay === 'full' ? 'full' : 'ez'));
      }
      // Graphic screens time out back to E-Z (profile, stops); alarms kick out of them.
      let screen = SCREENS[this.screen] ?? 'ez';
      const now = performance.now();
      if ((screen === 'profile' || screen === 'stops') && now - this.screenChangedAt > 5000) this.setScreen((screen = 'ez', 0));
      const alarm = this.alarm(v, s);
      if (alarm && screen !== 'ez' && screen !== 'full') this.setScreen(SCREENS.indexOf((screen = 'full')));
      if (alarm?.full && screen === 'ez') screen = 'full';
      html = screen === 'ez' || screen === 'full' ? this.diveScreen(screen, v, s, alarm) : this.graphScreen(screen, v, s);
    }
    el.innerHTML = `
      <div class="dev qc">
        <div class="qc-case">
          <button class="qc-btn tl" data-btn="tl"></button>
          <button class="qc-btn bl" data-btn="bl"></button>
          <button class="qc-btn tr" data-btn="tr"></button>
          <button class="qc-btn br" data-btn="br"></button>
          <div class="qc-screen ${layout} ${this.backlit ? 'backlit' : ''}">${html}</div>
        </div>
      </div>`;
  }

  /** Current alarm or warning message (bottom-right block), highest priority first. */
  private alarm(v: ComputerView, s: DiveSession): Alarm | null {
    const pending: string[] = [];
    const ack = (key: string) => {
      if (this.acked.has(key)) return false;
      pending.push(key);
      return true;
    };
    let a: Alarm | null = null;
    const ai = v.tank.ai;
    if (v.ascentLevel === 2) {
      a = { text: 'SLOW!', cls: 'red', sub: `SPEED ${Math.round(imperial() ? v.ascentRate * 3.28084 : v.ascentRate)}` };
    } else if (v.ceilingViolation === 2 && !this.violation) {
      // §10.3.4: DECO STOP! once more than 0.3 m above the stop depth.
      a = { text: 'DECO STOP!', cls: 'red', full: true };
    } else if (this.violation === 'deco') {
      a = { text: 'DECO VIOLATION!', cls: 'red' };
    } else if (v.depth > v.mod && ack('mod')) {
      a = { text: 'MOD EXCEEDED!', cls: 'red', full: true };
    } else if (v.cns > 75 && ack('cns')) {
      a = { text: 'CNS > 75%', cls: 'red', full: true };
    } else if (ai && v.inDeco && s.diveTime > 120 && (v.tank.gasTime ?? 0) < v.tts && ack('lowtank')) {
      a = { text: 'LOW TANK PRESSURE', cls: 'red' };
    } else if (ai && v.tank.pressure < v.tank.reserve && ack('reserve')) {
      a = { text: 'TANK RESERVE', cls: 'red' };
    } else if (ai && v.tank.pressure >= v.tank.reserve && v.tank.pressure < v.tank.fill / 2 && ack('half')) {
      a = { text: 'HALF TANK', cls: 'yellow' };
    }
    this.pendingAcks = pending;
    return a;
  }

  private tankColor(v: ComputerView): string {
    const p = v.tank.pressure;
    const half = v.tank.fill / 2;
    return p > (v.tank.fill + half) / 2 ? 'blue' : p > half ? 'green' : p > v.tank.reserve ? 'yellow' : 'red';
  }

  private tankBlock(v: ComputerView): string {
    return `<div class="qc-tank ${this.tankColor(v)}"><b>${pressText(v.tank.pressure)}</b><u>${pressUnit().toUpperCase()}</u></div>`;
  }

  /** Magenta N2 divider (nitrogen bar graph), or the ascent speed graph while ascending. */
  private n2Bar(v: ComputerView, forceN2 = false, label = true): string {
    if (!forceN2 && v.ascentRate > 0.5) {
      const pct = v.ascentRate / quadAscentLimit(v.depth);
      const cls = pct > 1 ? 'red' : pct > 0.8 ? 'yellow' : 'green';
      return `<div class="qc-bar speed ${cls}"><i style="width:${Math.min(100, pct * 100)}%"></i></div>`;
    }
    return `<div class="qc-bar n2"><i style="width:${Math.min(100, v.n2Load)}%"></i>${label ? '<em>N2</em>' : ''}</div>`;
  }

  /** Lower divider of FULL: tank pressure graph in the pressure range colour, battery at the end. */
  private tankBar(v: ComputerView): string {
    // No tank module: the lower divider replicates the upper one (§11), without a second N2 caption.
    if (!v.tank.ai) return this.n2Bar(v, true, false);
    const fill = Math.max(0, Math.min(100, (v.tank.pressure / v.tank.fill) * 100));
    return `<div class="qc-bar tank ${this.tankColor(v)}"><i style="width:${fill}%"></i><span class="qc-batt"></span></div>`;
  }

  /** Right part of the dive time row: no deco, deco stop, safety or deep stop, or an alarm. */
  private stopCells(v: ComputerView, s: DiveSession, full: boolean): string {
    const du = depthUnit();
    // FULL: the middle row is short, so timers sit beside their caption, as in the manual's figures
    // (§11.1 "SAFETY STOP 0:40"); E-Z has room for the caption above a big figure.
    const timer = (lbl: string, val: string) => full
      ? `<div class="qc-c r nd"><em class="cy">${lbl}</em><b>${val}</b></div>`
      : `<div class="qc-c r"><em class="cy">${lbl}</em><b>${val}</b></div>`;
    if (v.inDive && v.depth < 1.2) {
      return timer('SURFACING', mmss(Math.max(0, DIVE_END_TIMEOUT - s.surfaceTimer)));
    }
    if (v.inDeco && v.stopDepth > 0) {
      const red = v.ceilingViolation === 2 ? 'red' : '';
      return `<div class="qc-c sm ${red}"><em>DECO</em><b>${depthInt(v.stopDepth)}<u>${du}</u></b></div>
        <div class="qc-c sm"><em>STOP</em><b>${v.stopTime}:</b></div>
        <div class="qc-c sm r"><em>TTS</em><b>${v.tts}:</b></div>`;
    }
    const deep = this.deepStop(v, s);
    if (full && deep && deep.active) {
      return timer('DEEP STOP', mmss(deep.remaining));
    }
    if (v.safety.state === 'active' || v.safety.state === 'paused') {
      return timer('SAFETY STOP', mmss(v.safety.remaining));
    }
    if (v.safety.state === 'done' && v.depth < 6) {
      return timer('SAFETY STOP', 'OK');
    }
    return full
      ? `<div class="qc-c r nd"><em>NO<br>DECO</em><b>${Math.min(99, v.ndl)}:</b></div>`
      : `<div class="qc-c r"><em>NO DECO</em><b>${Math.min(99, v.ndl)}:</b></div>`;
  }

  private dtime(v: ComputerView, full: boolean): string {
    const min = Math.floor(v.diveTime / 60);
    const sec = String(Math.floor(v.diveTime % 60)).padStart(2, '0');
    return full
      ? `<div class="qc-c dt"><b>${min}:</b><span class="qc-sec">${sec}<em>DTIME</em></span></div>`
      : `<div class="qc-c"><em>DTIME<span class="qc-sec">${sec}</span></em><b>${min}:</b></div>`;
  }

  private diveScreen(screen: 'ez' | 'full', v: ComputerView, s: DiveSession, alarm: Alarm | null): string {
    const du = depthUnit();
    const now = performance.now();
    const surfacing = v.depth < 1.2;
    const depthRed = v.depth > v.mod || v.ceilingViolation === 2 ? 'red' : '';
    const depth = surfacing ? '--.-' : depthText(v.depth);
    const alarmBlock = alarm
      ? `<div class="qc-alarm ${alarm.cls}">${alarm.text}${alarm.sub ? `<small>${alarm.sub} <u>${du}/min</u></small>` : ''}</div>`
      : '';

    if (screen === 'ez') {
      // Top: depth (temperature / max depth momentarily) and tank pressure; bottom: dive time (TTR,
      // gas consumption, O2 %, time momentarily) and no deco / deco / safety stop, or the message.
      const top = this.ezTop && now < this.ezTop.until ? EZ_TOP[this.ezTop.i] : null;
      let topCell = `<div class="qc-depth ${depthRed}">${depth}<u>${du}</u></div>`;
      if (top === 'temp') topCell = `<div class="qc-depth"><em class="cy">TEMP</em>${Math.round(tempVal(v.temperature))}<u>${tempUnit()}</u></div>`;
      if (top === 'max') topCell = `<div class="qc-depth"><em class="cy">MAX</em>${depthText(v.maxDepth)}<u>${du}</u></div>`;
      const fields = this.ezBottomFields(s);
      const bot = this.ezBottom && now < this.ezBottom.until ? fields[this.ezBottom.i % fields.length] : null;
      let left = this.dtime(v, false);
      if (bot) left = `<div class="qc-c"><em class="cy">${EZ_LABELS[bot]}</em><b>${this.fieldValue(bot, v, s)}</b></div>`;
      return `
        <div class="qc-row top ${v.tank.ai ? '' : 'center'}">${topCell}${v.tank.ai ? this.tankBlock(v) : ''}</div>
        ${this.n2Bar(v)}
        <div class="qc-row bot">${left}<div class="qc-right">${alarmBlock || this.stopCells(v, s, false)}</div></div>`;
    }

    // FULL: depth / top-right field; dive time / no deco; tank pressure / TTR / bottom-right field.
    const deep = this.deepStop(v, s);
    let tr = this.trCell(v, s);
    if (v.depth > v.mod) tr = `<div class="qc-f red"><em>MOD</em><b>${depthText(v.mod)}<u>${du}</u></b></div>`;
    else if (deep && TR_FIELDS[this.trField] === 'temp') tr = `<div class="qc-f"><em class="cy">DEEP</em><b>${depthText(deep.depth)}<u>${du}</u></b></div>`;
    const slow = alarm && alarm.text === 'SLOW!';
    const mid = slow ? '<div class="qc-alarm red">SLOW!</div>' : this.stopCells(v, s, true);
    let bottomRight = this.brCell(v, s);
    if (slow) bottomRight = `<div class="qc-alarm red sm">SPEED<small>${alarm!.sub!.replace('SPEED ', '')} <u>${du}/min</u></small></div>`;
    else if (alarm) bottomRight = alarmBlock;
    else if (surfacing) bottomRight = `<div class="qc-f"><em class="cy">GF @SURF/@+3</em><b>${Math.round(v.surfGf)}/${this.gfAt3(v, s)}</b></div>`;
    else if (v.safety.state === 'active' || v.safety.state === 'paused') bottomRight = `<div class="qc-f"><em class="cy">GF @SURF/@+3</em><b>${Math.round(v.surfGf)}/${this.gfAt3(v, s)}</b></div>`;
    const ai = v.tank.ai;
    const bottomLeft = ai ? `<div class="qc-c"><b>${pressText(v.tank.pressure)}<u>${pressUnit().toUpperCase()}</u></b></div>` : this.dtime(v, true);
    return `
      <div class="qc-row top">
        <div class="qc-depth ${depthRed}">${depth}<u>${du}</u></div>
        ${tr}
      </div>
      ${this.n2Bar(v, true)}
      <div class="qc-row mid">${ai ? this.dtime(v, true) : ''}<div class="qc-right">${mid}</div></div>
      ${this.tankBar(v)}
      <div class="qc-row low">${bottomLeft}${bottomRight}</div>`;
  }

  /**
   * GF RATE (glossary): how much GF @SURF will rise (yellow digits) or fall (blue digits) over the
   * next minute at the current depth. One decimal below 10, as in the figures ("77/1.6", "163/1").
   */
  private gfRate(v: ComputerView, s: DiveSession): { text: string; cls: string } {
    const t = s.tissues.clone();
    t.expose(depthToPressure(v.depth), s.gas, 1);
    const r = t.maxGradientPercent(depthToPressure(0)) - s.tissues.maxGradientPercent(depthToPressure(0));
    const a = Math.abs(r);
    const text = a < 9.95 ? a.toFixed(1).replace(/\.0$/, '') : String(Math.round(a));
    return { text, cls: text === '0' ? '' : r > 0 ? 'yel' : 'blu' };
  }

  private gfAt3(v: ComputerView, s: DiveSession): number {
    const t = s.tissues.clone();
    t.expose(depthToPressure(v.depth), s.gas, 3);
    return Math.round(t.maxGradientPercent(depthToPressure(0)));
  }

  /** Deep stop being suggested (see tick). */
  private deepStop(v: ComputerView, _s: DiveSession): { depth: number; remaining: number; active: boolean } | null {
    if (!v.inDive || (this.deepState !== 'pending' && this.deepState !== 'active')) return null;
    return { depth: this.deepDepth, remaining: this.deepRemaining, active: this.deepState === 'active' };
  }

  private fieldValue(f: string, v: ComputerView, s: DiveSession): string {
    const { h, m } = clockOfDay(s);
    switch (f) {
      case 'ttr': return v.tank.gasTime === null || s.diveTime < 120 ? '--' : `${v.tank.gasTime}:`;
      case 'gas': return v.tank.ai ? String(Math.round(s.rmv)) : '--';
      case 'o2': return `${v.o2}<u>%</u>`;
      default: return `${h}:${String(m).padStart(2, '0')}`;
    }
  }

  private trCell(v: ComputerView, s: DiveSession): string {
    const du = depthUnit();
    const f = (lbl: string, val: string, unit = '', cls = '') => `<div class="qc-f ${cls}"><em class="cy">${lbl}</em><b>${val}${unit ? `<u>${unit}</u>` : ''}</b></div>`;
    switch (TR_FIELDS[this.trField]) {
      case 'max': return f('MAX', depthText(v.maxDepth), du);
      case 'avg': return f('AVG', depthText(v.avgDepth), du);
      case 'mod': return f('MOD', depthText(v.mod), du);
      case 'deep': {
        const d = this.deepStop(v, s);
        return f('DEEP', d ? depthText(d.depth) : '--', d ? du : '');
      }
      case 'tts5': {
        const t = s.tissues.clone();
        t.expose(depthToPressure(v.depth), s.gas, 5);
        return f('TTS@+5', `${planAscent(t, v.depth, s.gas, this.decoParams(s), this.anchor).tts}:`);
      }
      case 'ceil': return f('CEILING', v.ceiling > 0 ? depthText(v.ceiling) : '--', v.ceiling > 0 ? du : '');
      default: return f('TEMP', String(Math.round(tempVal(v.temperature))), tempUnit());
    }
  }

  private brCell(v: ComputerView, s: DiveSession): string {
    const { h, m } = clockOfDay(s);
    const f = (lbl: string, val: string, unit = '', cls = '') => `<div class="qc-f ${cls}"><em class="cy">${lbl}</em><b>${val}${unit ? `<u>${unit}</u>` : ''}</b></div>`;
    const fields = this.brFields(s);
    switch (fields[this.brField % fields.length]) {
      case 'gf': return f('MAIN GF', `${v.gfLow}/${v.gfHigh}`);
      case 'gfnow': return f('GF NOW/@SURF', `${Math.round(v.gf99)}/${Math.round(v.surfGf)}`);
      case 'gfrate': {
        const r = this.gfRate(v, s);
        return `<div class="qc-f"><em class="cy">GF@SURF/RATE</em><b class="${r.cls}">${Math.round(v.surfGf)}/${r.text}</b></div>`;
      }
      case 'o2': return f('O2', String(v.o2), '%');
      case 'cns': return f('CNS', String(Math.round(v.cns)), '%', v.cns > 75 ? 'red' : '');
      case 'ppo2': return f('PPO2', v.ppO2.toFixed(2));
      case 'time': return f('TIME OF DAY', `${h}:${String(m).padStart(2, '0')}`);
      case 'sw': return f('STOPWATCH', mmss(v.diveTime - this.stopwatchFrom));
      case 'gas': return f('GAS', String(Math.round(s.rmv)), imperial() ? 'cuft/min' : 'l/min');
      default: return f('TTR', v.tank.gasTime === null || s.diveTime < 120 ? '--' : `${v.tank.gasTime}:`);
    }
  }

  /** Top row of the graphic screens: depth, deco stop (or no deco) and TTS. */
  private graphTop(v: ComputerView): string {
    const du = depthUnit();
    const right = v.inDeco && v.stopDepth > 0
      ? `<div class="qc-f"><em class="cy">DECO STOP</em><b>${depthInt(v.stopDepth)}<u>${du}</u></b></div><div class="qc-f"><em class="cy">TTS</em><b>${v.tts}</b></div>`
      : `<div class="qc-f"><em class="cy">NO DECO</em><b>${Math.min(99, v.ndl)}:</b></div>`;
    return `<div class="qc-row top sm"><div class="qc-depth">${depthText(v.depth)}<u>${du}</u></div>${right}</div>`;
  }

  private graphScreen(screen: Screen, v: ComputerView, s: DiveSession): string {
    const top = this.graphTop(v);
    if (screen === 'tissue') {
      // Bars: GF @SURF of each tissue (the highest equals the GF @SURF value below). In the manual's
      // figures (§11.1.2, §11.3) off-gassing tissues are blue and on-gassing ones yellow.
      const g = s.tissues.gradientPercents(depthToPressure(0));
      const inspired = (s.pressure - WATER_VAPOUR) * (1 - s.gas.o2);
      const gfHigh = v.gfHigh;
      const scale = Math.max(120, ...g);
      const rate = this.gfRate(v, s);
      const bars = g.map((x, i) => `<i class="${s.tissues.n2[i] + s.tissues.he[i] < inspired ? 'yellow' : 'blue'}" style="height:${Math.max(2, (Math.max(0, x) / scale) * 100)}%" title="${i + 1}"></i>`).join('');
      const tank = v.tank.ai ? `<div class="qc-f"><em class="cy">G1</em><b>${pressText(v.tank.pressure)}<u>${pressUnit().toUpperCase()}</u></b></div>` : '';
      return `${top}<div class="qc-tissue">${bars}<b style="bottom:${(gfHigh / scale) * 100}%"></b><em style="bottom:${(gfHigh / scale) * 100}%">${gfHigh}</em></div>
        <div class="qc-row low sm">${`<div class="qc-f"><em class="cy">DTIME</em><b>${mmss(v.diveTime)}</b></div>`}${tank}<div class="qc-f"><em class="cy">GF@SURF / RATE</em><b class="${rate.cls}">${Math.round(v.surfGf)}/${rate.text}</b></div></div>`;
    }
    if (screen === 'profile') {
      const pts = [...s.profile.map((p) => [p.t, p.depth] as const), [v.diveTime, v.depth] as const];
      const tMax = Math.max(60, v.diveTime);
      const dMax = Math.max(5, v.maxDepth);
      const xy = pts.map(([t, d]) => `${((t / tMax) * 300).toFixed(1)},${((d / dMax) * 120).toFixed(1)}`).join(' ');
      return `${top}<svg class="qc-prof" viewBox="-4 -4 308 128" preserveAspectRatio="none"><polyline points="${xy}"/></svg>`;
    }
    const stops = v.plan.stops;
    // Up to 5 stops at full size; more rows shrink so the whole list stays on the screen.
    const size = Math.min(30, Math.floor(146 / Math.max(1, stops.length) / 1.05));
    return `${top}<div class="qc-stops" style="font-size:${size}px">${stops.map((st) => `<div><span>${depthInt(st.depth)}<u>${depthUnit()}</u></span><span>${Math.ceil(st.minutes)}:</span></div>`).join('')}</div>`;
  }

  /** Bottom timer (manual §14): depth; average depth and temperature; dive time. */
  private bottomTimer(v: ComputerView): string {
    const du = depthUnit();
    const f = (lbl: string, val: string, unit: string) => `<div class="qc-c"><em class="cy">${lbl}</em><b>${val}<u>${unit}</u></b></div>`;
    const ascent = v.ascentRate > 0.5 ? f('SPEED', String(Math.round(imperial() ? v.ascentRate * 3.28084 : v.ascentRate)), `${du}/min`) : '';
    return `
      <div class="qc-row top center"><div class="qc-depth">${depthText(v.depth)}<u>${du}</u></div></div>
      <div class="qc-bar cyan"></div>
      <div class="qc-row mid">${f('AVG', depthText(v.avgDepth), du)}${ascent || f('TEMP', String(Math.round(tempVal(v.temperature))), tempUnit())}</div>
      <div class="qc-bar cyan"></div>
      <div class="qc-row low center"><div class="qc-c"><em class="cy">DTIME</em><b>${mmss(v.diveTime)}</b></div></div>
      <div class="qc-msg">LOCKED BY PREVIOUS DIVE</div>`;
  }

  /** HOME, PRE-DIVE and POST DIVE displays. */
  private surfaceScreen(v: ComputerView, s: DiveSession): string {
    const du = depthUnit();
    const { h, m } = clockOfDay(s);
    const time = `${h}:${String(m).padStart(2, '0')}`;
    const day = Math.floor((s.clock + 9 * 3600) / 86400);
    const date = new Date(2026, 8, 26 + day);
    const dateText = `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
    const mode = s.gas.o2 > 0.21 ? `NITROX <b>${Math.round(s.gas.o2 * 100)}%</b>` : 'AIR';
    const lock = this.locked ? `<div class="qc-msg">LOCKED BY PREVIOUS DIVE · ${hmm(Math.max(0, (this.lockedUntil - s.clock) / 60))}</div>` : '';
    if (this.surfacePage === 'predive') {
      return `
        <div class="qc-row top sm"><div class="qc-depth">--.-<u>${du}</u></div><div class="qc-f"><em class="cy">MAIN GF</em><b>${v.gfLow}/${v.gfHigh}</b></div></div>
        <div class="qc-bar green"></div>
        <div class="qc-row mid sm"><div class="qc-c"><em class="cy">G1</em><b>${v.o2}<u>%</u></b></div><div class="qc-c r"><em class="cy">MOD</em><b>${depthText(v.mod)}<u>${du}</u></b></div></div>
        <div class="qc-bar green"></div>
        <div class="qc-row low sm">${v.tank.ai ? `<div class="qc-c"><b>${pressText(v.tank.pressure)}<u>${pressUnit().toUpperCase()}</u></b></div>` : '<div class="qc-c"><em class="cy">DIVE</em></div>'}</div>${lock}`;
    }
    if (this.surfacePage === 'postdive' && this.hasDesat(s)) {
      const last = s.log[s.log.length - 1];
      let noFly = v.noFly;
      if (this.longNoFly && s.surfaceInterval !== null) noFly = Math.max(noFly, 24 * 60 - s.surfaceInterval / 60);
      return `
        <div class="qc-row pd"><div class="qc-f"><em class="cy">S.I.</em><b>${hmm((v.surfaceInterval ?? 0) / 60)}</b></div><div class="qc-f"><em class="cy">NO FLY</em><b>${hmm(noFly)}</b></div><div class="qc-f"><em class="cy">DESAT</em><b>${hmm(v.desat)}</b></div></div>
        <div class="qc-row mid"><div class="qc-c"><em class="cy">${dateText}</em><b>${time}</b></div><div class="qc-f"><em class="cy">MAX</em><b>${depthText(last.maxDepth)}<u>${du}</u></b><em class="cy">DTIME</em><b>${Math.round(last.duration / 60)}:</b></div></div>
        <div class="qc-bar green"></div>
        <div class="qc-row low sm"><div class="qc-f"><em class="cy">CNS</em><b>${Math.round(v.cns)}<u>%</u></b></div><div class="qc-f"><em class="cy">GF NOW</em><b>${Math.round(v.surfGf)}</b></div></div>${lock}`;
    }
    return `
      <div class="qc-row pd"><div class="qc-f"><em class="cy">${dateText}</em></div><div class="qc-f"><em class="cy">SINGLE GAS</em></div></div>
      <div class="qc-row mid"><div class="qc-c"><b class="huge">${time}</b></div><div class="qc-f mode"><b>${mode}</b></div></div>
      <div class="qc-bar green"></div>
      <div class="qc-row low sm"><div class="qc-f"><em class="cy">MAIN GF</em><b>${v.gfLow}/${v.gfHigh}</b></div><div class="qc-f"><em class="cy">ALT GF</em><b>${v.gfLow}/${v.gfHigh}</b></div></div>${lock}`;
  }
}

type SurfacePage = 'home' | 'predive' | 'postdive';

interface Alarm {
  text: string;
  cls: 'red' | 'yellow';
  sub?: string;
  /** The display switches to FULL. */
  full?: boolean;
}

const EZ_TOP = ['temp', 'max'] as const;
const EZ_LABELS: Record<string, string> = { ttr: 'TTR', gas: 'GAS', o2: 'O2%', time: 'TIME OF DAY' };
