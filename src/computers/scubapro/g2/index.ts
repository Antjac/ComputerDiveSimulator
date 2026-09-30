import type { DiveSession } from '../../../engine/session';
import { depthInt, depthText, imperial, pressText, pressUnit, tempUnit, tempVal } from '../../../units';
import type { Lang } from '../../../i18n';
import { ButtonHelp, ComputerView, clockOfDay, hmm, mmss } from '../../base';
import { idealAscent } from '../common';
import { type G2Warning, G2Rules } from './rules';

const DU = () => (imperial() ? 'FEET' : 'METER');
const DU1 = () => (imperial() ? 'FT' : 'M');
const TU = () => tempUnit();

/** Pop-up texts of the §3.5 warnings, as on the figures ("ENTERING DECO" has no figure: deduced from "ENTERING DECO AT L0"). */
function warningText(k: G2Warning, tankWarn: number): string {
  switch (k) {
    case 'depth': return 'MAX DEPTH REACHED';
    case 'cns75': return 'CNS O2 = 75%';
    case 'nostop': return 'NO STOP = 2 MINUTES';
    case 'deco': return 'ENTERING DECO';
    case 'time': return 'TIME LIMIT REACHED';
    case 'turn': return 'TURN-AROUND TIME';
    // §3.5.7 figure: "100BAR REACHED" (the psi wording is not shown: same pattern assumed).
    case 'tank': return `${pressText(tankWarn)}${pressUnit().toUpperCase()} REACHED`;
    case 'rbt3': return 'RBT = 3 MINUTES';
    case 'levelStops': return 'ENTERING LEVEL STOPS';
    case 'mbIgnored': return 'MB STOP IGNORED';
    case 'mbReduced': return 'MB LEVEL REDUCED';
    case 'l0Nostop': return 'L0 NO-STOP = 2MIN';
    case 'l0Deco': return 'ENTERING DECO AT L0';
  }
}

/** Stop window content, as in the manual: "10:  3" with MINUTE / METER underneath. */
function stopValue(minutes: number, depth: number): string {
  return `<span>${minutes}:</span><span class="g2-gap">${depthInt(depth)}</span><em class="g2-sub l">MINUTE</em><em class="g2-sub r">${DU()}</em>`;
}

/** Scubapro G2: buttons and display, after the manual (rules in rules.ts). */
export class ScubaproG2 extends G2Rules {
  // User manual §3.2 (button functions while diving) and §3.7.2–3.7.6: left sets a bookmark (and
  // restarts the safety stop timer), middle steps through the alternate window, right brightens the
  // backlight; holding middle shows the profile, holding right shows the compass.
  press(button: string): boolean {
    if (button === 'more') this.setScreen((this.screen + 1) % this.altCount);
    else if (button === 'timer') {
      if (this.safetyState === 'active' || this.safetyState === 'paused') this.safetyRemaining = this.safetyTotal;
      this.flash('BOOKMARK SET');
    } else if (button === 'dim') this.backlightUntil = performance.now() + 6000;
    else return false;
    return true;
  }

  private altCount = 8;

  buttons(): Record<string, ButtonHelp> {
    return {
      timer: {
        name: 'TIMER · BOOK',
        press: {
          real: { fr: 'Pose un repère (bookmark) ; relance le palier de sécurité ; remet le chronomètre à zéro (Classic/Full/Graphical)', en: 'Sets a bookmark; restarts the safety stop timer; resets the stopwatch (Classic/Full/Graphical)' },
          simulated: true,
          note: { fr: 'chronomètre non simulé', en: 'stopwatch not simulated' },
        },
        hold: { real: { fr: 'Changement de gaz manuel (multigaz uniquement)', en: 'Manual gas switch (multi-gas only)' }, simulated: false },
      },
      more: {
        name: 'MORE',
        press: {
          real: { fr: 'Fenêtre d’information suivante (profondeur max, PDIS, température, niveau MB, heure, CNS…)', en: 'Next alternate window (max depth, PDIS, temperature, MB level, time, CNS…)' },
          simulated: true,
          note: { fr: 'séquence de l’écran Light pour toutes les configurations ; fréquence cardiaque, température cutanée et batterie absentes', en: 'Light-screen sequence for every layout; heart rate, skin temperature and battery omitted' },
        },
        hold: { real: { fr: 'Profil de plongée, saturation des compartiments, images', en: 'Dive profile, compartment saturation, pictures' }, simulated: false },
      },
      dim: {
        name: 'LIGHT · DIM',
        press: { real: { fr: 'Augmente le rétroéclairage', en: 'Brightens the backlight' }, simulated: true },
        hold: { real: { fr: 'Boussole', en: 'Compass' }, simulated: false },
      },
    };
  }

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    const screen = this.currentScreen();
    const ideal = idealAscent(v.depth);
    const pct = Math.max(0, Math.round((v.ascentRate / ideal) * 100));

