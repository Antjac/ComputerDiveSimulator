import { Tissues, depthToPressure, planAscent, type DecoParams } from '../engine/buhlmann';
import type { DiveSession } from '../engine/session';
import type { Lang } from '../i18n';
import { remainingTime } from '../engine/gas';
import { depthInt, depthText, depthUnit, imperial, pressText, pressUnit, tempUnit, tempVal } from '../units';
import { ButtonHelp, ComputerView, DiveComputer, SettingDef, clockOfDay, leadingOnGas } from './base';

const SCREWS = [[14, 14], [194, 10], [374, 14], [10, 156], [378, 156], [14, 298], [194, 302], [374, 298]]
  .map(([x, y]) => `<i class="pd-screw" style="left:${x - 5}px;top:${y - 5}px"></i>`)
  .join('');

// Perdix 2 Recreational manual, §8.2: Low 45/95, Med 40/85, High 35/75 (not editable in Rec mode).
const GF_PRESETS: Record<string, [number, number]> = { low: [45, 95], med: [40, 85], high: [35, 75] };

/**
 * Shearwater Perdix 2, Nitrox Recreational mode.
 * Layout, colours and behaviours follow the Perdix 2 Recreational Modes operating instructions (Rev B).
 */
export class ShearwaterPerdix extends DiveComputer {
  readonly id = 'shearwater';
  readonly name = 'Shearwater Perdix 2';
  readonly algorithm = 'Bühlmann ZHL-16C + GF';
  readonly exact = true;
  readonly transmitter = 'Swift';
  readonly gasTimeName = 'GTR';
  readonly notes = {
    fr: 'Mode Nitrox Recreational. Bouton droit (SELECT) : écrans d’info (MOD/MAX/PPO2, GF99/SurGF/CEIL, tissus, DET/Δ+5/@+5…) ; bouton gauche (MENU) : retour à l’écran principal (le menu de plongée n’est pas simulé). Aucun verrouillage en cas de palier manqué (conforme au manuel).',
    en: 'Nitrox Recreational mode. Right button (SELECT): info screens (MOD/MAX/PPO2, GF99/SurGF/CEIL, tissues, DET/Δ+5/@+5…); left button (MENU): back to the main screen (the dive menu is not simulated). No lock-out for missed stops (as per the manual).',
  };
  readonly settingDefs: SettingDef[] = [
    {
      key: 'gf',
      label: { fr: 'Conservatisme', en: 'Conservatism' },
      options: [
        { value: 'low', label: 'Low (45/95)' },
        { value: 'med', label: 'Med (40/85)' },
        { value: 'high', label: 'High (35/75)' },
      ],
      default: 'med',
    },
    {
      key: 'safety',
      label: { fr: 'Palier de sécurité', en: 'Safety stop' },
      options: [
        { value: '3', label: '3 min' }, { value: '4', label: '4 min' }, { value: '5', label: '5 min' },
        { value: 'adapt', label: 'Adapt' }, { value: 'off', label: 'Off' },
      ],
      default: '3',
    },
    {
      key: 'bottom',
      essential: true,
      label: { fr: 'Ligne du bas', en: 'Bottom row' },
      options: [
        { value: 't1gtr', label: 'T1 & GTR (AI)' },
        { value: 'tempclock', label: 'Temp & Time' },
        { value: 'maxtts', label: 'Max. / TTS' },
        { value: 'ppo2tts', label: 'PPO2 & CNS / TTS' },
      ],
      default: 't1gtr',
    },
  ];

  /** Adapt mode: 5 min stop if the dive exceeded 30 m or the NDL fell below 5 min. */
  private adaptLong = false;

  constructor() {
    super();
    // §6.1: required beyond 11 m, countdown starts above 6 m, runs between 2.4 and 7.0 m,
    // resets if the depth exceeds 11 m again.
    this.safetyStop = { trigger: 11, start: 6, top: 2.4, bottom: 7.0, reset: 11 };
    this.stopWindow = 1.5; // §6.2: "at the stop depth or up to 1.5 m deeper"
    this.ceilingMargin = 0;
    this.screenTimeout = 10_000; // §4.6: info screens time out after 10 s (except tissues and AI)
    this.init();
  }

