import { ndl } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthInt, depthText, depthUnit, imperial, tempUnit, tempVal } from '../../../units';
import { ButtonHelp, ComputerView, clockOfDay } from '../../base';
import { dotMatrix } from '../../common/matrix';
import { sevenSeg } from '../../common/segments';
import { MANDATORY_CEILING, ZoopNovoRules } from './rules';

/** Main modes at the surface (§2.1: TIME, DIVE, PLANNING, MEMORY; MEMORY not simulated). */
type Page = 'time' | 'dive' | 'plan';
/**
 * Bottom row (§2.1: "views [...] you can scroll through with [DOWN] and [UP]"). The guide does not
 * list them. Fields from the quick guide (left: max depth, time, O2 %; right: dive time, temperature,
 * PO2, OLF %); each side has its own cycle, DOWN for the left one and UP for the right one, as on the
 * Vyper Air (VA §6.1.1: "DOWN button toggles between maximum depth, current time [...]", "UP button
 * toggles between dive time and water temperature"). Default MAX and DIVE TIME, as on an underwater
 * photo of a Zoop Novo (ScubaBoard); the §3.4 figures show MAX and the temperature, reachable with UP.
 */
type Left = 'max' | 'clock' | 'o2';
type Right = 'time' | 'temp' | 'po2' | 'olf';
/** §3.5: backlight duration is a setting whose default is not given; 5 s assumed. */
const BACKLIGHT_MS = 5000;