    // MB level information (level stops are not mandatory).
    const lv = this.levelInfo(v, s);
    const { ndl: levelNdl, stop: levelStop, tat: levelTat } = lv;
    // §3.5 warnings shown in the pop-up window; §3.5.1: "the related data window is highlighted".
    const warnings = this.updateWarnings(v, lv, s);
    const warn = warnings[0];

    // Pop-up bar: alarm (red, §3.6) > warning (yellow, §3.5) > button labels.
    let bar = '<span>TIMER</span><span>MORE</span><span>DIM</span>';
    let barCls = '';
    if (v.inDive) {
      if (this.ascentAlarm) [bar, barCls] = ['ASCENT TOO FAST', 'red'];
      else if (v.ceilingViolation === 2) [bar, barCls] = ['MISSED DECO STOP!', 'red'];
      else if (v.depth > v.mod) [bar, barCls] = ['MOD EXCEEDED', 'red'];
      else if (v.cns >= 100) [bar, barCls] = ['CNS O2 = 100%', 'red'];
      else if (v.tank.ai && v.tank.pressure < v.tank.reserve) [bar, barCls] = ['TANK RESERVE REACHED', 'red'];
      else if (v.tank.ai && v.tank.gasTime === 0) [bar, barCls] = ['RBT = 0 MIN', 'red'];
      else if (warn) [bar, barCls] = [warningText(warn, this.tankWarnPressure() ?? 0), 'yellow'];
    }
    const hl = (...k: G2Warning[]) => (k.some((x) => warnings.includes(x)) ? 'yellow' : '');
    const note = this.flashMessage();
    if (note && barCls !== 'red') [bar, barCls] = [note, ''];

    // Depth window colour follows the ascent speed (yellow > 110 %, red > 140 %).
    const depthWin = v.ascentLevel === 2 ? 'red' : v.ascentLevel === 1 ? 'yellow' : hl('depth', 'mbIgnored');
    const depthTxt = v.depth < 0.8 ? '---' : depthText(v.depth);
    const depthCls = v.depth > v.mod || v.ceilingViolation === 2 ? 'red blink' : '';

    // Alternate information window (MORE button, Light configuration sequence without tank).
    const alt = this.altInfo(screen, v, s, levelNdl);

    // Main decompression window.
    let mainLbl = 'NO STOP';
    let mainUnit = 'MIN';
    // Display information: "Maximum displayed no-stop times is 99 minutes."
    let mainVal = `${Math.min(99, this.activeLevel > 0 ? levelNdl : v.ndl)}:`;
    let mainCls = '';
    let tat: string | null = null;
    if (v.locked) {
      // SOS lock: countdown at the surface; dives in Gauge mode, without decompression information.
      [mainLbl, mainUnit, mainVal] = v.inDive ? ['GAUGE', '', '--'] : ['SOS', 'HR', hmm(Math.max(0, (this.lockedUntil - s.clock) / 60))];
      mainCls = 'red';
    } else if (!v.inDive) {
      [mainLbl, mainUnit, mainVal] = ['DESAT', 'HR', v.desat > 0 ? hmm(v.desat) : '--'];
    } else if (v.inDeco) {
      [mainLbl, mainUnit] = ['DECO STOP', ''];
      mainVal = stopValue(v.stopTime, v.stopDepth);
      mainCls = v.ceilingViolation === 2 ? 'red' : 'deco';
      tat = `${v.tts}:`;
    } else if (levelStop) {
      [mainLbl, mainUnit] = ['LEVEL STOP', ''];
      mainVal = stopValue(levelStop.min, levelStop.depth);
      mainCls = 'level';
      tat = `${levelTat}:`;
    } else if (v.safety.state === 'active' || v.safety.state === 'paused' || (v.safety.state === 'pending' && v.depth <= 5.5)) {
      [mainLbl, mainUnit, mainVal] = ['SAFETY STOP', 'MIN', mmss(v.safety.remaining)];
    } else if (this.pdisState === 'active') {
      [mainLbl, mainUnit, mainVal] = [`PDIS ${depthInt(this.pdisDepth)}${DU1()}`, 'MIN', mmss(this.pdisRemaining)];
    }
    const noStopLow = mainLbl === 'NO STOP' && (this.activeLevel > 0 ? levelNdl : v.ndl) <= 2 ? 'yellow' : hl('deco', 'levelStops', 'l0Deco');