  baseParams(): DecoParams {
    const [lo, hi] = GF_PRESETS[this.settings.gf] ?? GF_PRESETS.med;
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: 3, stopStep: 3, ascentRate: 10 };
  }

  /** Each arrow is 3 m/min; yellow from 4 arrows (≈12 m/min), red at 6 (18+ m/min). */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate >= 18 ? 2 : rate >= 12 ? 1 : 0;
  }

  /**
   * Gas Time Remaining (Technical manual §9.7): minutes at the current depth until a direct ascent at
   * 10 m/min would surface with the reserve pressure. Safety and deco stops are not considered.
   */
  gasTime(s: DiveSession, _p: DecoParams, sacBar: number): number | null {
    return remainingTime({
      tissues: s.tissues, depth: s.depth, gas: s.gas, tankPressure: s.tankPressure, reserve: s.tank.reserve,
      sacBar, rate: () => 10, deco: null,
    });
  }

  safetySeconds(): number {
    const v = this.settings.safety;
    if (v === 'adapt') return this.adaptLong ? 300 : 180;
    return Number(v) * 60 || 180;
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.adaptLong = false;
  }

  tick(s: DiveSession, dt: number): void {
    if (s.inDive && s.depth > 30) this.adaptLong = true;
    if (this.settings.safety === 'off') {
      // Keep the rest of the bookkeeping but never request a safety stop.
      super.tick(s, dt);
      this.safetyState = 'none';
      return;
    }
    super.tick(s, dt);
  }

  // Recreational manual §2.2 and §4.6: SELECT steps through the info screens (stepping past the last
  // one returns to the main screen, 10 s time-out); MENU returns to the main screen from an info
  // screen, and opens the menu from the main screen. Single presses only, no long press.
  press(button: string, s: DiveSession): boolean {
    if (button === 'right') this.setScreen((this.screen + 1) % (this.infoScreens(s).length + 1));
    else if (button === 'left') this.setScreen(0);
    return true;
  }

  /**
   * Info screens in the order of the Perdix 2 manual (§4.6). Last dive: surface only; AI: with a
   * transmitter. The compass screen is left out (compass not simulated).
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
          real: { fr: 'Écran d’info → retour à l’écran principal. Écran principal → menu de plongée', en: 'Info screen → back to the main screen. Main screen → dive menu' },
          simulated: true,
          note: { fr: 'le menu de plongée n’est pas simulé', en: 'the dive menu is not simulated' },
        },
      },
      right: {
        name: 'SELECT',
        press: { real: { fr: 'Écran d’info suivant (retour à l’écran principal après le dernier, ou après 10 s)', en: 'Next info screen (back to the main screen after the last one, or after 10 s)' }, simulated: true },
      },
    };
  }

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    if (v.inDive && v.ndl < 5 && !v.inDeco) this.adaptLong = true;
    const screens = this.infoScreens(s);
    if (this.screen > screens.length) this.screen = 0; // the list shrank (dive started, AI off)
    // Tissues and AI screens do not time out (§4.6).
    const shown = screens[this.screen - 1];
    if (shown === 'tissues' || shown === 'ai') this.screenChangedAt = performance.now();
    const screen = this.currentScreen();

    // --- Basic dive info (left) ---
    const [dInt, dDec] = depthText(v.depth).split('.');
    const du = depthUnit();
    const arrows = v.inDive && v.ascentRate >= 3 ? Math.min(6, Math.floor(v.ascentRate / 3)) : 0;
    const arrowCls = arrows >= 6 ? 'red' : arrows >= 4 ? 'yellow' : 'white';
    const arrowHtml = Array.from({ length: 6 }, (_, i) => `<i class="${5 - i < arrows ? arrowCls : 'off'}"></i>`).join('');
    const surfacedEarly = !v.inDive && s.surfaceInterval !== null && s.surfaceInterval < 180 && (this.safetyState === 'pending' || this.safetyState === 'paused');

    let timeBlock: string;
    if (v.inDive) {
      const sec = Math.floor(v.diveTime);
      timeBlock = `<div class="pd-lbl">TIME</div><div class="pd-time">${Math.floor(sec / 60)}<small>:${String(sec % 60).padStart(2, '0')}</small></div>`;
    } else {
      const si = Math.floor((v.surfaceInterval ?? 0) / 60);
      const siStr = v.surfaceInterval === null ? '0<small>h</small>00<small>m</small>'
        : si >= 96 * 60 ? `${Math.floor(si / 1440)}<small>d</small>` : `${Math.floor(si / 60)}<small>h</small>${String(si % 60).padStart(2, '0')}<small>m</small>`;
      timeBlock = `<div class="pd-lbl">SURFACE</div><div class="pd-time">${siStr}<span class="pd-bat"><i></i></span></div>`;
    }

    // --- Decompression info (right) ---
    let title = '';
    let stopBody = '';
    const stopState = v.safety.state;
    if (v.inDeco && v.inDive) {
      // §5.2: red title; yellow with a flashing up-arrow within 5.1 m of the stop; green with a check
      // mark at the stop (up to 1.5 m deeper); flashing red when shallower than the stop.
      const viol = v.ceilingViolation > 0;
      const approach = !viol && !v.atStop && v.depth > v.stopDepth && v.depth <= v.stopDepth + 5.1;
      const cls = viol ? 'red blink' : v.atStop ? 'green' : approach ? 'yellow' : 'red';
      title = `<div class="pd-title ${cls}">DECO STOP${v.atStop && !viol ? ' ✓' : ''}</div>`;
      // One line, shrunk when the digits (and the ▼ / ▲ hint) would not fit the column.
      const hint = viol ? '<span class="pd-down">▼</span>' : approach ? '<span class="pd-down yellow blink">▲</span>' : '';
      const chars = String(depthInt(v.stopDepth)).length + String(v.stopTime).length + (hint ? 2 : 0) + (du === 'ft' ? 1 : 0);
      const size = chars >= 7 ? 'xs' : chars >= 5 ? 'sm' : '';
      stopBody = `<div class="pd-stop ${size} ${viol ? 'red blink' : ''}">${hint}${depthInt(v.stopDepth)}<small>${du}</small> ${v.stopTime}<small>min</small></div>`;
    } else if (v.inDive && stopState !== 'none') {
      if (stopState === 'done') {
        title = '<div class="pd-title">SAFETY STOP</div>';
        stopBody = '<div class="pd-stop green">Complete</div>';
      } else {
        const hint = stopState === 'paused' ? (v.depth < this.safetyStop.top ? '<span class="pd-down yellow">▼</span>' : '<span class="pd-down yellow">▲</span>') : '';
        title = '<div class="pd-title">SAFETY STOP</div>';
        stopBody = `<div class="pd-stop">${hint}${Math.floor(v.safety.remaining / 60)}:${String(Math.floor(v.safety.remaining % 60)).padStart(2, '0')}</div>`;
      }
    } else if (surfacedEarly) {
      title = '<div class="pd-title">SAFETY STOP</div>';
      stopBody = '<div class="pd-stop"><span class="pd-down yellow blink">▼</span></div>';
    }

    // Warning box (highest priority only), shown beside the NDL.
    let warn = '';
    const unit = du;
    if (v.cns >= 100) warn = '<div class="pd-warn red">High<br>CNS<br>' + Math.round(v.cns) + '%</div>';
    else if (v.inDive && v.depth > v.mod) warn = `<div class="pd-warn red blink">MOD<br>${depthInt(v.mod)}${unit}<br>▲</div>`;
    else if (v.inDive && v.depth > v.mod - 1.9) warn = `<div class="pd-warn yellow">MOD<br>${depthInt(v.mod)}${unit}</div>`;

    const ndlCls = v.inDeco ? 'red' : v.ndl < 5 ? 'yellow' : '';
    const ndlVal = v.inDeco ? 0 : Math.min(99, v.ndl);
    const load = Math.min(100, v.n2Load);
    const n2Bar = `<div class="pd-n2"><div class="pd-n2-fill" style="height:${load}%"></div><span>N<sub>2</sub></span></div>`;

    // --- Bottom row (configurable) or info screen ---
    const gasCls = v.inDive && v.depth > v.mod ? 'red blink' : '';
    const gasTxt = v.o2 === 21 ? 'Air' : `Nx${v.o2}`;
    const { h, m } = clockOfDay(s);
    const h12 = ((h + 11) % 12) + 1;
    const clock = `${h12}:${String(m).padStart(2, '0')}<span class="pd-blue">${h < 12 ? 'am' : 'pm'}</span>`;
    let bottom: string;
    if (screen === 0) {
      let right = '';
      if (this.settings.bottom === 't1gtr' && v.tank.ai) {
        const pCls = v.tank.pressure < v.tank.reserve / 2 ? 'red' : v.tank.pressure < v.tank.reserve ? 'yellow' : '';
        right = `<div class="pd-cell"><div class="pd-lbl">T1 ${pressUnit()}</div><div class="pd-val ${pCls}">${pressText(v.tank.pressure)}</div></div>
                 <div class="pd-cell r"><div class="pd-lbl">GTR</div><div class="pd-val">${this.gtrText(v)}</div></div>`;
      } else if (this.settings.bottom === 'maxtts') {
        right = `<div class="pd-cell"><div class="pd-lbl">MAX</div><div class="pd-val">${depthInt(v.maxDepth)}<small class="pd-blue">${du}</small></div></div>
                 <div class="pd-cell r"><div class="pd-lbl">TTS</div><div class="pd-val">${v.tts}</div></div>`;
      } else if (this.settings.bottom === 'ppo2tts') {
        right = `<div class="pd-cell"><div class="pd-small"><span class="pd-blue">PO2</span> ${v.ppO2.toFixed(2)}<br><span class="pd-blue">CNS</span> ${Math.round(v.cns)}<span class="pd-blue">%</span></div></div>
                 <div class="pd-cell r"><div class="pd-lbl">TTS</div><div class="pd-val">${v.tts}</div></div>`;
      } else {
        right = `<div class="pd-cell"></div><div class="pd-cell r"><div class="pd-small r">${Math.round(tempVal(v.temperature))}<span class="pd-blue">${tempUnit()}</span><br>${clock}</div></div>`;
      }
      bottom = `<div class="pd-gas ${gasCls}">${gasTxt}</div>${right}`;
    } else {
      bottom = this.infoScreen(screens[screen - 1], v, s);
    }

    el.innerHTML = `
      <div class="dev pd">
        <div class="pd-body">
          ${SCREWS}
          <button class="pd-btn l" data-btn="left"></button>
          <button class="pd-btn r" data-btn="right"></button>
          <div class="pd-screen">
            <div class="pd-top">
              <div class="pd-left">
                <div class="pd-depth">${dInt}${dDec !== undefined ? `<small>.${dDec}</small>` : ''}<span class="pd-unit">${du}</span><div class="pd-arrows">${arrowHtml}</div></div>
                ${timeBlock}
              </div>
              <div class="pd-right">
                <div class="pd-stopzone">${title}${stopBody}</div>
                <div class="pd-ndlrow">${warn}<div class="pd-ndl"><div class="pd-lbl r">NDL</div><div class="pd-big ${ndlCls}">${ndlVal}</div></div>${n2Bar}</div>
              </div>
            </div>
            <div class="pd-bottom ${screen ? 'info' : ''}">${bottom}</div>
          </div>
        </div>
      </div>`;
  }

  /** GTR display: "---" on the surface (and in deco, GTR being limited to no-deco), "wait" for the first 2 minutes. */
  private gtrText(v: ComputerView): string {
    if (!v.inDive || v.inDeco || v.tank.gasTime === null) return '---';
    if (v.diveTime < 120) return 'wait';
    return String(Math.min(99, v.tank.gasTime));
  }

  /** Info screens (§5), replacing the bottom row. */
  private infoScreen(id: InfoScreen, v: ComputerView, s: DiveSession): string {
    // Long values (e.g. "232/ 177" for @+5 / TTS on a deep dive) get a smaller font to stay in the cell.
    const cell = (lbl: string, val: string, cls = '') => {
      const len = val.replace(/<[^>]*>/g, '').length;
      const size = len > 7 ? 'xs' : len > 5 ? 'sm' : '';
      return `<div class="pd-cell ${cls}"><div class="pd-lbl">${lbl}</div><div class="pd-val ${size}">${val}</div></div>`;
    };
    const u = depthUnit();
    switch (id) {
      case 'last': {
        const d = s.log[s.log.length - 1];
        const sec = Math.round(d.duration);
        const hms = `${Math.floor(sec / 3600)}<small class="pd-blue">h</small>${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}<small class="pd-blue">m</small>${String(sec % 60).padStart(2, '0')}<small class="pd-blue">s</small>`;
        return cell('LAST DIVE', `<small class="pd-blue">MAX</small>${depthText(d.maxDepth)}<small class="pd-blue">${u}</small>`) +
          cell(`#${d.number}`, hms, 'r');
      }
      case 'ai': {
        const sac = imperial() ? `${Math.round(v.tank.sacBar * 14.5038)}<small class="pd-blue">psi/m</small>` : `${v.tank.sacBar.toFixed(1)}<small class="pd-blue">bar/m</small>`;
        return cell(`T1 ${pressUnit()}`, pressText(v.tank.pressure)) + cell('GTR', this.gtrText(v)) + cell('SAC', v.inDive && v.diveTime >= 120 ? sac : '---');
      }
      case 'mod':
        return cell('MOD', `${depthInt(v.mod)}<small class="pd-blue">${u}</small>`, v.depth > v.mod ? 'red blink' : '') +
          cell('MAX', `${depthInt(v.maxDepth)}<small class="pd-blue">${u}</small>`) +
          cell('PPO2', v.ppO2.toFixed(2).replace(/^0/, ''), v.ppO2 > 1.4 ? 'red blink' : '');
      case 'temp':
        // CNS: yellow above 90 %, red above 150 % (§4.7).
        return cell('TEMP', `${Math.round(tempVal(v.temperature))}<small class="pd-blue">${tempUnit()}</small>`) +
          `<div class="pd-cell"><div class="pd-lbl">CONSERV</div><div class="pd-small c">${({ low: 'Low', med: 'Med', high: 'High' } as Record<string, string>)[this.settings.gf]}<br>${v.gfLow}/${v.gfHigh}</div></div>` +
          cell('CNS', `${Math.round(v.cns)}<small class="pd-blue">%</small>`, v.cns > 150 ? 'red' : v.cns > 90 ? 'yellow' : '');
      case 'gf': {
        // §4.7: GF99 yellow above GF high, red above 100 %; SurGF takes the colour of GF99. "On Gas"
        // while the leading tissue is still loading.
        const gfCls = v.gf99 > 100 ? 'red' : v.gf99 > v.gfHigh ? 'yellow' : '';
        const gf99 = leadingOnGas(s) ? '<small>On Gas</small>' : `${Math.round(v.gf99)}<small class="pd-blue">%</small>`;
        return cell('GF99', gf99, gfCls) +
          cell('SurGF', `${Math.round(v.surfGf)}<small class="pd-blue">%</small>`, gfCls) +
          cell('CEIL', String(Math.ceil(v.ceiling)));
      }
      case 'tissues':
        return `<div class="pd-tissues"><div class="pd-lbl">TISSUES</div>${tissueBars(s.tissues, s.pressure)}</div>`;
      case 'det': {
        // DET: time of day at the surface if leaving now. @+5: TTS after 5 more minutes here; Δ+5 = @+5 − TTS.
        const t = s.tissues.clone();
        t.expose(depthToPressure(v.depth), s.gas, 5);
        const at5 = planAscent(t, v.depth, s.gas, this.decoParams(s), this.anchor).tts;
        const end = (s.clock + v.tts * 60 + 9 * 3600) % 86400;
        const det = `${((Math.floor(end / 3600) + 11) % 12) + 1}:${String(Math.floor((end % 3600) / 60)).padStart(2, '0')}`;
        return cell('DET', det) + cell('Δ+5', String(at5 - v.tts)) + cell('@+5/TTS', `${at5}/ ${v.tts}`);
      }
      case 'battery':
        // Simulated reading (the Perdix 2 runs on one AA cell).
        return cell('BATTERY', `<small class="pd-blue">1.5V Alka</small> 1.52<small class="pd-blue">V</small>`, 'wide r');
      case 'pressure':
        return cell('PRESSURE mBar', `<small class="pd-blue">SURF</small>1013 <small class="pd-blue">NOW</small>${Math.round(s.pressure * 1000)}`, 'wide');
      case 'date': {
        const { h, m } = clockOfDay(s);
        const day = Math.floor((s.clock + 9 * 3600) / 86400) + 1;
        return cell('DATE', `${String(day).padStart(2, '0')}-Sep-26`) + cell('CLOCK', `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`, 'r');
      }
      default:
        // Placeholder identifiers: this is a simulation, not a real unit.
        return cell('SERIAL NO', 'SIMUL') + cell('VERSION', '---', 'r');
    }
  }
}

type InfoScreen = 'last' | 'ai' | 'mod' | 'temp' | 'gf' | 'tissues' | 'det' | 'battery' | 'pressure' | 'date' | 'serial';

/** Shearwater-style tissue graph: fastest compartment on the left, colour by loading. */
function tissueBars(t: Tissues, pAmb: number): string {
  const g = t.gradientPercents(pAmb);
  return `<div class="pd-tbars">${g
    .map((x) => {
      const h = Math.max(4, Math.min(100, 50 + x / 2));
      const c = x < 0 ? '#2fbf4a' : x < 70 ? '#e8d23a' : '#e63b2e';
      return `<i style="height:${h}%;background:${c}"></i>`;
    })
    .join('')}<b style="bottom:50%"></b></div>`;
}
