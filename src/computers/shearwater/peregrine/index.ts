import { COMPARTMENTS, Tissues, WATER_VAPOUR, depthToPressure, planAscent } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthInt, depthText, depthUnit, imperial, pressText, pressUnit, tempUnit, tempVal } from '../../../units';
import { ButtonHelp, ComputerView, clockOfDay, leadingOnGas } from '../../base';
import { type PeregrineNotice, PeregrineRules } from './rules';

// §4.10 primary notifications: title ("Warning", or "Alert" for the custom alerts) and message, as on
// the figures of the table.
const NOTICE: Record<PeregrineNotice, [string, string]> = {
  'high-ppo2': ['Warning', 'HIGH PPO2'],
  'missed-stop': ['Warning', 'MISSED DECO STOP'],
  'fast-ascent': ['Warning', 'FAST ASCENT'],
  'very-high-cns': ['Warning', 'VERY HIGH CNS'],
  'high-cns': ['Warning', 'HIGH CNS'],
  'low-ndl': ['Alert', 'Low NDL Alert'],
  'depth-alert': ['Alert', 'Depth Alert'],
  'time-alert': ['Alert', 'Time Alert'],
  'critical-pres': ['Warning', 'T1 CRITICAL PRES'],
};

type InfoScreen = 'last' | 'ai' | 'mod' | 'temp' | 'gf' | 'tissues' | 'det' | 'battery' | 'pressure' | 'date' | 'serial';

/** Shearwater Peregrine TX: buttons and display, after the manual (rules in rules.ts). */
export class ShearwaterPeregrine extends PeregrineRules {
  // §2.2 and §4.6: FUNC (right) steps through the info screens, past the last one back to the main
  // screen (10 s time-out); MENU (left) returns to the main screen, and opens the menu from it. §4.8:
  // a notification on display is dismissed by either button.
  press(button: string, s: DiveSession): boolean {
    if ((button === 'left' || button === 'right') && this.notices.dismiss()) return true;
    if (button === 'right') this.setScreen((this.screen + 1) % (this.infoScreens(s).length + 1));
    else if (button === 'left') this.setScreen(0);
    return true;
  }

