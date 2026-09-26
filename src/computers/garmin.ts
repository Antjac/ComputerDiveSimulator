import type { DecoParams } from '../engine/buhlmann';
import type { DiveSession } from '../engine/session';
import type { Lang } from '../i18n';
import { remainingTime } from '../engine/gas';
import { depthInt, depthUnit, pressText, pressUnit, tempUnit, tempVal } from '../units';
import { ButtonHelp, ComputerView, DiveComputer, SettingDef, clockOfDay, depthStr, hmm, leadingOnGas, mmss } from './base';

// Garmin conservatism presets (gradient factors).
const PRESETS: Record<string, [number, number]> = { low: [45, 95], medium: [40, 85], high: [35, 70] };

const C = 150; // centre of the 300×300 viewBox
const GREEN = '#35c759';
const ORANGE = '#ff9f0a';
const RED = '#ff3b30';

/** Point on the dial; angle in degrees clockwise from 12 o'clock. */
function pt(a: number, r: number): [number, number] {
  const rad = ((a - 90) * Math.PI) / 180;
  return [C + r * Math.cos(rad), C + r * Math.sin(rad)];
}

function arc(from: number, to: number, r: number): string {
  const [x1, y1] = pt(from, r);
  const [x2, y2] = pt(to, r);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} ${sweep} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

/** White marker on the ring, pointing along the radius. */
function marker(a: number, r: number, outward: boolean): string {
  const [x, y] = pt(a, r);
  const rot = a - 90 + (outward ? 0 : 180);
  return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)})"><path d="M -9 -4 L 3 -4 L 8 0 L 3 4 L -9 4 Z" fill="#fff"/></g>`;
}

/**
 * Garmin Descent Mk3, single-gas mode.
 * Layout and thresholds follow the Descent Mk3 Series owner's manual (Dive data screens, safety and
 * decompression stops, alerts).
 */
export class GarminDescent extends DiveComputer {
  readonly id = 'garmin';
  readonly name = 'Garmin Descent Mk3i';
  readonly algorithm = 'Bühlmann ZHL-16C + GF';
  readonly exact = true;
  readonly transmitter = 'Descent T2';
  readonly gasTimeName = 'ATR';
  readonly notes = {
    fr: 'Bühlmann ZHL-16C avec facteurs de gradient. DOWN (et UP en sens inverse) : écrans de données ; LIGHT, START et BACK ne sont pas simulés. Verrouillage de déco après 3 min au-dessus du plafond. L’écran TTS / plafond / GF99 / Surface GF est un écran personnalisé : sur la montre, ces champs s’ajoutent via Dive Setup > Display Settings > Data Screens.',
    en: 'Bühlmann ZHL-16C with gradient factors. DOWN (and UP backwards): data screens; LIGHT, START and BACK are not simulated. Decompression lockout after 3 min above the ceiling. The TTS / ceiling / GF99 / Surface GF screen is a custom one: on the watch, these fields are added via Dive Setup > Display Settings > Data Screens.',
  };
  readonly settingDefs: SettingDef[] = [
    {
      key: 'gf',
      label: { fr: 'Conservatisme', en: 'Conservatism' },
      options: [
        { value: 'low', label: 'Low (45/95)' },
        { value: 'medium', label: 'Medium (40/85)' },
        { value: 'high', label: 'High (35/70)' },
      ],
      default: 'medium',
    },
    {
      key: 'layout',
      essential: true,
      label: { fr: 'Affichage', en: 'Display' },
      options: [{ value: 'big', label: 'Big Numbers' }, { value: 'std', label: 'Standard' }],
      default: 'big',
    },
    {
      key: 'safety',
      label: { fr: 'Palier de sécurité', en: 'Safety stop' },
      options: [{ value: '3', label: '3 min' }, { value: '4', label: '4 min' }, { value: '5', label: '5 min' }],
      default: '3',
    },
    {
      key: 'lastStop',
      label: { fr: 'Dernier palier', en: 'Last deco stop' },
      options: [{ value: '3', label: '3 m' }, { value: '6', label: '6 m' }],
      default: '3',
    },
  ];

