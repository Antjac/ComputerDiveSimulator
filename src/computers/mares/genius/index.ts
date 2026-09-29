import { WATER_VAPOUR, depthToPressure } from '../../../engine/buhlmann';
import { DIVE_END_TIMEOUT, type DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthInt, depthText, depthUnit, imperial, pressText, pressUnit, tempUnit, tempVal } from '../../../units';
import { ButtonHelp, ComputerView, clockOfDay, hmm, mmss } from '../../base';
import { Acks } from '../../common/acks';
import { gfRate } from '../../common/predict';
import { quadAscentLimit, tankRange } from '../common';
import { GeniusRules } from './rules';

const pad2 = (n: number) => String(n).padStart(2, '0');
/** Fictitious battery charge of the computer and of the tank module (not simulated). */
const BATTERY = 83;

type TopField = 'temp' | 'max' | 'avg' | 'mod' | 'deep' | 'tts5' | 'ceil';
type BottomField = 'gf' | 'gfnow' | 'gfrate' | 'sw' | 'cns' | 'ppo2' | 'time' | 'batt' | 'tbatt' | 'gas';
type Mode = 'std' | 'profile' | 'tissue';

/** Mares Genius: buttons and colour TFT display, after the manual's figures (rules in rules.ts). */
export class MaresGenius extends GeniusRules {
  private mode: Mode = 'std';
  private topIdx = 0;
  private botIdx = 0;
  /** Another field shown over the CNS for 4 s (§8.5.3). */
  private botUntil = 0;
  private stopwatchFrom = 0;
  private acks = new Acks();
  private surfacePage: 'home' | 'post' = 'home';

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.mode = 'std';
    this.topIdx = this.botIdx = 0;
    this.botUntil = 0;
    this.stopwatchFrom = 0;
    this.acks.clear();
  }

  onDiveEnd(s: DiveSession): void {
    super.onDiveEnd(s);
    this.surfacePage = 'post';
  }

  // -------------------------------------------------------------------------
  // Buttons (§1.6, §9): 1st compass / underwater menu; 2nd graphic display (profile) / list of stops;
  // 3rd bottom-right field / gas switch; 4th top-right field / tissue graph. In a graphic display the
  // 1st button returns to the standard display. Any button acknowledges the messages (§8.5).

  press(button: string, s: DiveSession): boolean {
    this.acks.ackAll();
    if (!s.inDive) return true; // surface: PRE DIVE, LOG, GAS, MENU are not simulated
    if (this.mode !== 'std' && button === 'b1') {
      this.mode = 'std';
      return true;
    }
    const v = this.lastView;
    if (button === 'b2' && !this.locked) this.mode = this.mode === 'profile' ? 'std' : 'profile';
    else if (button === 'b3') {
      const f = this.bottomFields(s);
      this.botIdx = (this.botIdx + 1) % f.length;
      this.botUntil = v && v.cns > 75 ? performance.now() + 4000 : 0;
    } else if (button === 'b4') this.topIdx = (this.topIdx + 1) % this.topFields(s, v).length;
    else return button === 'b1';
    return true;
  }

  hold(button: string, s: DiveSession): boolean {
    if (!s.inDive) {
      // §10: press and hold the left button toggles POST DIVE / HOME.
      if (button === 'b1' && this.hasPostDive(s)) this.surfacePage = this.surfacePage === 'post' ? 'home' : 'post';
      return button === 'b1';
    }
    if (button === 'b4' && !this.locked) {
      this.mode = this.mode === 'tissue' ? 'std' : 'tissue';
      return true;
    }
    if (button === 'b3' && this.locked) this.stopwatchFrom = s.diveTime; // §12: restarts the stopwatch
    return false;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      b1: {
        name: '1',
        press: { real: { fr: 'Boussole ; dans un affichage graphique, retour à l’affichage standard. Surface : PRE DIVE', en: 'Compass; in a graphic display, back to the standard display. Surface: PRE DIVE' }, simulated: true, note: { fr: 'retour seulement ; boussole et pré-plongée non simulées', en: 'return only; compass and pre-dive not simulated' } },
        hold: { real: { fr: 'Menu sous l’eau. Surface : POST DIVE ↔ HOME', en: 'Underwater menu. Surface: POST DIVE ↔ HOME' }, simulated: true, note: { fr: 'surface seulement', en: 'surface only' } },
      },
      b2: {
        name: '2',
        press: { real: { fr: 'Affichage graphique (profil de la plongée)', en: 'Graphic display (dive profile)' }, simulated: true },
        hold: { real: { fr: 'Liste des paliers', en: 'List of stops' }, simulated: false },
      },
      b3: {
        name: '3',
        press: { real: { fr: 'Champ en bas à droite : GF, GF NOW/@SURF, GF @SURF/RATE, chronomètre, CNS, ppO2, heure, batteries, consommation', en: 'Bottom-right field: GF, GF NOW/@SURF, GF @SURF/RATE, stopwatch, CNS, ppO2, time, batteries, gas consumption' }, simulated: true, note: { fr: 'batteries fictives', en: 'fictitious batteries' } },
        hold: { real: { fr: 'Changement de gaz ; en profondimètre, remise à zéro du chronomètre', en: 'Gas switch; in bottom timer, restarts the stopwatch' }, simulated: true, note: { fr: 'chronomètre seulement (un seul gaz)', en: 'stopwatch only (single gas)' } },
      },
      b4: {
        name: '4',
        press: { real: { fr: 'Champ en haut à droite : max, moyenne, MOD, deep stop, TTS @+5, plafond', en: 'Top-right field: max, average, MOD, deep stop, TTS @+5, ceiling' }, simulated: true },
        hold: { real: { fr: 'Graphique de saturation des tissus', en: 'Tissue saturation graph' }, simulated: true },
      },
    };
  }

  // -------------------------------------------------------------------------
  // Fields.

  /** §9: temperature, then max depth, average depth, MOD, deep stop, TTS @+5 (deco), ceiling. */
  private topFields(s: DiveSession, v: ComputerView | null): TopField[] {
    const f: TopField[] = ['temp', 'max', 'avg'];
    if (this.nitrox(s)) f.push('mod'); // §9.2 note: no MOD, CNS, ppO2 on AIR
    if (this.deep.shown) f.push('deep');
    if (v?.inDeco) f.push('tts5');
    f.push('ceil');
    return f;
  }

  /** §9: active GF, then GF NOW/@SURF, GF @SURF/RATE, stopwatch, CNS, ppO2, time, batteries, gas. */
  private bottomFields(s: DiveSession): BottomField[] {
    const f: BottomField[] = ['gf', 'gfnow', 'gfrate', 'sw'];
    if (this.nitrox(s)) f.push('cns', 'ppo2');
    f.push('time', 'batt');
    if (this.airIntegrated(s)) f.push('tbatt', 'gas');
    return f;
  }

  /** GF RATE (glossary): change of GF @SURF over the next minute, orange rising, green falling. */
  private gfRate(v: ComputerView, s: DiveSession): { text: string; cls: string } {
    const { r, text } = gfRate(s, v.depth);
    return { text, cls: text === '0' ? '' : r > 0 ? 'or' : 'gr' };
  }

  // -------------------------------------------------------------------------
  // Display.

  render(el: HTMLElement, view: ComputerView, s: DiveSession, _lang: Lang): void {
    this.lastView = view;
    const html = !view.inDive ? this.surface(view, s) : view.depth < 1.2 ? this.surfacing(view, s) : this.dive(view, s);
    el.innerHTML = `
      <div class="dev gn">
        <div class="gn-case">
          <div class="gn-screen">${html}</div>
          <div class="gn-btns">
            <button class="gn-btn" data-btn="b1"></button><button class="gn-btn" data-btn="b2"></button>
            <button class="gn-btn" data-btn="b3"></button><button class="gn-btn" data-btn="b4"></button>
          </div>
        </div>
      </div>`;
  }

  /** Tank column (§2.3.1 colours: blue / green upper and lower half above the mid tank warning,
   *  yellow down to 50 bar, red below). */
  private tankColumn(v: ComputerView, s: DiveSession, bottomLbl: string, bottomVal: string): string {
    const ai = v.tank.ai;
    const gas = this.nitrox(s) ? `<b class="yel">G1 ${v.o2}%</b>` : '<b>AIR</b>';
    const p = v.tank.pressure;
    const mid = imperial() ? 1500 / 14.5038 : 100;
    const low = imperial() ? 750 / 14.5038 : 50;
    const col = tankRange(p, v.tank.fill, mid, low);
    const fill = ai ? Math.max(0, Math.min(100, (p / v.tank.fill) * 100)) : 0;
    return `<div class="gn-col">
      ${gas}
      <span class="gn-press">${ai ? pressText(p) : ''}</span><span class="gn-pu">${ai ? pressUnit() : ''}</span>
      <div class="gn-tank"><i class="valve"></i><div class="body"><i class="${col}" style="height:${Math.round(fill)}%"></i></div></div>
      <span class="gn-cl">${bottomLbl}</span><span class="gn-cv">${bottomVal}</span>
    </div>`;
  }

  /** Left edge: nitrogen bar graph in 10 % steps (orange up to the load, yellow next, green above:
   *  deduced from the figures), or ascent arrows of 20 % of the allowed rate (§9), red in alarm. */
  private leftBar(v: ComputerView): string {
    if (v.inDive && v.ascentRate > 0.5) {
      const n = Math.min(5, Math.ceil(v.ascentRate / quadAscentLimit(v.depth) / 0.2 - 1e-6));
      const cls = v.ascentLevel === 2 ? 'red' : '';
      return `<div class="gn-bar arrows ${cls}">${Array.from({ length: 5 }, (_, i) => `<i class="${4 - i < n ? 'on' : ''}"></i>`).join('')}</div>`;
    }
    const n = v.inDeco ? 10 : Math.min(10, Math.floor(v.n2Load / 10));
    return `<div class="gn-bar">${Array.from({ length: 10 }, (_, i) => {
      const k = 9 - i; // 0 = bottom
      return `<i class="${k < n ? 'or' : k === n ? 'ye' : 'gr'}"></i>`;
    }).join('')}</div>`;
  }

  private icons(kind: 'std' | 'graph'): string {
    const i = (a: string, b = '') => `<span class="gn-ic"><i>${a}</i>${b ? `<i>${b}</i>` : ''}</span>`;
    return kind === 'std'
      ? `<div class="gn-icons">${i('✦', '▦')}${i('⟲', '◢')}${i('+', '▮')}${i('+', '▥')}</div>`
      : `<div class="gn-icons">${i('◀')}${i('')}${i('+')}${i('▥')}</div>`;
  }

  /** Alarm and warning messages (§8.5), with the band they replace in the figures. */
  private messages(v: ComputerView, s: DiveSession, tts5: number): { mid: string; bot: string } {
    this.acks.begin();
    const ack = (key: string, on: boolean) => this.acks.show(key, on);
    const ai = v.tank.ai;
    let mid = '';
    let bot = '';
    const x = Number(this.settings.ttsx) || 5;
    const runaway = ack('runaway', v.inDeco && tts5 - v.tts >= x * (Number(this.settings.runaway) || 2));
    const cns = ack('cns', v.cns > 75);
    const reserve = ack('reserve', ai && v.tank.pressure <= v.tank.reserve);
    const lowTank = ack('lowtank', ai && v.inDeco && s.diveTime > 120 && v.tank.gasTime !== null && v.tank.gasTime < v.tts);
    if (v.ascentLevel === 2) mid = 'SLOW DOWN!'; // §8.5: the ascent rate alarm has priority
    else if (runaway) mid = 'RUNAWAY DECO';
    else if (cns) mid = 'CNS > 75%';
    else if (reserve) mid = 'TANK RESERVE<br>REACHED';
    if (v.ceilingViolation === 2) bot = 'BACK TO<br>STOP DEPTH';
    else if (this.violation === 'deco') bot = 'VIOLATION -<br>DECO';
    else if (v.depth > v.mod) bot = 'MOD EXCEEDED';
    else if (lowTank) bot = 'LOW TANK<br>PRESSURE';
    return { mid, bot };
  }

  private dive(v: ComputerView, s: DiveSession): string {
    const du = depthUnit();
    const x = Number(this.settings.ttsx) || 5;
    const tts5 = v.inDeco ? this.ttsPlus(v, s, x) : 0;
    const msg = this.messages(v, s, tts5);
    // An alarm kicks out of the graphic displays (§8.5 note).
    if (msg.mid || msg.bot) this.mode = 'std';
    if (this.locked) return this.bottomTimer(v, s);

    const modAlarm = v.depth > v.mod;
    const aboveStop = v.ceilingViolation === 2;
    const tops = this.topFields(s, v);
    let top = tops[this.topIdx % tops.length];
    if (modAlarm) top = 'mod';
    if (msg.mid === 'RUNAWAY DECO') top = 'tts5';
    const tf = this.topValue(top, v, s, tts5, msg.mid === 'RUNAWAY DECO');
    const topBand = `<div class="gn-top ${modAlarm || aboveStop ? 'red' : ''}">
        <span class="gn-lbl">DEPTH</span><span class="gn-rlbl">${tf.lbl}</span>
        <span class="gn-depth">${depthText(v.depth)}<u>${du}</u></span>
        <span class="gn-tv ${tf.cls}">${tf.val}</span>
      </div>`;

    if (this.mode !== 'std') {
      const right = v.inDeco ? `<span class="gn-rlbl or">TTS</span><span class="gn-tv or">${v.tts}:</span>` : `<span class="gn-rlbl">NO DECO</span><span class="gn-tv">${Math.min(99, v.ndl)}:</span>`;
      const head = `<div class="gn-top"><span class="gn-lbl">DEPTH</span>${right}<span class="gn-depth">${depthText(v.depth)}<u>${du}</u></span></div>`;
      const body = this.mode === 'profile' ? this.profile(v, s) : this.tissues(v, s);
      return `${this.leftBar(v)}<div class="gn-main">${head}${body}</div>${this.tankColumn(v, s, 'TTR', this.ttrText(v, s))}${this.icons('graph')}`;
    }

    // Middle band: no deco (green), deco or deep stop (orange), safety stop (green), or a message (red).
    let midBand: string;
    if (msg.mid) {
      midBand = `<div class="gn-mid red"><span class="gn-msg">${msg.mid}</span></div>`;
    } else if (v.inDeco && v.stopDepth > 0) {
      midBand = `<div class="gn-mid orange"><span class="gn-lbl">DECO</span><span class="gn-rlbl">TTS</span>
        <span class="gn-stop">${depthInt(v.stopDepth)}<u>${du}</u> ${Math.min(99, v.stopTime)}:</span><span class="gn-mv">${v.tts}:</span></div>`;
    } else if (this.deep.state === 'active') {
      midBand = `<div class="gn-mid orange"><span class="gn-lbl">DEEP</span><span class="gn-rlbl">TIMER</span>
        <span class="gn-stop">${depthInt(this.deep.depth)}<u>${du}</u></span><span class="gn-mv">${mmss(this.deep.remaining)}</span></div>`;
    } else if (v.safety.state === 'active' || v.safety.state === 'paused') {
      midBand = `<div class="gn-mid green"><span class="gn-lbl">SAFETY</span><span class="gn-big">${mmss(Math.ceil(v.safety.remaining))}</span></div>`;
    } else {
      // §9.1: "Maximum displayed no deco time is 99 minutes."
      midBand = `<div class="gn-mid green"><span class="gn-lbl">NO<br>DECO</span><span class="gn-big">${Math.min(99, v.ndl)}:</span></div>`;
    }

    // Bottom row: dive time (ascent speed while ascending) and the selected field, or a message.
    let botRow: string;
    if (msg.bot) {
      botRow = `<div class="gn-bot red"><span class="gn-msg">${msg.bot}</span></div>`;
    } else {
      const now = performance.now();
      if (this.botUntil && now > this.botUntil) {
        this.botUntil = 0;
        this.botIdx = 0;
      }
      const fields = this.bottomFields(s);
      let f = fields[this.botIdx % fields.length];
      if (v.cns > 75 && fields.includes('cns') && !this.botUntil) f = 'cns'; // §8.5.3
      let bf = this.bottomValue(f, v, s);
      // §9.1.1: GF @+3 next to GF @SURF once the safety stop countdown begins.
      if ((v.safety.state === 'active' || v.safety.state === 'paused') && f === 'gf') bf = { lbl: 'GF@SURF/GF@+3', val: `${Math.round(v.surfGf)}/${this.gfAt3(v, s)}` };
      const left = v.ascentRate > 0.5
        ? `<span class="gn-lbl">SPEED</span><span class="gn-dt">${Math.round(imperial() ? v.ascentRate * 3.28084 : v.ascentRate)}<u class="frac">${du}<br>min</u></span>`
        : `<span class="gn-lbl">D-TIME</span><span class="gn-dt">${Math.floor(v.diveTime / 60)}:${this.settings.seconds === 'on' ? `<sup>${pad2(Math.floor(v.diveTime % 60))}</sup>` : ''}</span>`;
      botRow = `<div class="gn-bot">${left}<span class="gn-rlbl">${bf.lbl}</span><span class="gn-bv ${bf.cls ?? ''}">${bf.val}</span></div>`;
    }
    return `${this.leftBar(v)}<div class="gn-main">${topBand}${midBand}${botRow}</div>${this.tankColumn(v, s, 'TTR', this.ttrText(v, s))}${this.icons('std')}`;
  }

  /** "-" during the first two minutes, as in the figures (breathing rate not yet known). */
  private ttrText(v: ComputerView, s: DiveSession): string {
    return v.tank.gasTime === null || s.diveTime < 120 ? '-' : `${v.tank.gasTime}:`;
  }

  private topValue(f: TopField, v: ComputerView, s: DiveSession, tts5: number, alarm: boolean): { lbl: string; val: string; cls?: string } {
    const du = depthUnit();
    const x = Number(this.settings.ttsx) || 5;
    switch (f) {
      case 'max': return { lbl: 'MAX', val: `${depthText(v.maxDepth)}<u>${du}</u>` };
      case 'avg': return { lbl: 'AVG', val: `${depthText(v.avgDepth)}<u>${du}</u>` };
      case 'mod': return { lbl: 'MOD', val: `${depthText(v.mod)}` };
      case 'deep': return { lbl: 'DEEP', val: `${depthInt(this.deep.depth)}` };
      case 'tts5': return { lbl: `TTS @+${x}`, val: `${tts5 || this.ttsPlus(v, s, x)}:`, cls: alarm ? 'redt' : '' };
      case 'ceil': return { lbl: 'CEILING', val: v.ceiling > 0 ? `${depthText(v.ceiling)}<u>${du}</u>` : '-' };
      default: return { lbl: 'TEMP', val: `${Math.round(tempVal(v.temperature))}<u>${tempUnit()}</u>` };
    }
  }

  private bottomValue(f: BottomField, v: ComputerView, s: DiveSession): { lbl: string; val: string; cls?: string } {
    const { h, m } = clockOfDay(s);
    const batt = (lbl: string) => ({ lbl, val: `<span class="gn-batt"><i></i><i></i><i></i></span>${lbl === 'G1 BATT' ? '' : `${BATTERY}<u>%</u>`}` });
    switch (f) {
      case 'gfnow': return { lbl: 'GF NOW/GF@SURF', val: `${Math.round(v.gf99)}/${Math.round(v.surfGf)}` };
      case 'gfrate': {
        const r = this.gfRate(v, s);
        return { lbl: 'GF@SURF/GF RATE', val: `${Math.round(v.surfGf)}/<span class="${r.cls}">${r.text}</span>` };
      }
      case 'sw': return { lbl: 'STOPWATCH', val: mmss(v.diveTime - this.stopwatchFrom) };
      case 'cns': return { lbl: 'CNS%', val: `${Math.round(v.cns)}<u>%</u>`, cls: v.cns > 75 ? 'redt' : '' };
      case 'ppo2': return { lbl: 'PPO2', val: v.ppO2.toFixed(2) };
      case 'time': return { lbl: 'TIME', val: `${h}:${pad2(m)}` };
      case 'batt': return batt('');
      case 'tbatt': return batt('G1 BATT');
      case 'gas': return { lbl: imperial() ? 'cuft/min' : 'l/min', val: imperial() ? (s.rmv / 28.3168).toFixed(2) : String(Math.round(s.rmv)) };
      default: return { lbl: 'MAIN GF', val: `${v.gfLow}/${v.gfHigh}` };
    }
  }

  /** §9.3: depth profile so far, with the stops in deco. */
  private profile(v: ComputerView, s: DiveSession, short = false): string {
    const pts = [...s.profile.map((p) => [p.t, p.depth] as const), [v.diveTime, v.depth] as const];
    // In deco the time axis goes on to the end of the ascent, so the stops show (§9.3 figure).
    const tMax = Math.max(600, v.diveTime + (v.inDeco ? v.tts * 60 : 0));
    const dMax = Math.max(10, Math.ceil(v.maxDepth / 10) * 10);
    const X = (t: number) => ((t / tMax) * 180).toFixed(1);
    const Y = (d: number) => ((d / dMax) * 120).toFixed(1);
    const grid = Array.from({ length: dMax / 10 + 1 }, (_, i) => `<line x1="0" x2="180" y1="${Y(i * 10)}" y2="${Y(i * 10)}"/><text x="-3" y="${Y(i * 10)}">${i ? -depthInt(i * 10) : 0}</text>`).join('');
    const stops = v.inDeco ? v.plan.stops.map((st) => `<line class="stop" x1="${X(v.diveTime)}" x2="180" y1="${Y(st.depth)}" y2="${Y(st.depth)}"/>`).join('') : '';
    return `<div class="gn-graph ${short ? 'short' : ''}"><svg viewBox="-16 -6 200 132" preserveAspectRatio="none">${grid}${stops}<polyline points="${pts.map(([t, d]) => `${X(t)},${Y(d)}`).join(' ')}"/></svg></div>`;
  }

  /** §9.5: tension of the 16 tissues, red segments at the tolerated pressure at the surface and at
   *  each stop, yellow line at the inspired nitrogen pressure; yellow bars ongassing, green offgassing. */
  private tissues(v: ComputerView, s: DiveSession): string {
    const p = this.decoParams(s);
    const inspired = (s.pressure - WATER_VAPOUR) * (1 - s.gas.o2);
    const depths = [0, ...v.plan.stops.map((st) => st.depth)];
    // Maximum tolerated tissue tension at an ambient pressure: the M-value reduced by GF high.
    const tol = (i: number, d: number) => {
      const [a, b] = s.tissues.coefficients(i);
      const amb = depthToPressure(d);
      return amb + p.gfHigh * (amb / b + a - amb);
    };
    let top = inspired;
    for (let i = 0; i < 16; i++) top = Math.max(top, s.tissues.n2[i] + s.tissues.he[i], tol(i, 0));
    const Y = (x: number) => (120 - (x / (top * 1.08)) * 120).toFixed(1);
    const bars = Array.from({ length: 16 }, (_, i) => {
      const pt = s.tissues.n2[i] + s.tissues.he[i];
      const x = 4 + i * 11;
      const reds = depths.map((d) => `<line class="tol" x1="${x - 1}" x2="${x + 8}" y1="${Y(tol(i, d))}" y2="${Y(tol(i, d))}"/>`).join('');
      return `<rect class="${pt < inspired ? 'on' : 'off'}" x="${x}" y="${Y(pt)}" width="7" height="${(120 - Number(Y(pt))).toFixed(1)}"/>${reds}`;
    }).join('');
    return `<div class="gn-graph white"><svg viewBox="0 -4 184 128">${bars}<line class="insp" x1="0" x2="184" y1="${Y(inspired)}" y2="${Y(inspired)}"/></svg></div>`;
  }

  /** §12: depth, max / average depth, stopwatch, dive time, temperature; LOCKED BY PREVIOUS DIVE. */
  private bottomTimer(v: ComputerView, s: DiveSession): string {
    const du = depthUnit();
    const tops: TopField[] = ['max', 'avg', 'temp'];
    const tf = this.topValue(tops[this.topIdx % tops.length], v, s, 0, false);
    return `<div class="gn-bar"></div><div class="gn-main">
        <div class="gn-top"><span class="gn-lbl">DEPTH</span><span class="gn-rlbl">${tf.lbl}</span>
          <span class="gn-depth">${depthText(v.depth)}<u>${du}</u></span><span class="gn-tv">${tf.val}</span></div>
        <div class="gn-mid red"><span class="gn-msg">LOCKED BY<br>PREVIOUS DIVE</span></div>
        <div class="gn-bot"><span class="gn-lbl">D-TIME</span><span class="gn-dt">${Math.floor(v.diveTime / 60)}:</span>
          <span class="gn-rlbl">STOPWATCH</span><span class="gn-bv">${mmss(v.diveTime - this.stopwatchFrom)}</span></div>
      </div>${this.tankColumn(v, s, 'TTR', this.ttrText(v, s))}${this.icons('std')}`;
  }

  /** §10 figure: time to surface mode countdown, profile, dive time, average depth, CNS. */
  private surfacing(v: ComputerView, s: DiveSession): string {
    const du = depthUnit();
    const { h, m } = clockOfDay(s);
    const t = Math.max(0, DIVE_END_TIMEOUT - s.surfaceTimer);
    return `${this.leftBar(v)}<div class="gn-main">
        <div class="gn-top plain"><span class="gn-lbl">TIME TO SURFACE MODE:</span><span class="gn-rlbl">TIME</span>
          <span class="gn-depth small">${pad2(Math.floor(t / 60))}:${pad2(Math.floor(t % 60))}</span><span class="gn-tv small">${h}:${pad2(m)}</span></div>
        ${this.profile(v, s, true)}
        <div class="gn-bot tri"><span><em>D-TIME</em><b>${Math.floor(v.diveTime / 60)}:</b></span><span><em>AVG</em><b>${depthText(v.avgDepth)}<u>${du}</u></b></span>
          ${this.nitrox(s) ? `<span><em>CNS%</em><b>${Math.round(v.cns)}</b></span>` : ''}<span class="gn-batt"><i></i><i></i><i></i></span></div>
      </div>${this.tankColumn(v, s, 'TTR', this.ttrText(v, s))}<div class="gn-icons"><span class="gn-ic"><i>✦</i></span></div>`;
  }

  /** HOME (figure of §1.6; with desaturation: surface interval and GF NOW, §10) and POST DIVE. */
  private surface(v: ComputerView, s: DiveSession): string {
    if (!this.hasPostDive(s)) this.surfacePage = 'home';
    const { h, m } = clockOfDay(s);
    const day = Math.floor((s.clock + 9 * 3600) / 86400);
    const date = new Date(2026, 8, 26 + day);
    const dateText = `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
    const p = this.decoParams(s);
    const liters = imperial() ? (s.tank.volume * s.tank.fill / 28.3168).toFixed(0) : String(s.tank.volume);
    const lock = this.locked ? `<div class="gn-lock">LOCKED BY PREVIOUS DIVE · ${hmm(Math.max(0, (this.lockedUntil - s.clock) / 60))}</div>` : '';
    const labels = '<div class="gn-labels"><span>PREDIVE</span><span>LOG/PLAN</span><span>GAS/GF</span><span>MENU/BT</span></div>';
    const tank = this.tankColumn(v, s, imperial() ? 'CUFT' : 'LITERS', liters);
    if (this.surfacePage === 'post') {
      const last = s.log[s.log.length - 1];
      const g = s.tissues.gradientPercents(depthToPressure(0));
      const bars = g.map((x) => `<i style="height:${Math.max(0, Math.min(100, Math.round(x / 10) * 10))}%"></i>`).join('');
      return `<div class="gn-home">
          <div class="gn-post">
            <span><em>DESAT</em><b>${hmm(v.desat)}</b></span><span><em>NO-FLY</em><b>${hmm(this.noFlyMin(s))}</b></span>
            <span><em>SURF. INT.</em><b>${hmm((s.surfaceInterval ?? 0) / 60)}</b></span><span><em>CNS</em><b>${Math.round(v.cns)}%</b></span>
            <span><em>MAX</em><b>${depthText(last.maxDepth)}${depthUnit()}</b></span><span><em>TEMP</em><b>${Math.round(tempVal(last.minTemp))}${tempUnit()}</b></span>
            <span><em>D-TIME</em><b>${Math.round(last.duration / 60)}:</b></span><span><em>${pressUnit()}</em><b>${pressText(last.tankStart)}/${pressText(last.tankEnd)}</b></span>
          </div>
          <div class="gn-tbars">${bars}</div>
        </div>${tank}${labels}${lock}`;
    }
    const desat = v.desat > 0 && s.log.length > 0;
    return `<div class="gn-home">
        <span class="gn-ice">✚</span>
        <span class="gn-date">${desat ? `SURF: ${hmm((s.surfaceInterval ?? 0) / 60)}` : dateText}</span>
        <span class="gn-clock">${h}:${pad2(m)}</span>
        <span class="gn-temp">${desat ? `GF NOW: ${Math.round(v.surfGf)}` : `${Math.round(tempVal(v.temperature))}${tempUnit()}`}</span>
        <span class="gn-photo"></span>
        <span class="gn-gfs">GF ${Math.round(p.gfLow * 100)}/${Math.round(p.gfHigh * 100)} - AGF 85/85<br><small>▲ A0</small></span>
        <span class="gn-batt home"><i></i><i></i><i></i></span>
      </div>${tank}${labels}${lock}`;
  }
}
