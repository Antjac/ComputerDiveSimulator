import type { DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthInt, depthUnit, imperial, pressText, pressUnit, tempUnit, tempVal } from '../../../units';
import { ButtonHelp, ComputerView, depthStr, hmm } from '../../base';
import { type D5Notice, D5Rules } from './rules';

/** Stop / ceiling values: one decimal in metres, whole feet in imperial. */
const stopDepth = (m: number) => (imperial() ? String(depthInt(m)) : m.toFixed(1));

const GREEN = '#22e35a';
const ORANGE = '#ffa11a';
const YELLOW = '#ffe11a';
const RED = '#ff2d2d';
const CYAN = '#2fe3ff';

function pt(a: number, r: number): [number, number] {
  const rad = ((a - 90) * Math.PI) / 180;
  return [150 + r * Math.cos(rad), 150 + r * Math.sin(rad)];
}

function arc(from: number, to: number, r: number): string {
  const [x1, y1] = pt(from, r);
  const [x2, y2] = pt(to, r);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

/** m′ss with the seconds smaller, as on the D5. */
function minSec(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}′<tspan class="su-sec">${String(s % 60).padStart(2, '0')}</tspan>`;
}

/** Warning and notification names of the §4.1 tables. */
const NOTICE_TEXT: Record<D5Notice, string> = {
  'cns-100': 'CNS 100%',
  'otu-300': 'OTU 300',
  depth: 'Depth',
  'dive-time': 'Dive time',
  'gas-time': 'Gas time',
  'safety-broken': 'Safety stop broken',
  'tank-50': 'Tank pressure',
  'tank-alarm': 'Tank pressure',
  'cns-80': 'CNS 80%',
  'otu-250': 'OTU 250',
};

/** Suunto D5: buttons and round display, after the manual (rules in rules.ts). */
export class SuuntoD5 extends D5Rules {
  press(button: string): boolean {
    // §4.1: "Acknowledge the warning by pressing any button" (the press only acknowledges: assumed).
    if (this.notices.dismiss()) return true;
    if (button === 'lower') this.setScreen((this.screen + 1) % (this.switchCount + 1));
    else if (button === 'upper') {
      this.timerRunning = !this.timerRunning;
      this.showTimer = true;
    } else return false;
    return true;
  }

  hold(button: string): boolean {
    if (this.notices.dismiss()) return true;
    if (button === 'upper') {
      this.timerRunning = false;
      this.timerSec = 0;
      this.showTimer = true;
    } else if (button === 'lower') this.flash('BOOKMARK');
    else return false;
    return true;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      upper: {
        name: 'UPPER',
        press: { real: { fr: 'Démarre / met en pause le chronomètre (affiché dans la fenêtre du bas)', en: 'Starts / pauses the timer (shown in the bottom window)' }, simulated: true },
        hold: { real: { fr: 'Remet le chronomètre à zéro', en: 'Resets the timer' }, simulated: true },
      },
      middle: {
        name: 'MIDDLE',
        press: { real: { fr: 'Vue suivante : sans palier, boussole, pression bouteille', en: 'Next view: no deco, compass, tank pressure' }, simulated: false },
        hold: { real: { fr: 'Options de gaz', en: 'Gas options' }, simulated: false },
      },
      lower: {
        name: 'LOWER',
        press: { real: { fr: 'Change le contenu de la fenêtre du bas', en: 'Changes the bottom (switch) window' }, simulated: true },
        hold: {
          real: { fr: 'Ajoute un repère (bookmark) au carnet', en: 'Adds a bookmark to the log' },
          simulated: true,
          note: { fr: 'confirmation affichée seulement', en: 'confirmation shown only' },
        },
      },
    };
  }

  private switchCount = 3;
  /** Set by the upper button: jump the switch window to the timer once. */
  private showTimer = false;

  /** Contents of the switch window (lower button), besides the default NO DECO. */
  private switchWindow(v: ComputerView): [string, string][] {
    const list: [string, string][] = [];
    if (v.tank.ai) {
      list.push([`TANK, ${pressUnit()}`, pressText(v.tank.pressure)]);
      list.push(['GAS TIME', v.tank.gasTime === null ? '--' : `${v.tank.gasTime}′`]);
    }
    list.push([`MAX DEPTH, ${depthUnit()}`, depthStr(v.maxDepth)]);
    list.push([`TEMP, ${tempUnit()}`, tempVal(v.temperature).toFixed(0)]);
    list.push(['CNS, %', Math.round(v.cns).toString()]);
    if (this.timerRunning || this.timerSec > 0) {
      list.push(['TIMER', `${Math.floor(this.timerSec / 60)}′${String(Math.floor(this.timerSec % 60)).padStart(2, '0')}`]);
      if (this.showTimer) this.screen = list.length;
    }
    this.showTimer = false;
    this.switchCount = list.length;
    return list;
  }

  render(el: HTMLElement, view: ComputerView, _s: DiveSession, _lang: Lang): void {
    // §4.11: above the safe margin "the decompression calculation is paused until you go back down
    // below this limit".
    const v = this.withPausedDeco(view);
    this.currentScreen();
    const deep = this.deepstops.find((d) => d.state !== 'done');
    const deepActive = !!deep && v.inDive && deep.state === 'active';
    const deepPending = !!deep && v.inDive && deep.state === 'pending';
    const inDeepWindow = !!deep && deep.state === 'active' && Math.abs(v.depth - deep.target) <= 1.5;
    const ascTime = v.tts + Math.ceil(this.pendingDeepSeconds() / 60);

    // Band (bottom window): label, value, colour.
    let bandLbl = 'NO DECO';
    let bandVal = v.ndl > 99 ? '>99′' : `${v.ndl}′`; // §7.1: ">99 above 99"
    let bandCol = GREEN;
    let arch = GREEN;
    let archFrac = Math.min(1, v.ndl / 60);
    const stopLbl = `STOP, ${depthUnit()}`;
    let rightLbl = stopLbl;
    let rightVal = stopDepth(3);
    let rightCls = '';
    let decoTag = false;
    let depthArrows = '';

    const safetyShown = v.safety.state === 'active' || v.safety.state === 'paused' || (v.safety.state === 'pending' && v.depth < 7);
    const mandatorySafety = this.violations > 0;

    if (v.locked) {
      bandVal = 'N/A';
      rightLbl = '';
      rightVal = '<tspan class="su-lock">🔒</tspan>';
      archFrac = 1;
    } else if (!v.inDive) {
      bandLbl = 'SURF. TIME';
      bandVal = v.surfaceInterval !== null ? hmm(v.surfaceInterval / 60) : '0:00';
      bandCol = '#d8d8d8';
      arch = '#d8d8d8';
      archFrac = 0;
      rightLbl = 'NO FLY';
      rightVal = v.noFly > 0 ? `${Math.ceil(v.noFly / 60)}h` : '--';
    } else if (deepActive && deep) {
      bandLbl = 'STOP';
      bandVal = minSec(deep.remaining);
      bandCol = arch = YELLOW;
      archFrac = 1;
      rightVal = stopDepth(deep.target);
      decoTag = v.inDeco;
      if (inDeepWindow) depthArrows = '<tspan fill="#fff">▼▲</tspan>';
      else if (v.depth < deep.target - 1.5) depthArrows = `<tspan fill="${v.depth < deep.target - 0.5 - 1 ? RED : YELLOW}">▼</tspan>`;
    } else if (v.inDeco) {
      decoTag = true;
      archFrac = 1;
      // The ceiling value comes from the deepest stop, deepstops included; the field is labelled
      // "STOP, m" in the manual's decompression display examples (§4.11).
      rightLbl = stopLbl;
      rightVal = deepPending && deep ? stopDepth(deep.target) : stopDepth(v.ceiling);
      if (v.ceilingViolation === 2) {
        rightCls = 'su-red blink';
        depthArrows = `<tspan fill="${RED}">▼</tspan>`;
      } else if (v.ceilingViolation === 1) {
        rightCls = 'su-yellow';
        depthArrows = `<tspan fill="${YELLOW}">▼</tspan>`;
      } else if (v.depth <= v.ceiling + 3) {
        depthArrows = '<tspan fill="#fff">▼▲</tspan>';
      }
      if (v.depth <= v.ceiling + 3 && v.ceilingViolation === 0) {
        bandLbl = 'STOP';
        bandVal = minSec(v.stopTimeSec);
        bandCol = arch = RED;
      } else {
        bandLbl = 'ASC. TIME';
        bandVal = `${ascTime}′`;
        bandCol = arch = ORANGE;
      }
    } else if (safetyShown) {
      bandLbl = 'STOP';
      bandVal = minSec(v.safety.remaining);
      bandCol = arch = mandatorySafety ? RED : YELLOW;
      archFrac = 1;
      if (v.safety.state === 'active') depthArrows = '<tspan fill="#fff">▼▲</tspan>';
      else if (v.depth < this.safetyStop.top) depthArrows = `<tspan fill="${YELLOW}">▼</tspan>`;
    } else {
      if (deepPending && deep) rightVal = stopDepth(deep.target);
      // §4.1: tank pressure forced onto the display below the set alarm (yellow) and 50 bar (red).
      const forced = v.tank.ai && v.tank.pressure < Math.max(50, this.tankAlarm() ?? 0);
      const alt = this.switchWindow(v);
      const pick = forced ? alt.findIndex((a) => a[0].startsWith('TANK')) : this.screen - 1;
      if (pick >= 0 && pick < alt.length) {
        [bandLbl, bandVal] = alt[pick];
        bandCol = arch = forced ? (v.tank.pressure < 50 ? RED : YELLOW) : CYAN;
        if (bandLbl.startsWith('TANK')) archFrac = Math.min(1, v.tank.pressure / v.tank.fill);
      }
    }
    if (v.ndl <= 5 && !v.inDeco && v.inDive && bandLbl === 'NO DECO') bandCol = arch = YELLOW;
    const note = this.flashMessage();
    if (note && bandCol !== RED) [bandLbl, bandVal, bandCol] = [note, '✓', CYAN];

    // Ascent bar: one step per 2 m/min.
    const steps = v.inDive && v.ascentRate > 1 ? Math.min(6, Math.ceil(v.ascentRate / 2)) : 0;
    const barCol = v.ascentLevel === 2 ? RED : v.ascentLevel === 1 ? YELLOW : GREEN;
    let bar = '';
    for (let i = 0; i < 6; i++) {
      const y = 196 - i * 11;
      bar += i < steps
        ? `<path d="M 50 ${y} L 58 ${y - 8} L 66 ${y} Z" fill="${barCol}"/>`
        : `<rect x="51" y="${y - 3}" width="14" height="2" fill="#555"/>`;
    }

    // Arch with ticks.
    let ticks = '';
    for (let a = -145; a <= 145; a += 7.25) {
      const [x1, y1] = pt(a, 144);
      const [x2, y2] = pt(a, 136);
      ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#666" stroke-width="1.2"/>`;
    }
    const archPath = archFrac > 0.01 ? `<path d="${arc(-145, -145 + 290 * archFrac, 141)}" stroke="${arch}" stroke-width="9" fill="none"/>` : '';

    const [di, dd] = depthStr(v.depth).split('.');
    const decimals = dd !== undefined ? `<tspan class="su-dec">.${dd}</tspan>` : '';
    // §4.1 figure "High pO2": a yellow band across the middle, the pO2 in red under it (in place of
    // the bottom window). Warnings and notifications pop up the same way until a button is pressed
    // (no figure for them: same band assumed; the guide says warnings "may be red or yellow").
    const po2Alarm = v.inDive && v.ppO2 > 1.6;
    const notice = v.inDive ? this.notices.top : undefined;
    let popup = '';
    const band = (text: string) => `<g clip-path="url(#su-clip)"><rect x="0" y="142" width="300" height="62" fill="${YELLOW}"/><text x="150" y="182" class="su-t su-pop">${text}</text></g>`;
    if (po2Alarm) {
      popup = band('High pO<tspan class="su-sub" dy="4">2</tspan>') +
        `<text x="150" y="222" class="su-t su-lbl su-c">pO<tspan class="su-sub" dy="3">2</tspan></text>` +
        `<text x="150" y="261" class="su-t su-band su-red-fill">${v.ppO2.toFixed(1).replace(/^0/, '')}</text>`;
    } else if (notice) {
      popup = band(NOTICE_TEXT[notice]);
    }

    el.innerHTML = `
      <div class="dev su">
        <div class="su-strap top"></div><div class="su-strap bottom"></div>
        <div class="su-case">
          <button class="su-btn upper" data-btn="upper"></button>
          <button class="su-btn middle" data-btn="middle"></button>
          <button class="su-btn lower" data-btn="lower"></button>
          <svg class="su-screen" viewBox="0 0 300 300">
            <defs><clipPath id="su-clip"><circle cx="150" cy="150" r="148"/></clipPath></defs>
            <circle cx="150" cy="150" r="148" fill="#000"/>
            ${ticks}${archPath}
            <text x="60" y="140" class="su-t su-wave">≈</text>
            ${bar}
            <text x="98" y="81" class="su-t su-lbl">DEPTH, ${depthUnit()}</text>
            <text x="94" y="130" class="su-t su-depth"><tspan class="su-arrows">${depthArrows}</tspan>${di}${decimals}</text>
            ${popup ? '' : `<text x="98" y="152" class="su-t su-lbl">DIVE TIME</text>
            <text x="98" y="196" class="su-t su-time">${Math.floor(v.diveTime / 60)}′</text>
            ${decoTag ? `<rect x="182" y="150" width="46" height="15" rx="2" fill="${ORANGE}"/><text x="205" y="162" class="su-t su-tag">DECO</text>` : ''}
            <text x="186" y="177" class="su-t su-lbl">${rightLbl}</text>
            <text x="186" y="203" class="su-t su-right ${rightCls}">${rightVal}</text>`}
            ${po2Alarm ? '' : `<text x="150" y="222" class="su-t su-lbl su-c">${bandLbl}</text>
            <g clip-path="url(#su-clip)">
              <rect x="0" y="227" width="300" height="42" fill="${bandCol}"/>
              <text x="150" y="261" class="su-t su-band">${bandVal}</text>
            </g>`}
            <rect x="136" y="277" width="28" height="6" rx="1" fill="none" stroke="#fff" stroke-width="1.5"/>
            <rect x="138" y="279" width="18" height="2" fill="#fff"/>
            ${popup}
            ${v.locked && !popup ? `<text x="186" y="166" class="su-t su-lbl">LOCKED</text>` : ''}
          </svg>
        </div>
      </div>`;
  }
}
