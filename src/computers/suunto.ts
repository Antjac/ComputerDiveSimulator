import type { DecoParams } from '../engine/buhlmann';
import type { DiveSession } from '../engine/session';
import type { Lang } from '../i18n';
import { depthToPressure } from '../engine/buhlmann';
import { depthInt, depthUnit, imperial, pressText, pressUnit, tempUnit, tempVal } from '../units';
import { ComputerView, DiveComputer, SettingDef, depthStr, hmm } from './base';

/** Stop / ceiling values: one decimal in metres, whole feet in imperial. */
const stopDepth = (m: number) => (imperial() ? String(depthInt(m)) : m.toFixed(1));

/** Approximate GF high equivalent for each personal setting (calibrated on published NDLs). */
const PERSONAL: Record<string, number> = { '-2': 0.98, '-1': 0.93, '0': 0.88, '+1': 0.83, '+2': 0.78 };

const GREEN = '#22e35a';
const ORANGE = '#ffa11a';
const YELLOW = '#ffe11a';
const RED = '#ff2d2d';
const CYAN = '#2fe3ff';

interface DeepStop {
  target: number;
  remaining: number;
  state: 'pending' | 'active' | 'done';
}

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

/**
 * Suunto D5, Air/Nitrox mode. Screens and rules follow the Suunto D5 user guide (display, alarms,
 * decompression window, algorithm lock, safety stops and deepstops). Fused RGBM 2 itself is
 * proprietary: it is approximated with Bühlmann + penalties.
 */
export class SuuntoD5 extends DiveComputer {
  readonly id = 'suunto';
  readonly name = 'Suunto D5';
  readonly algorithm = 'Suunto Fused RGBM 2 (≈)';
  readonly exact = false;
  readonly transmitter = 'Tank POD';
  readonly gasTimeName = 'gas time';
  readonly notes = {
    fr: 'Fused RGBM 2 est propriétaire : approximation (Bühlmann + réglage personnel, pénalités en successives et après remontée rapide). Affichage, deepstops, fenêtre de déco et verrouillage 48 h conformes au manuel. Bouton bas : fenêtre d’information.',
    en: 'Fused RGBM 2 is proprietary: approximation (Bühlmann + personal setting, penalties for repetitive dives and fast ascents). Display, deepstops, deco window and 48 h lock as per the manual. Lower button: switch window.',
  };
  readonly settingDefs: SettingDef[] = [
    {
      key: 'personal',
      label: { fr: 'Réglage personnel', en: 'Personal setting' },
      options: [
        { value: '-2', label: '-2 (more aggressive)' },
        { value: '-1', label: '-1 (aggressive)' },
        { value: '0', label: '0 (default)' },
        { value: '+1', label: '+1 (conservative)' },
        { value: '+2', label: '+2 (more conservative)' },
      ],
      default: '0',
    },
    {
      key: 'deepstop',
      label: { fr: 'Deepstop', en: 'Deepstop' },
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      default: 'on',
    },
    {
      key: 'safety',
      label: { fr: 'Palier de sécurité', en: 'Safety stop' },
      options: [{ value: '3', label: '3 min' }, { value: '4', label: '4 min' }, { value: '5', label: '5 min' }],
      default: '3',
    },
    {
      key: 'lastStop',
      label: { fr: 'Dernier palier', en: 'Last stop depth' },
      options: [{ value: '3', label: '3.0 m' }, { value: '6', label: '6.0 m' }],
      default: '3',
    },
  ];

  /** GF points removed because of fast ascents during this dive. */
  ascentPenalty = 0;
  violations = 0;
  deepstops: DeepStop[] = [];

  constructor() {
    super();
    // Safety stop: recommended for dives over 10 m, counted between 2.4 and 6 m.
    this.safetyStop = { trigger: 10, start: 6, top: 2.4, bottom: 6, reset: 10 };
    this.ascentAlarmDelay = 5; // "for five seconds or more"
    this.ceilingMargin = 0.6; // safe margin above the ceiling
    this.lockAfter = 180;
    this.lockHours = 48;
    this.stopWindow = 3; // deco window: ceiling to ceiling + 3 m
    this.screenTimeout = 0;
    this.init();
  }