  /**
   * Info screens in the order of the §4.6 figure. Last dive: surface only; AI: when the AI feature is
   * on. The compass screen is left out (compass not simulated).
   */
  private infoScreens(s: DiveSession): InfoScreen[] {
    return [
      ...(!s.inDive && s.log.length ? ['last' as const] : []),
      ...(this.airIntegrated(s) ? ['ai' as const] : []),
      'mod', 'temp', 'gf', 'tissues', 'det', 'battery', 'pressure', 'date', 'serial',
    ];
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      left: {
        name: 'MENU',
        press: {
          real: { fr: 'Notification → acquittée. Écran d’info → retour à l’écran principal. Écran principal → menu', en: 'Notification → dismissed. Info screen → back to the main screen. Main screen → menu' },
          simulated: true,
          note: { fr: 'les menus ne sont pas simulés', en: 'the menus are not simulated' },
        },
      },
      right: {
        name: 'FUNC',
        press: {
          real: { fr: 'Notification → acquittée. Sinon écran d’info suivant (retour à l’écran principal après le dernier, ou après 10 s)', en: 'Notification → dismissed. Otherwise next info screen (back to the main screen after the last one, or after 10 s)' },
          simulated: true,
        },
      },
    };
  }

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    if (v.inDive && v.ndl < 5 && !v.inDeco) this.adaptLong = true;
    const screens = this.infoScreens(s);
    if (this.screen > screens.length) this.screen = 0; // the list shrank (dive started, AI off)
    // §4.6: the tissues and AI screens do not time out.
    const shown = screens[this.screen - 1];
    if (shown === 'tissues' || shown === 'ai') this.screenChangedAt = performance.now();
    const screen = this.currentScreen();
    const du = depthUnit();

    // --- Basic dive info (top left, §4.4) ---
    const depthA = this.alertValue('depthAlert');
    const depthCls = v.inDive && depthA !== null && v.depth > depthA ? 'yellow' : ''; // §4.9
    const [dInt, dDec] = depthText(v.depth).split('.');
    const depthHtml = dDec !== undefined
      ? `${dInt}<span class="pt-dec"><b>.${dDec}</b><small>${du}</small></span>`
      : `${dInt}<span class="pt-dec"><b></b><small>${du}</small></span>`;
    // §4.4: 1 arrow per 3 m/min; white up to 9 m/min (1–3), yellow above (4 or 5), flashing red above
    // 18 m/min (6).
    const rate = v.inDive ? v.ascentRate : 0;
    const arrows = rate > 18 ? 6 : rate > 9 ? Math.max(4, Math.min(5, Math.floor(rate / 3))) : Math.max(0, Math.min(3, Math.floor(rate / 3)));
    const arrowCls = arrows === 6 ? 'red blink' : arrows >= 4 ? 'yellow' : 'white';
    const arrowHtml = Array.from({ length: 6 }, (_, i) => `<i class="${5 - i < arrows ? arrowCls : ''}"></i>`).join('');

    let timeBlock: string;
    if (v.inDive) {
      const sec = Math.floor(v.diveTime);
      const timeA = this.alertValue('timeAlert');
      const tCls = timeA !== null && sec > timeA * 60 ? 'yellow' : ''; // §4.9
      timeBlock = `<div class="pt-lbl">TIME</div><div class="pt-time ${tCls}">${Math.floor(sec / 60)}<sup>:${String(sec % 60).padStart(2, '0')}</sup></div>`;
    } else {
      // §4.4: surface interval in hours and minutes, in days beyond 96 hours; battery icon on the surface.
      const si = Math.floor((v.surfaceInterval ?? 0) / 60);
      const siStr = si >= 96 * 60 ? `${Math.floor(si / 1440)}<small>d</small>` : `${Math.floor(si / 60)}<small>h</small>${String(si % 60).padStart(2, '0')}<small>m</small>`;
      timeBlock = `<div class="pt-lbl">SURFACE</div><div class="pt-time">${siStr}<span class="pt-bat"><i></i></span></div>`;
    }

    // --- Decompression info (top right, §4.4, §5) ---
    const { title, body } = this.stopArea(v, s);
    const ndlA = this.alertValue('ndlAlert');
    // §4.4 / §4.9: NDL yellow at or below the low NDL alert value, red (0) once deco stops are needed;
    // §7.1 figure 1: 0 on the surface. §7.1: 99 is the largest value displayed.
    const ndlVal = !v.inDive || v.inDeco ? 0 : Math.min(99, v.ndl);
    const ndlCls = v.inDive && v.inDeco ? 'red' : v.inDive && ndlA !== null && v.ndl <= ndlA ? 'yellow' : '';
    const load = Math.min(100, v.n2Load);
    const n2Bar = `<div class="pt-n2"><span>N<sub>2</sub></span><div class="pt-n2-fill" style="height:${Math.round(load)}%"></div></div>`;

    // --- Bottom row (§4.3, §12.4) or info screen ---
    let bottom: string;
    if (screen === 0) bottom = this.gasCell(v) + this.bottomCells(v, s);
    else bottom = this.infoScreen(screens[screen - 1], v, s);
    // §4.8: a primary notification shows across the bottom row, in yellow, until dismissed.
    const notice = v.inDive ? this.notices.top : undefined;
    if (notice) {
      const [kind, msg] = NOTICE[notice];
      bottom = `<div class="pt-err"><div class="pt-err-lbls"><span class="yellow">${kind}</span><span class="pt-cyan">Confirm</span></div><div class="pt-err-msg">${msg}</div></div>`;
    }

    el.innerHTML = `
      <div class="dev pt">
        <div class="pt-body">
          <i class="pt-lug t"></i><i class="pt-lug b"></i>
          <button class="pt-btn l" data-btn="left"></button>
          <button class="pt-btn r" data-btn="right"></button>
          <div class="pt-bezel">
            <div class="pt-screen">
              <div class="pt-top">
                <div class="pt-left">
                  <div class="pt-depthrow"><div class="pt-depth ${depthCls}">${depthHtml}</div><div class="pt-arrows">${arrowHtml}</div></div>
                  ${timeBlock}
                </div>
                <div class="pt-right">
                  <div class="pt-stopzone">${title}${body}</div>
                  <div class="pt-ndlrow">${this.persistent(v)}<div class="pt-ndl"><div class="pt-lbl r">NDL</div><div class="pt-big ${ndlCls}">${ndlVal}</div></div>${n2Bar}</div>
                </div>
              </div>
              <div class="pt-bottom ${screen ? 'info' : ''}">${bottom}</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  /** Safety stop, deco stop, "CLEAR" count-up or "Complete" (§5.1, §5.2, §7). */
  private stopArea(v: ComputerView, s: DiveSession): { title: string; body: string } {
    const du = depthUnit();
    const st = v.safety.state;
    const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
    if (v.inDive && v.inDeco) {
      // §5.2: red title; yellow with a flashing up-arrow within 5.1 m of the stop; green with a check
      // mark at the stop (up to 1.5 m deeper); stop depth and time flashing red (with a down arrow)
      // when shallower than the stop.
      const viol = v.ceilingViolation > 0;
      const approach = !viol && !v.atStop && v.depth > v.stopDepth && v.depth <= v.stopDepth + 5.1;
      const cls = viol ? 'red' : v.atStop ? 'green' : approach ? 'yellow' : 'red';
      const mark = viol ? '<span class="pt-mark red">⇩</span>' : approach ? '<span class="pt-mark yellow blink">⇧</span>' : v.atStop ? '<span class="pt-mark green">✓</span>' : '';
      const hl = viol ? ' pt-hl-red blink' : '';
      const chars = String(depthInt(v.stopDepth)).length + String(v.stopTime).length;
      const size = chars >= 5 ? 'xs' : chars >= 4 ? 'sm' : '';
      return {
        title: `<div class="pt-title ${cls}">DECO STOP</div>`,
        body: `<div class="pt-stop ${size}"><span class="${hl}">${depthInt(v.stopDepth)}</span><small>${du}</small>${mark}<span class="${hl}">${v.stopTime}</span><small>min</small></div>`,
      };
    }
    const safetyOn = this.settings.safety !== 'off';
    // §5.1: surfacing before the end of the countdown leaves the stop shown as paused until the dive ends.
    const surfacedEarly = !v.inDive && s.surfaceInterval !== null && s.surfaceInterval < 180 && (this.safetyState === 'pending' || this.safetyState === 'paused');
    if (v.inDive && this.countUp && st !== 'none') {
      // §12.2 CntUp: counts up from zero from the safety stop zone or once the deco is cleared; §7.2
      // figure 11: "CLEAR" in green after a deco dive. Title after a no-deco dive: not shown in the
      // manual ("SAFETY STOP" assumed).
      const up = Math.max(0, v.safety.total - v.safety.remaining);
      const titleTxt = this.hadDeco ? 'CLEAR' : 'SAFETY STOP';
      const tCls = this.hadDeco ? 'green' : st === 'paused' ? 'yellow' : st === 'active' ? 'green' : '';
      return { title: `<div class="pt-title ${tCls}">${titleTxt}</div>`, body: `<div class="pt-stop">${mmss(up)}</div>` };
    }
    if (v.inDive && st === 'done') {
      return { title: '<div class="pt-title">SAFETY STOP</div>', body: '<div class="pt-stop green done">Complete</div>' };
    }
    if ((v.inDive && (st === 'pending' || st === 'active' || st === 'paused')) || surfacedEarly) {
      // §5.1 figures: required, cyan title and white time; counting down, green title and green check
      // mark; paused, yellow title, yellow down (or up) arrow and the time on a yellow background.
      const paused = st === 'paused' || surfacedEarly;
      const mark = paused ? `<span class="pt-mark yellow">${v.depth < this.safetyStop.top || !v.inDive ? '⇩' : '⇧'}</span>` : st === 'active' ? '<span class="pt-mark green">✓</span>' : '';
      const time = mmss(v.safety.remaining);
      return {
        title: `<div class="pt-title ${paused ? 'yellow' : st === 'active' ? 'green' : ''}">SAFETY STOP</div>`,
        body: `<div class="pt-stop">${mark}${paused ? `<span class="pt-hl">${time}</span>` : time}</div>`,
      };
    }
    if (v.inDive && !safetyOn && this.hadDeco && !this.countUp) {
      // §5.2 "Deco Stop Complete" (figure): cyan title and green "Complete".
      return { title: '<div class="pt-title">DECO STOP</div>', body: '<div class="pt-stop green done">Complete</div>' };
    }
    // §7.1 figures 1 and 2: the "SAFETY STOP" title stays on the screen before the stop is required.
    return { title: safetyOn ? '<div class="pt-title">SAFETY STOP</div>' : '', body: '' };
  }

  /** §4.8 persistent notifications left of the NDL, highest priority only. */
  private persistent(v: ComputerView): string {
    const u = depthUnit();
    // "High CNS": CNS limit reached (100 %, deduced; red above 100 % per §4.7).
    if (v.cns >= 100) return `<div class="pt-warn red">High<br>CNS<br>${Math.round(v.cns)}%</div>`;
    if (!v.inDive) return '';
    if (v.depth > v.mod) return `<div class="pt-warn red">MOD<br>${depthInt(v.mod)}${u}<br>⇧</div>`;
    if (v.depth > v.mod - 1.9) return `<div class="pt-warn yellow">MOD<br>${depthInt(v.mod)}${u}</div>`; // "Near MOD"
    return '';
  }

  /** §4.4: "Air" for 21 % O2, "Nx" + O2 % otherwise; flashing red when the MOD is exceeded. */
  private gasCell(v: ComputerView): string {
    const cls = v.inDive && v.depth > v.mod ? 'pt-hl-red blink' : '';
    return `<div class="pt-gas"><span class="${cls}">${v.o2 === 21 ? 'Air' : `Nx${v.o2}`}</span></div>`;
  }

  /** Centre and right positions of the bottom row (§4.3, §4.5, §12.4). */
  private bottomCells(v: ComputerView, s: DiveSession): string {
    const u = depthUnit();
    const { h, m } = clockOfDay(s);
    const clock = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}<span class="pt-cyan">${h < 12 ? 'am' : 'pm'}</span>`;
    const mini1 = `<div class="pt-cell r"><div class="pt-mini r">${Math.round(tempVal(v.temperature))}<span class="pt-cyan">${tempUnit()}</span><br>${clock}</div></div>`;
    const maxCell = cell('MAX', depthDec(v.maxDepth), 'c');
    const gfCls = gf99Class(v);
    switch (this.settings.bottom) {
      case 'ai':
        if (v.tank.ai) return this.pressureCell(v, s, 'c') + cell(`GTR<span class="pt-gray"> T1</span>`, this.gtrText(v), 'r');
        return maxCell + mini1; // AI off: nothing to show (not described), default row kept
      case 'gf':
        return cell('GF99', gf99Text(v, s), `c ${gfCls}`) + cell('SurGF', `${Math.round(v.surfGf)}<small class="pt-cyan">%</small>`, `r ${gfCls}`);
      case 'ppo2':
        return cell('PPO2', ppo2Text(v.ppO2), `c ${this.ppo2Bad(v) ? 'red blink' : ''}`) + cell('SurGF', `${Math.round(v.surfGf)}<small class="pt-cyan">%</small>`, `r ${gfCls}`);
      case 'mini': {
        // §4.5 figure: mini display 2 with MAX, PO2 and MOD, mini display 1 with temperature and time.
        const mini2 = `<div class="pt-mini l"><span class="pt-cyan">MAX</span> ${depthInt(v.maxDepth)}<span class="pt-cyan">${u}</span><br><span class="pt-cyan">PO2</span> <span class="${this.ppo2Bad(v) ? 'red blink' : ''}">${ppo2Text(v.ppO2)}</span><br><span class="pt-cyan">MOD</span> ${depthInt(v.mod)}<span class="pt-cyan">${u}</span></div>`;
        return `<div class="pt-cell c">${mini2}</div>${mini1}`;
      }
      default:
        return maxCell + mini1;
    }
  }

  /** §4.7 PPO2 in flashing red outside the limits (0.18 to the MOD PPO2 in Air and Nitrox modes). */
  private ppo2Bad(v: ComputerView): boolean {
    return v.ppO2 > this.modPpo2 + 1e-9 || v.ppO2 < 0.18;
  }

  /** §10.3: T1 with its pressure bar graph (0 to the rated pressure), yellow below the reserve, red below the critical pressure. */
  private pressureCell(v: ComputerView, _s: DiveSession, cls: string): string {
    const p = v.tank.pressure;
    const lvl = p < this.criticalPressure() ? 'red' : p < v.tank.reserve ? 'yellow' : '';
    // Rated pressure: the fill pressure of the simulated tank (the manual's example: 207 bar).
    const frac = Math.max(0, Math.min(1, p / v.tank.fill));
    const bars = Array.from({ length: 5 }, (_, i) => `<i class="${i < Math.ceil(frac * 5) ? 'on' : ''}"></i>`).join('');
    const unit = pressUnit().toUpperCase().split('').join('<br>');
    return `<div class="pt-cell ${cls}"><div class="pt-lbl">T1<span class="pt-pbar ${lvl}">${bars}</span></div><div class="pt-val"><span class="${lvl ? `pt-hl-${lvl}` : ''}">${pressText(p)}</span><span class="pt-vunit">${unit}</span></div></div>`;
  }

  /** §10.3 GTR: "---" on the surface, "deco" with deco stops, "wait" for the first minutes; yellow ≤ 5, red ≤ 2. */
  private gtrText(v: ComputerView): string {
    if (!v.inDive || v.tank.gasTime === null) return '---';
    if (v.inDeco) return 'deco';
    // SAC ignores the first 30 s, then "takes an additional few minutes": 2 minutes assumed.
    if (v.diveTime < 120) return 'wait';
    const g = Math.min(99, v.tank.gasTime);
    return `<span class="${g <= 2 ? 'red' : g <= 5 ? 'yellow' : ''}">${g}</span>`;
  }

  /** Info screens (§4.7), replacing the bottom row. */
  private infoScreen(id: InfoScreen, v: ComputerView, s: DiveSession): string {
    const u = depthUnit();
    switch (id) {
      case 'last': {
        const d = s.log[s.log.length - 1];
        const sec = Math.round(d.duration);
        const hms = `${Math.floor(sec / 3600)}<small class="pt-cyan">h</small>${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}<small class="pt-cyan">m</small>${String(sec % 60).padStart(2, '0')}<small class="pt-cyan">s</small>`;
        return `<div class="pt-last"><div class="pt-lastrow"><span class="pt-lbl">LAST DIVE</span><span><span class="pt-cyan">#</span>${d.number}</span></div><div class="pt-lastrow big"><span><small class="pt-cyan">MAX</small>${depthDec(d.maxDepth)}</span><span>${hms}</span></div></div>`;
      }
      case 'ai': {
        const sac = imperial() ? `${Math.round(v.tank.sacBar * 14.5038)}` : v.tank.sacBar.toFixed(1);
        const sacUnit = imperial() ? 'psi<br>min' : 'Bar<br>min';
        return this.pressureCell(v, s, '') + cell(`GTR<span class="pt-gray"> T1</span>`, this.gtrText(v), 'c') +
          cell(`SAC<span class="pt-gray"> T1</span>`, v.inDive && v.diveTime >= 120 ? `${sac}<span class="pt-vunit u">${sacUnit}</span>` : v.inDive ? 'wait' : '---', 'r');
      }
      case 'mod':
        // §4.7: MOD and PPO2 in flashing red when exceeded / outside the limits.
        return cell('MOD', `${depthInt(v.mod)}<small class="pt-cyan">${u}</small>`, v.inDive && v.depth > v.mod ? 'red blink' : '') +
          cell('MAX', depthDec(v.maxDepth), 'c') +
          cell('PPO2', ppo2Text(v.ppO2), `r ${this.ppo2Bad(v) ? 'red blink' : ''}`);
      case 'temp': {
        // §4.7: CNS yellow above 90 %, red above 100 %.
        const gf = this.settings.gf;
        const name = ({ low: 'Low', med: 'Med', high: 'High', custom: 'Custom' } as Record<string, string>)[gf] ?? 'Med';
        return cell('TEMP', `${Math.round(tempVal(v.temperature))}<small class="pt-cyan">${tempUnit()}</small>`) +
          `<div class="pt-cell c"><div class="pt-lbl">CONSERV</div><div class="pt-mini c">${name}<br>${v.gfLow}/${v.gfHigh}</div></div>` +
          cell('CNS', `${Math.round(v.cns)}<small class="pt-cyan">%</small>`, `r ${v.cns > 100 ? 'red' : v.cns > 90 ? 'yellow' : ''}`);
      }
      case 'gf': {
        const gfCls = gf99Class(v);
        return cell('GF99', gf99Text(v, s), gfCls) +
          cell('SurGF', `${Math.round(v.surfGf)}<small class="pt-cyan">%</small>`, `c ${gfCls}`) +
          cell('CEIL', String(Math.ceil(imperial() ? v.ceiling * 3.28084 : v.ceiling)), 'r') // not rounded to a stop;
      }
      case 'tissues':
        return `<div class="pt-tissues"><div class="pt-lbl">TISSUES</div>${tissueGraph(s.tissues, s.pressure, s.gas.o2)}</div>`;
      case 'det': {
        // §4.7: DET = time of day at the surface if leaving now; @+5 = TTS after 5 more minutes here;
        // Δ+5 = (@+5) − TTS.
        const t = s.tissues.clone();
        t.expose(depthToPressure(v.depth), s.gas, 5);
        const at5 = planAscent(t, v.depth, s.gas, this.decoParams(s), this.anchor).tts;
        const end = (s.clock + v.tts * 60 + 9 * 3600) % 86400;
        const det = `${((Math.floor(end / 3600) + 11) % 12) + 1}:${String(Math.floor((end % 3600) / 60)).padStart(2, '0')}`;
        return cell('DET', det) + cell('Δ+5', String(at5 - v.tts), 'c') + cell('@+5/TTS', `${at5}/ ${v.tts}`, 'r');
      }
      case 'battery':
        // §4.7 "Battery" (figure): nominal 3.7V LiIon and current voltage. Simulated reading.
        return `<div class="pt-cell r"><div class="pt-lbl r">BATTERY</div><div class="pt-batt"><span class="pt-mini c pt-cyan">3.7V<br>LiIon</span><span class="pt-val">4.12<small class="pt-cyan">V</small></span></div></div>`;
      case 'pressure':
        // §4.7 "Pressure" (figure): surface and current pressure in millibar.
        return `<div class="pt-cell"><div class="pt-lbl">PRESSURE mBar</div><div class="pt-press"><span><small class="pt-cyan">SURF</small>1013</span><span><small class="pt-cyan">NOW</small>${Math.round(s.pressure * 1000)}</span></div></div>`;
      case 'date': {
        // §4.7: day-month-year. The simulated calendar starts on 1 Sep 2026 (fictitious date).
        const { h, m } = clockOfDay(s);
        const day = Math.floor((s.clock + 9 * 3600) / 86400) + 1;
        return cell('DATE', `${String(day).padStart(2, '0')}-Sep-26`, 'wide') + cell('CLOCK', `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`, 'r');
      }
      default:
        // Placeholder identifiers: this is a simulation, not a real unit.
        return cell('SERIAL NO', 'SIMUL') + cell('VERSION', '---', 'r');
    }
  }
}

