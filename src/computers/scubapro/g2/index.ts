import { WATER_VAPOUR, planAscent } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import { depthInt, depthText, imperial, pressText, pressUnit, tempUnit, tempVal } from '../../../units';
import type { Lang } from '../../../i18n';
import { ButtonHelp, ComputerView, clockOfDay, hmm, mmss } from '../../base';
import { idealAscent, levelParams } from '../common';
import { type G2Warning, G2Rules } from './rules';

const DU = () => (imperial() ? 'FEET' : 'METER');

/** §3.7.1 alternate displays reached with MORE held. */
type AltPage = 'gas' | 'deco' | 'profile' | 'sat';
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
  press(button: string, s: DiveSession): boolean {
    // §3.7.1 alternate displays (MORE held): "With the ARROW buttons you can scroll to the next display"
    // (figures: ⇩ on the left button, ⇧ on the middle one, DIM on the right).
    if (this.alt) {
      this.alt.last = performance.now();
      // The display after the compartment saturation is the list of pictures (not simulated): back to
      // the dive screen instead; ⇩ on the first display goes back to it too (deduced).
      const pages = this.altPages(s);
      const i = pages.indexOf(this.alt.page);
      if (button === 'more' || button === 'timer') {
        const next = pages[i + (button === 'more' ? 1 : -1)];
        if (next) this.alt.page = next;
        else this.alt = null;
      } else if (button === 'dim') this.backlightUntil = performance.now() + 6000;
      return true;
    }
    // §3.4.2 gas switch screen: SAVE (left) confirms, the arrow (middle) proposes another gas.
    if (this.sw !== null) {
      if (button === 'timer') {
        const g = this.sw;
        this.sw = null;
        if (s.depth <= this.gasMods(s)[g] || g === 0) {
          s.switchGas(g);
          this.prompt.offer = null;
          this.successUntil = performance.now() + 4000; // "remains on the screen for 4 seconds"
          this.successGas = g;
        }
        return true;
      }
      if (button === 'more') {
        const c = this.candidates(s);
        this.sw = c[(c.indexOf(this.sw) + 1) % c.length] ?? this.sw;
        this.swAt = s.clock;
        return true;
      }
    }
    if (button === 'more') this.setScreen((this.screen + 1) % this.altCount);
    else if (button === 'timer') {
      if (this.safetyState === 'active' || this.safetyState === 'paused') this.safetyRemaining = this.safetyTotal;
      this.flash('BOOKMARK SET');
    } else if (button === 'dim') this.backlightUntil = performance.now() + 6000;
    else return false;
    return true;
  }

  private altCount = 8;
  /** §3.7.1 alternate displays opened by MORE held: page shown, real time opened and of the last press. */
  private alt: { page: AltPage; opened: number; last: number } | null = null;

  /**
   * §3.2 button table, MORE held: Light: dive profile, compartment saturation, pictures; Classic and
   * Full: gas summary, deco summary, dive profile, compartment saturation, pictures ("depending on MB/PMG
   * settings", §3.7.1: the gas summary with PMG, the deco summary with PMG or an MB level, deduced).
   * The Graphical screen is taken as Classic (not stated).
   */
  private altPages(s: DiveSession): AltPage[] {
    const summaries = this.settings.screen !== 'light';
    const pmg = this.maxGases > 1 && this.knownGases(s).length > 1;
    return [
      ...(summaries && pmg ? ['gas' as const] : []),
      ...(summaries && (pmg || this.activeLevel > 0) ? ['deco' as const] : []),
      'profile', 'sat',
    ];
  }
  /** Gas proposed on the switch screen (§3.4.2), from the prompt or from BOOK held; null when closed. */
  private sw: number | null = null;
  private swFromPrompt = false;
  private swAt = 0;
  private successUntil = 0;
  private successGas = 0;

  /** Gases that can be breathed at this depth, other than the current one (T1 always). */
  private candidates(s: DiveSession): number[] {
    const mods = this.gasMods(s);
    return mods.map((m, i) => (i !== s.breathing && (i === 0 || s.depth <= m) ? i : -1)).filter((i) => i >= 0);
  }

  hold(button: string, s: DiveSession): boolean {
    // §3.7.1: "A press-and-hold of the MORE button launches a dive profile (or gas/deco summary displays
    // depending on MB/PMG settings) display" (the gas and deco summaries are not simulated).
    if (button === 'more' && s.inDive && !this.locked && this.sw === null) {
      const now = performance.now();
      this.alt = this.alt ? null : { page: this.altPages(s)[0], opened: now, last: now };
      return true;
    }
    // §3.4.2: "you can manually initiate the gas switch by pressing and holding the BOOK button";
    // the richest gas available is proposed first (the planned switch), else a leaner one.
    if (button !== 'timer' || !s.inDive || this.locked || this.maxGases < 2) return false;
    const c = this.candidates(s);
    if (!c.length) return true;
    const gases = s.allGases;
    const richer = c.filter((i) => gases[i].o2 > s.gas.o2);
    this.sw = richer.length ? richer.reduce((a, b) => (gases[b].o2 > gases[a].o2 ? b : a)) : c[0];
    this.swFromPrompt = false;
    this.swAt = s.clock;
    return true;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      timer: {
        name: 'TIMER · BOOK',
        press: {
          real: { fr: 'Pose un repère (bookmark) ; relance le palier de sécurité ; remet le chronomètre à zéro (Classic/Full/Graphical)', en: 'Sets a bookmark; restarts the safety stop timer; resets the stopwatch (Classic/Full/Graphical)' },
          simulated: true,
          note: { fr: 'chronomètre non simulé', en: 'stopwatch not simulated' },
        },
        hold: { real: { fr: 'Changement de gaz manuel (multigaz uniquement) ; sur l’écran de changement, SAVE confirme', en: 'Manual gas switch (multi-gas only); on the switch screen, SAVE confirms' }, simulated: true, note: { fr: 'avec PMG activé', en: 'with PMG enabled' } },
      },
      more: {
        name: 'MORE',
        press: {
          real: { fr: 'Fenêtre d’information suivante (profondeur max, PDIS, température, niveau MB, heure, CNS…)', en: 'Next alternate window (max depth, PDIS, temperature, MB level, time, CNS…)' },
          simulated: true,
          note: { fr: 'séquence de l’écran Light pour toutes les configurations ; fréquence cardiaque, température cutanée et batterie absentes', en: 'Light-screen sequence for every layout; heart rate, skin temperature and battery omitted' },
        },
        hold: {
          real: { fr: 'Profil de plongée, saturation des compartiments, images (Classic, Full : d’abord résumés des gaz et de la déco)', en: 'Dive profile, compartment saturation, pictures (Classic, Full: gas and deco summaries first)' },
          simulated: true,
          note: { fr: 'profil et saturation ; ⇧ (bouton du milieu) : écran suivant, ⇩ (bouton de gauche) : précédent ; images et résumés non simulés', en: 'profile and saturation; ⇧ (middle button): next display, ⇩ (left button): previous; pictures and summaries not simulated' },
        },
      },
      dim: {
        name: 'LIGHT · DIM',
        press: { real: { fr: 'Augmente le rétroéclairage', en: 'Brightens the backlight' }, simulated: true },
        hold: { real: { fr: 'Boussole', en: 'Compass' }, simulated: false },
      },
    };
  }

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    // §3.4.2: the prompt opens the switch screen; it closes when the 30 s run out (EXCLUDING GAS T2) and
    // a switch started with BOOK closes after 30 s too (not stated, assumed).
    if (this.prompt.offer !== null && this.sw === null && !this.swFromPrompt) {
      this.sw = this.prompt.offer;
      this.swFromPrompt = true;
      this.swAt = s.clock;
    }
    if (this.swFromPrompt && this.prompt.offer === null) {
      if (this.sw !== null && this.sw !== s.breathing) this.sw = null;
      this.swFromPrompt = false;
    }
    if (this.sw !== null && (!v.inDive || (!this.swFromPrompt && s.clock - this.swAt > 30))) this.sw = null;
    if (this.sw !== null) {
      this.alt = null;
      this.renderSwitch(el, v, s, this.sw);
      return;
    }
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
    // §3.4.2 figure: EXCLUDING GAS T2 in the top bar (4 s assumed).
    if (this.excluded && s.clock - this.excluded.at < 4 && barCls !== 'red') [bar, barCls] = [`EXCLUDING GAS T${this.excluded.gas + 1}`, 'yellow'];
    // §3.7.1: the alternate displays "remain for 12 seconds and return to the normal dive display unless
    // buttons are pressed"; "can be viewed for a maximum of 1 minute"; "If any warning or alarm is
    // triggered while viewing alternate screens, the G2 will immediately revert to the normal dive screen".
    if (this.alt) {
      const now = performance.now();
      if (!v.inDive || barCls === 'red' || barCls === 'yellow' || now - this.alt.last > 12_000 || now - this.alt.opened > 60_000 || !this.altPages(s).includes(this.alt.page)) this.alt = null;
    }
    if (this.alt) {
      this.renderAlt(el, v, s, this.alt.page);
      return;
    }

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
            ${performance.now() < this.successUntil ? `<div class="g2-swok">SWITCH TO GAS T${this.successGas + 1}<br>SUCCESSFUL</div>` : ''}
          </div>
        </div>
      </div>`;
  }

  /**
   * §3.4.2 figure: SAVE / arrow / DIM in the bar, depth and dive time, the green SWITCH TO GAS T2 banner,
   * then the gas mix, its PPO2MAX and its MOD.
   */
  private renderSwitch(el: HTMLElement, v: ComputerView, s: DiveSession, g: number): void {
    const win = (lbl: string, unit: string, body: string, extra = '') =>
      `<div class="g2-win ${extra}"><div class="g2-h"><span>${lbl}</span><span>${unit}</span></div><div class="g2-v">${body}</div></div>`;
    const gas = s.allGases[g] ?? s.gas;
    const ppo2 = g === 0 ? this.modPpo2 : gas.o2 >= 0.8 ? 1.6 : this.decoPpo2();
    el.innerHTML = `
      <div class="dev g2">
        <div class="g2-case">
          <button class="g2-btn l" data-btn="timer"></button>
          <button class="g2-btn m" data-btn="more"></button>
          <button class="g2-btn r" data-btn="dim"></button>
          <div class="g2-screen ${this.backlit ? 'backlit' : ''}">
            <div class="g2-bar"><span>SAVE</span><span>⇨</span><span>DIM</span></div>
            <div class="g2-grid sw">
              ${win('DEPTH', DU(), depthText(v.depth), 'w-depth')}
              ${win('DIVE TIME', 'MIN', `${Math.floor(v.diveTime / 60)}:`, 'w-time')}
              <div class="g2-swbanner">SWITCH TO GAS T${g + 1}</div>
              ${win('GAS MIX', 'O2', `${Math.round(gas.o2 * 100)}%`)}
              ${win('PO2MAX', 'BAR', ppo2.toFixed(2))}
              ${win('MOD', DU(), depthText(this.gasMods(s)[g]))}
            </div>
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
  /** Projected ascent at 10 m/min with the planned stops (and the safety stop when pending), as [s, m] points. */
  private projection(v: ComputerView): [number, number][] {
    const now = v.inDive ? v.diveTime : 0;
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
    return proj;
  }

  /**
   * §3.7.1 alternate displays (figures of §3.4.2 and §3.7.1): ⇩ ⇧ DIM in the bar, "5.Dive profile" or
   * "6.Compartment saturation" in white, then the graph in a green frame.
   */
  private renderAlt(el: HTMLElement, v: ComputerView, s: DiveSession, page: AltPage): void {
    const body = page === 'gas' ? this.gasSummary(s) : page === 'deco' ? this.decoSummary(v, s) : page === 'profile' ? this.diveProfile(v, s) : this.saturation(s);
    const title = { gas: '3.Gas summary', deco: '4.Deco summary table', profile: '5.Dive profile', sat: '6.Compartment saturation' }[page];
    el.innerHTML = `
      <div class="dev g2">
        <div class="g2-case">
          <button class="g2-btn l" data-btn="timer"></button>
          <button class="g2-btn m" data-btn="more"></button>
          <button class="g2-btn r" data-btn="dim"></button>
          <div class="g2-screen ${this.backlit ? 'backlit' : ''}">
            <div class="g2-bar"><span>⇩</span><span>⇧</span><span>DIM</span></div>
            <div class="g2-alt-title">${title}</div>
            <div class="g2-alt">${body}</div>
          </div>
        </div>
      </div>`;
  }

  /**
   * Gas summary (§2.8.2.5 figure, "a fast overview of the paired tank pressures and their content"):
   * BAR, O2 and MOD of tanks T1 to T4 (more rows when more gases are set); "NO P" for a tank without a
   * paired transmitter (only T1 has one here), "---" when it is not received, "--%" and "-" for an
   * unused tank; the MOD column gives the AMD (0.0 with nitrox) and the MOD. Title number deduced.
   */
  private gasSummary(s: DiveSession): string {
    const gases = this.knownGases(s);
    const mods = this.gasMods(s);
    const n = Math.max(4, gases.length);
    const u = imperial() ? 'FT' : 'M';
    const rows = Array.from({ length: n }, (_, i) => {
      const g = gases[i];
      const bar = i === 0 ? (this.transmitter && s.transmitterOn ? pressText(s.tankPressure) : '---') : 'NO P';
      const o2 = g ? `${Math.round(g.o2 * 100)}<small>%</small>` : '--<small>%</small>';
      const mod = g ? `0.0- ${depthText(mods[i])}<small>${u}</small>` : '-';
      return `<div class="${i === s.breathing ? 'cur' : ''}"><span>T${i + 1}</span><span>${bar}</span><span>${o2}</span><span>${mod}</span></div>`;
    }).join('');
    return `<div class="g2-gsum"><div class="hd"><span></span><span>${imperial() ? 'PSI' : 'BAR'}</span><span>O2</span><span>MOD</span></div>${rows}</div>`;
  }

  /**
   * Deco summary table (§3.4.2 figure): "the predicted decompression stops are shown with all enabled
   * gases used (PMG) and assuming only the current gas would be used (1G). Also, current selected MB
   * level as well as MB level 0 schedules are shown": first stop (depth, minutes) and TAT in orange.
   * Without PMG the rows are labelled 1G (deduced).
   */
  private decoSummary(v: ComputerView, s: DiveSession): string {
    const pmg = this.maxGases > 1 && this.knownGases(s).length > 1;
    const levels = this.activeLevel > 0 ? [this.activeLevel, 0] : [0];
    const rows: string[] = [];
    for (const lv of levels) {
      for (const mode of pmg ? ['PMG', '1G'] : ['1G']) {
        const p = { ...levelParams(lv), gases: mode === 'PMG' ? this.planGases(s) : [] };
        const plan = planAscent(s.tissues, v.depth, s.gas, p, lv > 0 ? this.levelAnchor : this.anchor);
        const st = plan.stops[0];
        const stop = st ? `<span class="o">${depthInt(st.depth)}<small>${imperial() ? 'FT' : 'M'}</small></span><span class="o">${Math.ceil(st.minutes)}:</span>` : '<span></span><span></span>';
        rows.push(`<div><span class="b">${mode}</span><span class="b">L${lv}</span>${stop}<span class="o">${plan.tts}:</span></div>`);
      }
    }
    return `<div class="g2-dsum">${rows.join('')}</div>`;
  }

  /**
   * "blue is the dived part, the gray line identifies current time and green is the predicted ascent
   * profile) with required gas switching depths according to MOD's (white lines)"; figures: depth scale
   * on the right (0 m to a round depth below the maximum: deduced) and the stops in orange.
   */
  private diveProfile(v: ComputerView, s: DiveSession): string {
    const past: [number, number][] = [...s.profile.map((p) => [p.t, p.depth] as [number, number]), [v.diveTime, v.depth]];
    const proj = this.projection(v);
    const now = v.diveTime;
    const tMax = Math.max(proj[proj.length - 1][0], 600);
    const scale = Math.max(10, Math.ceil(v.maxDepth / 10) * 10);
    const W = 268;
    const H = 150;
    const X = (x: number) => ((x / tMax) * W).toFixed(1);
    const Y = (y: number) => ((Math.min(y, scale) / scale) * (H - 2) + 1).toFixed(1);
    const area = (pts: [number, number][]) => `M ${X(pts[0][0])} 0 ${pts.map(([x, y]) => `L ${X(x)} ${Y(y)}`).join(' ')} L ${X(pts[pts.length - 1][0])} 0 Z`;
    const line = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${X(x)} ${Y(y)}`).join(' ');
    const mods = this.maxGases > 1
      ? this.planGases(s).map((g) => `<line x1="${X(now)}" y1="${Y(g.mod)}" x2="${W}" y2="${Y(g.mod)}" stroke="#fff" stroke-width="1"/>`).join('')
      : '';
    const stops = [...v.plan.stops].reverse().map((st) => `<div><span>${depthInt(st.depth)}<small>${imperial() ? 'FT' : 'M'}</small></span><span>${Math.ceil(st.minutes)}:</span></div>`).join('');
    const u = imperial() ? 'FT' : 'M';
    return `<svg class="g2-prof" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <path d="${area(past)}" fill="#0b1f78"/><path d="${line(past)}" fill="none" stroke="#3f7bff" stroke-width="1.5"/>
        <path d="${area(proj)}" fill="#1c6a1c"/><path d="${line(proj)}" fill="none" stroke="#8be08b" stroke-width="1.5"/>
        ${mods}
        <line x1="${X(now)}" y1="0" x2="${X(now)}" y2="${H}" stroke="#a0a0a0" stroke-width="2"/>
        <path d="M ${Number(X(now)) - 4} 0 L ${Number(X(now)) + 4} 0 L ${X(now)} 6 Z M ${Number(X(now)) - 4} ${H} L ${Number(X(now)) + 4} ${H} L ${X(now)} ${H - 6} Z" fill="#a0a0a0"/>
      </svg>
      <div class="g2-prof-scale"><span>0${u}</span><span>${imperial() ? depthInt(scale) : scale}${u}</span></div>
      <div class="g2-prof-stops">${stops}</div>`;
  }

  /**
   * "The height of each bar indicates the ratio of current tissue loading with respect to the maximum
   * tolerable loading, expressed in a percentage. The green color indicates that the compartment is
   * off-gassing, and the red color shows on-gassing." The tolerable loading is taken as the M-value at
   * the current ambient pressure (deduced). Captions of the figures: CNS, SKIN, MUSCLE, BONE.
   */
  private saturation(s: DiveSession): string {
    const t = s.tissues;
    const inspired = (s.pressure - WATER_VAPOUR) * (1 - s.gas.o2);
    const bars = Array.from({ length: 16 }, (_, i) => {
      const [a, b] = t.coefficients(i);
      const p = t.n2[i] + t.he[i];
      const ratio = Math.max(0, Math.min(1, p / (s.pressure / b + a)));
      return `<i class="${p > inspired ? 'off' : 'on'}" style="height:${(ratio * 100).toFixed(1)}%"></i>`;
    }).join('');
    return `<div class="g2-sat"><div class="g2-sat-bars">${bars}</div><div class="g2-sat-lbl"><span>CNS</span><span>SKIN</span><span>MUSCLE</span><span>BONE</span></div></div>`;
  }

  private profileGraph(v: ComputerView, s: DiveSession): string {
    const past: [number, number][] = v.inDive ? [...s.profile.map((p) => [p.t, p.depth] as [number, number]), [v.diveTime, v.depth]] : [];
    const now = v.inDive ? v.diveTime : 0;
    const proj = this.projection(v);
    const t = proj[proj.length - 1][0];

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