  baseParams(): DecoParams {
    const hi = PERSONAL[this.settings.personal] ?? PERSONAL['0'];
    return { gfLow: hi - 0.1, gfHigh: hi, lastStop: Number(this.settings.lastStop), stopStep: 3, ascentRate: 10 };
  }

  decoParams(s: DiveSession): DecoParams {
    const p = this.baseParams();
    // Repetitive-dive penalty: up to 8 GF points, fading with a ~2 h time constant.
    let rep = 0;
    if (s.lastDiveEnd !== null) {
      const si = ((s.inDive ? s.diveStart : s.clock) - s.lastDiveEnd) / 60;
      rep = 0.08 * Math.exp(-si / 120);
    }
    const drop = Math.min(0.15, rep + this.ascentPenalty);
    return { ...p, gfHigh: p.gfHigh - drop, gfLow: p.gfLow - drop };
  }

  /**
   * Gas time (user guide §4.19): remaining gas at the current depth and breathing rate, down to 35 bar.
   */
  gasTime(s: DiveSession, _p: DecoParams, sacBar: number): number | null {
    const perMin = sacBar * (depthToPressure(s.depth) / 1.01325);
    return Math.max(0, Math.min(99, Math.floor((s.tankPressure - 35) / perMin)));
  }

  /** Green < 8, yellow 8–10, red > 10 m/min. */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate > 10 ? 2 : rate >= 8 ? 1 : 0;
  }

  /** "Ascent speed violation increases safety stop time with minimum 30 seconds." */
  safetySeconds(): number {
    return Number(this.settings.safety) * 60 + this.violations * 30;
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.ascentPenalty = 0;
    this.violations = 0;
    this.deepstops = [];
    this.screen = 0;
  }

  protected onAscentViolation(): void {
    this.violations += 1;
    this.ascentPenalty = Math.min(0.08, this.ascentPenalty + 0.02);
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive || this.settings.deepstop !== 'on' || this.locked) return;
    // Deepstops: activated deeper than 20 m, at half the maximum depth; a second one at half of the
    // first when the first is 20 m or deeper. Window ±1.5 m, counted from target + 0.5 m to target − 3 m.
    if (s.maxDepth > 20) {
      if (!this.deepstops.length) this.deepstops.push({ target: s.maxDepth / 2, remaining: 120, state: 'pending' });
      const first = this.deepstops[0];
      if (first.state === 'pending') first.target = Math.round((s.maxDepth / 2) * 10) / 10;
      if (first.target >= 20 && this.deepstops.length === 1) this.deepstops.push({ target: first.target / 2, remaining: 120, state: 'pending' });
      if (this.deepstops[1] && this.deepstops[1].state === 'pending') this.deepstops[1].target = Math.round((first.target / 2) * 10) / 10;
    }
    const cur = this.deepstops.find((d) => d.state !== 'done');
    if (!cur) return;
    if (s.depth <= cur.target + 0.5 && s.depth >= cur.target - 3) {
      cur.state = 'active';
      cur.remaining -= dt;
      if (cur.remaining <= 0) cur.state = 'done';
    } else if (s.depth < cur.target - 3) {
      cur.state = 'done';
    } else if (cur.state === 'active') {
      cur.state = 'pending';
    }
  }

  press(button: string): boolean {
    if (button === 'lower') this.setScreen((this.screen + 1) % (this.switchCount + 1));
    return true;
  }

  private switchCount = 3;

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
    this.switchCount = list.length;
    return list;
  }

  summary(v: ComputerView): { ndl: string; stop: string; tts: string } {
    const b = super.summary(v);
    const extra = this.pendingDeepSeconds();
    return extra > 0 && !v.locked ? { ...b, tts: String(v.tts + Math.ceil(extra / 60)) } : b;
  }

  private pendingDeepSeconds(): number {
    return this.deepstops.filter((d) => d.state !== 'done').reduce((a, d) => a + d.remaining, 0);
  }

  render(el: HTMLElement, v: ComputerView, _s: DiveSession, _lang: Lang): void {
    const screen = this.currentScreen();
    const deep = this.deepstops.find((d) => d.state !== 'done');
    const deepActive = !!deep && v.inDive && deep.state === 'active';
    const deepPending = !!deep && v.inDive && deep.state === 'pending';
    const inDeepWindow = !!deep && deep.state === 'active' && Math.abs(v.depth - deep.target) <= 1.5;
    const ascTime = v.tts + Math.ceil(this.pendingDeepSeconds() / 60);

    // Band (bottom window): label, value, colour.
    let bandLbl = 'NO DECO';
    let bandVal = `${Math.min(99, v.ndl)}′`;
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
      // The ceiling value comes from the deepest stop, deepstops included.
      rightLbl = deepPending && deep ? stopLbl : 'CEILING';
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
      // Tank pressure is forced onto the display below the reserve (yellow) and 50 bar (red).
      const forced = v.tank.ai && v.tank.pressure < v.tank.reserve;
      const alt = this.switchWindow(v);
      const pick = forced ? alt.findIndex((a) => a[0].startsWith('TANK')) : screen - 1;
      if (pick >= 0 && pick < alt.length) {
        [bandLbl, bandVal] = alt[pick];
        bandCol = arch = forced ? (v.tank.pressure < 50 ? RED : YELLOW) : CYAN;
        if (bandLbl.startsWith('TANK')) archFrac = Math.min(1, v.tank.pressure / v.tank.fill);
      }
    }
    if (v.ndl <= 5 && !v.inDeco && v.inDive && bandLbl === 'NO DECO') bandCol = arch = YELLOW;

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
    const po2Alarm = v.ppO2 > 1.6;
    const ascentAlarm = this.ascentAlarm;

    el.innerHTML = `
      <div class="dev su">
        <div class="su-strap top"></div><div class="su-strap bottom"></div>
        <div class="su-case">
          <button class="su-btn upper" data-btn="upper" title="Timer"></button>
          <button class="su-btn middle" data-btn="middle" title="View"></button>
          <button class="su-btn lower" data-btn="lower" title="Switch window"></button>
          <svg class="su-screen" viewBox="0 0 300 300">
            <defs><clipPath id="su-clip"><circle cx="150" cy="150" r="148"/></clipPath></defs>
            <circle cx="150" cy="150" r="148" fill="#000"/>
            ${ticks}${archPath}
            <text x="60" y="140" class="su-t su-wave">≈</text>
            ${bar}
            <text x="98" y="84" class="su-t su-lbl">DEPTH, ${depthUnit()}</text>
            <text x="94" y="130" class="su-t su-depth ${po2Alarm ? 'su-red blink' : ''}"><tspan class="su-arrows">${depthArrows}</tspan>${di}${decimals}</text>
            <text x="98" y="152" class="su-t su-lbl">DIVE TIME</text>
            <text x="98" y="196" class="su-t su-time">${Math.floor(v.diveTime / 60)}′</text>
            ${decoTag ? `<rect x="182" y="150" width="46" height="15" rx="2" fill="${ORANGE}"/><text x="205" y="162" class="su-t su-tag">DECO</text>` : ''}
            <text x="186" y="180" class="su-t su-lbl">${rightLbl}</text>
            <text x="186" y="203" class="su-t su-right ${rightCls}">${rightVal}</text>
            <text x="150" y="222" class="su-t su-lbl su-c">${bandLbl}</text>
            <g clip-path="url(#su-clip)">
              <rect x="0" y="227" width="300" height="42" fill="${bandCol}"/>
              <text x="150" y="261" class="su-t su-band">${bandVal}</text>
              <rect x="136" y="277" width="28" height="6" rx="1" fill="none" stroke="#fff" stroke-width="1.5"/>
              <rect x="138" y="279" width="18" height="2" fill="#fff"/>
            </g>
            ${ascentAlarm ? `<g><rect x="70" y="30" width="160" height="26" rx="4" fill="${RED}"/><text x="150" y="49" class="su-t su-alert">Ascent speed</text></g>` : ''}
            ${v.locked ? `<text x="186" y="166" class="su-t su-lbl">LOCKED</text>` : ''}
          </svg>
        </div>
      </div>`;
  }
}
