import { WATER_VAPOUR, depthToPressure } from '../../../engine/buhlmann';
import { DIVE_END_TIMEOUT, type DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthInt, depthText, depthUnit, imperial, pressText, pressUnit, tempUnit, tempVal } from '../../../units';
import { ButtonHelp, ComputerView, clockOfDay, hmm, mmss } from '../../base';
import { Acks } from '../../common/acks';
import { gfRate, surfGfAfter, ttsAfter } from '../../common/predict';
import { quadAscentLimit, tankRange } from '../common';
import { QuadCiRules } from './rules';

type Screen = 'ez' | 'full' | 'tissue' | 'profile' | 'stops';
const SCREENS: Screen[] = ['ez', 'full', 'tissue', 'profile', 'stops'];
/**
 * Fields at the right of the top (TR) and bottom (BR) rows of the FULL screen, cycled by their
 * buttons in the manual's order (the battery fields are not simulated).
 */
const TR_FIELDS = ['temp', 'max', 'avg', 'mod', 'deep', 'tts5', 'ceil'] as const;
const BR_FIELDS = ['gf', 'gfnow', 'gfrate', 'o2', 'cns', 'ppo2', 'time', 'sw', 'gas', 'ttr'];

/** Mares Quad Ci: buttons and MIP display, after the manual's figures (rules in rules.ts). */
export class MaresQuadCi extends QuadCiRules {
  private trField = 0;
  private brField = 0;
  /** Dive screen setting last applied, so a change in the settings shows at once. */
  private appliedDisplay = '';
  private stopwatchFrom = 0;
  private surfacePage: SurfacePage = 'home';
  private ezTop: { i: number; until: number } | null = null;
  private ezBottom: { i: number; until: number } | null = null;
  private acks = new Acks();
  /** §13.2: gas summary table (BR-LP), with the gas under the cursor; null when closed. */
  private gasTable: number | null = null;

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.stopwatchFrom = 0;
    this.acks.clear();
    this.ezTop = this.ezBottom = null;
    this.gasTable = null;
    this.appliedDisplay = this.settings.display;
    this.screen = SCREENS.indexOf(this.appliedDisplay === 'full' ? 'full' : 'ez');
  }

  onDiveEnd(s: DiveSession): void {
    super.onDiveEnd(s);
    this.surfacePage = 'postdive';
  }

  // Dive mode (manual §1.5): BL-SP cycles E-Z, FULL, tissue graph, profile, list of stops; TL-SP
  // resets the stopwatch; TR-SP / BR-SP change the top / bottom field (momentarily on E-Z); TR-LP:
  // backlight. At the surface BL-SP cycles HOME, PRE-DIVE and (with residual nitrogen) POST DIVE.
  // Any button acknowledges the messages that stay until then.
  press(button: string, s: DiveSession): boolean {
    this.acks.ackAll();
    if (!s.inDive) {
      if (button !== 'bl') return true;
      const pages: SurfacePage[] = ['home', 'predive', ...(this.hasDesat(s) ? ['postdive' as const] : [])];
      this.surfacePage = pages[(pages.indexOf(this.surfacePage) + 1) % pages.length];
      return true;
    }
    // §13.2: SWITCH TO G2: "With TR-SP or BR-SP you perform the switch [...] with TL-SP or BL-SP you stay
    // on the current gas".
    if (this.prompt.offer !== null) {
      const g = this.prompt.offer;
      if (button === 'tr' || button === 'br') {
        this.prompt.accept(s);
        this.say('GAS SWITCH OK');
      } else {
        this.prompt.decline();
        this.notSwitched(g);
      }
      return true;
    }
    // Gas table: "Scroll through the available gases with TR-SP and BR-SP [...] With BL-SP you can exit
    // without making changes."
    if (this.gasTable !== null) {
      const n = this.knownGases(s).length;
      if (button === 'tr') this.gasTable = (this.gasTable + n - 1) % n;
      else if (button === 'br') this.gasTable = (this.gasTable + 1) % n;
      else if (button === 'bl') this.gasTable = null;
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

  hold(button: string, s: DiveSession): boolean {
    // §13.2: "You can always perform a manual switch with BR-LP. This will make the gas summary table
    // appear [...] then with TR-LP or BR-LP you activate it."
    if (s.inDive && this.gasTable !== null && (button === 'tr' || button === 'br')) {
      const i = this.gasTable;
      // §2.4.2 SWITCH BELOW MOD OFF: no switch deeper than the gas MOD.
      const mod = i === 0 ? this.modDepth(s.allGases[0].o2) : this.decoMod(s.allGases[i].o2);
      if (this.settings.belowMod !== 'off' || s.depth <= mod) {
        s.switchGas(i);
        this.prompt.offer = null;
        this.gasTable = null;
      }
      return true;
    }
    if (button === 'br' && s.inDive && this.knownGases(s).length > 1 && !this.locked) {
      this.gasTable = s.breathing;
      return true;
    }
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
        hold: { real: { fr: 'Table de changement de gaz (multigaz) ; dans la table, active le gaz choisi', en: 'Gas switch table (multigas); in the table, activates the gas chosen' }, simulated: true },
      },
    };
  }

  // -------------------------------------------------------------------------
  // Display: black MIP screen, white figures, coloured blocks, magenta N2 divider, as in the manual's
  // figures (§10.3, §11).

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
      html = this.gasTable !== null ? this.gasTableScreen(v, s)
        : screen === 'ez' || screen === 'full' ? this.diveScreen(screen, v, s, alarm) : this.graphScreen(screen, v, s);
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

  /** §3.2.6: the GF @SURF value blinks (reached the warning value, not acknowledged yet). */
  private gfSurfBlink = false;

  /** Current alarm or warning message (bottom-right block), highest priority first. */
  private alarm(v: ComputerView, s: DiveSession): Alarm | null {
    // Acknowledged messages stay off until the next dive.
    this.acks.begin();
    const ack = (key: string) => this.acks.show(key);
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
    } else if (this.settings.wMaxDepth !== 'off' && v.depth >= Number(this.settings.wMaxDepth) && ack('maxdepth')) {
      // §3.2.1: "an alarm similar in behaviour to the MOD alarm (section 10.3.2) is triggered, albeit with
      // the message MAX DEPTH REACHED".
      a = { text: 'MAX DEPTH REACHED', cls: 'red', full: true };
    } else if (v.cns > 75 && ack('cns')) {
      a = { text: 'CNS > 75%', cls: 'red', full: true };
    } else if (ai && v.inDeco && s.diveTime > 120 && (v.tank.gasTime ?? 0) < v.tts && ack('lowtank')) {
      a = { text: 'LOW TANK PRESSURE', cls: 'red' };
    } else if (ai && v.tank.pressure <= v.tank.reserve && ack('reserve')) {
      // §10.3.4.2: TANK RESERVE and HALF TANK at the pressures set in §4.1, until a button is pressed.
      a = { text: 'TANK RESERVE', cls: 'red' };
    } else if (ai && this.settings.halfWarn !== 'off' && v.tank.pressure > v.tank.reserve && v.tank.pressure <= this.halfTank() && ack('half')) {
      a = { text: 'HALF TANK', cls: 'yellow' };
    } else if (this.settings.wTime !== 'off' && v.diveTime / 60 >= Number(this.settings.wTime) && ack('timelimit')) {
      // §3.2.2: TURN AROUND at half of the time limit, TIME LIMIT at it, each until a button is pressed.
      a = { text: 'TIME LIMIT', cls: 'yellow' };
    } else if (this.settings.wTime !== 'off' && v.diveTime / 60 >= Number(this.settings.wTime) / 2 && ack('turn')) {
      a = { text: 'TURN AROUND', cls: 'yellow' };
    } else if (this.settings.wDeco !== 'off' && v.inDeco && ack('deco')) {
      // §3.2.3 / §3.2.4: "a warning will alert you"; its message is not given: the menu names, deduced,
      // until a button is pressed like the other warnings (assumed).
      a = { text: 'ENTERING DECO', cls: 'yellow' };
    } else if (this.settings.wNoDeco !== 'off' && !v.inDeco && v.ndl <= 2 && ack('nodeco')) {
      a = { text: 'NO DECO 2 MIN', cls: 'yellow' };
    }
    // §3.2.6: GF @SURF "will blink on the screen until you push any button to confirm having seen it".
    this.gfSurfBlink = this.settings.wGfSurf !== 'off' && v.surfGf >= Number(this.settings.wGfSurf) && this.acks.show('gfsurf');
    return a;
  }

  /** §4.1.1: blue / green above HALF TANK, yellow down to 50 bar / 500 psi, red below. */
  private tankColor(v: ComputerView): string {
    return tankRange(v.tank.pressure, v.tank.fill, this.halfTank(), imperial() ? 500 / 14.5038 : 50);
  }

  private tankBlock(v: ComputerView): string {
    return `<div class="qc-tank ${this.tankColor(v)}"><b>${pressText(v.tank.pressure)}</b><u>${pressUnit().toUpperCase()}</u></div>`;
  }

  /**
   * §13.2: the gas switch prompt "below the top row", or the short messages that follow (colours not
   * given: yellow like the warnings, assumed), in place of the N2 divider.
   */
  private gasLine(): string | null {
    if (this.prompt.offer !== null) return `<div class="qc-gsw">SWITCH TO G${this.prompt.offer + 1}</div>`;
    const msg = this.gasMessage();
    return msg ? `<div class="qc-gsw">${msg}</div>` : null;
  }

  /** §13.2: gas summary table: each active gas, its MOD and its tank pressure (NP: no transmitter paired). */
  private gasTableScreen(v: ComputerView, s: DiveSession): string {
    const du = depthUnit();
    const rows = this.knownGases(s).map((g, i) => {
      const mod = i === 0 ? this.modDepth(g.o2) : this.decoMod(g.o2);
      // Only the main tank has a transmitter here: --- when it is off (§13.2 NOTE), NP for the others.
      const p = i === 0 && this.transmitter && s.transmitterOn ? `${pressText(s.tankPressure)}<u>${pressUnit().toUpperCase()}</u>` : i === 0 ? '---' : 'NP';
      return `<div class="qc-gt ${this.gasTable === i ? 'sel' : ''} ${s.breathing === i ? 'cur' : ''}"><span>G${i + 1}</span><span>${Math.round(g.o2 * 100)}<u>%</u></span><span><u>MOD</u> ${depthText(mod)}<u>${du}</u></span><span>${p}</span></div>`;
    }).join('');
    return `<div class="qc-row top sm"><div class="qc-depth">${depthText(v.depth)}<u>${du}</u></div></div><div class="qc-gtab">${rows}</div>`;
  }

  /** Magenta N2 divider (nitrogen bar graph), or the ascent speed graph while ascending. */
  private n2Bar(v: ComputerView, forceN2 = false, label = true): string {
    const line = this.gasLine();
    if (line) return line;
    if (!forceN2 && v.ascentRate > 0.5) {
      const pct = v.ascentRate / quadAscentLimit(v.depth);
      const cls = pct > 1 ? 'red' : pct > 0.8 ? 'yellow' : 'green';
      return `<div class="qc-bar speed ${cls}"><i style="width:${Math.round(Math.min(100, pct * 100))}%"></i></div>`;
    }
    return `<div class="qc-bar n2"><i style="width:${Math.round(Math.min(100, v.n2Load))}%"></i>${label ? '<em>N2</em>' : ''}</div>`;
  }

  /** Lower divider of FULL: tank pressure graph in the pressure range colour, battery at the end. */
  private tankBar(v: ComputerView): string {
    // No tank module: the lower divider replicates the upper one (§11), without a second N2 caption.
    if (!v.tank.ai) return this.n2Bar(v, true, false);
    const fill = Math.max(0, Math.min(100, (v.tank.pressure / v.tank.fill) * 100));
    return `<div class="qc-bar tank ${this.tankColor(v)}"><i style="width:${Math.round(fill)}%"></i><span class="qc-batt"></span></div>`;
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
      // §13.1 NOTE: "When more than one gas is set, the label G1 (or G2 or G3) appears together with the O2% label."
      const lbl = bot === 'o2' && this.knownGases(s).length > 1 ? `G${s.breathing + 1} O2%` : EZ_LABELS[bot!];
      if (bot) left = `<div class="qc-c"><em class="cy">${lbl}</em><b>${this.fieldValue(bot, v, s)}</b></div>`;
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
    else if (surfacing) bottomRight = `<div class="qc-f"><em class="cy">GF @SURF/@+3</em><b>${this.surfGfText(v)}/${this.gfAt3(v, s)}</b></div>`;
    else if (v.safety.state === 'active' || v.safety.state === 'paused') bottomRight = `<div class="qc-f"><em class="cy">GF @SURF/@+3</em><b>${this.surfGfText(v)}/${this.gfAt3(v, s)}</b></div>`;
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

  /** GF @SURF value, blinking while its §3.2.6 warning is not acknowledged. */
  private surfGfText(v: ComputerView): string {
    const t = String(Math.round(v.surfGf));
    return this.gfSurfBlink ? `<span class="blink">${t}</span>` : t;
  }

  /**
   * GF RATE (glossary): how much GF @SURF will rise (yellow digits) or fall (blue digits) over the
   * next minute at the current depth. One decimal below 10, as in the figures ("77/1.6", "163/1").
   */
  private gfRate(v: ComputerView, s: DiveSession): { text: string; cls: string } {
    const { r, text } = gfRate(s, v.depth);
    return { text, cls: text === '0' ? '' : r > 0 ? 'yel' : 'blu' };
  }

  private gfAt3(v: ComputerView, s: DiveSession): number {
    return Math.round(surfGfAfter(s, v.depth, 3));
  }

  /** Deep stop being suggested (see tick). */
  private deepStop(v: ComputerView, _s: DiveSession): { depth: number; remaining: number; active: boolean } | null {
    if (!v.inDive || !this.deep.shown) return null;
    return { depth: this.deep.depth, remaining: this.deep.remaining, active: this.deep.state === 'active' };
  }

  private fieldValue(f: string, v: ComputerView, s: DiveSession): string {
    const { h, m } = clockOfDay(s);
    switch (f) {
      case 'ttr': return v.tank.gasTime === null || s.diveTime < 120 ? '--' : `${v.tank.gasTime}:`;
      case 'gas': return v.tank.ai ? String(Math.round(s.rmv)) : '--';
      case 'o2': return `${v.o2}<u>%</u>`; // label: see ezLabel()
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
        return f('TTS@+5', `${ttsAfter(s, v.depth, 5, this.decoParams(s), this.anchor)}:`);
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
      case 'gfnow': return f('GF NOW/@SURF', `${Math.round(v.gf99)}/${this.surfGfText(v)}`);
      case 'gfrate': {
        const r = this.gfRate(v, s);
        return `<div class="qc-f"><em class="cy">GF@SURF/RATE</em><b class="${r.cls}">${this.surfGfText(v)}/${r.text}</b></div>`;
      }
      case 'o2': return f(this.knownGases(s).length > 1 ? `G${s.breathing + 1} O2` : 'O2', String(v.o2), '%');
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
      const bars = g.map((x, i) => `<i class="${s.tissues.n2[i] + s.tissues.he[i] < inspired ? 'yellow' : 'blue'}" style="height:${Math.round(Math.max(2, (Math.max(0, x) / scale) * 100))}%" title="${i + 1}"></i>`).join('');
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
      <div class="qc-row pd"><div class="qc-f"><em class="cy">${dateText}</em></div><div class="qc-f"><em class="cy">${this.knownGases(s).length > 1 ? 'MULTIGAS' : 'SINGLE GAS'}</em></div></div>
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
