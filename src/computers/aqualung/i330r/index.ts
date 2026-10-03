import type { DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthText, depthUnit, imperial, tempUnit, tempVal } from '../../../units';
import { type ButtonHelp, type ComputerView, clockOfDay } from '../../base';
import type { PelagicAlarm } from '../common';
import { I330rRules } from './rules';

type Alt = 'fly' | 'alt2' | 'alt3' | 'ds';

const U = () => depthUnit().toUpperCase();
const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.floor(min % 60)).padStart(2, '0')}`;
const ms = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** Vertical label under a bar graph ("ASC", "N2"), read bottom to top as on the figures. */
const vlabel = (t: string) => `<svg viewBox="0 0 10 18"><text x="9" y="18" transform="rotate(-90 9 18)">${t}</text></svg>`;

/** Large depth with a smaller decimal ("19.8 M"), whole feet in imperial. */
function depthBig(d: number): string {
  const [i, dec] = depthText(d).split('.');
  return `${i}<small>${dec !== undefined ? `.${dec}` : ''}</small><em>${U()}</em>`;
}

/** Aqua Lung i330R: buttons and display (rules in rules.ts and ../common.ts). */
export class AqualungI330r extends I330rRules {
  /** Last Dive screens (hold Up on the surface): 0 = off, 1 = LAST DIVE 1, 2 = LAST DIVE 2. */
  private lastIdx = 0;

  /** ALT screens in the order of the manual's diagrams (ALT 1 with the Timer and the Timer itself are not simulated). */
  private alts(s: DiveSession): Alt[] {
    if (s.inDive) {
      return ['alt2', ...(s.gas.o2 > 0.215 ? ['alt3' as const] : []), ...(this.deep.state === 'armed' ? ['ds' as const] : [])];
    }
    const nitroxDive = s.log.length > 0 && s.log[s.log.length - 1].gas.o2 > 0.215;
    return [...(s.log.length ? ['fly' as const] : []), 'alt2', ...(nitroxDive ? ['alt3' as const] : [])];
  }

  /**
   * Dive Main Menu (▼ hold): lead-in BRIGHT. / GAS SWTCH; Gas Menu: SWITCH TO GAS n. "If no button is
   * pressed the i330R will revert to the Dive Main screen after 10 seconds."
   */
  private menu: { page: 'lead' | 'gas'; idx: number; gas: number; warned: boolean; at: number } | null = null;

  /** Gases offered in the Gas Menu ("The active gas will not display in the Gas Menu"). */
  private menuGases(s: DiveSession): number[] {
    return this.knownGases(s).map((_, i) => i).filter((i) => i !== s.breathing);
  }

  press(button: string, s: DiveSession): boolean {
    const m = this.menu;
    if (m && s.inDive) {
      m.at = s.clock;
      if (m.page === 'lead') m.idx = m.idx ? 0 : 1; // ▲ / ▼: "to Gas Switch Lead-in" / "to Brightness Lead-in"
      else {
        const list = this.menuGases(s);
        m.gas = list[(list.indexOf(m.gas) + (button === 'up' ? 1 : list.length - 1)) % list.length]; // "toggle between available gasses"
        m.warned = false;
      }
      return true;
    }
    if (button === 'down') return this.acknowledge(s) || true; // acknowledge alarms
    if (button === 'up') {
      if (this.lastIdx) {
        // Up steps LAST DIVE 1 → LAST DIVE 2 → back to Main (Last Dive 2 bypassed if no dive yet).
        this.lastIdx = this.lastIdx === 1 && s.log.length ? 2 : 0;
        return true;
      }
      this.setScreen((this.screen + 1) % (this.alts(s).length + 1));
    }
    return true;
  }

  hold(button: string, s: DiveSession): boolean {
    if (s.inDive && !this.locked) {
      const m = this.menu;
      // ▲ + ▼ held exits the menu (both buttons cannot be held here: ▲ held stands for it).
      if (m && button === 'up') {
        this.menu = null;
        return true;
      }
      if (button === 'down') {
        // "The Gas Switch Menu cannot be accessed during the sounding of alarms"; lead-in bypassed with a single gas.
        if (!m) {
          if (!this.shownAlarm(s)) this.menu = { page: 'lead', idx: this.knownGases(s).length > 1 ? 1 : 0, gas: 0, warned: false, at: s.clock };
        } else if (m.page === 'lead') {
          if (m.idx === 1 && this.knownGases(s).length > 1) Object.assign(m, { page: 'gas', gas: this.menuGases(s)[0], warned: false, at: s.clock });
          else this.menu = null; // Brightness: not simulated
        } else {
          // "If the current PO2 value is greater than max PO2 value set, then a warning not to switch will
          // display [...] The diver may override the i330R and force the gas switch" (a second hold, deduced).
          const limit = m.gas === 0 ? Number(this.settings.ppo2) || 1.4 : this.decoPpo2();
          if (s.pressure * s.allGases[m.gas].o2 > limit + 1e-9 && !m.warned) {
            m.warned = true;
            m.at = s.clock;
          } else {
            s.switchGas(m.gas);
            this.menu = null;
          }
        }
        return true;
      }
    }
    if (button === 'up' && !s.inDive) {
      this.lastIdx = 1;
      this.setScreen(0);
      return true;
    }
    return false;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      up: {
        name: '▲',
        press: { real: { fr: 'Écrans ALT (retour à l’écran principal après le dernier)', en: 'ALT screens (back to the main screen after the last one)' }, simulated: true },
        hold: { real: { fr: 'En surface : écrans Last Dive', en: 'On the surface: Last Dive screens' }, simulated: true },
      },
      down: {
        name: '▼',
        press: { real: { fr: 'Acquitte l’alarme sonore', en: 'Acknowledges the audible alarm' }, simulated: true },
        hold: { real: { fr: 'Menu (luminosité, changement de gaz ; en surface : Plan, Log, réglages…) ; dans un menu : sélection', en: 'Menu (brightness, gas switch; on the surface: Plan, Log, settings…); in a menu: select' }, simulated: true, note: { fr: 'en plongée, changement de gaz seulement ; ▲ long remplace ▲ + ▼ pour sortir', en: 'during the dive, gas switch only; ▲ hold stands for ▲ + ▼ to exit' } },
      },
    };
  }

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    const alts = this.alts(s);
    if (this.screen > alts.length) this.screen = 0;
    if (s.inDive) this.lastIdx = 0;
    const alt = this.screen ? alts[this.screen - 1] : undefined;
    const alarm = s.inDive ? this.shownAlarm(s) : undefined;
    const blink = Math.floor(performance.now() / 500) % 2 === 0;

    // The menu closes after 10 s without a button, when the dive ends, or when an alarm strikes.
    if (this.menu && (!s.inDive || s.clock - this.menu.at > 10 || alarm)) this.menu = null;
    let body: string;
    if (this.menu) body = this.menuScreen(v, s);
    else if (this.lastIdx && s.log.length) body = this.lastDive(s);
    else if (this.lastIdx) body = '<div class="aq3-center">NO DIVE YET</div>';
    else if (alt) body = this.altScreen(alt, v, s);
    else body = s.inDive ? this.diveMain(v, s, alarm, blink) : this.surfaceMain(v, s);

    // ASC bar graph: 1 segment above 3, 4.5, 6, 7.5 m/min, 5 above 9 (flashing: "all segments flash").
    const r = v.inDive ? v.ascentRate : 0;
    const asc = [3, 4.5, 6, 7.5, 9].filter((t) => r > t).length;
    const ascFlash = asc === 5 && alarm === 'too-fast' && !blink;
    // N2 bar graph: hidden in Violation Gauge Mode; full bar flashing during the deco / violation alarms.
    const n2 = this.locked ? 0 : this.n2Segments(v);
    const n2Flash = (alarm === 'deco-entry' || alarm === 'down-to-stop' || alarm === 'deco-deep') && !blink;
    const segs = (n: number, flash: boolean) => Array.from({ length: 5 }, (_, i) => {
      const on = 4 - i < n && !flash;
      return `<i class="${on ? ['g', 'g', 'g', 'y', 'r'][4 - i] : ''}"></i>`;
    }).join('');

    el.innerHTML = `
      <div class="dev aq3">
        <div class="aq3-case">
          <i class="aq3-lug t"></i><i class="aq3-lug b"></i>
          <button class="aq3-btn up" data-btn="up"></button>
          <button class="aq3-btn down" data-btn="down"></button>
          <div class="aq3-screen">
            <div class="aq3-bar l">${segs(asc, ascFlash)}${vlabel('ASC')}</div>
            <div class="aq3-bar r">${segs(n2, n2Flash)}${vlabel('N2')}</div>
            <div class="aq3-body">${body}</div>
          </div>
        </div>
      </div>`;
  }

  /** Bottom line: gas number (tank icon) and battery (simulated value). */
  private footer(): string {
    const g = (this.lastSession?.breathing ?? 0) + 1;
    return `<div class="aq3-foot"><span class="aq3-tank"><i></i>${g}</span><span class="aq3-batt"><i></i></span></div>`;
  }

  /** Dive Main Menu lead-ins and Gas Menu (p. 43–44 figures); high PO2 warning text deduced. */
  private menuScreen(_v: ComputerView, s: DiveSession): string {
    const m = this.menu!;
    if (m.page === 'lead') {
      const [other, name] = m.idx === 1 ? ['BRIGHTNESS', 'GAS SWTCH'] : ['GAS SWITCH', 'BRIGHT.'];
      return `<div class="aq3-lbl c">${other} ▲</div><div class="aq3-menu">${name}</div><div class="aq3-lbl c">${other} ▼</div>`;
    }
    const gas = s.allGases[m.gas] ?? s.gas;
    const po2 = s.pressure * gas.o2;
    const limit = m.gas === 0 ? Number(this.settings.ppo2) || 1.4 : this.decoPpo2();
    const fo2 = Math.round(gas.o2 * 100) === 100 ? 'O2' : Math.round(gas.o2 * 100) === 21 ? 'AIR' : `${Math.round(gas.o2 * 100)}<small>%</small>`;
    const warn = m.warned ? '<div class="aq3-msg red"><span>HIGH PO2</span></div>' : '';
    return `<div class="aq3-lbl c">SWITCH TO</div><div class="aq3-menu big">GAS ${m.gas + 1}</div>${warn || this.pair('PO2', po2.toFixed(2), po2 > limit ? 'red' : 'green', 'FO2', fo2, 'white')}`;
  }

  private diveMain(v: ComputerView, s: DiveSession, alarm: PelagicAlarm | undefined, blink: boolean): string {
    const depth = s.depth > 100 ? '<span class="red">- - -</span><em class="red">' + U() + '</em>' : depthBig(v.depth);
    const top = `<div class="aq3-depth">${depth}</div>`;

    // Middle box: VIOLATION, deep stop, deco stop, safety stop or DTR (NO DECO / O2 TIME).
    let box: string;
    if (this.locked) {
      box = `<div class="aq3-viol ${alarm && !blink ? 'off' : ''}">VIOLATION</div>`;
    } else if (v.inDeco) {
      const cv = v.ceilingViolation > 0;
      box = `<div class="aq3-box ${cv ? 'red' : 'yellow'}"><div class="aq3-lbl c">DECO STOP</div><div class="aq3-stop">${this.stopDepthText(v.stopDepth)}<small> ${U()}</small> - ${v.stopTime}<small>MIN</small></div></div>`;
    } else if (this.deep.state === 'active') {
      box = `<div class="aq3-box yellow"><div class="aq3-lbl c">DEEP STOP</div><div class="aq3-stop">${depthText(this.deep.target)}<small>${U()}</small> - ${ms(this.deep.remaining)}</div></div>`;
    } else if (v.safety.state === 'active') {
      box = `<div class="aq3-box yellow"><div class="aq3-lbl c">SAFETY STOP</div><div class="aq3-stop">${this.stopDepthText(this.ssDepth())}<small> ${U()}</small> - ${ms(v.safety.remaining)}</div></div>`;
    } else {
      const d = this.dtr(s, v);
      box = d.o2
        ? `<div class="aq3-box yellow dtr"><div class="aq3-lbl two">O2<br>TIME</div><div class="aq3-dtr">${d.value}</div></div>`
        : `<div class="aq3-box green dtr"><div class="aq3-lbl two">NO<br>DECO</div><div class="aq3-dtr">${d.value}</div></div>`;
    }

    // Lower row: alarm message during the audible alarm (and while it lasts for some), else data.
    const cv = v.inDeco && v.ceilingViolation > 0;
    const msg = this.message(alarm, v, s, cv);
    let row: string;
    if (msg) row = msg;
    else if (this.switchWarn !== null && blink) {
      // GAS SWITCH WARNING figure: "SWITCH TO FO2: 80%", flashing.
      const o2 = Math.round((s.allGases[this.switchWarn] ?? s.gas).o2 * 100);
      row = `<div class="aq3-msg yellow"><span>SWITCH TO<br>FO2: ${o2 === 100 ? 'O2' : `${o2}%`}</span></div>`;
    } else if (v.inDeco) {
      // TTS "0 - 99, then - - if greater than 99 min"; PO2 above 1.60 alternates with TTS.
      const po2 = s.ppO2 > 1.6 && Math.floor(s.clock / 2) % 2 === 0;
      row = this.pair(po2 ? 'PO2' : 'TTS', po2 ? s.ppO2.toFixed(2) : v.tts > 99 ? '- -' : String(v.tts), po2 ? 'red' : 'yellow', 'DIVE-T', String(Math.floor(v.diveTime / 60)), 'cyan');
    } else {
      // After a PO2 alarm, "the PO2 value (red) is to alternate with Max Depth".
      const po2 = s.ppO2 >= this.po2Limit(false) - 1e-9 && Math.floor(s.clock / 2) % 2 === 0;
      row = po2
        ? this.pair('PO2', s.ppO2.toFixed(2), 'red', 'DIVE-T', String(Math.floor(v.diveTime / 60)), 'cyan')
        : this.pair(`MAX ${U()}`, depthBig(v.maxDepth).replace(/<em>.*<\/em>/, ''), 'white', 'DIVE-T', String(Math.floor(v.diveTime / 60)), 'cyan');
    }
    return top + box + row + this.footer();
  }

  /** Stop depths in whole metres (feet: 10 ft steps). */
  private stopDepthText(d: number): string {
    return String(imperial() ? Math.round((d * 3.28084) / 5) * 5 : Math.round(d));
  }

  /** Alarm messages of the manual's figures (red: alarms; yellow: O2 SAT warning). */
  private message(alarm: PelagicAlarm | undefined, v: ComputerView, s: DiveSession, cv: boolean): string {
    const banner = (text: string, cls = 'red', arrows = '') => `<div class="aq3-msg ${cls}">${arrows ? `<b>${arrows}</b>` : ''}<span>${text}</span>${arrows ? `<b>${arrows}</b>` : ''}</div>`;
    // Persistent: DOWN TO STOP while above the stop, O2 SAT 100 % until surfacing, GO UP in VGM during the alarm.
    if (cv) return banner('DOWN<br>TO STOP', 'red', '▼');
    if (alarm === 'violation') return banner('GO UP', 'red', '▲');
    if (this.o2Sat(s) >= 100) return banner('O2 SAT<br>100%', 'red', '▲');
    switch (alarm) {
      case 'too-deep': return banner('TOO<br>DEEP', 'red', '▲');
      case 'deco-entry': return banner('DECO<br>ENTRY', 'red', '▲');
      case 'high-po2': return banner(`PO2 = ${s.ppO2.toFixed(2)}`, 'red', '▲');
      case 'too-fast': return banner('TOO FAST');
      case 'o2-warning': return banner(`O2 SAT<br>${Math.floor(this.o2Sat(s))}%`, 'yellow');
      case 'depth': return banner('DEPTH ALARM');
      case 'dive-t': return banner(`DIVE TIME<br>${this.settings.diveTAl} MIN`);
      case 'n2bar': return banner('NITROGEN');
      case 'dtr': return banner(this.dtr(s, v).o2 ? 'O2 TIME' : 'NO DECO TIME');
      default: return '';
    }
  }

  private pair(l1: string, v1: string, c1: string, l2: string, v2: string, c2: string): string {
    return `<div class="aq3-row"><div class="${c1}"><div class="aq3-lbl">${l1}</div><div class="aq3-val">${v1}</div></div><div class="${c2}"><div class="aq3-lbl">${l2}</div><div class="aq3-val">${v2}</div></div></div>`;
  }

  private surfaceMain(v: ComputerView, s: DiveSession): string {
    const si = v.surfaceInterval === null ? s.clock / 60 : v.surfaceInterval / 60;
    const top = `<div class="aq3-lbl c">SURFACE</div><div class="aq3-surf">${hm(si)}</div>`;
    if (this.locked) return top + '<div class="aq3-viol">VIOLATION</div>' + this.footer();
    const last = s.log[s.log.length - 1];
    let row: string;
    if (last && v.surfaceInterval !== null && v.surfaceInterval < 600) {
      // Surfacing: max depth and elapsed dive time during the first 10 minutes.
      row = this.pair(`MAX ${U()}`, depthBig(last.maxDepth).replace(/<em>.*<\/em>/, ''), 'white', 'DIVE-T', String(Math.round(last.duration / 60)), 'cyan');
    } else {
      const fo2 = v.o2 === 21 ? 'AIR' : `${v.o2}<small>%</small>`;
      row = last
        ? `<div class="aq3-row"><div class="cyan boxed"><div class="aq3-lbl">DIVE</div><div class="aq3-val">${last.number}</div></div><div class="white"><div class="aq3-lbl">FO2</div><div class="aq3-val">${fo2}</div></div></div>`
        : `<div class="aq3-row one"><div class="white"><div class="aq3-lbl">FO2</div><div class="aq3-val big">${fo2}</div></div></div>`;
    }
    return top + row + this.footer();
  }

  private altScreen(alt: Alt, v: ComputerView, s: DiveSession): string {
    const { h, m } = clockOfDay(s);
    switch (alt) {
      case 'fly': {
        // FLY counts down from 23:50, 10 minutes after surfacing; DESAT from at most 23 hours.
        const si = (v.surfaceInterval ?? 0) / 60;
        const fly = si < 10 ? 23 * 60 + 50 : Math.max(0, 24 * 60 - si);
        const desat = Math.min(23 * 60, v.desat);
        return `<div class="aq3-alt"><div class="aq3-box yellow"><div class="aq3-lbl c">FLY</div><div class="aq3-big">${hm(fly)}</div></div><div class="aq3-box white"><div class="aq3-lbl c">DESAT</div><div class="aq3-big">${hm(desat)}</div></div></div>`;
      }
      case 'alt2':
        // Time of day, temperature and elevation (blank at sea level).
        return `<div class="aq3-lbl c">TIME</div><div class="aq3-surf">${h}:${String(m).padStart(2, '0')}</div>${this.pair('TEMP', `${Math.round(tempVal(v.temperature))}<small>${tempUnit()}</small>`, 'cyan boxed', 'ELEV', '&nbsp;', 'white boxed')}`;
      case 'alt3': {
        const po2 = s.inDive ? s.ppO2 : this.po2Limit(false);
        return `<div class="aq3-lbl c">PO2</div><div class="aq3-surf">${po2.toFixed(2)}</div>${this.pair('O2 SAT', `${Math.floor(this.o2Sat(s))}<small>%</small>`, 'green boxed', 'FO2', `${v.o2}<small>%</small>`, 'white')}`;
      }
      default:
        return `<div class="aq3-lbl c">DEEP STOP DEPTH</div><div class="aq3-surf">${depthText(this.deep.target)}<small> ${U()}</small></div><div class="aq3-lbl c">DEEP STOP TIME</div><div class="aq3-surf">2:00</div>`;
    }
  }

  private lastDive(s: DiveSession): string {
    const d = s.log[s.log.length - 1];
    const tod = (t: number) => {
      const x = (t + 9 * 3600) % 86400;
      const hh = Math.floor(x / 3600);
      return `${((hh + 11) % 12) + 1}:${String(Math.floor((x % 3600) / 60)).padStart(2, '0')}<sup>${hh < 12 ? 'A' : 'P'}</sup>`;
    };
    if (this.lastIdx === 1) {
      return `<div class="aq3-lbl c">ENTRY TIME</div><div class="aq3-surf">${tod(d.start)}</div>${this.pair(`MAX ${U()}`, depthBig(d.maxDepth).replace(/<em>.*<\/em>/, ''), 'white boxed', 'DIVE-T', String(Math.round(d.duration / 60)), 'cyan boxed')}<div class="aq3-lbl c cyan">LAST DIVE #1</div>`;
    }
    return `<div class="aq3-lbl c">EXIT TIME</div><div class="aq3-surf">${tod(d.start + d.duration)}</div>${this.pair('MIN TEMP', `${Math.round(tempVal(d.minTemp))}<small>${tempUnit()}</small>`, 'cyan boxed', `AVG ${U()}`, depthBig(d.avgDepth).replace(/<em>.*<\/em>/, ''), 'white boxed')}<div class="aq3-lbl c cyan">LAST DIVE #2</div>`;
  }
}
