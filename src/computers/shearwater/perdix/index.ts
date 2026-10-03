import { Tissues, depthToPressure, planAscent } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthInt, depthText, depthUnit, imperial, pressText, pressUnit, tempUnit, tempVal } from '../../../units';
import { ButtonHelp, ComputerView, clockOfDay, leadingOnGas } from '../../base';
import { type PerdixNotice, PerdixRules } from './rules';
import { SwMenu, bestGas, nxName, swO2, trimixName } from '../multigas';

const NOTICE_TEXT: Record<PerdixNotice, string> = {
  'high-ppo2': 'HIGH PPO2',
  'missed-stop': 'MISSED DECO STOP',
  'fast-ascent': 'FAST ASCENT',
  'very-high-cns': 'VERY HIGH CNS',
  'high-cns': 'HIGH CNS',
  'low-ndl': 'Low NDL Alert',
  'depth-alert': 'Depth Alert',
  'time-alert': 'Time Alert',
  gas: 'T1 CRITICAL PRES',
};

const SCREWS = [[14, 14], [194, 10], [374, 14], [10, 156], [378, 156], [14, 298], [194, 302], [374, 298]]
  .map(([x, y]) => `<i class="pd-screw" style="left:${x - 5}px;top:${y - 5}px"></i>`)
  .join('');

/** Shearwater Perdix 2: buttons and display, after the manual (rules in rules.ts). */
export class ShearwaterPerdix extends PerdixRules {
  // Recreational manual §2.2 and §4.6: SELECT steps through the info screens (stepping past the last
  // one returns to the main screen, 10 s time-out); MENU returns to the main screen from an info
  // screen, and opens the menu from the main screen. Single presses only, no long press.
  press(button: string, s: DiveSession): boolean {
    const tec = this.mode === 'octec';
    // §10: an error on display is dismissed by SELECT (then the next one, if any, shows up); Technical
    // manual §4.8: "The notification is dismissed by pressing either button."
    if ((button === 'right' || tec) && this.notices.dismiss()) return true;
    const menu = this.menu;
    if (this.maxGases > 1 && menu.open) {
      const items = this.menuItems(s);
      if (button === 'left') menu.menu(items, this.knownGases(s));
      else {
        const g = menu.select(items[menu.item!], this.knownGases(s), this.queuedGas(s));
        if (g !== null) s.switchGas(g);
      }
      return true;
    }
    if (button === 'right') this.setScreen((this.screen + 1) % (this.infoScreens(s).length + 1));
    else if (button === 'left') {
      // MENU: back to the main screen from an info screen; from the main screen, the menu (simulated in
      // the multi-gas modes, for Select Gas).
      if (this.screen === 0 && this.maxGases > 1) menu.menu(this.menuItems(s), this.knownGases(s));
      else this.setScreen(0);
    }
    return true;
  }

  /** Select Gas: one gas at a time in OC Tec (classic style, the default there), new style in 3 GasNx. */
  private menus = { classic: new SwMenu('classic'), new: new SwMenu('new') };
  private get menu(): SwMenu {
    return this.mode === 'octec' ? this.menus.classic : this.menus.new;
  }

  /**
   * Main menu items (Technical manual §10.1, Recreational manual §11.1): Turn Off (End Dive while still
   * in dive mode) and the log, Bluetooth and setup menus at the surface only; Select Gas and Dive Setup
   * always. Only Select Gas is simulated.
   */
  private menuItems(s: DiveSession): string[] {
    if (s.inDive && s.depth >= 1.2) return ['Select Gas', 'Dive Setup'];
    return [s.inDive ? 'End Dive' : 'Turn Off', 'Select Gas', 'Dive Setup', ...(s.inDive ? [] : ['Dive Log', 'Start Bluetooth', 'System Setup'])];
  }

  /** The best gas when it differs from the gas breathed (gas shown in yellow), else null. */
  private betterGas(s: DiveSession): number | null {
    if (this.maxGases < 2) return null;
    const b = bestGas(s, this.knownGases(s), this.modPpo2, this.decoPpo2());
    return b !== null && b !== s.breathing ? b : null;
  }