    // Light is the factory default; it switches to Classic automatically when decompression (or level
    // stop) information must be shown. Classic, Full and Graphical keep their layout.
    const layout = this.settings.screen === 'light' && tat !== null ? 'classic' : this.settings.screen;
    const win = (lbl: string, unit: string, body: string, cls = '', extra = '') =>
      `<div class="g2-win ${cls} ${extra}"><div class="g2-h"><span>${lbl}</span><span>${unit}</span></div><div class="g2-v">${body}</div></div>`;
    // Long alternate values (e.g. the L0 stop "40FT 1'") get a smaller font to stay inside the window.
    const altCls = (val: string) => (val.length > 5 ? 'g2-long' : '');
    // While ascending, the ascent speed (% of the ideal rate) replaces the unit in the depth header.
    const speed = v.inDive && pct > 0 && v.ascentRate > 0.5 ? `▲ ${pct}%` : DU();
    const depthWinHtml = (extra: string) => win('DEPTH', speed, `<span class="${depthCls}">${depthTxt}</span>`, depthWin, extra);
    // Tank window (Smart transmitter) and RBT.
    // §3.5.1: the data window related to a warning is highlighted (yellow) while it shows.
    const tankCls = v.tank.pressure < v.tank.reserve ? 'red' : hl('tank');
    const tankHtml = (extra: string, withO2 = true) => win('TANK', pressUnit().toUpperCase(),
      `${pressText(v.tank.pressure)}${withO2 ? `<span class="g2-o2">${v.o2}%<small>O2</small></span>` : ''}`, tankCls, extra);
    const rbt = v.tank.gasTime;
    const rbtHtml = (extra: string) => win('RBT', 'MIN', rbt === null ? '--' : `${rbt}:`, rbt !== null && rbt <= 3 ? (rbt === 0 ? 'red' : 'yellow') : '', extra);
    const ai = v.tank.ai;
    const diveTimeHtml = (extra: string, colon = true) => win(v.inDive ? 'DIVE TIME' : 'SURF. INT.', v.inDive ? 'MIN' : 'HR',
      v.inDive ? `${Math.floor(v.diveTime / 60)}${colon ? ':' : ''}` : v.surfaceInterval !== null ? hmm(v.surfaceInterval / 60) : '--', hl('time', 'turn'), extra);
    // The Classic main window is narrow: long labels (SAFETY STOP, LEVEL STOP) drop the unit.
    const mainHtml = (extra: string) =>
      win(mainLbl, extra === 'c-main' && mainLbl.length > 9 ? '' : mainUnit, mainVal, `${mainCls} ${noStopLow}`, extra);
    const tatHtml = (extra: string) => win('TAT', 'MIN', tat ?? `${v.tts}:`, '', extra);
    const { h, m } = clockOfDay(s);
    const clock = `${h}:${String(m).padStart(2, '0')}`;