/** Suunto Zoop Novo: four buttons, segmented and dot-matrix LCD, after the user guide (rules in rules.ts). */
export class SuuntoZoopNovo extends ZoopNovoRules {
  private page: Page = 'dive';
  private left = 0;
  private right = 0;
  private planDepth = 18;
  private timerView = false;
  private timerRunning = false;
  private timerSec = 0;

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.left = 0;
    this.right = 0;
    this.timerView = false;
    this.timerRunning = false;
    this.timerSec = 0;
  }

  onDiveEnd(s: DiveSession): void {
    super.onDiveEnd(s);
    this.page = 'dive'; // §3.23: surface and no-fly times in dive mode
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (this.timerRunning) this.timerSec += dt;
  }

  private lefts(s: DiveSession): Left[] {
    return s.gas.o2 > 0.21 ? ['max', 'clock', 'o2'] : ['max', 'clock'];
  }

  private rights(s: DiveSession): Right[] {
    return s.gas.o2 > 0.21 ? ['time', 'temp', 'po2', 'olf'] : ['time', 'temp'];
  }

  /** DOWN: next left field; UP: next right field. */
  private scroll(button: string, s: DiveSession): void {
    if (button === 'down') this.left = (this.left + 1) % this.lefts(s).length;
    else this.right = (this.right + 1) % this.rights(s).length;
  }

  press(button: string, s: DiveSession): boolean {
    this.ackNotices(); // §3.2: "acknowledge the alarm by pressing any button"
    if (s.inDive) {
      switch (button) {
        case 'mode': // §3.5: "to activate the backlight while diving, press [MODE]"
          this.backlightUntil = performance.now() + BACKLIGHT_MS;
          return true;
        case 'select': // §3.22 stopwatch start / stop; §3.6 otherwise a bookmark
          if (this.timerView) this.timerRunning = !this.timerRunning;
          else this.flash('Bookmark', 2000);
          return true;
        case 'up':
        case 'down':
          this.scroll(button, s);
          return true;
      }
      return false;
    }
    switch (button) {
      case 'mode': {
        const order: Page[] = this.locked ? ['time', 'dive'] : ['time', 'dive', 'plan']; // §3.14: no PLAN in error state
        this.page = order[(order.indexOf(this.page) + 1) % order.length];
        return true;
      }
      case 'up':
      case 'down':
        if (this.page === 'plan') this.planDepth = Math.min(45, Math.max(9, this.planDepth + (button === 'up' ? 3 : -3)));
        else this.scroll(button, s);
        return true;
    }
    return false;
  }

  hold(button: string, s: DiveSession): boolean {
    if (button !== 'mode') return false;
    // §3.22: "to activate the stopwatch in dive mode, keep [MODE] pressed"; §3.5 otherwise the backlight.
    if (s.inDive) this.timerView = !this.timerView;
    else this.backlightUntil = performance.now() + BACKLIGHT_MS;
    return true;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      select: {
        name: 'SELECT',
        press: {
          real: { fr: 'Repère dans le carnet (§3.6) ; chronomètre : marche / arrêt (§3.22) ; acquitte une alarme', en: 'Bookmark in the log (§3.6); stopwatch: start / stop (§3.22); acknowledges an alarm' },
          simulated: true,
        },
        hold: { real: { fr: 'Remise à zéro du chronomètre ; en surface, réglages', en: 'Stopwatch reset; at the surface, settings' }, simulated: false },
      },
      mode: {
        name: 'MODE',
        press: {
          real: { fr: 'Plongée : rétroéclairage (§3.5). Surface : mode suivant TIME → DIVE → PLAN → MEM', en: 'Dive: backlight (§3.5). Surface: next mode TIME → DIVE → PLAN → MEM' },
          simulated: true,
          note: { fr: 'rétroéclairage 5 s (durée par défaut non donnée) ; MEM non simulé', en: 'backlight 5 s (default duration not given); MEM not simulated' },
        },
        hold: {
          real: { fr: 'Plongée : chronomètre (§3.22). Surface : rétroéclairage', en: 'Dive: stopwatch (§3.22). Surface: backlight' },
          simulated: true,
        },
      },
      down: {
        name: 'DOWN',
        press: {
          real: { fr: 'Case gauche de la ligne du bas : profondeur max, heure, O2 % (§2.1) ; PLAN : profondeur −3 m', en: 'Bottom row, left field: max depth, time, O2 % (§2.1); PLAN: depth −3 m' },
          simulated: true,
          note: { fr: 'champs du guide rapide ; un cycle par case comme sur le Vyper Air (non vérifié sur le Zoop Novo)', en: 'fields from the quick guide; one cycle per field as on the Vyper Air (not verified on the Zoop Novo)' },
        },
        hold: { real: { fr: 'Réglages (surface)', en: 'Settings (surface)' }, simulated: false },
      },
      up: {
        name: 'UP',
        press: {
          real: { fr: 'Case droite de la ligne du bas : durée, température, PO2, OLF % (§2.1) ; PLAN : profondeur +3 m', en: 'Bottom row, right field: dive time, temperature, PO2, OLF % (§2.1); PLAN: depth +3 m' },
          simulated: true,
          note: { fr: 'champs du guide rapide ; un cycle par case comme sur le Vyper Air (non vérifié sur le Zoop Novo)', en: 'fields from the quick guide; one cycle per field as on the Vyper Air (not verified on the Zoop Novo)' },
        },
        hold: { real: { fr: 'Minuteur d’apnée (mode TIME)', en: 'Apnea timer (TIME mode)' }, simulated: false },
      },
    };
  }

  // -------------------------------------------------------------------------
  // Display, laid out as the LCD of the guide's figures (§2.3 icon map, §3.4, §3.8, §3.19, §3.23):
  // depth at the top (seven segments), CEILING / STOP / ASC TIME captions, a dot-matrix centre field
  // (two figures, or text), the ascent rate bar on the right, NO DEC TIME, and a bottom row of two
  // seven-segment fields.

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    const z: Screen = {};
    const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
    const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.floor(min % 60)).padStart(2, '0')}`;
    const { h, m } = clockOfDay(s);
    const clock = `${h}:${String(m).padStart(2, '0')}`;
    const olf = Math.round(this.olf(s));
    const notices = this.pendingNotices();
    const lefts = this.lefts(s);
    const rights = this.rights(s);

    // Bottom row (dive mode, in and out of the water): its own field on each side.
    const bottom = () => {
      const lastMax = v.inDive ? v.maxDepth : s.log.length ? s.log[s.log.length - 1].maxDepth : 0;
      switch (lefts[this.left % lefts.length]) {
        case 'max': z.bl = seg(depthText(lastMax), 4); z.blUnit = depthUnit(); z.blLbl = 'MAX'; break;
        case 'clock': z.bl = seg(clock, 4); z.blLbl = 'TIME'; break;
        case 'o2': z.bl = seg(String(Math.round(s.gas.o2 * 100)), 2); z.blTop = 'O2%'; break;
      }
      switch (rights[this.right % rights.length]) {
        case 'time': z.br = seg(String(Math.floor(v.diveTime / 60)), 3); z.brLbl = 'DIVE TIME'; break;
        case 'temp': z.br = seg(String(Math.round(tempVal(v.temperature))), 3); z.brUnit = tempUnit(); break;
        case 'po2': z.br = seg(this.modPpo2.toFixed(1), 2); z.brTop = 'PO2'; break;
        case 'olf': z.br = seg(String(olf), 3); z.brTop = 'OLF%'; break;
      }
    };

    if (!v.inDive && this.page === 'time') {
      // TIME mode (§2.1, §3.7): time of day, date and weekday in the bottom row. Date fictitious.
      const day = Math.floor((s.clock + 9 * 3600) / 86400);
      const date = new Date(2026, 8, 26 + day);
      z.clock = seg(clock, 4);
      z.bl = seg(`${date.getDate()}.${date.getMonth() + 1}`, 4);
      z.brText = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][date.getDay()];
    } else if (!v.inDive && this.page === 'plan') {
      // PLAN NoDeco (§3.14): depths from 9 to 45 m by 3 m, no-decompression time in the centre.
      const t = ndl(s.tissues, this.planDepth, s.gas, this.decoParams(s).gfHigh);
      z.depth = seg(depthText(this.planDepth), 4);
      z.line1 = 'PLAN';
      z.line2 = 'NoDeco';
      z.right = String(Math.min(99, t));
      z.lblNdl = 'NO DEC TIME';
    } else if (!v.inDive) {
      // Dive mode at the surface (§3.23): Surf t. and No Fly in the centre, the no-fly icon.
      z.depth = seg(depthText(0), 4);
      if (s.log.length > 0) {
        z.line1 = `Surf t. ${hm((v.surfaceInterval ?? 0) / 60)}`;
        if (v.noFly > 0) z.line2 = `No Fly ${hm(v.noFly)}`;
      }
      if (this.locked) z.right = 'Er';
      bottom();
    } else {
      z.depth = seg(depthText(v.depth), 4);
      z.ac = true; // §3.26: water contact active under water
      bottom();
      // Ascent rate bar (§3.4): 5 segments here (scale not given); above 10 m/min the lower segments
      // blink and the top one stays solid (VA §6.1.4: "the lower segments start to blink").
      z.bar = v.ascentRate > 10 ? 6 : Math.max(0, Math.min(5, Math.ceil(v.ascentRate / 2 - 1e-6)));
      if (v.alarms.includes('ASCENT')) z.line2 = 'SLOW';
      // Notices (§3.2): the value concerned blinks until a button is pressed.
      if (notices.includes('depth')) { z.bl = seg(depthText(v.maxDepth), 4); z.blUnit = depthUnit(); z.blLbl = 'MAX'; z.blBlink = true; z.blTop = undefined; }
      if (notices.includes('time')) { z.br = seg(String(Math.floor(v.diveTime / 60)), 3); z.brLbl = 'DIVE TIME'; z.brUnit = undefined; z.brTop = undefined; z.brBlink = true; }
      if (notices.includes('olf')) { z.br = seg(String(olf), 3); z.brTop = 'OLF%'; z.brLbl = undefined; z.brUnit = undefined; z.brBlink = s.ppO2 > 0.5; }
      if (v.depth > v.mod) { z.br = seg(this.modPpo2Shown(s).toFixed(1), 2); z.brTop = 'PO2'; z.brLbl = undefined; z.brUnit = undefined; z.brBlink = true; } // §3.2: PO2 value blinks
      if (this.timerView) { z.bl = seg(mmss(this.timerSec), 4); z.blLbl = 'TIMER'; z.blUnit = undefined; z.blTop = undefined; z.blBlink = false; }

      const deep = this.deepState === 'pending' || this.deepState === 'active' || this.deepState === 'violated';
      const mandatoryDue = this.mandatory && this.mandatoryRemaining > 0;
      const safe = v.safety.state === 'active' || v.safety.state === 'paused';
      // §3.8: "the ceiling value always from the deepest of these stops" (deepstop, decompression, safety stop).
      const deepFirst = deep && (!v.inDeco || this.deepTarget > v.ceiling);
      if (this.locked) {
        // §3.16: "ER is shown instead" of the decompression information, no ceiling.
        z.right = 'Er';
      } else if (deepFirst) {
        // §3.19 deepstop: CEILING in the top, DEEPSTOP in the centre row, stop depth, countdown.
        z.lblCeiling = true;
        z.left = String(depthInt(this.deepTarget)); // §3.19 figure: whole metres ("16")
        z.right = String(Math.min(99, v.inDeco ? v.tts : v.ndl));
        if (v.inDeco) z.lblAsc = true;
        else z.lblNdl = 'NO DEC TIME';
        if (z.line2 !== 'SLOW') {
          // SLOW (a high priority alarm, §3.2) keeps the text row.
          z.line2 = 'DEEPSTOP';
          z.line2Blink = this.deepState === 'violated';
        }
        if (this.deepState === 'violated') z.arrow = 'down';
        // The deepstop countdown takes the timer's place (§3.19), after a pending depth alarm (§3.2).
        if (!this.timerView && !notices.includes('depth')) { z.bl = seg(mmss(Math.max(0, this.deepRemaining)), 4); z.blLbl = 'TIMER'; z.blUnit = undefined; z.blTop = undefined; z.blBlink = false; }
      } else if (v.inDeco) {
        // §3.8 continuous decompression: ceiling on the left, ASC TIME on the right.
        const floor = this.floorDepth(s, v.ceiling);
        const above = v.ceilingViolation > 0;
        z.lblCeiling = true;
        z.lblStop = true;
        z.left = depthText(v.ceiling);
        if (above) {
          // Above the ceiling: downward arrow, continuous beeping, Er instead of the ascent time.
          z.arrow = 'down';
          z.right = 'Er';
          z.rightBlink = true;
        } else {
          z.lblAsc = true;
          z.right = String(Math.min(999, v.tts));
          if (v.depth > floor) { z.arrow = 'up'; z.ascBlink = true; } // below the floor
          else if (v.depth <= v.ceiling + this.stopWindow) z.arrow = 'both'; // ceiling zone
        }
      } else if (mandatoryDue && v.depth <= 6) {
        // §3.19 mandatory safety stop in the 6 to 3 m zone: CEILING and STOP, ceiling depth, stop time.
        z.lblCeiling = true;
        z.lblStop = true;
        z.left = depthText(MANDATORY_CEILING);
        z.right = mmss(this.mandatoryRemaining);
        z.lblNdl = 'TIME';
        if (this.mandatoryViolated(v)) z.arrow = 'down';
      } else if (safe && !mandatoryDue && v.depth <= 6) {
        // §3.19 recommended safety stop: STOP icon and a three-minute countdown.
        z.lblStop = true;
        z.right = mmss(v.safety.remaining);
        z.lblNdl = 'TIME';
      } else {
        z.lblStop = mandatoryDue; // §3.4 figure: STOP shown once a mandatory stop is due
        // No figure above 99 min: NO DEC TIME alone (ScubaBoard photo of a Zoop Novo; VA §6.1 figure).
        z.right = v.ndl >= 99 ? undefined : String(v.ndl);
        z.lblNdl = 'NO DEC TIME';
      }
      const msg = this.flashMessage();
      if (msg && !z.line2) z.line2 = msg;
    }

    // Icons (§2.3): dive alarm (depth or time alarm set), no-fly, attention (penalty: extend surface interval).
    z.diveAlarm = this.depthAlarm() !== null || this.timeAlarm() !== null;
    z.noFly = v.noFly > 0;
    z.attention = this.penaltyActive || (!v.inDive && this.locked);

    el.innerHTML = `
      <div class="dev zn">
        <div class="zn-case">
          <button class="zn-btn select" data-btn="select"></button>
          <button class="zn-btn mode" data-btn="mode"></button>
          <button class="zn-btn down" data-btn="down"></button>
          <button class="zn-btn up" data-btn="up"></button>
          <div class="zn-lcd ${this.backlit ? 'backlit' : ''}">${lcd(z)}</div>
        </div>
      </div>`;
  }

  /** PO2 limit shown by the PO2 alarm (1.6 in Air mode, see modDepth). */
  private modPpo2Shown(s: DiveSession): number {
    return s.gas.o2 <= 0.21 + 1e-6 ? 1.6 : this.modPpo2;
  }
}

interface Screen {
  depth?: string;
  ac?: boolean;
  clock?: string;
  lblCeiling?: boolean;
  lblStop?: boolean;
  lblAsc?: boolean;
  ascBlink?: boolean;
  left?: string;
  right?: string;
  rightBlink?: boolean;
  arrow?: 'up' | 'down' | 'both';
  line1?: string;
  line2?: string;
  line2Blink?: boolean;
  lblNdl?: string;
  bar?: number;
  bl?: string;
  blUnit?: string;
  blLbl?: string;
  blTop?: string;
  blBlink?: boolean;
  br?: string;
  brUnit?: string;
  brLbl?: string;
  brTop?: string;
  brBlink?: boolean;
  brText?: string;
  diveAlarm?: boolean;
  noFly?: boolean;
  attention?: boolean;
}

function seg(text: string, cells: number): string {
  return sevenSeg(text, cells, 'zn-seg');
}

/**
 * Arrows around the ceiling line (§3.8 figures): below the floor, a bar with ▲ under it; above the
 * ceiling, ▼ over a bar; in the ceiling zone, ▼ and ▲ pointing at each other.
 */
function arrowSvg(kind: 'up' | 'down' | 'both'): string {
  const bar = (y: number) => `<rect x="1" y="${y}" width="12" height="2.6"/>`;
  const up = (y: number) => `<polygon points="7,${y} 12.5,${y + 7} 1.5,${y + 7}"/>`;
  const down = (y: number) => `<polygon points="1.5,${y} 12.5,${y} 7,${y + 7}"/>`;
  const body = kind === 'up' ? bar(2) + up(13) : kind === 'down' ? down(0) + bar(16) : down(0) + up(13);
  return `<svg viewBox="0 0 14 21">${body}</svg>`;
}

/** §2.3 icons: no-fly (aeroplane) and diver attention (triangle with an exclamation mark). */
const PLANE = '<svg viewBox="0 0 20 12"><path d="M1 7l3-1 3 2 4-2-5-5h2l7 4 3-1c1 0 1 1 0 2l-12 5H4z" fill="currentColor"/></svg>';
const ATTENTION = '<svg viewBox="0 0 16 14"><path d="M8 1l7 12H1z" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="7.2" y="5" width="1.6" height="4.2" fill="currentColor"/><rect x="7.2" y="10.2" width="1.6" height="1.6" fill="currentColor"/></svg>';

function lcd(z: Screen): string {
  const parts: string[] = [];
  const put = (cls: string, html: string) => parts.push(`<div class="zn-at ${cls}">${html}</div>`);
  // Icons, left of the depth.
  if (z.diveAlarm) put('zn-ic-alarm', '((•<b></b>');
  if (z.noFly) put('zn-ic-nofly', `${PLANE}<small>NO</small>`);
  if (z.attention) put('zn-ic-att', ATTENTION);
  if (z.depth) put('zn-depth', z.depth + `<i class="zn-u">${imperial() ? 'ft' : 'm'}</i>`);
  if (z.ac) put('zn-ac', 'AC');
  if (z.clock) put('zn-clock', z.clock);
  // Captions over the centre field (reverse video).
  if (z.lblCeiling) put('zn-rev zn-l-ceil', 'CEILING');
  if (z.lblStop) put('zn-rev zn-l-stop', 'STOP');
  if (z.lblAsc) put(`zn-rev zn-l-asc ${z.ascBlink ? 'blink' : ''}`, 'ASC TIME');
  // Centre dot-matrix field.
  if (z.line1) put('zn-line1', dotMatrix(z.line1, 'zn-dm-s'));
  // Ceiling (or stop depth) with the arrows right after it (§3.8 figures).
  const arrow = z.arrow ? `<span class="zn-arrow ${z.arrow === 'up' || z.arrow === 'down' ? 'blink' : ''}">${arrowSvg(z.arrow)}</span>` : '';
  if (z.left || arrow) put('zn-left', (z.left ? dotMatrix(z.left, 'zn-dm-b') : '') + arrow);
  if (z.right) put(`zn-right ${z.rightBlink ? 'blink' : ''}`, dotMatrix(z.right, 'zn-dm-b'));
  if (z.line2) put(`zn-line2 ${z.line2Blink ? 'blink' : ''}`, dotMatrix(z.line2, 'zn-dm-s'));
  if (z.lblNdl) put('zn-l-ndl', z.lblNdl);
  // Ascent rate bar (§3.4), on the right edge.
  if (z.bar !== undefined) {
    const n = z.bar > 5 ? 5 : z.bar;
    put('zn-bar', Array.from({ length: 5 }, (_, i) => `<i class="${5 - i <= n ? 'on' : ''} ${z.bar! > 5 && i > 0 ? 'blink' : ''}"></i>`).join(''));
  }
  // Bottom row.
  if (z.blTop) put('zn-bl-top', z.blTop);
  if (z.brTop) put('zn-br-top', z.brTop);
  if (z.bl) put(`zn-bl ${z.blBlink ? 'blink' : ''}`, z.bl + (z.blUnit ? `<i class="zn-u">${z.blUnit}</i>` : ''));
  if (z.br) put(`zn-br ${z.brBlink ? 'blink' : ''}`, z.br + (z.brUnit ? `<i class="zn-u">${z.brUnit}</i>` : ''));
  if (z.brText) put('zn-br zn-wd', z.brText);
  if (z.blLbl) put('zn-bl-lbl', z.blLbl);
  if (z.brLbl) put('zn-br-lbl', z.brLbl);
  return parts.join('');
}