  constructor() {
    super();
    // Safety stop after ≥11 m, stop depth 5 m: countdown within 1 m of it, pauses more than 3 m above,
    // resets below 11 m.
    this.safetyStop = { trigger: 11, start: 6, top: 2, bottom: 7, reset: 11 };
    this.ascentAlarmDelay = 5; // "faster than 9.1 m/min for more than 5 seconds"
    this.ceilingMargin = 0.6;
    this.lockAfter = 180;
    this.stopWindow = 0.6;
    this.init();
  }

  baseParams(): DecoParams {
    const [lo, hi] = PRESETS[this.settings.gf] ?? PRESETS.medium;
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: Number(this.settings.lastStop), stopStep: 3, ascentRate: 10 };
  }

  /** Green < 7.9, yellow 7.9–10.1, red > 10.1 m/min. */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate > 10.1 ? 2 : rate >= 7.9 ? 1 : 0;
  }

  ascentAlarmCondition(rate: number): boolean {
    return rate > 9.1;
  }

  /**
   * Air time remaining (manual, Dive terminology): time at the current depth until an ascent at 9 m/min
   * would surface with the reserve pressure. Decompression stops are included, safety stops are not.
   */
  gasTime(s: DiveSession, p: DecoParams, sacBar: number): number | null {
    return remainingTime({
      tissues: s.tissues, depth: s.depth, gas: s.gas, tankPressure: s.tankPressure, reserve: s.tank.reserve,
      sacBar, rate: () => 9, deco: p, anchor: this.anchor,
    });
  }

  safetySeconds(): number {
    return Number(this.settings.safety) * 60;
  }

  private screenCount = 4;

  // Deco stop behaviour ("Performing a Decompression Stop" and alert table): the stop timer pauses
  // while more than 0.6 m above the stop; a cleared stop flashes blue for 5 s; "Approaching Deco
  // Stop" within one stop interval (3 m) of the stop, "Decompression Cleared" once all are done.
  private pausedStop: { depth: number; sec: number } | null = null;
  private lastStop = 0;
  private stopDoneUntil = 0;
  private approachedStop = 0;
  private toast: { msg: string; until: number } | null = null;

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.pausedStop = null;
    this.lastStop = this.approachedStop = 0;
    this.stopDoneUntil = 0;
    this.toast = null;
  }

  private trackStops(v: ComputerView): void {
    const now = performance.now();
    const stop = v.inDive && v.inDeco ? v.stopDepth : 0;
    if (this.lastStop > 0 && stop < this.lastStop) {
      this.stopDoneUntil = now + 5000;
      if (stop === 0 && v.inDive) this.toast = { msg: 'Decompression Cleared', until: now + 5000 };
    }
    if (stop > 0 && stop !== this.approachedStop && v.depth > stop + this.stopWindow && v.depth <= stop + 3) {
      this.approachedStop = stop;
      this.toast = { msg: 'Approaching Deco Stop', until: now + 5000 };
    }
    this.lastStop = stop;
    this.pausedStop = v.ceilingViolation === 2
      ? this.pausedStop && this.pausedStop.depth === v.stopDepth ? this.pausedStop : { depth: v.stopDepth, sec: v.stopTimeSec }
      : null;
  }

  // Owner's manual, "Going Diving" and "Device Overview": DOWN scrolls through the data screens and
  // the dive compass, START opens the in-dive menu, LIGHT lights the screen (hold: controls menu).
  press(button: string): boolean {
    const n = this.screenCount;
    if (button === 'down') this.setScreen((this.screen + 1) % n);
    else if (button === 'up') this.setScreen((this.screen + n - 1) % n);
    else return false;
    return true;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      light: {
        name: 'LIGHT',
        press: { real: { fr: 'Éclaire l’écran', en: 'Lights the screen' }, simulated: false },
        hold: { real: { fr: 'Menu des commandes', en: 'Controls menu' }, simulated: false },
      },
      up: {
        name: 'UP · MENU',
        press: {
          real: { fr: 'Fait défiler les écrans de données', en: 'Scrolls through the data screens' },
          simulated: true,
          note: { fr: 'sens inverse de DOWN ; peut être désactivé en plongée (réglage « UP Key »)', en: 'opposite direction to DOWN; can be disabled while diving (“UP Key” setting)' },
        },
      },
      down: {
        name: 'DOWN',
        press: {
          real: { fr: 'Écran de données suivant (et boussole)', en: 'Next data screen (and compass)' },
          simulated: true,
          note: { fr: 'la boussole n’est pas simulée', en: 'the compass is not simulated' },
        },
      },
      start: {
        name: 'START · STOP',
        press: { real: { fr: 'Menu de plongée (gaz, réglages…)', en: 'In-dive menu (gases, settings…)' }, simulated: false },
      },
      back: {
        name: 'BACK · LAP',
        press: { real: { fr: 'Retour à l’écran précédent (pas de fonction décrite en plongée bouteille)', en: 'Back to the previous screen (no function described for scuba dives)' }, simulated: false },
      },
    };
  }

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    this.screenCount = v.tank.ai ? 5 : 4;
    if (this.screen >= this.screenCount) this.screen = 0;
    this.trackStops(v);
    const screen = this.currentScreen();
    let content: string;
    if (!v.inDive) content = this.surfaceScreen(v, s);
    else if (screen === 0) content = this.settings.layout === 'std' ? this.standardScreen(v) : this.bigScreen(v);
    else content = this.dataScreen(screen, v, s);

    el.innerHTML = `
      <div class="dev gm">
        <div class="gm-case">
          <button class="gm-btn light" data-btn="light"></button>
          <button class="gm-btn up" data-btn="up"></button>
          <button class="gm-btn down" data-btn="down"></button>
          <button class="gm-btn start" data-btn="start"></button>
          <button class="gm-btn back" data-btn="back"></button>
          <div class="gm-bezel"><svg class="gm-screen" viewBox="0 0 300 300">
            <circle cx="150" cy="150" r="150" fill="#000"/>
            ${content}
            ${this.banner(v, v.inDive && screen === 0 && this.settings.layout === 'std')}
          </svg></div>
        </div>
      </div>`;
  }

  /** Is a stop (safety or deco) currently guiding the diver? */
  private stopInfo(v: ComputerView): { depth: number; time: string; cls: string } | null {
    if (v.inDeco) {
      const cls = v.ceilingViolation === 2 ? 'gm-red blink' : performance.now() < this.stopDoneUntil ? 'gm-blue blink' : '';
      return { depth: depthInt(v.stopDepth), time: mmss(this.pausedStop ? this.pausedStop.sec : v.stopTimeSec), cls };
    }
    const st = v.safety.state;
    if (st === 'active' || st === 'paused' || (st === 'pending' && v.depth < 7)) {
      const cls = st === 'paused' && v.depth < this.safetyStop.top ? 'gm-yellow blink' : '';
      return { depth: depthInt(5), time: mmss(v.safety.remaining), cls };
    }
    return null;
  }

  /** Left gauge: tissue load (N2), or depth relative to the surface during stops. */
  private leftGauge(v: ComputerView): string {
    const stop = this.stopInfo(v);
    if (!stop) {
      const load = Math.min(120, v.n2Load);
      const a = (x: number) => 235 + (x / 120) * 90;
      return `
        <path d="${arc(a(0), a(79), 141)}" stroke="${GREEN}" stroke-width="8" fill="none"/>
        <path d="${arc(a(80), a(99), 141)}" stroke="${ORANGE}" stroke-width="8" fill="none"/>
        <path d="${arc(a(100), a(120), 141)}" stroke="${RED}" stroke-width="8" fill="none"/>
        ${marker(a(load), 128, true)}
        <text x="${pt(228, 128)[0]}" y="${pt(228, 128)[1]}" class="gm-t gm-n2" transform="rotate(38 ${pt(228, 128)[0]} ${pt(228, 128)[1]})">N2</text>`;
    }
    // Depth gauge: surface at the top (wave), stops as coloured segments.
    const scale = Math.max(12, v.maxDepth);
    const a = (d: number) => 325 - (Math.min(d, scale) / scale) * 110;
    const stops = v.inDeco ? v.plan.stops.map((st) => st.depth) : [5];
    const segs = stops.map((d) => `<path d="${arc(a(d), a(Math.max(0, d - 3)), 141)}" stroke="${v.inDeco ? RED : ORANGE}" stroke-width="8" fill="none"/>`).join('');
    const [wx, wy] = pt(330, 141);
    return `
      <path d="${arc(a(scale), a(0), 141)}" stroke="#0a84ff" stroke-width="2" fill="none"/>
      ${segs}
      <text x="${wx}" y="${wy + 4}" class="gm-t gm-wave">≈</text>
      ${marker(a(v.depth), 126, true)}`;
  }

  /** Right gauge: vertical speed, 0 at 3 o'clock, ascent upwards. */
  private rightGauge(v: ComputerView): string {
    const rate = Math.max(-12, Math.min(12, v.ascentRate));
    const pos = 90 - (rate / 12) * 50; // 40° (fast ascent) … 140° (fast descent)
    const color = v.ascentLevel === 2 ? RED : v.ascentLevel === 1 ? ORANGE : GREEN;
    let ticks = '';
    for (let i = 0; i < 11; i++) {
      const a0 = 40 + i * 10 + 1.5;
      const center = a0 + 3.5;
      const lit = rate > 0.5 ? center >= pos && center <= 90 : rate < -0.5 ? center <= pos && center >= 90 : Math.abs(center - 90) < 5;
      ticks += `<path d="${arc(a0, a0 + 7, 141)}" stroke="${lit ? color : '#3a3a3c'}" stroke-width="8" fill="none"/>`;
    }
    return ticks + marker(pos, 128, true);
  }

  private standardScreen(v: ComputerView): string {
    const stop = this.stopInfo(v);
    const po2Cls = v.ppO2 > 1.6 ? 'gm-red blink' : '';
    const left = stop
      ? `<text x="100" y="186" class="gm-t gm-mid ${stop.cls}">⬆${stop.depth}<tspan class="gm-unit">${depthUnit()}</tspan></text>
         <text x="100" y="222" class="gm-t gm-mid ${stop.cls}">${stop.time}</text>`
      : `<text x="100" y="168" class="gm-t gm-lbl">NDL</text>
         <text x="100" y="212" class="gm-t gm-val">${v.ndl >= 99 ? '99+' : v.ndl}</text>`;
    const depthCls = stop?.cls ?? '';
    return `
      ${this.leftGauge(v)}${this.rightGauge(v)}
      <text x="150" y="64" class="gm-t gm-top"><tspan class="${po2Cls}">${v.ppO2.toFixed(2)}</tspan><tspan dx="10" font-weight="700">${v.gas === 'AIR' ? 'Air' : v.gas}</tspan></text>
      ${this.middleField(v)}
      ${left}
      <text x="200" y="168" class="gm-t gm-lbl">DEPTH</text>
      <text x="200" y="212" class="gm-t gm-val ${depthCls}">${depthStr(v.depth)}<tspan class="gm-unit">${depthUnit()}</tspan></text>
      <text x="150" y="262" class="gm-t gm-mid">${mmss(v.diveTime)}</text>`;
  }

  private middleField(v: ComputerView): string {
    if (!v.tank.ai) {
      return `<text x="150" y="98" class="gm-t gm-lbl">TEMP.</text>
      <text x="150" y="130" class="gm-t gm-mid">${tempVal(v.temperature).toFixed(1)}°</text>`;
    }
    const cls = v.tank.pressure < Math.max(v.tank.reserve / 2, 21) ? 'gm-red blink' : v.tank.pressure < v.tank.reserve ? 'gm-yellow' : '';
    return `<rect x="104" y="104" width="12" height="24" rx="4" fill="#64b5ff"/><rect x="107" y="99" width="6" height="6" fill="#ddd"/>
      <text x="150" y="98" class="gm-t gm-lbl">T1</text>
      <text x="160" y="130" class="gm-t gm-mid ${cls}">${pressText(v.tank.pressure)}<tspan class="gm-unit"> ${pressUnit()}</tspan></text>`;
  }

  private bigScreen(v: ComputerView): string {
    const stop = this.stopInfo(v);
    const chevrons = v.ascentRate > 1 ? Math.min(3, Math.ceil(v.ascentRate / 3.4)) : 0;
    const col = v.ascentLevel === 2 ? RED : v.ascentLevel === 1 ? ORANGE : GREEN;
    const chev = [0, 1, 2]
      .map((i) => {
        const y = 118 + i * 16;
        const on = 2 - i < chevrons;
        return `<path d="M 244 ${y + 10} L 256 ${y} L 268 ${y + 10} L 268 ${y + 16} L 256 ${y + 6} L 244 ${y + 16} Z" fill="${on ? col : '#48484a'}"/>`;
      })
      .join('');
    const sec = Math.floor(v.diveTime);
    const [di, dd] = depthStr(v.depth).split('.');
    // Bottom row: NDL / stop right-aligned on the left half, dive time left-aligned on the right half,
    // with a smaller font for three digits so both fit inside the round dial.
    const fit = (n: string | number) => (String(n).length >= 3 ? 'gm-bignum3' : 'gm-bignum2');
    const mins = Math.floor(sec / 60);
    const bottomLeft = stop
      ? `<text x="76" y="226" class="gm-t gm-vert" transform="rotate(-90 76 226)">STOP</text>
         <text x="160" y="244" class="gm-t gm-end ${fit(stop.depth)} ${stop.cls}">${stop.depth}<tspan class="gm-unit">${depthUnit()}</tspan></text>`
      : `<text x="76" y="226" class="gm-t gm-vert" transform="rotate(-90 76 226)">NDL</text>
         <text x="160" y="244" class="gm-t gm-end gm-bignum2">${Math.min(99, v.ndl)}${v.ndl >= 99 ? '<tspan class="gm-sup" dy="-24">+</tspan>' : ''}</text>`;
    const top = stop
      ? `<text x="150" y="78" class="gm-t gm-mid ${stop.cls}">${v.inDeco ? 'DECO' : 'SAFETY'} ${stop.time}</text>`
      : v.tank.ai
        ? `<text x="150" y="80" class="gm-t gm-mid ${v.tank.pressure < v.tank.reserve ? 'gm-yellow' : ''}">${pressText(v.tank.pressure)}<tspan class="gm-unit"> ${pressUnit()}</tspan></text>`
        : `<text x="150" y="78" class="gm-t gm-lbl">${v.ppO2.toFixed(2)} PO2</text>`;
    return `
      ${top}
      <rect x="38" y="128" width="62" height="34" rx="8" fill="none" stroke="#fff" stroke-width="2.5"/>
      <text x="69" y="153" class="gm-t gm-pill" ${v.gas.length > 3 ? 'textLength="52" lengthAdjust="spacingAndGlyphs"' : ''}>${v.gas === 'AIR' ? 'Air' : v.gas}</text>
      <text x="172" y="180" class="gm-t gm-bignum">${di}${dd !== undefined ? `<tspan class="gm-bigdec">.${dd}</tspan>` : ''}<tspan class="gm-unit2">${depthUnit()}</tspan></text>
      ${chev}
      <rect x="244" y="170" width="24" height="5" rx="1" fill="#fff"/>
      ${bottomLeft}
      <text x="184" y="244" class="gm-t gm-start ${fit(mins)}">${String(mins).padStart(2, '0')}<tspan class="gm-sup" dy="-24">:${String(sec % 60).padStart(2, '0')}</tspan></text>`;
  }

  private dataScreen(i: number, v: ComputerView, s: DiveSession): string {
    const fields: [string, string][] =
      i === 1 ? [['TTS', `${v.tts}`], ['CEILING', v.ceiling > 0 ? `${depthInt(v.ceiling)}${depthUnit()}` : '--'], ['GF99', leadingOnGas(s) ? 'On-Gassing' : `${Math.round(v.gf99)}%`], ['SURF. GF', `${Math.round(v.surfGf)}%`]]
      : i === 2 ? [['MAX DEPTH', `${depthStr(v.maxDepth)}${depthUnit()}`], ['AVG. DEPTH', `${depthStr(v.avgDepth)}${depthUnit()}`], ['CNS', `${Math.round(v.cns)}%`], ['OTU', `${Math.round(v.otu)}`]]
      : i === 4 ? [['T1', `${pressText(v.tank.pressure)}`], ['ATR', v.tank.gasTime === null ? '--' : `${v.tank.gasTime}`],
          ['SAC', `${(v.tank.sacBar * (pressUnit() === 'psi' ? 14.5038 : 1)).toFixed(pressUnit() === 'psi' ? 0 : 1)}`], ['RESERVE', `${pressText(v.tank.reserve)}`]]
      : (() => {
          const { h, m } = clockOfDay(s);
          return [['TIME OF DAY', `${h}:${String(m).padStart(2, '0')}`], ['NDL', v.inDeco ? '0' : `${v.ndl}`], ['TEMP.', `${tempVal(v.temperature).toFixed(1)}${tempUnit()}`], ['BATTERY', '87%']] as [string, string][];
        })();
    const pos: [number, number][] = [[95, 105], [205, 105], [95, 195], [205, 195]];
    return `
      ${this.rightGauge(v)}
      <text x="150" y="52" class="gm-t gm-lbl">${depthStr(v.depth)}${depthUnit()} · ${mmss(v.diveTime)}</text>
      <line x1="40" y1="150" x2="260" y2="150" stroke="#3a3a3c"/>
      <line x1="150" y1="72" x2="150" y2="240" stroke="#3a3a3c"/>
      ${fields.map(([l, val], k) => `<text x="${pos[k][0]}" y="${pos[k][1]}" class="gm-t gm-lbl">${l}</text><text x="${pos[k][0]}" y="${pos[k][1] + 34}" class="gm-t gm-mid" ${val.length > 7 ? 'textLength="96" lengthAdjust="spacingAndGlyphs"' : ''}>${val}</text>`).join('')}
      <text x="150" y="268" class="gm-t gm-small">${i}/${this.screenCount - 1}</text>`;
  }

  private surfaceScreen(v: ComputerView, s: DiveSession): string {
    const { h, m } = clockOfDay(s);
    return `
      ${this.leftGauge({ ...v, safety: { ...v.safety, state: 'none' }, inDeco: false })}
      <text x="150" y="70" class="gm-t gm-lbl">SINGLE-GAS · ${v.gas === 'AIR' ? 'Air' : v.gas}</text>
      <text x="150" y="120" class="gm-t gm-bignum2">${h}:${String(m).padStart(2, '0')}</text>
      <text x="100" y="168" class="gm-t gm-lbl">SURF. INT.</text>
      <text x="100" y="200" class="gm-t gm-mid">${v.surfaceInterval !== null ? hmm(v.surfaceInterval / 60) : '--'}</text>
      <text x="200" y="168" class="gm-t gm-lbl">NO FLY</text>
      <text x="200" y="200" class="gm-t gm-mid">${v.noFly > 0 ? hmm(v.noFly) : '--'}</text>
      <text x="150" y="245" class="gm-t gm-small">${v.locked ? 'DECO LOCKOUT' : `CNS ${Math.round(v.cns)}%`}</text>`;
  }

  /** Alert pop-ups, worded as in the manual's alert table. */
  /** Alert pop-up; on the standard layout it sits higher so the depth stays fully visible. */
  private banner(v: ComputerView, raise = false): string {
    if (!v.inDive) return '';
    let msg = '';
    let color = '#1c1c1e';
    if (this.ascentAlarm) [msg, color] = ['Ascending too fast. Slow your ascent.', RED];
    else if (v.ceilingViolation === 2) [msg, color] = ['Descend below deco ceiling.', RED];
    else if (v.ppO2 > 1.6) [msg, color] = ['PO2 is high. Ascend or switch to lower O2 gas.', RED];
    else if (v.tank.ai && v.tank.pressure < Math.max(v.tank.reserve / 2, 21)) [msg, color] = ['Critical tank pressure. End your dive now.', RED];
    else if (v.tank.ai && v.tank.pressure < v.tank.reserve) [msg, color] = ['Reserve pressure reached.', ORANGE];
    else if (v.safety.state === 'paused' && v.depth < this.safetyStop.top) [msg, color] = ['Descend to complete safety stop.', ORANGE];
    else if (this.toast && performance.now() < this.toast.until) msg = this.toast.msg;
    else if (!v.inDeco && (v.ndl === 10 || v.ndl === 5)) msg = 'Approaching NDL';
    if (!msg) return '';
    const words = msg.split(' ');
    const lines: string[] = [];
    for (const w of words) {
      if (lines.length && (lines[lines.length - 1] + ' ' + w).length <= 18) lines[lines.length - 1] += ' ' + w;
      else lines.push(w);
    }
    const h = 20 + lines.length * 22;
    const top = raise ? Math.max(70, 128 - h) : 150 - h / 2;
    return `<g><rect x="40" y="${top}" width="220" height="${h}" rx="14" fill="${color}"/>
      ${lines.map((l, i) => `<text x="150" y="${top + 30 + i * 22}" class="gm-t gm-alert">${l}</text>`).join('')}</g>`;
  }
}