    let grid: string;
    if (layout === 'classic') {
      grid = `<div class="g2-grid classic">
        ${depthWinHtml('c-depth')}
        ${win('TEMP', '', `${Math.round(tempVal(v.temperature))}<small>${TU()}</small>`, '', 'c-temp')}
        ${diveTimeHtml('c-time', false)}
        ${win(alt.lbl, alt.unit, alt.val, altCls(alt.val), 'c-alt')}
        ${mainHtml('c-main')}
        ${tatHtml('c-tat')}
        ${ai ? tankHtml('c-o2', false) : win('O2', '', `${v.o2}<small>%</small>`, '', 'c-o2')}
        ${ai ? win('O2', '', `${v.o2}<small>%</small>`, '', 'c-cns') : win('CNS', '%', String(Math.round(v.cns)), v.cns >= 75 ? 'yellow' : '', 'c-cns')}
        ${ai ? rbtHtml('c-mb') : win('MB', '', `L${this.activeLevel}`, Number(this.settings.level) !== this.activeLevel ? 'yellow' : '', 'c-mb')}
      </div>`;
    } else if (layout === 'full') {
      // Full: every parameter at once (no tank transmitter, no heart-rate belt in the simulator).
      const sw = Math.floor(v.diveTime);
      const fAlt = this.fullAlt(screen, v);
      grid = `<div class="g2-grid full">
        ${win('TEMP', '', `${Math.round(tempVal(v.temperature))}<small>${TU()}</small>`, '', 'f-temp')}
        ${win('MB', '', `L${this.activeLevel}`, Number(this.settings.level) !== this.activeLevel ? 'yellow' : '', 'f-mb')}
        ${win('STOP WATCH', '', `${Math.floor(sw / 3600)}:${String(Math.floor(sw / 60) % 60).padStart(2, '0')}.${String(sw % 60).padStart(2, '0')}`, '', 'f-sw')}
        ${win('TIME', '', clock, '', 'f-clock')}
        ${depthWinHtml('f-depth')}
        ${diveTimeHtml('f-dtime')}
        ${win('HEART', '', '---', '', 'f-heart')}
        ${win('MAX', DU1(), depthText(v.maxDepth), '', 'f-max')}
        ${mainHtml('f-main')}
        ${tatHtml('f-tat')}
        ${win('AVG', DU1(), depthText(v.avgDepth), '', 'f-avg')}
        ${ai ? tankHtml('f-o2', false) : win(fAlt.lbl, fAlt.unit, fAlt.val, altCls(fAlt.val), 'f-o2')}
        ${win('CNS', '%', String(Math.round(v.cns)), v.cns >= 75 ? 'yellow' : '', 'f-cns')}
        ${ai ? rbtHtml('f-ppo2') : win('PPO2', 'BAR', v.ppO2.toFixed(2), v.ppO2 > 1.4 ? 'yellow' : '', 'f-ppo2')}
      </div>`;
    } else if (layout === 'graphical') {
      grid = `<div class="g2-grid graphical">
        <div class="g2-graph">${this.profileGraph(v, s)}</div>
        ${win('TEMP', '', `${Math.round(tempVal(v.temperature))}<small>${TU()}</small>`, '', 'g-temp')}
        ${win('MAX', DU1(), depthText(v.maxDepth), '', 'g-max')}
        ${ai ? rbtHtml('g-tat') : tatHtml('g-tat')}
        ${depthWinHtml('g-depth')}
        ${ai ? tankHtml('g-alt') : win(alt.lbl, (alt.lbl + alt.unit).length > 12 ? '' : alt.unit, `${alt.val}<span class="g2-o2">${v.o2}%<small>O2</small></span>`, altCls(alt.val), 'g-alt')}
        ${win('TIME', '', clock, '', 'g-clock')}
        ${mainHtml('g-main')}
        ${diveTimeHtml('g-dtime')}
      </div>`;
    } else {
      grid = `<div class="g2-grid light">
        ${depthWinHtml('big')}
        ${diveTimeHtml('big', false)}
        ${ai && screen === 0 ? tankHtml('big') : win(alt.lbl, alt.unit, `${alt.val}<span class="g2-o2">${v.o2}%<small>O2</small></span>`, altCls(alt.val), 'big')}
        ${mainHtml('big')}
      </div>`;
    }

    // Side bar graphs: O2 (CNS) on the left, N2 (leading tissue) on the right.
    const o2h = Math.min(100, v.cns);
    const n2h = Math.min(100, v.n2Load);