/** A bottom-row cell: cyan label above a large value. */
function cell(lbl: string, val: string, cls = ''): string {
  const len = val.replace(/<small[^>]*>.*?<\/small>/g, '').replace(/<span class="pt-vunit[^>]*>.*?<\/span>/g, '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length;
  const [sm, xs] = cls.includes('wide') ? [7, 10] : [5, 7];
  const size = len > xs ? 'xs' : len > sm ? 'sm' : '';
  return `<div class="pt-cell ${cls}"><div class="pt-lbl">${lbl}</div><div class="pt-val ${size}">${val}</div></div>`;
}

/** Depth with its decimal and unit stacked on the right (MAX, §4.7 figures); whole feet in imperial. */
function depthDec(d: number): string {
  const [i, dec] = depthText(d).split('.');
  return `${i}<span class="pt-dec s"><b>${dec !== undefined ? `.${dec}` : ''}</b><small>${depthUnit()}</small></span>`;
}

/** PPO2 without its leading zero (".54", figures of §4.7). */
function ppo2Text(p: number): string {
  return p.toFixed(2).replace(/^0/, '');
}

/** §4.7: GF99 yellow above GF High, red above 100 %; SurGF takes the colour of GF99. */
function gf99Class(v: ComputerView): string {
  return v.gf99 > 100 ? 'red' : v.gf99 > v.gfHigh ? 'yellow' : '';
}

/** §4.7: "On Gas" while the leading tissue is below the inspired inert gas pressure. */
function gf99Text(v: ComputerView, s: DiveSession): string {
  return v.inDive && leadingOnGas(s) ? '<small>On Gas</small>' : `${Math.round(v.gf99)}<small class="pt-cyan">%</small>`;
}

/**
 * §4.7 tissues bar graph: one horizontal bar per compartment, fastest at the top; green up to the
 * ambient pressure, yellow up to the ZHL-16C M-value, red beyond (each compartment on its own
 * scale); the vertical black line is the inspired inert gas pressure. Positions of the ambient and
 * M-value lines measured on the annotated figure of p. 19 (0.325 and 0.925 of the width); the
 * samples show the green part linear from 0 bar (the inspired line keeps its place at any depth).
 */
function tissueGraph(t: Tissues, pAmb: number, o2: number): string {
  const W = 300, H = 36, xAmb = 0.325 * W, xM = 0.925 * W;
  const inspired = (pAmb - WATER_VAPOUR) * (1 - o2);
  const x = (p: number, i: number) => {
    const [a, b] = t.coefficients(i);
    const m = pAmb / b + a;
    if (p <= pAmb) return (Math.max(0, p) / pAmb) * xAmb;
    if (p <= m) return xAmb + ((p - pAmb) / (m - pAmb)) * (xM - xAmb);
    return Math.min(W, xM + ((p - m) / (m - pAmb)) * (xM - xAmb));
  };
  const rowH = H / COMPARTMENTS;
  const bars = Array.from({ length: COMPARTMENTS }, (_, i) =>
    `<rect x="0" y="${(i * rowH + rowH * 0.35).toFixed(2)}" width="${x(t.n2[i] + t.he[i], i).toFixed(1)}" height="${(rowH * 0.45).toFixed(2)}" fill="#111"/>`).join('');
  const xi = ((inspired / pAmb) * xAmb).toFixed(1);
  return `<svg class="pt-tgraph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <rect x="0" y="0" width="${xAmb}" height="${H}" fill="#57d95b"/><rect x="${xAmb}" y="0" width="${xM - xAmb}" height="${H}" fill="#f5c400"/><rect x="${xM}" y="0" width="${W - xM}" height="${H}" fill="#f0282d"/>
    ${bars}<rect x="${xi}" y="0" width="1.2" height="${H}" fill="#000"/></svg>`;
}
