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

  press(button: string, s: DiveSession): boolean {
    if (button === 'select') return this.acknowledge(s) || true;
    if (button === 'up') this.setScreen((this.screen + 1) % (this.pages(s).length + 1));
    return true; // Down: Dive Main Menu (not simulated)
  }

  hold(button: string, s: DiveSession): boolean {
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
        press: { real: { fr: 'Menu (plongée : changement de gaz, affichage, DS Preview)', en: 'Menu (dive: gas switch, display, DS Preview)' }, simulated: false },
        hold: { real: { fr: 'En plongée : repère (EARMARK APPLIED)', en: 'During a dive: earmark (EARMARK APPLIED)' }, simulated: true },
      },
      up: {
        name: '▲',
        press: { real: { fr: 'More Dive Data (en surface : More Data, Last Dive Data), puis retour', en: 'More Dive Data (on the surface: More Data, Last Dive Data), then back' }, simulated: true },
      },
      select: {
        name: 'SELECT',
        press: { real: { fr: 'Acquitte l’alarme sonore', en: 'Acknowledges the audible alarm' }, simulated: true },
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

    let content: string;
    if (page === 'more') content = this.moreData(v, s);
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
    return `<div class="aq7-gas"><span>GAS 1</span><span>FO2: ${fo2}</span><span>${third}</span></div>`;
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
