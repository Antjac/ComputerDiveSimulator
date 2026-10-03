import type { DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthInt, depthText, depthUnit, depthVal, imperial, pressText, tempUnit, tempVal } from '../../../units';
import { ButtonHelp, ComputerView, clockOfDay } from '../../base';
import { sevenSeg } from '../../common/segments';
import { idealAscent } from '../common';
import { type LunaAlarm, type LunaWarning, LunaRules, type StageInfo } from './rules';

/** Matrix screens scrolled with the buttons (§3.4 figures; heart rate screen left out: no belt simulated). */
type Screen = 'nst' | 'o2mod' | 'cns' | 'timer' | 'clock';
const SCREENS: Screen[] = ['nst', 'o2mod', 'cns', 'timer', 'clock'];
/** A warning stays on screen "a couple seconds" (§3.9): 4 s assumed. */
const WARNING_MS = 4000;
const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/** Date shown on the device: fictitious (30.03.23, the manual's figure), advancing with the simulated days. */
function simDate(s: DiveSession): Date {
  return new Date(Date.UTC(2023, 2, 30) + Math.floor(s.clock / 86400) * 86400000);
}

function dateText(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCFullYear()).slice(2)}`;
}

/** Texts of the §3.10 alarm boxes (figures). */
function alarmBox(k: LunaAlarm, v: ComputerView): string {
  switch (k) {
    case 'slow': return box('<span class="ln-arr">↓</span>SLOW<span class="ln-arr">↓</span>', 'DOWN', 'wide');
    case 'mod': return box('MOD', `${depthInt(v.mod)}${depthUnit()}`, 'big');
    case 'missed': return box('MISSED', 'DECO');
    case 'cns100': return box('CNSO2', '100%', 'big');
    case 'reserve': return box('RESERVE', `${pressText(v.tank.reserve)}<small>${imperial() ? 'PSI' : 'BAR'}</small>`, 'big');
    case 'rbt0': return box('RBT', '0:', 'big');
  }
}

/** Boxes of the §3.9 warnings, as on the figures. */
function warningBox(k: LunaWarning, v: ComputerView, st: StageInfo, luna: LunaRules): string {
  const du = depthUnit();
  switch (k) {
    case 'depth': return box('MAX DPTH', `${luna.settings.wDepth}${du}`, 'big');
    case 'cns75': return box('CNSO2', '75%', 'big');
    case 'nostop2': return box('NOSTOP', '2:', 'big');
    case 'nostop0': return box('NOSTOP', '0:', 'big');
    // §3.9.5 figure: "DECO IN 2:" (L0); §3.9.11 figure (100/100): "NOSTOP 2:".
    case 'decoIn2': return luna.gfMode ? box('NOSTOP', '2:', 'big') : box('DECO IN', '2:', 'big');
    case 'deco': return box('DECO IN', '0:', 'big');
    case 'time': return box('MAX TIME', `${luna.settings.wTime}:`, 'big');
    case 'turn': return box('TURNING', 'TIME');
    // §3.9.8 figure: "HALFTANK", then the set pressure with "T1" over "BAR".
    case 'half': return box('HALFTANK', `${pressText(luna.tankWarnPressure() ?? 0)}<small class="ln-tk">T1<br>${imperial() ? 'PSI' : 'BAR'}</small>`, 'big');
    case 'rbt3': return box('RBT', '3:', 'big');
    case 'missed': return box(luna.gfMode ? 'MISSED GF' : 'MISSED MB', 'STOP');
    case 'relaxed': return luna.gfMode ? box('GF', 'INCREASED') : box('MB LEVEL', 'REDUCED');
  }
  void v;
  void st;
}

/** White box of the matrix area (warnings and alarms, §3.9 and §3.10). */
function box(l1: string, l2: string, cls = ''): string {
  return `<div class="ln-box ${cls}"><div>${l1}</div><div class="l2">${l2}</div></div>`;
}

/**
 * Matrix punctuation, after the figures (§3.2, §3.4, §3.7, §3.9.2: "30.03.23", "47:49", "2.32",
 * "T1:21%", "18%", "75%"). The device's small font is 5 × 6 pixels: the point is one pixel on the
 * bottom row, the colon two pixels (3rd and 5th rows), each with a blank column on both sides; the
 * percent sign is drawn below. The dot-matrix font used here (5 × 7) draws them with crosses: they
 * are drawn by luna.css instead, on its grid (the colon on its 3rd and 6th rows: deduced).
 */
const PCT_ROWS = ['XX..X', 'XX.X.', '..X..', '.X.XX', 'X..XX']; // §3.4 figures, top row blank
const PCT = `<svg class="ln-pc" viewBox="0 0 6 7">${PCT_ROWS.flatMap((row, r) =>
  [...row].map((c, x) => (c === 'X' ? `<rect x="${x}" y="${r + 2}" width="0.86" height="0.86"/>` : ''))).join('')}</svg>`;
function matrixPunct(html: string): string {
  return html.replace(/>([^<]+)</g, (_, text: string) =>
    `>${text.replace(/[.:%]/g, (c) => (c === '%' ? PCT : `<i class="ln-p${c === ':' ? ' colon' : ''}"></i>`))}<`);
}

/**
 * §1.2 and §3.2 figures: "Do not dive" is a circle crossed from top left to bottom right, "Do not
 * fly" a plane seen from above (nose to the upper right) in a circle crossed by a bar.
 */
const NO_DIVE_ICON = '<svg class="ln-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.6" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M5.2 5.2 18.8 18.8" stroke="currentColor" stroke-width="2.6"/></svg>';
const NO_FLY_ICON = '<svg class="ln-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.8" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M2.6 10.4 21.4 15.2" stroke="currentColor" stroke-width="1.9"/>'
  + '<g transform="rotate(-25 12 12)" fill="currentColor"><path d="M4.5 11.1H17.6Q20.6 12 17.6 12.9H4.5Z"/><path d="M11.4 11.2 7.2 4.6H9L14.6 11.2ZM11.4 12.8 7.2 19.4H9L14.6 12.8Z"/><path d="M5.6 11.2 3.8 8.2H5L7.4 11.2ZM5.6 12.8 3.8 15.8H5L7.4 12.8Z"/></g></svg>';

/** Scubapro Luna 2.0 AI: two buttons and a monochrome segment + dot-matrix display. */
export class ScubaproLuna extends LunaRules {
  private idx = 0;
  /** Real time (ms) at which each warning occurrence started to be shown (each for WARNING_MS, one after the other). */
  private warnSeen = new Map<string, number>();
  private timer = { startClock: 0, pausedAt: -1, offset: 0 };
  private lastView: ComputerView | null = null;
  /** §3.19 gas selection (SWITCH GAS, or CONFIRM for the suggestion): gas proposed, or null. */
  private sel: number | null = null;
  private selAt = 0;
  private savedUntil = 0;

  /** Gases breathable at this depth other than the current one (T1 always). */
  private candidates(s: DiveSession): number[] {
    const mods = this.gasMods(s);
    return mods.map((m, i) => (i !== s.breathing && (i === 0 || s.depth <= m) ? i : -1)).filter((i) => i >= 0);
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.idx = 0;
    this.timer = { startClock: s.clock, pausedAt: -1, offset: 0 };
  }

  // §3 button table (SCUBA mode, PMG off): short press right / left = next / previous screen of the
  // matrix area; long press right = warning confirmation, pause & restart of the timer; long press
  // left = bookmark, reset of the timer. Both buttons (backlight) cannot be pressed together here.
  press(button: string, s: DiveSession): boolean {
    const n = SCREENS.length;
    if (!s.inDive) {
      // Surface (§1.4, §3.2): right / left scroll the surface screens.
      const m = this.surfaceScreens(s).length;
      if (button === 'right') this.idx = (this.idx + 1) % m;
      else if (button === 'left') this.idx = (this.idx + m - 1) % m;
      else return false;
      this.setScreen(this.idx);
      return true;
    }
    // §3 button table (PMG on): short press left / right "Select previous gas" / "Select next gas".
    if (this.sel !== null || this.prompt.offer !== null) {
      const c = this.candidates(s);
      const cur = this.sel ?? this.prompt.offer!;
      const i = c.indexOf(cur);
      this.sel = c[(i + (button === 'right' ? 1 : c.length - 1)) % c.length] ?? cur;
      this.selAt = s.clock;
      return true;
    }
    if (button === 'right') this.idx = (this.idx + 1) % n;
    else if (button === 'left') this.idx = (this.idx + n - 1) % n;
    else return false;
    this.setScreen(this.idx);
    return true;
  }

  /** The gas proposed now: the one chosen in the selection, else the suggestion. */
  private proposed(): number | null {
    return this.sel ?? this.prompt.offer;
  }

  hold(button: string, s: DiveSession): boolean {
    if (!s.inDive) return false;
    const v = this.lastView;
    // §3 button table (PMG on): long press right "Confirm gas change auto suggestion" / "Enter gas
    // selection"; long press left "Exit gas selection".
    const g = this.proposed();
    // The alarm on display is confirmed first (it hides the gas switch).
    if (button === 'right' && v && this.confirmAlarms(v)) return true;
    if (g !== null) {
      if (button === 'right') {
        s.switchGas(g);
        this.prompt.offer = null;
        this.sel = null;
        this.savedUntil = performance.now() + WARNING_MS; // "GAS CHANGE SAVED" (duration not given: as a warning)
      } else if (button === 'left') {
        this.sel = null;
        if (this.prompt.offer !== null) this.prompt.decline(); // leaving the suggestion: the gas is not used (deduced)
      }
      return true;
    }
    if (button === 'right') {
      if (v && this.confirmAlarms(v)) return true;
      if (SCREENS[this.idx] !== 'timer' && this.maxGases > 1 && !this.locked) {
        const c = this.candidates(s);
        if (c.length) {
          this.sel = c[0];
          this.selAt = s.clock;
        }
        return true;
      }
      if (SCREENS[this.idx] === 'timer') {
        const t = this.timer;
        if (t.pausedAt >= 0) {
          t.offset += s.clock - t.pausedAt;
          t.pausedAt = -1;
        } else t.pausedAt = s.clock;
      }
      return true;
    }
    if (button === 'left') {
      if (SCREENS[this.idx] === 'timer') this.timer = { startClock: s.clock, pausedAt: this.timer.pausedAt >= 0 ? s.clock : -1, offset: 0 };
      else this.flash('BOOKMARK');
      return true;
    }
    return false;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      left: {
        name: 'LEFT',
        press: { real: { fr: 'Écran précédent de la zone centrale', en: 'Previous screen of the matrix area' }, simulated: true },
        hold: {
          real: { fr: 'Pose un repère ; remet le chronomètre à zéro (écran TIMER). Avec le bouton droit : rétroéclairage', en: 'Sets a bookmark; resets the timer (TIMER screen). With the right button: backlight' },
          simulated: true,
          note: { fr: 'appui simultané des deux boutons (rétroéclairage) non simulé', en: 'pressing both buttons (backlight) not simulated' },
        },
      },
      right: {
        name: 'RIGHT',
        press: {
          real: { fr: 'Écran suivant de la zone centrale (retour à l’écran NST après 1 min) ; en surface : réglages de plongée en cours', en: 'Next screen of the matrix area (back to the NST screen after 1 min); at the surface: current dive settings' },
          simulated: true,
          note: { fr: 'écran fréquence cardiaque absent (pas de ceinture simulée)', en: 'heart rate screen omitted (no belt simulated)' },
        },
        hold: {
          real: { fr: 'Confirme une alarme ; met en pause / relance le chronomètre (écran TIMER) ; changement de gaz (PMG)', en: 'Confirms an alarm; pauses / restarts the timer (TIMER screen); gas switch (PMG)' },
          simulated: true,
          note: { fr: 'changement de gaz avec PMG activé (hors écran TIMER)', en: 'gas switch with PMG enabled (outside the TIMER screen)' },
        },
      },
    };
  }

  /**
   * Surface screens (§3.2 and the manufacturer's product animation): the surface screen, the
   * desaturation after a dive, then the current dive settings (stage, water, MOD) and the gas (O2,
   * PPO2max, MOD).
   */
  private surfaceScreens(s: DiveSession): ('main' | 'desat' | 'settings' | 'gas')[] {
    return s.log.length ? ['main', 'desat', 'settings', 'gas'] : ['main', 'settings', 'gas'];
  }

  private timerText(s: DiveSession): string {
    const t = this.timer;
    const now = t.pausedAt >= 0 ? t.pausedAt : s.clock;
    const sec = Math.max(0, Math.floor(now - t.startClock - t.offset));
    // "0:28.51" in the figure: hours:minutes.seconds (deduced from the figure).
    return `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}.${String(sec % 60).padStart(2, '0')}`;
  }

  /** Warning of §3.9 to show now: each new one for WARNING_MS, queued when several occur together; or ''. */
  private warning(v: ComputerView, st: StageInfo, s: DiveSession): string {
    const now = performance.now();
    const active = this.updateWarnings(v, st, s).map(([k, since]): [LunaWarning, string] => [k, `${k}-${since}`]);
    const keys = new Set(active.map(([, id]) => id));
    for (const id of [...this.warnSeen.keys()]) if (!keys.has(id)) this.warnSeen.delete(id);
    const showing = active.find(([, id]) => this.warnSeen.has(id) && now - this.warnSeen.get(id)! < WARNING_MS);
    const next = showing ?? active.find(([, id]) => !this.warnSeen.has(id));
    if (!next) return '';
    if (!this.warnSeen.has(next[1])) this.warnSeen.set(next[1], now);
    return warningBox(next[0], v, st, this);
  }

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    this.lastView = v;
    // A gas selection left alone closes after 30 s (not stated: as the suggestion).
    if (this.sel !== null && (!v.inDive || s.clock - this.selAt > 30)) this.sel = null;
    this.pruneConfirmed(v);
    if (this.currentScreen() === 0) this.idx = 0;
    const ai = v.tank.ai;
    const du = depthUnit();

    // Stage information (MB level above L0, or GF other than 100/100): its no-stop time and stops.
    const st = this.stageInfo(v, s);
    const { ndl: stageNdl, stop: levelStop } = st;
    const nst = Math.min(this.ndlCap, stageNdl); // §3.1: at most 199 minutes

    // Top row: depth and dive time (surface: no-dive time and no-fly time, §3.12, §3.13).
    let topLeft: string;
    let topRight: string;
    let unitMark = '';
    const noFly = !v.inDive && v.noFly > 0 ? Math.ceil(v.noFly / 60) : 0;
    // §3.12: NO DIVE while the CNS O2 is above 40 % (the microbubble part of ADT MB is not modelled);
    // the time shown is how long the CNS takes to fall back to 40 % with its usual 90-min half-time
    // (deduced: the manual does not give the calculation).
    const noDive = !v.inDive && v.cns > 40 ? Math.max(1, Math.ceil((90 * Math.log2(v.cns / 40)) / 60)) : 0;
    if (v.inDive) {
      topLeft = sevenSeg(v.depth < 0.8 ? '---' : imperial() ? String(Math.round(depthVal(v.depth))) : depthText(v.depth), 3, 'ln-seg');
      unitMark = `<span class="ln-unit">${du}</span>`;
      topRight = sevenSeg(`${Math.min(999, Math.floor(v.diveTime / 60))}:`, 3, 'ln-seg');
    } else if (v.locked) {
      topLeft = sevenSeg(`${Math.ceil((this.lockedUntil - s.clock) / 3600)}h`, 3, 'ln-seg');
      topRight = sevenSeg(noFly ? `${noFly}h` : '', 3, 'ln-seg');
    } else {
      topLeft = sevenSeg(noDive ? `${noDive}h` : '', 3, 'ln-seg');
      topRight = sevenSeg(noFly ? `${noFly}h` : '', 3, 'ln-seg');
    }
    const icons = !v.inDive
      ? `${noDive || v.locked ? NO_DIVE_ICON : ''}${noFly ? NO_FLY_ICON : ''}`
      : '';

    // Matrix area.
    let matrix = '';
    let alarmShown = false;
    const alarms = this.activeAlarms(v).filter((k) => !this.confirmed.has(k));
    const warn = v.inDive ? this.warning(v, st, s) : '';
    const note = this.flashMessage();
    const screen: Screen = SCREENS[this.idx] ?? 'nst';
    if (v.locked) {
      matrix = `<div class="ln-sos">SOS</div>`; // §3.11 figures (in the water: GAUGE mode, not simulated)
    } else if (!v.inDive) {
      const { h, m } = clockOfDay(s);
      const sv = this.surfaceScreens(s)[this.idx] ?? 'main';
      const modTxt = imperial() ? `${depthInt(v.mod)}ft` : `${(Math.floor(v.mod * 10) / 10).toFixed(1)}m`;
      if (sv === 'settings') {
        // Current dive settings (product animation: "MB-LVL:3 / SALT / MOD:57.5m"); the simulator
        // computes in salt water. GF wording deduced ("GF:30/70").
        matrix = `<div class="ln-l">${this.gfMode ? `GF:${this.settings.gf}` : `MB-LVL:${this.settings.level}`}</div><div class="ln-l">SALT</div><div class="ln-l">MOD:${modTxt}</div>`;
      } else if (sv === 'gas') {
        // Product animation: "GAS 1 [21%] / 1.40BAR / MOD:57.5m".
        matrix = `<div class="ln-l">GAS 1 <span class="inv">${v.o2}%</span></div><div class="ln-l">${this.modPpo2.toFixed(2)}BAR</div><div class="ln-l">MOD:${modTxt}</div>`;
      } else if (sv === 'desat') {
        // Product animation: inverted "DESAT" and the desaturation time h:mm.
        const d = Math.max(0, Math.round(v.desat));
        matrix = `<div class="ln-l inv">DESAT</div><div class="ln-l">${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}</div>`;
      } else if (s.log.length) {
        const si = Math.floor((v.surfaceInterval ?? 0) / 60);
        matrix = `<div class="ln-l inv">SURF INT</div><div class="ln-l">${String(Math.floor(si / 60)).padStart(2, '0')}:${String(si % 60).padStart(2, '0')}</div><div class="ln-l">REPEAT:${String(v.diveNumber).padStart(2, '0')}</div>`;
      } else {
        const d = simDate(s);
        matrix = `<div class="ln-l">${dateText(d)}</div><div class="ln-l">${DAYS[d.getUTCDay()]}</div>`;
        void h;
        void m;
      }
    } else if (alarms.length) {
      matrix = alarmBox(alarms[0], v);
      alarmShown = true;
    } else if (this.proposed() !== null) {
      // §3.19.1 / §3.19.2 figures: "CONFIRM / T1➔T2 / 74%", "SWITCH GAS / T2➔T1 / 21%".
      const g = this.proposed()!;
      matrix = `<div class="ln-l">${this.sel === null ? 'CONFIRM' : 'SWITCH GAS'}</div><div class="ln-l">T${s.breathing + 1}➔T${g + 1}</div><div class="ln-l">${Math.round((s.allGases[g] ?? s.gas).o2 * 100)}%</div>`;
    } else if (performance.now() < this.savedUntil) {
      matrix = box('GAS CHANGE', 'SAVED');
    } else if (this.excluded && s.clock - this.excluded.at < 4) {
      matrix = box(`GAS ${this.excluded.gas + 1}`, 'EXCLUDED'); // §3.19.3 figure (shown 4 s, assumed)
    } else if (warn) {
      matrix = warn;
      alarmShown = true;
    } else if (note) {
      matrix = box(note, '');
    } else if (screen === 'nst') {
      if (v.inDeco || levelStop) {
        // §3.4 "Decompression stop" / "Level stop": DECO (or LVL) with stop depth and time, TAT. The
        // manual's figures box them; the manufacturer's product animation shows plain text: followed.
        const [lbl, depth, min, tat] = v.inDeco
          ? ['DECO', v.stopDepth, v.stopTime, v.tts]
          : ['LVL', levelStop!.depth, levelStop!.min, levelStop!.tat];
        matrix = `<div class="ln-stop"><div class="ln-stopbox"><div>${lbl}</div><div>${depthInt(depth)}${du}</div><div>${min}:</div></div><div class="ln-tat"><div>TAT</div><div class="big">${Math.min(999, tat)}:</div></div></div>`;
      } else if (v.safety.state === 'active' || v.safety.state === 'paused') {
        // §3.7 figure: "S-STOP 2.32".
        const r = Math.max(0, Math.ceil(v.safety.remaining));
        matrix = `<div class="ln-l">S-STOP</div><div class="ln-l big">${Math.floor(r / 60)}.${String(r % 60).padStart(2, '0')}</div>`;
      } else if (this.pdisState === 'active') {
        const r = Math.max(0, Math.ceil(this.pdisRemaining));
        matrix = `<div class="ln-l">PDIS</div><div class="ln-l big">${Math.floor(r / 60)}.${String(r % 60).padStart(2, '0')}</div>`; // §3.15.3 figure
      } else if (this.pdisState === 'shown') {
        matrix = box('PDIS', `${depthInt(this.pdisDepth)}${du}`, 'big');
      } else {
        matrix = `<div class="ln-nst"><div><div class="ln-l">${this.stageText()}</div><div class="ln-l big">${nst}:</div></div><div class="ln-vert">N<br>S<br>T</div></div>`;
      }
    } else if (screen === 'o2mod') {
      matrix = `<div class="ln-l">T1:${v.o2}%</div><div class="ln-l">MOD: ${depthInt(v.mod)}${du}</div>`;
    } else if (screen === 'cns') {
      matrix = `<div class="ln-l">${this.gfMode ? `GF${this.activeGf.join('/')}` : this.stageText()}</div><div class="ln-l">CNSO2:</div><div class="ln-l">${Math.round(v.cns)}%</div>`;
    } else if (screen === 'timer') {
      matrix = `<div class="ln-l">TIMER</div><div class="ln-l mid">${this.timerText(s)}</div>`;
    } else {
      const { h, m } = clockOfDay(s);
      matrix = `<div class="ln-l">${dateText(simDate(s))}</div><div class="ln-l big">${h}:${String(m).padStart(2, '0')}</div>`;
    }

    // Bottom row: tank pressure and RBT with a transmitter, water temperature and NST without (§3.3).
    let botLeft: string;
    let botRight: string;
    let lblLeft = '';
    let lblRight = '';
    if (!v.inDive) {
      const { h, m } = clockOfDay(s);
      const sv = this.surfaceScreens(s)[this.idx] ?? 'main';
      const txGas = sv === 'gas' && v.tank.ai;
      if (txGas) lblLeft = imperial() ? 'PSI' : 'bar';
      botLeft = txGas
        ? sevenSeg(pressText(v.tank.pressure), imperial() ? 4 : 3, 'ln-seg') // product animation (AI): tank pressure
        : sv === 'settings' || sv === 'gas'
        ? `${sevenSeg(String(v.o2), 2, 'ln-seg')}<span class="ln-o2">O<sub>2</sub><br>%</span>`
        : sv === 'desat'
          ? sevenSeg('C0-', 3, 'ln-seg') // altitude class (altitude not simulated: sea level, C0)
          : s.log.length || v.locked
        ? `${sevenSeg(String(Math.round(v.cns)), 3, 'ln-seg')}<span class="ln-pct">%</span>`
        : `${sevenSeg(String(Math.round(tempVal(v.temperature))), 2, 'ln-seg')}<span class="ln-deg">°${tempUnit().replace('°', '')}</span>`;
      botRight = sevenSeg(`${h}:${String(m).padStart(2, '0')}`, 4, 'ln-seg');
    } else if (ai) {
      lblLeft = imperial() ? 'PSI' : 'bar';
      lblRight = 'RBT';
      botLeft = sevenSeg(pressText(v.tank.pressure), imperial() ? 4 : 3, 'ln-seg');
      botRight = v.tank.gasTime === null || v.diveTime < 120 ? '<span class="ln-dash">- - -</span>' : sevenSeg(String(Math.min(99, v.tank.gasTime)), 2, 'ln-seg');
    } else {
      botLeft = `${sevenSeg(String(Math.round(tempVal(v.temperature))), 2, 'ln-seg')}<span class="ln-deg">°${tempUnit().replace('°', '')}</span>`;
      botRight = v.inDeco ? '<span class="ln-dash">- - -</span>' : sevenSeg(String(nst), 3, 'ln-seg');
    }

    // Ascent / descent symbol (§3.4): only with a deco or level stop; ↑ deeper than the stop, ↓↑ at
    // the stop, ↓ shallower (the safety stop figure shows it too).
    let asc = '';
    const stopDepth = v.inDeco ? v.stopDepth : levelStop?.depth ?? 0;
    let dir: 'up' | 'down' | 'both' | '' = '';
    if (v.inDive && stopDepth > 0) dir = v.depth > stopDepth + this.stopWindow ? 'up' : v.depth < stopDepth - 0.1 ? 'down' : 'both';
    else if (v.inDive && (v.safety.state === 'active' || v.safety.state === 'paused')) dir = 'both';
    if (dir) {
      const down = dir !== 'up' ? '<path d="M9 0 V8 M5 5 L9 9 L13 5"/>' : '';
      const up = dir !== 'down' ? '<path d="M9 26 V17 M5 20 L9 16 L13 20"/>' : '';
      asc = `<svg class="ln-asc" viewBox="0 0 18 26">${down}<path d="M1 13 q2 -3 4 0 t4 0 t4 0 t4 0"/>${up}</svg>`;
    }

    // Transmitter signal symbol (§1.2), shown with the gas screen of the product animation.
    const signal = !v.inDive && v.tank.ai && (this.surfaceScreens(s)[this.idx] ?? 'main') === 'gas'
      ? '<svg class="ln-signal" viewBox="0 0 16 16"><path d="M2 14 a12 12 0 0 1 12 -12 M2 14 a8 8 0 0 1 8 -8 M2 14 a4 4 0 0 1 4 -4"/></svg>'
      : '';

    // Right bar: ascent speed in the water (§3.10.1: 20-40 %… >110 %), tissue saturation at the surface.
    const pct = v.inDive ? v.ascentRate / idealAscent(v.depth) : 0;
    const bars = v.inDive ? (pct > 1.1 ? 6 : pct > 1 ? 5 : pct > 0.8 ? 4 : pct > 0.6 ? 3 : pct > 0.4 ? 2 : pct > 0.2 ? 1 : 0) : Math.round(Math.min(100, v.n2Load) / 100 * 6);
    const bar = Array.from({ length: 6 }, (_, i) => `<i class="${5 - i < bars ? 'on' : ''}"></i>`).join('');

    // Dive mode symbol (SCUBA diver), alarm / warning bell (§1.2).
    // Diver symbol of the SCUBA mode (§1.2, product animation): diving head down, fins up-left,
    // tank on the back, bubbles at the head.
    const diver = `<svg class="ln-diver" viewBox="0 0 64 60"><g class="body"><path d="M16.5 10 Q18 7 20.5 9 L32 20 Q32.5 23.5 29 23 Z"/><path d="M5 19.5 Q6 16.5 8.5 18.5 L21.5 25.5 Q21.5 29 18 28.5 Z"/><path d="M28.5 21.5 L31.5 23.5 L27.5 33.5 L23.5 32 Z"/><path d="M17.5 27.5 L21 26 L27.5 34 L24 36.5 Z"/><path d="M22 33 Q24.5 30.5 30.5 33.5 L54 44 Q57.5 47 55 50.5 L50 51.5 Q40 50.5 28 43.5 Q20.5 39 22 33 Z"/><path d="M31.5 34.5 Q32.5 31.5 36 32.5 L51.5 39 Q54.5 41 52 43.5 L35 38.5 Q31 37.5 31.5 34.5 Z"/><path d="M31 40.5 L49 47.5 Q51 48.5 50 46.5" fill="none"/><circle cx="56.5" cy="47" r="4.3"/></g><g class="bub"><circle cx="53" cy="29.5" r="2.2"/><circle cx="56.5" cy="34.5" r="1.8"/><circle cx="51.5" cy="34.5" r="1.2"/><circle cx="54" cy="38.5" r="1.3"/></g></svg>`;
    const bell = alarmShown ? `<svg class="ln-bell" viewBox="0 0 20 20"><path d="M10 2 C6 2 5 6 5 9 L3 14 L17 14 L15 9 C15 6 14 2 10 2 Z M8 16 A2 2 0 0 0 12 16 Z"/></svg>` : '';

    el.innerHTML = `
      <div class="dev ln">
        <div class="ln-case">
          <button class="ln-btn left" data-btn="left"></button>
          <button class="ln-btn right" data-btn="right"></button>
          <div class="ln-bezel">
          <i class="ln-contact l"></i><i class="ln-contact r"></i>
          <div class="ln-screen">
            <div class="ln-top l">${topLeft}${unitMark}</div>
            <div class="ln-top r">${topRight}</div>
            <div class="ln-icons">${icons}</div>
            <div class="ln-side">${diver}${bell}</div>
            <div class="ln-matrix">${matrixPunct(matrix)}</div>
            <div class="ln-batt"><i></i><i></i><i></i><i></i></div>
            <div class="ln-strip"></div>
            <div class="ln-bar">${bar}</div>
            ${asc}
            <div class="ln-lbl l">${lblLeft}</div>
            <div class="ln-lbl r">${lblRight}</div>
            <div class="ln-bot l">${botLeft}</div>
            <div class="ln-bot r">${botRight}</div>
            ${signal}
          </div>
          </div>
        </div>
      </div>`;
  }
}