  /** New style: "When a gas change is suggested, the recommended best gas will be automatically queued up". */
  private queuedGas(s: DiveSession): number {
    return this.betterGas(s) ?? s.breathing;
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
    if (this.maxGases > 1) {
      return {
        left: {
          name: 'MENU',
          press: {
            real: { fr: 'Écran d’info → écran principal. Écran principal → menu (Select Gas, Dive Setup…), élément suivant ; dans Select Gas : gaz suivant (Next)', en: 'Info screen → main screen. Main screen → menu (Select Gas, Dive Setup…), next item; in Select Gas: next gas (Next)' },
            simulated: true,
            note: { fr: 'seul Select Gas est simulé', en: 'only Select Gas is simulated' },
          },
        },
        right: {
          name: 'SELECT',
          press: {
            real: { fr: 'Notification → acquittée. Menu : entre dans l’élément (Select Gas) ; dans la liste : choisit le gaz (Select). Sinon écran d’info suivant', en: 'Notification → dismissed. Menu: enters the item (Select Gas); in the list: selects the gas (Select). Otherwise next info screen' },
            simulated: true,
          },
        },
      };
    }
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
    if (this.mode === 'octec') {
      el.innerHTML = this.tecScreen(v, s, screen, screens);
      return;
    }
    const better = this.betterGas(s);

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
      const timeA = this.alertValue('timeAlert');
      const tCls = timeA !== null && sec > timeA * 60 ? 'yellow' : ''; // §4.9: "the dive time value will turn yellow"
      timeBlock = `<div class="pd-lbl">TIME</div><div class="pd-time ${tCls}">${Math.floor(sec / 60)}<small>:${String(sec % 60).padStart(2, '0')}</small></div>`;
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
        // §6.1 (figures): added beyond 11 m, blue title and white time; counting down, green title
        // and green check mark; paused, yellow title, yellow ▼ / ▲ and the time on a yellow background.
        const paused = stopState === 'paused';
        const hint = paused ? `<span class="pd-down yellow">${v.depth < this.safetyStop.top ? '▼' : '▲'}</span>`
          : stopState === 'active' ? '<span class="pd-down green">✓</span>' : '';
        const time = `${Math.floor(v.safety.remaining / 60)}:${String(Math.floor(v.safety.remaining % 60)).padStart(2, '0')}`;
        title = `<div class="pd-title${paused ? ' yellow' : stopState === 'active' ? ' green' : ''}">SAFETY STOP</div>`;
        stopBody = `<div class="pd-stop">${hint}${paused ? `<span class="pd-hl">${time}</span>` : time}</div>`;
      }
    } else if (v.inDive && this.settings.safety === 'off' && this.hadDeco) {
      // §6.2 "Deco Stops Complete" (figure): with safety stops off, blue title and green "Complete".
      title = '<div class="pd-title">DECO STOP</div>';
      stopBody = '<div class="pd-stop green">Complete</div>';
    } else if (surfacedEarly) {
      title = '<div class="pd-title">SAFETY STOP</div>';
      stopBody = '<div class="pd-stop"><span class="pd-down yellow blink">▼</span></div>';
    }

    // Warning box (highest priority only), shown beside the NDL.
    let warn = '';
    const unit = du;
    // §4.8 persistent notifications (Recreational manual rev. C, p. 23): High CNS; MOD exceeded, "go up"
    // or "switch gas" ("another gas must be programmed and turned on for this to appear"); Near MOD;
    // Better Gas ("Only displays when deco stops are needed").
    if (v.cns >= 100) warn = '<div class="pd-warn red">High<br>CNS<br>' + Math.round(v.cns) + '%</div>';
    else if (v.inDive && v.depth > v.mod && better !== null) warn = `<div class="pd-warn red blink">MOD<br>⟳Gas<br>${nxName(s.allGases[better])}</div>`;
    else if (v.inDive && v.depth > v.mod) warn = `<div class="pd-warn red blink">MOD<br>${depthInt(v.mod)}${unit}<br>▲</div>`;
    else if (v.inDive && v.depth > v.mod - 1.9) warn = `<div class="pd-warn yellow">MOD<br>${depthInt(v.mod)}${unit}</div>`;
    else if (v.inDive && v.inDeco && better !== null) warn = `<div class="pd-warn yellow">Best<br>Gas<br>${nxName(s.allGases[better])}</div>`;

    // §4.9: "the NDL value will turn yellow when at or below the Alert value".
    const depthA = this.alertValue('depthAlert');
    const depthAlertCls = v.inDive && depthA !== null && v.depth > depthA ? 'yellow' : ''; // §4.9: "the depth value will turn yellow"
    const ndlA = this.alertValue('ndlAlert');
    const ndlCls = v.inDeco ? 'red' : ndlA !== null && v.ndl <= ndlA ? 'yellow' : '';
    const ndlVal = v.inDeco ? 0 : Math.min(99, v.ndl); // §4 (NDL): "A maximum value of 99 minutes is displayed."
    const load = Math.min(100, v.n2Load);
    const n2Bar = `<div class="pd-n2"><div class="pd-n2-fill" style="height:${Math.round(load)}%"></div><span>N<sub>2</sub></span></div>`;

    // --- Bottom row (configurable) or info screen ---
    // Recreational manual §4.4: the gas "will display in yellow if a better gas is available (3 GasNx mode
    // only)" (figure: yellow background), flashing red past its MOD.
    const gasCls = v.inDive && v.depth > v.mod ? 'red blink' : better !== null ? 'pd-hlbg' : '';
    const gasTxt = nxName(s.gas);
    const { h, m } = clockOfDay(s);
    const h12 = ((h + 11) % 12) + 1;
    const clock = `${h12}:${String(m).padStart(2, '0')}<span class="pd-blue">${h < 12 ? 'am' : 'pm'}</span>`;
    let bottom: string;
    if (this.maxGases > 1 && this.menu.open) {
      bottom = this.menuRow(s);
    } else if (screen === 0) {
      let right = '';
      if (this.settings.bottom === 't1gtr' && v.tank.ai) {
        const pCls = this.pressureClass(v);
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
    // §10 Error Displays (figure): the bottom row shows the message in yellow under "Error" and
    // "Confirm" (SELECT), until dismissed. Message wording: the §10 table names in capitals, like
    // the figure's "HIGH PPO2" (the gas one from the Technical manual).
    const notice = this.notices.top;
    if (notice && v.inDive) {
      // §4.10 figures: "Warning" above the automatic notifications, "Alert" above the §4.9 custom alerts.
      const kind = notice === 'low-ndl' || notice === 'depth-alert' || notice === 'time-alert' ? 'Alert' : 'Warning';
      bottom = `<div class="pd-err"><div class="pd-err-lbls"><span class="pd-lbl">${kind}</span><span class="pd-lbl">Confirm</span></div><div class="pd-err-msg ${NOTICE_TEXT[notice].length > 12 ? 'long' : ''}">${NOTICE_TEXT[notice]}</div></div>`;
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
                <div class="pd-depth ${depthAlertCls}">${dInt}${dDec !== undefined ? `<small>.${dDec}</small>` : ''}<span class="pd-unit">${du}</span><div class="pd-arrows">${arrowHtml}</div></div>
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

  /**
   * Menu in the bottom row: the item's name (figures "Turn Off", "Select Gas"), or Select Gas: new style
   * (Recreational manual §11.3 figure: every gas "NN%", the active one inverted, ▸ on the one pointed,
   * "Next" / "Select", "Active" when the active gas is pointed); classic style (Technical manual §10.2
   * figures: "A1 OC On 21/00", Next / Select).
   */
  private menuRow(s: DiveSession): string {
    const m = this.menu;
    const gases = this.knownGases(s);
    if (m.gas === null) return `<div class="pd-menu">${this.menuItems(s)[m.item!]}</div>`;
    const order = SwMenu.order(gases);
    if (this.mode === 'octec') {
      const k = order.indexOf(m.gas);
      return `<div class="pd-msel"><div class="pd-mgas">${m.gas === s.breathing ? 'A' : '&nbsp;'}<u>${k + 1}</u> OC On ${trimixName(gases[m.gas])}</div><div class="pd-mlbl"><span>Next</span><span>Select</span></div></div>`;
    }
    const items = order.map((i) => `<span class="${i === s.breathing ? 'act' : ''}">${i === m.gas ? '<b class="yellow">▸</b>' : ''}${swO2(gases[i])}<small class="pd-blue">%</small></span>`).join('');
    return `<div class="pd-msel"><div class="pd-mlist">${items}</div><div class="pd-mlbl"><span>Next</span><span>${m.gas === s.breathing ? 'Active' : ''}</span><span>Select</span></div></div>`;
  }

  /**
   * OC Tec main screen (Technical manual §4.3–4.4 figures): top row DEPTH / TIME / STOP / TIME, centre
   * row (PPO2 in the middle, two settable positions), bottom row OC, O2/HE, NDL, TTS.
   */
  private tecScreen(v: ComputerView, s: DiveSession, screen: number, screens: InfoScreen[]): string {
    const better = this.betterGas(s);
    // §4.4: "In meters, depth displays with one decimal place up to 99.9m" (figures: ".0" at the surface).
    const depth = depthText(v.depth).replace(/^0\./, '.');
    const rate = v.inDive ? v.ascentRate : 0;
    // §4.4: 1 arrow per 3 m/min; white below 9 m/min (1–3), yellow above (4 or 5), flashing red above 18 (6).
    const arrows = rate > 18 ? 6 : rate > 9 ? Math.max(4, Math.min(5, Math.floor(rate / 3))) : Math.max(0, Math.min(3, Math.floor(rate / 3)));
    const aCls = arrows === 6 ? 'red blink' : arrows >= 4 ? 'yellow' : 'white';
    const arrowHtml = `<div class="pdt-arrows">${Array.from({ length: 6 }, (_, i) => `<i class="${5 - i < arrows ? aCls : 'off'}"></i>`).join('')}</div>`;
    // "Seconds display as a bar drawn below the word Time. It takes 15 seconds to underline each character".
    const secPct = v.inDive ? ((v.diveTime % 60) / 60) * 100 : 0;
    const timeLbl = `<span class="pdt-lbl pdt-tl">TIME<i style="width:${secPct.toFixed(0)}%"></i></span>`;
    const timeVal = v.inDive ? String(Math.floor(v.diveTime / 60)) : '';
    // Right half of the top row: deco stop, CLEAR counter, or the surface interval.
    let right: string;
    const ndlA = this.alertValue('ndlAlert');
    if (!v.inDive) {
      const si = Math.floor((v.surfaceInterval ?? 0) / 60);
      const siStr = si >= 96 * 60 ? `${Math.floor(si / 1440)}<small class="pd-blue">d</small>` : `${Math.floor(si / 60)}<small class="pd-blue">h</small>${String(si % 60).padStart(2, '0')}<small class="pd-blue">m</small>`;
      right = `<div class="pdt-c w2"><span class="pdt-lbl r">SURFACE</span><b>${v.surfaceInterval === null ? '' : siStr}</b></div>`;
    } else if (v.inDeco) {
      // §4.10: "If you ascend shallower than the current stop, the decompression information will flash red."
      const cls = v.ceilingViolation > 0 ? 'red blink' : '';
      right = `<div class="pdt-c"><span class="pdt-lbl">STOP</span><b class="${cls}">${depthInt(v.stopDepth)}</b></div><div class="pdt-c"><span class="pdt-lbl r">TIME</span><b class="r ${cls}">${v.stopTime}</b></div>`;
    } else if (this.clearedAt !== null) {
      // §4.10 Deco Stops Complete: the counter counts up from zero, or "Clear" when it is turned off.
      const up = Math.max(0, s.clock - this.clearedAt);
      right = this.settings.clearCntr === 'off'
        ? '<div class="pdt-c w2"><span class="pdt-lbl r green">&nbsp;</span><b class="green r">Clear</b></div>'
        : `<div class="pdt-c w2"><span class="pdt-lbl r green">CLEAR</span><b class="r">${Math.floor(up / 60)}:${String(Math.floor(up % 60)).padStart(2, '0')}</b></div>`;
    } else {
      right = '<div class="pdt-c"><span class="pdt-lbl">STOP</span><b></b></div><div class="pdt-c"><span class="pdt-lbl r">TIME</span><b></b></div>';
    }
    // §4.4: battery icon on the surface only (charge OK: blue).
    const bat = v.inDive ? '' : '<span class="pdt-bat"><i></i></span>';
    const top = `<div class="pdt-row top"><div class="pdt-c dep"><span class="pdt-lbl">DEPTH</span><b>${depth}</b></div>${arrowHtml}
      <div class="pdt-c tim">${timeLbl}<b>${timeVal}</b></div>${bat}${right}</div>`;

    // Centre row: PPO2 in the middle; flashing red below 0.19 or above 1.65 (§4.4 "Default PPO2 Limits"),
    // with the persistent "High PPO2" / "Low PPO2" notification in place of its title (§4.8 figures).
    const po2 = v.ppO2;
    const po2Bad = v.inDive && (po2 > 1.65 || po2 < 0.19);
    const po2Lbl = v.inDive && po2 > 1.65 ? '<span class="pdt-lbl red">High PPO2</span>' : v.inDive && po2 < 0.19 ? '<span class="pdt-lbl red">Low PPO2</span>' : '<span class="pdt-lbl">PPO2</span>';
    const center = `<div class="pdt-row mid">${this.tecSlot(this.settings.centerL, v, s, 'l')}
      <div class="pdt-c ppo2">${po2Lbl}<b class="${po2Bad ? 'red blink' : ''}">${po2.toFixed(2).replace(/^0/, '')}</b></div>${this.tecSlot(this.settings.centerR, v, s, 'r')}</div>`;

    let bottom: string;
    const notice = v.inDive ? this.notices.top : undefined;
    if (notice) {
      const kind = notice === 'low-ndl' || notice === 'depth-alert' || notice === 'time-alert' ? 'Alert' : 'Warning';
      bottom = `<div class="pd-err"><div class="pd-err-lbls"><span class="yellow">${kind}</span><span class="pd-blue">Confirm</span></div><div class="pd-err-msg ${NOTICE_TEXT[notice].length > 12 ? 'long' : ''}">${NOTICE_TEXT[notice]}</div></div>`;
    } else if (this.menu.open) {
      bottom = this.menuRow(s);
    } else if (screen > 0) {
      bottom = this.infoScreen(screens[screen - 1], v, s);
    } else {
      // §4.4 bottom row: the gas in yellow when a better gas is available, highlighted red with a PPO2
      // persistent notification; NDL yellow at or below the low NDL alert; NDL Display replacement in deco.
      const gasCls = po2Bad ? 'pdt-hlred' : better !== null && v.inDive ? 'pd-hlbg' : '';
      let ndlLbl = 'NDL';
      let ndlVal = String(!v.inDive || v.inDeco ? 0 : Math.min(99, v.ndl));
      const nd = this.settings.ndlDisplay;
      if (v.inDive && v.inDeco && nd && nd !== 'NDL') {
        ndlLbl = nd;
        ndlVal = this.tecValue(nd, v, s).replace(/<small[^>]*>.*?<\/small>/g, '');
      }
      const ndlCls = v.inDive && !v.inDeco && ndlA !== null && v.ndl <= ndlA ? 'yellow' : '';
      bottom = `<div class="pdt-oc">OC</div><div class="pdt-c gas"><span class="pdt-lbl">O2/HE</span><b><span class="${gasCls}">${trimixName(s.gas)}</span></b></div>
        <div class="pdt-c r"><span class="pdt-lbl r">${ndlLbl}</span><b class="r ${ndlCls}">${ndlVal}</b></div><div class="pdt-c r"><span class="pdt-lbl r">TTS</span><b class="r">${v.inDive ? v.tts : 0}</b></div>`;
    }
    return `
      <div class="dev pd">
        <div class="pd-body">
          ${SCREWS}
          <button class="pd-btn l" data-btn="left"></button>
          <button class="pd-btn r" data-btn="right"></button>
          <div class="pd-screen pdt">
            ${top}${center}
            <div class="pdt-row bot ${screen || this.menu.open || notice ? 'info' : ''}">${bottom}</div>
          </div>
        </div>
      </div>`;
  }

  /** A centre row position (§4.4 "Home Screen Configuration Options"). */
  private tecSlot(id: string | undefined, v: ComputerView, s: DiveSession, side: 'l' | 'r'): string {
    if (!id || id === 'none') return `<div class="pdt-c slot ${side}"></div>`;
    const cls = this.tecClass(id, v, s);
    return `<div class="pdt-c slot ${side}"><span class="pdt-lbl ${side === 'r' ? 'r' : ''}">${id === 'DENSITY' ? 'DENSITY' : id}</span><b class="${side === 'r' ? 'r' : ''} ${cls}">${this.tecValue(id, v, s)}</b></div>`;
  }

  /** Colour of a centre value: CNS yellow > 90 %, red > 150 %; GF99 / SurGF yellow above GF high, red above 100 %; MOD flashing red when exceeded; density yellow from 6.3 g/l (OC). */
  private tecClass(id: string, v: ComputerView, s: DiveSession): string {
    if (id === 'CNS') return v.cns > 150 ? 'red' : v.cns > 90 ? 'yellow' : '';
    if (id === 'GF99' || id === 'SurGF') return v.gf99 > 100 ? 'red' : v.gf99 > v.gfHigh ? 'yellow' : '';
    if (id === 'MOD') return v.inDive && v.depth > v.mod ? 'red blink' : '';
    if (id === 'DENSITY') return gasDensity(v, s.gas) >= 6.3 ? 'yellow' : '';
    return '';
  }

  private tecValue(id: string, v: ComputerView, s: DiveSession): string {
    const u = `<small class="pd-blue">${depthUnit()}</small>`;
    switch (id) {
      case 'MAX': return `${depthText(v.maxDepth)}${u}`;
      case 'AVG': return `${depthText(v.avgDepth)}${u}`;
      case 'CNS': return String(Math.round(v.cns));
      case 'MOD': return `${depthText(v.mod)}${u}`;
      case 'GF99': return leadingOnGas(s) && v.inDive ? '<small>On Gas</small>' : `${Math.round(v.gf99)}<small class="pd-blue">%</small>`;
      case 'SurGF': return `${Math.round(v.surfGf)}<small class="pd-blue">%</small>`;
      case 'CEIL': return String(Math.ceil(imperial() ? v.ceiling * 3.28084 : v.ceiling));
      case '@+5': return String(this.at5(v, s));
      case 'Δ+5': {
        const d = this.at5(v, s) - v.tts;
        return d > 0 ? `+${d}` : String(d);
      }
      case 'TTS': return String(v.tts);
      case 'TEMP': return `${Math.round(tempVal(v.temperature))}<small class="pd-blue">${tempUnit()}</small>`;
      case 'CLOCK': {
        const { h, m } = clockOfDay(s);
        return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`;
      }
      default: return `${gasDensity(v, s.gas).toFixed(1)}<small class="pd-blue">g/L</small>`;
    }
  }

  /** @+5: TTS after 5 more minutes at the current depth (§4.6). */
  private at5(v: ComputerView, s: DiveSession): number {
    const t = s.tissues.clone();
    t.expose(depthToPressure(v.depth), s.gas, 5);
    return planAscent(t, v.depth, s.gas, this.decoParams(s), this.anchor).tts;
  }

  /** GTR display: "---" on the surface (and in deco, GTR being limited to no-deco), "wait" for the first 2 minutes. */
  /** §10.3 low pressure warnings: yellow below the reserve pressure, red below the critical pressure (§12.3). */
  private pressureClass(v: ComputerView): string {
    return v.tank.pressure < this.criticalPressure() ? 'red' : v.tank.pressure < v.tank.reserve ? 'yellow' : '';
  }

  private gtrText(v: ComputerView): string {
    if (!v.inDive || v.inDeco || v.tank.gasTime === null) return '---';
    if (v.diveTime < 120) return 'wait';
    return String(Math.min(99, v.tank.gasTime));
  }

  /** OC Tec info screens that differ from the Recreational ones. */
  private tecInfo(id: 'mod' | 'temp', v: ComputerView): string {
    const cell = (lbl: string, val: string, cls = '') => `<div class="pd-cell ${cls}"><div class="pd-lbl">${lbl}</div><div class="pd-val">${val}</div></div>`;
    const u = `<small class="pd-blue">${depthUnit()}</small>`;
    if (id === 'mod') {
      // "Average Atmospheres": the average depth as absolute pressure (1.0 at sea level).
      const atm = depthToPressure(v.avgDepth) / 1.01325;
      return cell('MAX', `${depthText(v.maxDepth)}${u}`) + cell('AVG', `${depthText(v.avgDepth)}${u}`) + cell('AvgATM', atm.toFixed(2), 'r');
    }
    return cell('TEMP', `${Math.round(tempVal(v.temperature))}<small class="pd-blue">${tempUnit()}</small>`) +
      cell('GF', `${v.gfLow}/${v.gfHigh}`) + cell('CNS', String(Math.round(v.cns)), `r ${v.cns > 150 ? 'red' : v.cns > 90 ? 'yellow' : ''}`);
  }

  /** Info screens (§5), replacing the bottom row. */
  private infoScreen(id: InfoScreen, v: ComputerView, s: DiveSession): string {
    // OC Tec info screens (Technical manual §4.5 figure): MAX / AVG / AvgATM in place of MOD / MAX / PPO2,
    // TEMP / GF / CNS in place of TEMP / CONSERV / CNS.
    if (this.mode === 'octec' && (id === 'mod' || id === 'temp')) return this.tecInfo(id, v);
    // Long values (e.g. "232/ 177" for @+5 / TTS on a deep dive) get a smaller font to stay in the cell.
    const cell = (lbl: string, val: string, cls = '') => {
      // Only the big figures count (small units and captions do not); wide cells have more room.
      const len = val.replace(/<small[^>]*>.*?<\/small>/g, '').replace(/<[^>]*>/g, '').trim().length;
      const [sm, xs] = cls.includes('wide') ? [9, 11] : [5, 7];
      const size = len > xs ? 'xs' : len > sm ? 'sm' : '';
      return `<div class="pd-cell ${cls}"><div class="pd-lbl">${lbl}</div><div class="pd-val ${size}">${val}</div></div>`;
    };
    const u = depthUnit();
    switch (id) {
      case 'last': {
        const d = s.log[s.log.length - 1];
        const sec = Math.round(d.duration);
        const hms = `${Math.floor(sec / 3600)}<small class="pd-blue">h</small>${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}<small class="pd-blue">m</small>${String(sec % 60).padStart(2, '0')}<small class="pd-blue">s</small>`;
        return cell('LAST DIVE', `<small class="pd-blue">MAX</small> ${depthText(d.maxDepth)}<small class="pd-blue">${u}</small>`) +
          cell(`#${d.number}`, hms, 'r');
      }
      case 'ai': {
        const sac = imperial() ? `${Math.round(v.tank.sacBar * 14.5038)}<small class="pd-blue">psi/m</small>` : `${v.tank.sacBar.toFixed(1)}<small class="pd-blue">bar/m</small>`;
        return cell(`T1 ${pressUnit()}`, pressText(v.tank.pressure), this.pressureClass(v)) + cell('GTR', this.gtrText(v)) + cell('SAC', v.inDive && v.diveTime >= 120 ? sac : '---');
      }
      case 'mod':
        // §8.5: "When the Max Depth setting is the controlling factor, the MOD is displayed grayed-out."
        return cell('MOD', `${depthInt(v.mod)}<small class="pd-blue">${u}</small>`, v.depth > v.mod ? 'red blink' : v.mod >= this.modDepthLimit() - 0.05 ? 'gray' : '') +
          cell('MAX', `${depthInt(v.maxDepth)}<small class="pd-blue">${u}</small>`) +
          cell('PPO2', v.ppO2.toFixed(2).replace(/^0/, ''), v.ppO2 > 1.4 ? 'red blink' : '');
      case 'temp':
        // CNS: yellow above 90 %, red above 150 % (§4.7).
        return cell('TEMP', `${Math.round(tempVal(v.temperature))}<small class="pd-blue">${tempUnit()}</small>`) +
          `<div class="pd-cell"><div class="pd-lbl">CONSERV</div><div class="pd-small c">${({ low: 'Low', med: 'Med', high: 'High', custom: 'Custom' } as Record<string, string>)[this.settings.gf]}<br>${v.gfLow}/${v.gfHigh}</div></div>` +
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
        return cell('PRESSURE mBar', `<small class="pd-blue">SURF</small> 1013`, 'wide') +
          cell('&nbsp;', `<small class="pd-blue">NOW</small> ${Math.round(s.pressure * 1000)}`, 'r');
      case 'date': {
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

/** Gas density (g/l) at the current depth: O2, N2, He at about 20 °C (Technical manual §4.6, approximation). */
function gasDensity(v: ComputerView, g: { o2: number; he: number }): number {
  const n2 = 1 - g.o2 - g.he;
  return (g.o2 * 1.331 + n2 * 1.165 + g.he * 0.166) * depthToPressure(v.depth);
}

type InfoScreen = 'last' | 'ai' | 'mod' | 'temp' | 'gf' | 'tissues' | 'det' | 'battery' | 'pressure' | 'date' | 'serial';

/** Shearwater-style tissue graph: fastest compartment on the left, colour by loading. */
function tissueBars(t: Tissues, pAmb: number): string {
  const g = t.gradientPercents(pAmb);
  return `<div class="pd-tbars">${g
    .map((x) => {
      const h = Math.max(4, Math.min(100, 50 + x / 2));
      const c = x < 0 ? '#2fbf4a' : x < 70 ? '#e8d23a' : '#e63b2e';
      return `<i style="height:${Math.round(h)}%;background:${c}"></i>`;
    })
    .join('')}<b style="bottom:50%"></b></div>`;
}
