import { DIVE_END_TIMEOUT, type DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthInt, depthText, depthUnit, imperial, pressText, tempUnit, tempVal } from '../../../units';
import { ButtonHelp, ComputerView, clockOfDay } from '../../base';
import { Acks } from '../../common/acks';
import { sevenSeg } from '../../common/segments';
import { QuadAirRules } from './rules';

const pad2 = (n: number) => String(n).padStart(2, '0');

type TopField = 'temp' | 'max' | 'avg' | 'mod' | 'asc5' | 'empty';
type BottomField = 'ttr' | 'gas' | 'o2' | 'cns' | 'ppo2' | 'asc5' | 'temp' | 'none' | 'time';

/** Mares Quad Air: buttons and segmented LCD, after the manual's figures (rules in rules.ts). */
export class MaresQuadAir extends QuadAirRules {
  private topIdx = 0;
  private botIdx = 0;
  /** Bottom field shown momentarily (time of day 4 s, anything else over CNS 8 s). */
  private botUntil = 0;
  private stopwatchFrom = 0;
  private acks = new Acks();
  private surfacePage: 'pre' | 'post' = 'pre';
  // -------------------------------------------------------------------------
  // Buttons (§1.5, figures of §1.5): during the dive both upper buttons act as UP (top-right field,
  // hold: backlight) and both lower ones as DOWN (bottom-right field, hold: gas switch, or stopwatch
  // restart in bottom timer). Any button acknowledges the alarms that wait for it (§3.2.5, §3.3.1).

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.topIdx = this.botIdx = 0;
    this.botUntil = 0;
    this.stopwatchFrom = 0;
    this.acks.clear();
  }

  onDiveEnd(s: DiveSession): void {
    super.onDiveEnd(s);
    this.surfacePage = 'post';
  }

  private isUp(b: string): boolean {
    return b === 'enter' || b === 'up';
  }

  press(button: string, s: DiveSession): boolean {
    this.acks.ackAll();
    if (!s.inDive) {
      // Surface: UP / DOWN scroll the menus, POST-DIVE ↔ PRE-DIVE being the first two (§2).
      if ((button === 'up' || button === 'down') && this.hasPostDive(s)) this.surfacePage = this.surfacePage === 'pre' ? 'post' : 'pre';
      return true;
    }
    const v = this.lastView;
    if (this.isUp(button)) {
      this.topIdx = (this.topIdx + 1) % this.topFields(s, v).length;
    } else {
      const fields = this.bottomFields(s, v);
      this.botIdx = (this.botIdx + 1) % fields.length;
      // §3.3: time of day has a 4 s time-out; §3.2.3: over CNS ≥ 75 %, other items stay 8 s.
      const cnsDefault = v !== null && v.cns >= 75 && fields.includes('cns');
      this.botUntil = fields[this.botIdx] === 'time' ? performance.now() + 4000 : cnsDefault ? performance.now() + 8000 : 0;
    }
    return true;
  }

  hold(button: string, s: DiveSession): boolean {
    if (this.isUp(button)) {
      this.backlightUntil = performance.now() + 5000; // §2.2.1.1: 1–10 s (LGHt), 5 s here
      return true;
    }
    if (s.inDive && this.locked) {
      this.stopwatchFrom = s.diveTime; // §3.6: press and hold a lower button restarts the stopwatch
      return true;
    }
    return false;
  }

  buttons(): Record<string, ButtonHelp> {
    const up: ButtonHelp['press'] = {
      real: { fr: 'Plongée : champ en haut à droite (température, max, moyenne, MOD en nitrox, deep stop, vide). Surface : menus', en: 'Dive: top-right field (temperature, max, average, MOD on nitrox, deep stop, empty). Surface: menus' },
      simulated: true,
      note: { fr: 'sans deep stop ; en surface, seules les pages PRE-DIVE / POST-DIVE', en: 'no deep stop; at the surface, only the PRE-DIVE / POST-DIVE pages' },
    };
    const down: ButtonHelp['press'] = {
      real: { fr: 'Plongée : champ en bas à droite (TTR, consommation, O2 %, CNS, ppO2, ASC+5, heure 4 s). Surface : menus', en: 'Dive: bottom-right field (TTR, gas consumption, O2 %, CNS, ppO2, ASC+5, time of day 4 s). Surface: menus' },
      simulated: true,
      note: { fr: 'en surface, seules les pages PRE-DIVE / POST-DIVE', en: 'at the surface, only the PRE-DIVE / POST-DIVE pages' },
    };
    const light = { real: { fr: 'Rétroéclairage (durée réglée dans LGHt)', en: 'Backlight (duration set in LGHt)' }, simulated: true, note: { fr: '5 s ici', en: '5 s here' } };
    const gas = {
      real: { fr: 'Changement de gaz (multigaz) ; en profondimètre, remise à zéro du chronomètre', en: 'Gas switch (multigas); in bottom timer, restarts the stopwatch' },
      simulated: true,
      note: { fr: 'chronomètre seulement (un seul gaz simulé)', en: 'stopwatch only (single gas simulated)' },
    };
    return {
      enter: { name: 'ENTER', press: up, hold: light },
      up: { name: 'UP', press: up, hold: light },
      esc: { name: 'ESC', press: down, hold: gas },
      down: { name: 'DOWN', press: down, hold: gas },
    };
  }

  // -------------------------------------------------------------------------
  // Fields.

  /** §3.3: temperature, max depth, average depth, MOD (nitrox only), deep stop, empty field. */
  private topFields(s: DiveSession, v: ComputerView | null): TopField[] {
    const f: TopField[] = [];
    if (this.settings.temp !== 'bottom') f.push('temp');
    f.push('max', 'avg');
    if (this.nitrox(s)) f.push('mod');
    if (this.settings.asc5 === 'top' && v?.inDeco) f.push('asc5');
    f.push('empty');
    return f;
  }

  /** §3.3: TTR, gas consumption, O2 %, CNS, ppO2 (nitrox only), ASC+5 (deco), time of day. */
  private bottomFields(s: DiveSession, v: ComputerView | null): BottomField[] {
    const f: BottomField[] = [];
    if (this.airIntegrated(s)) f.push('ttr', 'gas');
    if (this.nitrox(s)) f.push('o2', 'cns', 'ppo2');
    else if (v && v.cns >= 75) f.push('cns'); // §2.1: CNS computed on air, shown by its warning
    if (this.settings.asc5 !== 'top' && v?.inDeco) f.push('asc5');
    if (this.settings.temp === 'bottom') f.push('temp');
    if (!f.length) f.push('none');
    f.push('time');
    return f;
  }

  // -------------------------------------------------------------------------
  // Display.

  render(el: HTMLElement, view: ComputerView, s: DiveSession, _lang: Lang): void {
    // §3.2.4: while the missed deco stop alarm is on, desaturation of the tissues is halted.
    const v = this.withPausedDeco(view);
    this.lastView = view;
    const lcd = !v.inDive ? this.surface(v, s) : this.locked ? this.bottomTimer(v, s) : this.dive(v, s);
    el.innerHTML = `
      <div class="dev qa">
        <div class="qa-case">
          <span class="qa-n2lbl">N2 - SPEED</span>
          <span class="qa-scale"><i class="r"></i><i class="y"></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
          <span class="qa-side"><b>DEPTH</b><b>DECO</b><b>TANK DATA</b></span>
          <button class="qa-btn tl" data-btn="enter"><span>ENTER</span></button>
          <button class="qa-btn tr" data-btn="up"><span>UP</span></button>
          <button class="qa-btn bl" data-btn="esc"><span>ESC</span></button>
          <button class="qa-btn br" data-btn="down"><span>DOWN</span></button>
          <div class="qa-lcd ${this.backlit ? 'backlit' : ''}">${lcd}</div>
        </div>
      </div>`;
  }

  /** Alarms waiting for a button press (§3.2.5 half tank, low tank; §3.3.1 runaway deco). */
  private ackable(key: string, on: boolean): boolean {
    return this.acks.show(key, on);
  }

  private dive(v: ComputerView, s: DiveSession): string {
    this.acks.begin();
    const now = performance.now();
    const ai = v.tank.ai;
    const surfacing = v.depth < 1.2;
    const du = depthUnit();

    // Top-right field (MOD instead while the MOD alarm is on, §3.2.2).
    const tops = this.topFields(s, v);
    let top = tops[this.topIdx % tops.length];
    const modAlarm = v.depth > v.mod;
    if (modAlarm) top = 'mod';
    if (surfacing) top = 'max'; // figure of §3.4

    // Bottom-right field: CNS by default from 75 % (§3.2.3), time of day for 4 s.
    const bots = this.bottomFields(s, v);
    if (this.botUntil && now > this.botUntil) {
      this.botUntil = 0;
      this.botIdx = 0;
    }
    let bot = bots[this.botIdx % bots.length];
    if (v.cns >= 75 && bots.includes('cns') && !this.botUntil) bot = 'cns';
    if (surfacing) bot = 'o2';

    // Acknowledgeable alarms.
    const reserveAt = imperial() ? v.tank.reserve : Math.max(50, v.tank.reserve); // §3.2.5 note
    const halfAt = imperial() ? 1500 / 14.5038 : 100; // §2.2.1.6 tANK WARN default
    const asc5 = v.inDeco ? this.asc5(v, s) : 0;
    const lowTank = this.ackable('lowtank', ai && v.inDeco && s.diveTime > 120 && v.tank.gasTime !== null && v.tank.gasTime < v.tts);
    const reserveBlink = ai && v.tank.pressure <= reserveAt; // keeps blinking after the acknowledgement
    this.ackable('reserve', reserveBlink);
    const halfBlink = this.ackable('half', ai && v.tank.pressure <= halfAt && v.tank.pressure > reserveAt);
    const runLimit = Number(this.settings.runaway);
    const runaway = this.ackable('runaway', v.inDeco && this.settings.runaway !== 'off' && asc5 - v.tts >= runLimit);
    // The blinking value is brought up: ASC+5 (§3.3.1 figure), TTR (§3.2.5 figure).
    if (runaway && !surfacing) {
      if (this.settings.asc5 === 'top') top = 'asc5';
      else bot = 'asc5';
    } else if (lowTank && !surfacing) {
      bot = 'ttr';
    }

    // Middle row.
    const ascending = v.ascentRate > 0.3 && this.ascentFrom - v.depth > 0.8; // §3.2.1: after 0.8 m
    const slow = v.ascentLevel === 2;
    let left = `${Math.min(99, Math.floor(v.diveTime / 60))}:`;
    let leftLbl = 'DTIME';
    let speedUnit = false;
    if (ascending && !surfacing) {
      left = String(Math.round(imperial() ? v.ascentRate * 3.28084 : v.ascentRate));
      leftLbl = '';
      speedUnit = true;
    }
    const mid: Mid = { left, leftLbl, speedUnit, depth: '', r1: '', r2: '', labels: [] };
    const showTime = bot === 'time';
    if (surfacing) {
      const t = Math.max(0, DIVE_END_TIMEOUT - s.surfaceTimer);
      Object.assign(mid, { r1: `${Math.floor(t / 60)}:`, r2: pad2(Math.floor(t % 60)), labels: ['TIME', 'OUT'] });
    } else if (showTime) {
      const { h, m } = clockOfDay(s);
      Object.assign(mid, { r1: `${h}:`, r2: pad2(m), labels: ['TIME'] });
    } else if (v.inDeco && v.stopDepth > 0) {
      Object.assign(mid, { depth: String(depthInt(v.stopDepth)), r1: `${Math.min(99, v.stopTime)}:`, r2: `${Math.min(99, v.tts)}:`, labels: ['DECO', 'ASC'] });
    } else if (v.safety.state === 'active' || v.safety.state === 'paused') {
      const t = Math.ceil(v.safety.remaining);
      Object.assign(mid, { r1: `${Math.floor(t / 60)}:`, r2: pad2(t % 60), labels: ['SAFE'] });
    } else {
      Object.assign(mid, { r1: `${Math.min(99, v.ndl)}:`, labels: ['NO', 'DECO'] }); // §3.3: at most 99 minutes
    }
    // Alphanumeric message across the middle row: SLOW (§3.2.1), rUn AWAY (§3.3.1).
    let msg = '';
    if (slow && !surfacing) msg = 'SLOW';
    else if (runaway) msg = 'rUn AWAY';
    // The message takes the middle row's alphanumeric cells: the fields under it are off (figures).
    if (msg) Object.assign(mid, { depth: '', r1: '', r2: '', labels: [] });

    const aboveStop = v.ceilingViolation === 2;
    const ceilingBlink = aboveStop ? 'blink' : '';
    return this.lcd({
      depth: surfacing ? '---' : depthText(v.depth),
      depthBlink: modAlarm || aboveStop,
      unit: du,
      triangles: v.inDeco && v.stopDepth > 0 ? (v.ceilingViolation > 0 ? 'down' : v.atStop ? 'both' : '') : '',
      icons: { fast: this.fastViolation ? 'on' : this.fastBlink ? 'blink' : '', missed: this.decoViolation ? 'on' : '' },
      top: this.topValue(top, v, asc5, modAlarm || (runaway && top === 'asc5')),
      mid: { ...mid, depthBlink: ceilingBlink, msg },
      bottom: {
        press: ai ? pressText(v.tank.pressure) : '',
        pressBlink: ai && (reserveBlink || halfBlink),
        ...this.bottomValue(showTime ? 'none' : bot, v, s, asc5, lowTank || runaway),
      },
      bar: v.inDeco ? 10 : Math.min(10, Math.floor(v.n2Load / 10)),
    });
  }

  private topValue(f: TopField, v: ComputerView, asc5: number, blink: boolean): TopView {
    const du = depthUnit();
    switch (f) {
      case 'temp': return { lbl: [], value: String(Math.round(tempVal(v.temperature))), unit: tempUnit() };
      case 'max': return { lbl: ['MAX'], value: depthText(v.maxDepth), unit: du };
      case 'avg': return { lbl: ['AVG'], value: depthText(v.avgDepth), unit: du };
      case 'mod': return { lbl: ['MOD'], value: depthText(v.mod), unit: du, blink };
      case 'asc5': return { lbl: ['ASC+5'], value: `${Math.min(99, asc5)}:`, unit: '' };
      default: return { lbl: [], value: '', unit: '' };
    }
  }

  private bottomValue(f: BottomField, v: ComputerView, s: DiveSession, asc5: number, blink: boolean): BottomView {
    switch (f) {
      case 'ttr': return { lbl: ['TTR'], value: v.tank.gasTime === null || s.diveTime < 120 ? '' : `${v.tank.gasTime}:`, units: [], blink }; // §3.3 note: ~2 min to analyse
      case 'gas': return { lbl: [], value: String(Math.round(imperial() ? s.rmv / 28.3168 : s.rmv)), units: imperial() ? ['cuft', 'min'] : ['l', 'min'] };
      case 'o2': return { lbl: [], value: String(v.o2), units: ['%', 'O2'] };
      case 'cns': return { lbl: [], value: String(Math.round(v.cns)), units: ['%', 'CNS'], blink: v.cns >= 75 };
      case 'ppo2': return { lbl: [], value: v.ppO2.toFixed(2), units: ['PPO2'] };
      case 'asc5': return { lbl: ['ASC+5'], value: `${Math.min(99, asc5)}:`, units: [], blink };
      case 'temp': return { lbl: [], value: String(Math.round(tempVal(v.temperature))), units: [tempUnit()] };
      default: return { lbl: [], value: '', units: [] };
    }
  }

  /** §3.6: depth, temperature, stopwatch, dive time, tank pressure, TTR; violation icon steady. */
  private bottomTimer(v: ComputerView, s: DiveSession): string {
    const du = depthUnit();
    const tops = ['max', 'avg', 'temp', 'empty'] as const;
    const top = tops[this.topIdx % tops.length];
    const now = performance.now();
    if (this.botUntil && now > this.botUntil) this.botUntil = 0;
    const sw = Math.max(0, v.diveTime - this.stopwatchFrom);
    const ascending = v.ascentRate > 0.3 && this.ascentFrom - v.depth > 0.8;
    let r1 = `${Math.floor(sw / 60)}:`;
    let r2 = pad2(Math.floor(sw % 60));
    let labels: string[] = [];
    if (this.botUntil) {
      const { h, m } = clockOfDay(s);
      [r1, r2, labels] = [`${h}:`, pad2(m), ['TIME']];
    }
    return this.lcd({
      depth: v.depth < 1.2 ? '---' : depthText(v.depth),
      unit: du,
      icons: { fast: this.lockCause === 'fast' ? 'on' : '', missed: this.lockCause === 'deco' ? 'on' : '', watch: !this.botUntil },
      top: top === 'max' ? { lbl: ['MAX'], value: depthText(v.maxDepth), unit: du }
        : top === 'avg' ? { lbl: ['AVG'], value: depthText(v.avgDepth), unit: du }
          : top === 'temp' ? { lbl: [], value: String(Math.round(tempVal(v.temperature))), unit: tempUnit() }
            : { lbl: [], value: '', unit: '' },
      mid: {
        left: ascending ? String(Math.round(imperial() ? v.ascentRate * 3.28084 : v.ascentRate)) : `${Math.min(99, Math.floor(v.diveTime / 60))}:`,
        leftLbl: ascending ? '' : 'DTIME',
        speedUnit: ascending,
        depth: '', r1, r2, labels,
      },
      bottom: {
        press: v.tank.ai ? pressText(v.tank.pressure) : '',
        bt: true,
        ...(v.tank.ai ? this.bottomValue('ttr', v, s, 0, false) : { lbl: [], value: '', units: [] }),
      },
      bar: 0,
    });
  }

  /** Pre-dive (figure of §1.6) and post-dive pages alternating every 4 s (§3.4). */
  private surface(v: ComputerView, s: DiveSession): string {
    const du = depthUnit();
    if (!this.hasPostDive(s)) this.surfacePage = 'pre';
    const ai = v.tank.ai;
    const nitrox = this.nitrox(s);
    const pf = this.settings.personal === 'P1' ? 'p+' : this.settings.personal === 'P2' ? 'p++' : '';
    const icons = {
      fast: this.locked && this.lockCause === 'fast' ? 'on' : '',
      missed: this.locked && this.lockCause === 'deco' ? 'on' : '',
      pf,
    };
    const { h, m } = clockOfDay(s);
    const si = s.surfaceInterval;
    const siMid = si === null ? { left: '--:', depth: '--' } : { left: `${Math.min(99, Math.floor(si / 3600))}:`, depth: pad2(Math.floor((si % 3600) / 60)) };
    const last = s.log[s.log.length - 1];
    if (this.surfacePage === 'post' && last) {
      const pageB = Math.floor(performance.now() / 4000) % 2 === 1;
      const bottom: BottomState = { press: pressText(last.tankEnd), pressLbl: 'P-END', lbl: [], value: String(Math.round(last.gas.o2 * 100)), units: ['%', 'O2'] };
      if (pageB) {
        // Condensed log: max and average depth, dive time, final tank pressure and O2 %.
        return this.lcd({
          depth: depthText(last.maxDepth), unit: du, icons, bar: Math.min(10, Math.floor(v.n2Load / 10)),
          top: { lbl: ['MAX', 'AVG'], value: depthText(last.avgDepth), unit: du },
          mid: { left: `${Math.min(99, Math.round(last.duration / 60))}:`, leftLbl: 'DTIME', depth: '', r1: '', r2: '', labels: [] },
          bottom,
        });
      }
      const noFly = this.noFlyMin(v, s);
      return this.lcd({
        depth: String(Math.ceil(v.desat / 60)), hours: true, desat: true, unit: '', icons: { ...icons, plane: true }, bar: Math.min(10, Math.floor(v.n2Load / 10)),
        top: { lbl: [], value: String(Math.ceil(noFly / 60)), unit: 'h' },
        mid: { ...siMid, leftLbl: 'S.I.', r1: `${h}:`, r2: pad2(m), labels: ['TIME'] },
        bottom,
      });
    }
    return this.lcd({
      depth: '---', unit: du, icons, bar: Math.min(10, Math.floor(v.n2Load / 10)),
      top: nitrox ? { lbl: ['MOD'], value: depthText(v.mod), unit: du } : { lbl: [], value: '', unit: '' },
      mid: { ...siMid, leftLbl: 'S.I.', r1: `${h}:`, r2: pad2(m), labels: ['TIME'] },
      bottom: { press: ai ? pressText(v.tank.pressure) : '', bt: this.locked, lbl: nitrox ? ['G1'] : [], value: nitrox ? String(v.o2) : '', units: nitrox ? ['%', 'O2'] : [] },
    });
  }

  /**
   * The LCD, drawn like the manual's figures: every printed label and segment is there, unlit ones
   * in light grey.
   */
  private lcd(d: LcdState): string {
    const L = (t: string, on: boolean, cls = '', blink = false) => `<span class="qa-l ${cls} ${on ? 'on' : ''} ${on && blink ? 'blink' : ''}">${t}</span>`;
    const top = d.top;
    const mid = d.mid;
    const bot = d.bottom;
    const tl = new Set(top.lbl);
    const ml = new Set(mid.labels);
    const bl = new Set(bot.lbl);
    const bu = new Set(bot.units);
    const bar = Array.from({ length: 10 }, (_, i) => `<i class="${9 - i < d.bar ? 'on' : ''}"></i>`).join('');
    const tri = d.triangles ?? '';
    const imp = imperial();
    const topUnitC = top.unit === '°C' || top.unit === '°F';
    return `
      <div class="qa-bar">${bar}</div>
      <div class="qa-depth ${d.depthBlink ? 'blink' : ''}">${sevenSeg(d.depth, 3, 'qa-d')}</div>
      ${L('h', !!d.hours, 'qa-h')}${L('ft', !d.hours && d.unit === 'ft', 'qa-dft')}${L('m', !d.hours && d.unit === 'm', 'qa-dm')}
      <span class="qa-tri">${L('▼', tri === 'down' || tri === 'both', 'qa-tdn', tri === 'down')}${L('▲', tri === 'both', 'qa-tup')}</span>
      ${L('DESAT', !!d.desat, 'qa-desat')}${L(d.icons.pf || 'p++', !!d.icons.pf, 'qa-pf')}
      ${L('⧗', d.icons.missed === 'on', 'qa-hg')}
      <svg class="qa-mtn" viewBox="0 0 30 26"><path d="M1 25 L15 2 L29 25 Z M8 25 L15 13 L22 25" /></svg>
      <span class="qa-batt"></span>${L('✈', !!d.icons.plane, 'qa-plane')}
      <span class="qa-tlbl">${L('MAX', tl.has('MAX'))}${L('DEEP', false)}${L('AVG', tl.has('AVG'))}${L('MOD', tl.has('MOD'), '', !!top.blink)}</span>
      ${L('ASC<br>+5', tl.has('ASC+5'), 'qa-asc5t')}
      <div class="qa-top ${top.blink ? 'blink' : ''}">${sevenSeg(top.value, 3, 'qa-t')}</div>
      ${L('h', top.unit === 'h', 'qa-th')}${L(imp ? '°F' : '°C', topUnitC, 'qa-tc')}${L(top.unit === 'ft' ? 'ft' : 'm', top.unit === 'm' || top.unit === 'ft', 'qa-tm')}
      <div class="qa-hr r1"></div>
      ${L('DTIME', mid.leftLbl === 'DTIME', 'qa-dtime')}${L('S.I.', mid.leftLbl === 'S.I.', 'qa-si')}
      <span class="qa-fast">${L('↑!!', !!d.icons.fast, '', d.icons.fast === 'blink')}</span>
      <div class="qa-left">${sevenSeg(mid.left, 2, 'qa-m')}</div>
      ${L(`${imp ? 'ft' : 'm'}<br>min`, !!mid.speedUnit, 'qa-spd')}
      <div class="qa-sep"></div>
      ${L('MSS', false, 'qa-mss')}
      <div class="qa-stop ${mid.depthBlink ?? ''}">${sevenSeg(mid.depth, 2, 'qa-m')}</div>
      ${L(imp ? 'ft' : 'm', !!mid.depth && mid.leftLbl !== 'S.I.', 'qa-stopu')}
      <span class="qa-mlbl">${L('NO', ml.has('NO'))}${L('DECO', ml.has('DECO'))}${L('SAFE', ml.has('SAFE'))}${L('TIME', ml.has('TIME'))}${L('IN', false)}</span>
      ${L('ASC', ml.has('ASC'), 'qa-ascm')}${L('OUT', ml.has('OUT'), 'qa-out')}${L('⏱', !!d.icons.watch, 'qa-watch')}
      <div class="qa-r1">${sevenSeg(mid.r1, 2, 'qa-m')}</div>
      <div class="qa-r2">${sevenSeg(mid.r2, 2, 'qa-m')}</div>
      ${mid.msg ? `<div class="qa-msg blink">${mid.msg}</div>` : ''}
      <div class="qa-hr r2"></div>
      <span class="qa-blbl">${L('P-START', false)}${L('P-END', bot.pressLbl === 'P-END')}${L('ΔP', false)}${L('AGF', false)}</span>
      <div class="qa-press ${bot.pressBlink ? 'blink' : ''}">${sevenSeg(bot.press, 4, 'qa-p')}</div>
      ${L('psi', !!bot.press && imp, 'qa-psi')}${L('bar', !!bot.press && !imp, 'qa-barl')}${L('BT', !!bot.bt, 'qa-bt')}
      <span class="qa-rlbl">${L('SWITCH', false)}${L('G1', bl.has('G1'))}${L('▸2▸3', false)}${L('TTR', bl.has('TTR'))}${L('RGT', false)}</span>
      ${L('ASC<br>+5', bl.has('ASC+5'), 'qa-asc5b')}
      <div class="qa-br ${bot.blink ? 'blink' : ''}">${sevenSeg(bot.value, 3, 'qa-b')}</div>
      <span class="qa-units">
        ${L('%', bu.has('%'))}${L('PP', bu.has('PPO2'))}${L('O₂', bu.has('PPO2') || bu.has('O2'))}<br>${L('°C', bu.has('°C'))}${L('CNS', bu.has('CNS'))}<br>${L('DSI', false)}<br>${L('l', bu.has('l'))}${L('cuft', bu.has('cuft'))}<br>${L('°F', bu.has('°F'))}${L('min', bu.has('min'))}
      </span>`;
  }
}

interface TopView {
  lbl: string[];
  value: string;
  unit: string;
  blink?: boolean;
}

interface Mid {
  left: string;
  leftLbl: string;
  speedUnit?: boolean;
  depth: string;
  depthBlink?: string;
  r1: string;
  r2: string;
  labels: string[];
  msg?: string;
}

interface BottomView {
  lbl: string[];
  value: string;
  units: string[];
  blink?: boolean;
}

interface BottomState extends BottomView {
  press: string;
  pressLbl?: string;
  pressBlink?: boolean;
  bt?: boolean;
}

interface LcdState {
  depth: string;
  depthBlink?: boolean;
  hours?: boolean;
  desat?: boolean;
  unit: string;
  triangles?: '' | 'down' | 'both';
  icons: { fast?: string; missed?: string; pf?: string; plane?: boolean; watch?: boolean };
  top: TopView;
  mid: Mid;
  bottom: BottomState;
  bar: number;
}