    el.innerHTML = `
      <div class="dev g2">
        <div class="g2-case">
          <button class="g2-btn l" data-btn="timer"></button>
          <button class="g2-btn m" data-btn="more"></button>
          <button class="g2-btn r" data-btn="dim"></button>
          <div class="g2-screen ${this.backlit ? 'backlit' : ''}">
            <div class="g2-bar ${barCls} ${barCls === 'red' ? 'blink' : ''}">${bar}</div>
            <div class="g2-side l"><span>O2</span><div><i style="height:${Math.round(o2h)}%"></i></div></div>
            <div class="g2-side r"><span>N2</span><div><i style="height:${Math.round(n2h)}%" class="${v.inDeco ? 'red' : ''}"></i></div></div>
            ${grid}
          </div>
        </div>
      </div>`;
  }

  /** Full screen: the MORE button cycles the lower-left window (manual §3.8.1). */
  private fullAlt(screen: number, v: ComputerView): { lbl: string; unit: string; val: string } {
    const pdis = this.pdisState === 'ok' ? 'OK' : this.pdisState === 'no' ? 'NO' : this.pdisDepth > 8 ? String(this.pdisDepth) : '--';
    const seq = [
      { lbl: 'O2', unit: '', val: `${v.o2}<small>%</small>` },
      { lbl: 'PDIS', unit: DU(), val: pdis },
      { lbl: 'AVG DEPTH', unit: DU1(), val: depthText(v.avgDepth) },
      { lbl: 'BATTERY', unit: '%', val: '87' },
      { lbl: 'CNS', unit: '%', val: String(Math.round(v.cns)) },
      { lbl: 'PPO2', unit: 'BAR', val: v.ppO2.toFixed(2) },
      { lbl: 'OTU', unit: '', val: String(Math.round(v.otu)) },
    ];
    return seq[screen % seq.length];
  }

  /**
   * Graphical screen: the dive profile so far, the diver as a grey cursor line, and the projected
   * ascent with its stops on the right of the cursor.
   */
  private profileGraph(v: ComputerView, s: DiveSession): string {
    const past: [number, number][] = v.inDive ? [...s.profile.map((p) => [p.t, p.depth] as [number, number]), [v.diveTime, v.depth]] : [];
    const now = v.inDive ? v.diveTime : 0;
    // Projected ascent at 10 m/min with the planned stops (and the safety stop when pending).
    const proj: [number, number][] = [[now, v.depth]];
    let t = now;
    let d = v.depth;
    const stops = v.plan.stops.map((st) => ({ depth: st.depth, min: st.minutes }));
    if (!stops.length && v.maxDepth > 10 && v.safety.state !== 'done' && v.depth > 5) stops.push({ depth: 5, min: v.safety.remaining / 60 });
    for (const st of stops) {
      t += ((d - st.depth) / 10) * 60;
      d = st.depth;
      proj.push([t, d]);
      t += st.min * 60;
      proj.push([t, d]);
    }
    t += (d / 10) * 60;
    proj.push([t, 0]);

    const tMax = Math.max(t, 600);
    const dMax = Math.max(10, v.maxDepth) * 1.1;
    const X = (x: number) => ((x / tMax) * 200).toFixed(1);
    const Y = (y: number) => ((y / dMax) * 100).toFixed(1);
    const area = past.length > 1 ? `M 0 0 ${past.map(([x, y]) => `L ${X(x)} ${Y(y)}`).join(' ')} L ${X(now)} 0 Z` : '';
    const line = proj.map(([x, y], i) => `${i ? 'L' : 'M'} ${X(x)} ${Y(y)}`).join(' ');
    return `<svg viewBox="0 0 200 100" preserveAspectRatio="none">
      <path d="${area}" fill="#1f56c9" stroke="#6fa0ff" stroke-width="0.8" vector-effect="non-scaling-stroke"/>
      <path d="${line}" fill="none" stroke="#36e036" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
      <line x1="${X(now)}" y1="0" x2="${X(now)}" y2="100" stroke="#9a9a9a" stroke-width="2" vector-effect="non-scaling-stroke"/>
    </svg>`;
  }

  private altInfo(screen: number, v: ComputerView, s: DiveSession, _levelNdl: number): { lbl: string; unit: string; val: string } {
    if (!v.inDive) return { lbl: 'NO FLY', unit: 'HR', val: v.noFly > 0 ? `${Math.ceil(v.noFly / 60)}` : '--' };
    const pdis = this.settings.pdis === 'on'
      ? { lbl: 'PDIS', unit: DU(), val: this.pdisState === 'ok' ? 'OK' : this.pdisState === 'no' ? 'NO' : this.pdisDepth > 8 ? String(depthInt(this.pdisDepth)) : '--' }
      : { lbl: 'PDIS', unit: '', val: 'OFF' };
    const { h, m } = clockOfDay(s);
    const l0 = v.inDeco ? `${depthInt(v.stopDepth)}${DU1()} ${v.stopTime}'` : `${v.ndl}:`;
    const seq = [
      // Default window: PDIS when one is pending, otherwise max depth.
      this.pdisState === 'shown' || this.pdisState === 'active' ? pdis : { lbl: 'MAX DEPTH', unit: DU(), val: depthText(v.maxDepth) },
      { lbl: 'MAX DEPTH', unit: DU(), val: depthText(v.maxDepth) },
      pdis,
      { lbl: 'TEMP', unit: TU(), val: String(Math.round(tempVal(v.temperature))) },
      this.activeLevel > 0 ? { lbl: 'MB LEVEL', unit: '', val: `L${this.activeLevel}` } : null,
      { lbl: 'MB L0', unit: v.inDeco ? '' : 'NO STOP', val: l0 },
      { lbl: 'TIME', unit: '', val: `${h}:${String(m).padStart(2, '0')}` },
      { lbl: 'CNS', unit: '%', val: String(Math.round(v.cns)) },
    ];
    const list = seq.filter((x) => x !== null);
    this.altCount = list.length;
    return list[screen] ?? list[0];
  }
}
