import type { DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthText, depthUnit, imperial, pressText, pressUnit, tempUnit, tempVal } from '../../../units';
import { type ButtonHelp, type ComputerView, clockOfDay } from '../../base';
import type { PelagicAlarm } from '../common';
import { I770rRules } from './rules';

const U = () => depthUnit().toUpperCase();
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.floor(min % 60)).padStart(2, '0')}`;
const ms = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const stopText = (d: number) => String(imperial() ? Math.round((d * 3.28084) / 5) * 5 : Math.round(d));

/** Aqua Lung i770R: buttons and display (rules in rules.ts and ../common.ts). */
export class AqualungI770r extends I770rRules {
  /** Up button: More (Dive) Data screens; on the surface also Last Dive Data. */
  private pages(s: DiveSession): ('more' | 'last')[] {
    return s.inDive ? ['more'] : ['more', 'last'];
  }

  /** "EARMARK APPLIED" is displayed for 3 seconds. */
  private earmarkUntil = 0;

  /**
   * Dive Menu (▼): GAS SWITCH, DISPLAY, DS PREVIEW; Gas Switch list (p. 55–57 figures): ▲ / ▼ scroll,
   * SELECT "to select an option" / "TO SWITCH", SELECT held "to step back", ▼ held "Back to Dive Main".
   */
  private menu: { page: 'menu' | 'gas'; idx: number; warned: boolean; at: number } | null = null;

  press(button: string, s: DiveSession): boolean {
    const m = this.menu;
    if (m && s.inDive) {
      m.at = s.clock;
      const n = m.page === 'menu' ? 3 : 4;
      if (button === 'down') m.idx = (m.idx + 1) % n;
      else if (button === 'up') m.idx = (m.idx + n - 1) % n;
      else if (m.page === 'menu') {
        if (m.idx === 0) Object.assign(m, { page: 'gas', idx: s.breathing, warned: false }); // DISPLAY, DS PREVIEW: not simulated
      } else if (m.idx < this.knownGases(s).length && m.idx !== s.breathing) {
        // "If the current PO2 value is greater than 1.6, then a warning not to switch will display [...]
        // The diver may overide the i770R and force the gas switch by pressing the (Select) button during
        // the DO NOT SWITCH TO GAS n HIGH PO2 message."
        if (s.pressure * s.allGases[m.idx].o2 > 1.6 && !m.warned) m.warned = true;
        else {
          s.switchGas(m.idx);
          this.menu = null;
        }
      }
      if (m.page === 'gas' && button !== 'select') m.warned = false;
      return true;
    }
    if (button === 'select') {
      if (this.acknowledge(s)) return true;
      // Gas Switch Warning: "You must confirm the gas switch by pressing the (Select) button."
      if (this.switchWarn !== null && s.inDive) {
        s.switchGas(this.switchWarn);
        this.switchWarn = null;
      }
      return true;
    }
    if (button === 'up') this.setScreen((this.screen + 1) % (this.pages(s).length + 1));
    // "The Gas Switch Menu cannot be accessed during the sounding of alarms."
    if (button === 'down' && s.inDive && !this.locked && !this.shownAlarm(s)) this.menu = { page: 'menu', idx: 0, warned: false, at: s.clock };
    return true;
  }

  hold(button: string, s: DiveSession): boolean {
    if (this.menu && s.inDive) {
      if (button === 'down') this.menu = null;
      else if (button === 'select') this.menu = this.menu.page === 'gas' ? { ...this.menu, page: 'menu', idx: 0 } : null;
      return true;
    }
    if (button === 'down' && s.inDive) {
      this.earmarkUntil = s.clock + 3;
      return true;
    }
    return false;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      down: {
        name: '▼',
        press: { real: { fr: 'Menu (plongée : changement de gaz, affichage, DS Preview) ; dans un menu : descendre', en: 'Menu (dive: gas switch, display, DS Preview); in a menu: scroll down' }, simulated: true, note: { fr: 'changement de gaz seulement', en: 'gas switch only' } },
        hold: { real: { fr: 'En plongée : repère (EARMARK APPLIED)', en: 'During a dive: earmark (EARMARK APPLIED)' }, simulated: true },
      },
      up: {
        name: '▲',
        press: { real: { fr: 'More Dive Data (en surface : More Data, Last Dive Data), puis retour', en: 'More Dive Data (on the surface: More Data, Last Dive Data), then back' }, simulated: true },
      },
      select: {
        name: 'SELECT',
        press: { real: { fr: 'Acquitte l’alarme sonore ; confirme le changement de gaz proposé ; dans un menu : sélection', en: 'Acknowledges the audible alarm; confirms the gas switch proposed; in a menu: select' }, simulated: true },
        hold: { real: { fr: 'Boussole', en: 'Compass' }, simulated: false },
      },
    };
  }

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    const pages = this.pages(s);
    if (this.screen > pages.length) this.screen = 0;
    const page = this.screen ? pages[this.screen - 1] : undefined;
    const alarm = s.inDive ? this.shownAlarm(s) : undefined;
    const blink = Math.floor(performance.now() / 500) % 2 === 0;

    // The menu closes when the dive ends, when an alarm strikes, or after 10 s without a button (not stated: as the i330R).
    if (this.menu && (!s.inDive || alarm || s.clock - this.menu.at > 10)) this.menu = null;
    let content: string;
    if (this.menu) content = this.menuScreen(s);
    else if (page === 'more') content = this.moreData(v, s);
    else if (page === 'last') content = this.lastDive(s);
    else content = s.inDive ? this.diveMain(v, s, alarm, blink) : this.surfaceMain(v, s);

    // ASC bar graph: segments above 1.8, 3.7, 5.5, 7.4 and 9.2 m/min; "all segments flash" when too fast.
    const r = v.inDive ? v.ascentRate : 0;
    const asc = [1.8, 3.7, 5.5, 7.4, 9.2].filter((t) => r > t).length;
    // N2 bar graph: "grow in length, shift from green to amber, and ultimately to red" (segments green,
    // then amber, red on top, as on the figures); hidden in VGM.
    const n2 = this.locked ? 0 : this.n2Segments(v);
    const segs = (n: number, cls: (i: number) => string, flash: boolean) => Array.from({ length: 5 }, (_, i) => `<i class="${4 - i < n && !flash ? cls(4 - i) : ''}"></i>`).join('');
    const bars = page ? '' : `
      <div class="aq7-bar l">${segs(asc, () => 'g', asc === 5 && !blink)}</div><span class="aq7-barlbl l">ASC</span>
      <div class="aq7-bar r">${segs(n2, (i) => ['g', 'g', 'g', 'y', 'r'][i], (alarm === 'deco-entry' || alarm === 'down-to-stop') && !blink)}</div><span class="aq7-barlbl r">N2</span>`;

    el.innerHTML = `
      <div class="dev aq7">
        <div class="aq7-case">
          <button class="aq7-btn down" data-btn="down"></button>
          <button class="aq7-btn up" data-btn="up"></button>
          <button class="aq7-btn select" data-btn="select"></button>
          <div class="aq7-screen">${bars}${content}</div>
        </div>
      </div>`;
  }

  /** Bottom bar: "GAS 1 | FO2: 32% | MOD: 33.9 M" (third field: MOD, current PO2 or blank). */
  private gasBar(v: ComputerView, s: DiveSession, po2Red = false): string {
    const fo2 = v.o2 === 21 ? 'AIR' : `${v.o2}%`;
    const mod = imperial() ? `${Math.round(v.mod * 3.28084)} FT` : `${v.mod.toFixed(1)} M`;
    const third = po2Red ? `<span class="red">PO2: ${s.ppO2.toFixed(2)}</span>`
      : this.settings.field === 'po2' ? `PO2: ${s.ppO2.toFixed(2)}` : this.settings.field === 'mod' && v.o2 !== 21 ? `MOD: ${mod}` : '';
    return `<div class="aq7-gas"><span>GAS ${s.breathing + 1}</span><span>FO2: ${fo2}</span><span>${third}</span></div>`;
  }

  /** Dive Menu and Gas Switch list (p. 55–57 figures). */
  private menuScreen(s: DiveSession): string {
    const m = this.menu!;
    if (m.page === 'menu') {
      return this.list('DIVE MENU', ['GAS SWITCH', 'DISPLAY', 'DS PREVIEW'].map((k, i) => [m.idx === i ? `▶ ${k}` : k, '']));
    }
    const gases = this.knownGases(s);
    const fo2 = (i: number) => {
      if (i >= gases.length) return 'OFF';
      const o2 = Math.round(gases[i].o2 * 100);
      return o2 === 21 ? 'AIR' : `${o2}%`;
    };
    const rows = [0, 1, 2, 3].map((i) => `<div class="aq7-li ${m.idx === i ? 'hl' : ''} ${i === s.breathing ? 'cur' : 'green'}"><span>GAS ${i + 1}</span><span>FO2: ${fo2(i)}</span></div>`).join('');
    const sel = m.idx < gases.length ? gases[m.idx] : null;
    const u = imperial() ? 'FT' : 'M';
    const mod = sel ? (m.idx === 0 ? this.modDepth(sel.o2) : this.decoMod(sel.o2)) : 0;
    const side = m.warned
      ? `<div class="aq7-gw red">DO NOT SWITCH<br>TO GAS ${m.idx + 1}<br>HIGH PO2</div>`
      : sel ? `<div class="aq7-gw"><span>PO2</span><b>${(s.pressure * sel.o2).toFixed(2)}</b><span class="cyan">MOD: ${imperial() ? Math.round(mod * 3.28084) : Math.round(mod)} ${u}</span></div>` : '<div class="aq7-gw"></div>';
    return `<div class="aq7-list"><div class="aq7-head"><span>DIVE</span><span class="green">GAS SWITCH</span></div><div class="aq7-gsw"><div>${rows}</div>${side}</div><div class="aq7-keys">▲ - UP LIST · ▼ - DOWN LIST · ◉ - TO SWITCH</div></div>`;
  }

  /** Alarm banner at the bottom (red: alarms; yellow: warnings). */
  private banner(text: string, cls = 'red', arrows = ''): string {
    return `<div class="aq7-banner ${cls}">${arrows ? `<b>${arrows}</b>` : ''}<span>${text}</span>${arrows ? `<b>${arrows}</b>` : ''}</div>`;
  }

  private cell(lbl: string, val: string, cls: string): string {
    const len = val.replace(/<sup>.*?<\/sup>/g, '').replace(/<[^>]*>/g, '').length;
    return `<div class="aq7-cell ${cls}"><div class="aq7-lbl">${lbl}</div><div class="aq7-val ${len > 3 ? 'sm' : ''}">${val}</div></div>`;
  }

  private diveMain(v: ComputerView, s: DiveSession, alarm: PelagicAlarm | undefined, blink: boolean): string {
    const [di, dd] = depthText(v.depth).split('.');
    const depth = s.depth > 100 ? '<span class="red">- - -</span>' : `${di}<small>${dd !== undefined ? `.${dd}` : ''}</small>`;
    const ai = v.tank.ai;
    const bar = ai ? this.cell(pressUnit().toUpperCase(), pressText(v.tank.pressure), 'cyan') : '<div class="aq7-cell"></div>';
    const gtr = ai ? this.cell('GTR', v.tank.gasTime === null ? '- -' : String(Math.min(99, v.tank.gasTime)), 'green') : '<div class="aq7-cell"></div>';
    const cv = v.inDeco && v.ceilingViolation > 0;

    // Right column: top (NO-DECO / stop) and bottom (DIVE-T / stop time).
    let top: string;
    let bottom: string;
    if (this.locked) {
      top = `<div class="aq7-cell red ${alarm && !blink ? 'hide' : ''}"><div class="aq7-val go">▲<br>GO UP<br>▲</div></div>`;
      bottom = '<div class="aq7-cell"></div>';
    } else if (alarm === 'high-po2') {
      top = '<div class="aq7-cell red"><div class="aq7-val go">▲<br>GO UP<br>▲</div></div>';
      bottom = this.cell('PO2', s.ppO2.toFixed(2), 'red');
    } else if (alarm === 'o2-warning' || alarm === 'o2-alarm') {
      top = this.cell('O2 SAT', `${Math.floor(this.o2Sat(s))}%`, alarm === 'o2-alarm' ? 'red' : 'yellow');
      bottom = '<div class="aq7-cell"></div>';
    } else if (v.inDeco) {
      const cls = cv || alarm === 'deco-entry' ? 'red' : 'yellow';
      top = this.cell('DECO STOP', `${stopText(v.stopDepth)}<sup>${U()}</sup>`, cls);
      bottom = this.cell('TIME', String(v.stopTime), cls);
    } else if (this.deep.state === 'active') {
      top = this.cell('DEEP STOP', `${stopText(this.deep.target)}<sup>${U()}</sup>`, 'yellow');
      bottom = this.cell('TIME', ms(this.deep.remaining), 'yellow');
    } else if (v.safety.state === 'active') {
      top = this.cell('SAFETY STOP', `${stopText(this.ssDepth())}<sup>${U()}</sup>`, 'yellow');
      bottom = this.cell('TIME', ms(v.safety.remaining), 'yellow');
    } else {
      const d = this.dtr(s, v);
      top = this.cell(d.o2 ? 'O2 TIME' : 'NO-DECO', String(d.value), d.o2 ? 'yellow' : 'green');
      bottom = this.cell('DIVE-T', String(Math.floor(v.diveTime / 60)), 'white');
    }

    // Bottom bar: alarm banner, earmark, or the gas bar.
    let foot: string;
    if (cv) foot = this.banner('DOWN TO STOP', 'red', '▼');
    else if (this.locked && alarm) foot = this.banner('VIOLATION');
    else if (s.depth > 100) foot = this.banner('TOO DEEP', 'red', '▲');
    else if (alarm) foot = this.alarmBanner(alarm, v, s);
    else if (s.clock < this.earmarkUntil) foot = '<div class="aq7-gas green c">EARMARK APPLIED</div>';
    else if (this.switchWarn !== null) {
      // GAS SWITCH WARNING figure: yellow "SWITCH TO FO2: 100%".
      const o2 = Math.round((s.allGases[this.switchWarn] ?? s.gas).o2 * 100);
      foot = this.banner(`SWITCH TO FO2: ${o2 === 21 ? 'AIR' : `${o2}%`}`, 'yellow');
    }
    else if (this.locked) foot = this.banner('VIOLATION');
    else {
      // After a PO2 alarm the value (red) alternates with the normal data in the bottom bar.
      const po2High = v.inDeco ? s.ppO2 > 1.6 : s.ppO2 >= this.po2Limit(false) - 1e-9;
      foot = this.gasBar(v, s, po2High);
    }

    return `<div class="aq7-main">
      <div class="aq7-depth">${depth}<em>${U()}</em></div>
      <div class="aq7-right t">${top}</div>
      <div class="aq7-sub">${bar}${gtr}</div>
      <div class="aq7-right b">${bottom}</div>
    </div>${foot}`;
  }

  private alarmBanner(alarm: PelagicAlarm, v: ComputerView, s: DiveSession): string {
    switch (alarm) {
      case 'deco-entry': return this.banner('DECO ENTRY', 'red', '▲');
      case 'high-po2': case 'o2-alarm': return this.banner('ALARM');
      case 'o2-warning': return this.banner('WARNING', 'yellow');
      case 'too-fast': return this.banner('TOO FAST');
      case 'depth': return this.banner('DEPTH');
      case 'dive-t': return this.banner('DIVE TIME');
      case 'turn': return this.banner('TURN PRESSURE');
      case 'end': return this.banner('END PRESSURE');
      case 'n2bar': return this.banner('NITROGEN');
      case 'dtr': return this.banner(this.dtr(s, v).o2 ? 'O2 TIME' : 'NO DECO TIME');
      default: return this.gasBar(v, s);
    }
  }

  private surfaceMain(v: ComputerView, s: DiveSession): string {
    const si = v.surfaceInterval === null ? s.clock / 60 : v.surfaceInterval / 60;
    const ai = v.tank.ai;
    const last = s.log[s.log.length - 1];
    const foot = this.locked ? this.banner('VIOLATION') : this.gasBar(v, s);
    return `<div class="aq7-main surf">
      <div class="aq7-depth"><span class="aq7-surflbl">SURF-T</span>${hm(si)}</div>
      <div class="aq7-right t"><div class="aq7-batt">70%<i></i></div></div>
      <div class="aq7-sub">${ai ? this.cell(pressUnit().toUpperCase(), pressText(v.tank.pressure), 'cyan') : '<div class="aq7-cell"></div>'}${ai ? this.cell('GTR', '- -', 'green') : '<div class="aq7-cell"></div>'}</div>
      <div class="aq7-right b">${this.cell('DIVE', String(last ? last.number : 0), 'white')}</div>
    </div>${foot}`;
  }

  private list(title: string, rows: [string, string][]): string {
    return `<div class="aq7-list"><div class="aq7-head"><span>DIVE</span><span class="green">${title}</span></div>${rows.map(([k, val]) => `<div class="aq7-li"><span class="green">${k}</span><span>${val}</span></div>`).join('')}</div>`;
  }

  /** More Dive Data (dive) / More Data (surface); battery, date: simulated values. */
  private moreData(v: ComputerView, s: DiveSession): string {
    const { h, m } = clockOfDay(s);
    const tod = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    const day = Math.floor((s.clock + 9 * 3600) / 86400) + 1;
    const date = `9.${day}.26`; // fictitious calendar, M.D.YY
    const temp = `${Math.round(tempVal(v.temperature))} ${tempUnit()}`;
    const sat = `${Math.floor(this.o2Sat(s))} %`;
    if (s.inDive) {
      // "The Max Depth and Date fields will be replaced with No Deco and Dive-T during a Deep Stop or Safety Stop."
      const stop = v.safety.state === 'active' || this.deep.state === 'active';
      const first: [string, string][] = v.inDeco
        ? [['TTS', v.tts > 99 ? '- -' : `${v.tts} MIN`], ['DIVE-T', `${Math.floor(v.diveTime / 60)} MIN`]]
        : stop
          ? [['NO DECO', `${Math.min(99, v.ndl)} MIN`], ['DIVE-T', `${Math.floor(v.diveTime / 60)} MIN`]]
          : [['MAX DEPTH', `${depthText(v.maxDepth)} ${U()}`], ['DATE', date]];
      return this.list('MORE DIVE DATA', [...first, ['TIME OF DAY', tod], ['TEMPERATURE', temp], ['ELEV', 'SEA'], ['O2 SAT', sat], ['CURRENT PO2', s.ppO2.toFixed(2)]]);
    }
    const dived = s.log.length > 0;
    const si = (v.surfaceInterval ?? 0) / 60;
    const fly = !dived ? '- -' : si < 10 ? '23:50' : hm(Math.max(0, 24 * 60 - si));
    const desat = !dived ? '- -' : v.desat > 24 * 60 ? '> 24:00' : hm(v.desat);
    return this.list('MORE DATA', [['DATE', date], ['TIME OF DAY', tod], ['TEMPERATURE', temp], ['ELEV', 'SEA'], ['FLY', fly], ['O2 SAT', dived ? sat : '- -'], ['DESAT', desat]]);
  }

  private lastDive(s: DiveSession): string {
    const d = s.log[s.log.length - 1];
    if (!d) return `<div class="aq7-list"><div class="aq7-head"><span>DIVE</span><span class="green">LAST DIVE DATA</span></div><div class="aq7-center">NO DIVE YET</div></div>`;
    return `<div class="aq7-list"><div class="aq7-head"><span>DIVE</span><span class="green">LAST DIVE DATA</span></div>
      <div class="aq7-lastlbl green">MAX DEPTH</div><div class="aq7-lastval">${imperial() ? Math.round(d.maxDepth * 3.28084) : d.maxDepth.toFixed(1)} ${U()}</div>
      <div class="aq7-lastlbl green">DIVE-T</div><div class="aq7-lastval">${Math.round(d.duration / 60)} MIN</div></div>`;
  }
}
