// Rules shared by the Mares computers (from their manuals; each model cites its own sections).
import { ndl, pressureToDepth, type DecoParams } from '../../engine/buhlmann';
import type { DiveSession } from '../../engine/session';
import type { AlertCue, ComputerView, SettingDef } from '../base';

/**
 * Gradient factor sets of the ZH-L16C models (Quad Ci, Genius). The manuals give R0 (85/85),
 * R3 (50/60), T0 (30/85) and T3 (25/40); the Quad Ci manual R2 (60/70) and a Genius figure R1 (70/80);
 * T1 and T2 are interpolated.
 */
export const PRESETS: Record<string, [number, number]> = {
  R0: [85, 85], R1: [70, 80], R2: [60, 70], R3: [50, 60],
  T0: [30, 85], T1: [28, 70], T2: [27, 55], T3: [25, 40],
};

/** Maximum ascent rate by depth (m/min) of the ZH-L16C models. */
export function quadAscentLimit(depth: number): number {
  return depth > 50 ? 20 : depth > 30 ? 15 : depth > 10 ? 10 : 5;
}

const PERSONAL: Record<string, number> = { P0: 0.9, P1: 0.83, P2: 0.76 };

/**
 * Approximation of Mares RGBM (Wienke), shared by the models that use it (Puck Pro, Quad Air):
 * Bühlmann with a GF per P factor, and a repetitive-dive penalty fading over the surface interval.
 */
export function maresRgbmParams(pFactor: string, s: DiveSession | null): DecoParams {
  const g = PERSONAL[pFactor] ?? PERSONAL.P0;
  const p: DecoParams = { gfLow: g - 0.1, gfHigh: g, lastStop: 3, stopStep: 3, ascentRate: 10 };
  if (!s || s.lastDiveEnd === null) return p;
  const si = ((s.inDive ? s.diveStart : s.clock) - s.lastDiveEnd) / 60;
  const drop = 0.1 * Math.exp(-si / 150);
  return { ...p, gfLow: p.gfLow - drop, gfHigh: p.gfHigh - drop };
}

/**
 * Missed deco stop timer. ZH-L16C models: above the stop by less than 1 m for more than 3 min, or by
 * more than 1 m for more than 1 min (reset once back within 0.3 m). RGBM models: more than 1 m above
 * for more than 3 min.
 */
export class MissedStop {
  private near = 0;
  private far = 0;

  constructor(private readonly rule: 'zhl' | 'rgbm') {}

  /** `above`: metres above the stop depth. True once it is a dive violation. */
  update(above: number, dt: number): boolean {
    if (above > 1) this.far += dt;
    else if (this.rule === 'zhl' && above > 0.3) this.near += dt;
    if (above <= (this.rule === 'zhl' ? 0.3 : 1)) this.near = this.far = 0;
    return this.rule === 'zhl' ? this.near > 180 || this.far > 60 : this.far > 180;
  }

  reset(): void {
    this.near = this.far = 0;
  }
}

/** ZH-L16C models: more than 120 % of the allowed rate over a depth change of more than 20 m. */
export class FastAscentZhl {
  private from: number | null = null;

  /** True once it is a dive violation. */
  update(rate: number, depth: number): boolean {
    if (rate > 1.2 * quadAscentLimit(depth)) {
      if (this.from === null) this.from = depth;
      return this.from - depth > 20;
    }
    this.from = null;
    return false;
  }

  reset(): void {
    this.from = null;
  }
}

/**
 * RGBM models: faster than 12 m/min, started deeper than 12 m, kept for two thirds of the depth where
 * it started. `active` while such an ascent is going on (the icon blinks on the Quad Air).
 */
export class FastAscentRgbm {
  private from: number | null = null;

  get active(): boolean {
    return this.from !== null;
  }

  /** True once it is a dive violation. */
  update(rate: number, depth: number): boolean {
    if (rate > 12) {
      if (this.from === null && depth > 12) this.from = depth;
      return this.from !== null && depth <= this.from / 3;
    }
    this.from = null;
    return false;
  }

  reset(): void {
    this.from = null;
  }
}

/**
 * Deep stop of the ZH-L16C models: at the depth where the 5th tissue (27 min) switches from
 * ongassing to offgassing, suggested as the no deco limit approaches on dives deeper than 15 m;
 * 2 minutes within 1.5 m, optional.
 */
export class DeepStop {
  state: 'none' | 'pending' | 'active' | 'done' = 'none';
  depth = 0;
  remaining = 120;

  get shown(): boolean {
    return this.state === 'pending' || this.state === 'active';
  }

  reset(): void {
    this.state = 'none';
    this.remaining = 120;
  }

  /** `enabled`: the deep stop setting (only needed to start one; a started stop goes on). */
  update(s: DiveSession, ceil: number, p: DecoParams, dt: number, enabled: boolean): void {
    if (enabled && this.state === 'none' && s.maxDepth > 15) {
      if (ceil > 0 || ndl(s.tissues, s.depth, s.gas, p.gfHigh) <= 10) {
        this.depth = Math.round(pressureToDepth(s.tissues.n2[4] / 0.7902 + 0.0627) * 10) / 10;
        this.state = this.depth >= 9 && this.depth < s.depth ? 'pending' : 'done';
      }
    }
    if (this.state === 'pending' || this.state === 'active') {
      if (Math.abs(s.depth - this.depth) <= 1.5) {
        this.state = 'active';
        this.remaining -= dt;
        if (this.remaining <= 0) this.state = 'done';
      } else if (s.depth < this.depth - 1.5) {
        this.state = 'done';
      } else if (this.state === 'active') {
        this.state = 'pending';
      }
    }
  }
}

/**
 * Tank pressure colour ranges: blue in the upper half above `mid`, green in the lower half, yellow
 * down to `low`, red below.
 */
export function tankRange(p: number, fill: number, mid: number, low: number): 'blue' | 'green' | 'yellow' | 'red' {
  return p > (fill + mid) / 2 ? 'blue' : p > mid ? 'green' : p > low ? 'yellow' : 'red';
}

/**
 * Audible alarms common to the Mares manuals ("Alarms are both visual and audible"): fast ascent,
 * ppO2 above the set maximum (MOD) and missed decompression stop sound while they last; at CNS 100 %
 * the audible signal is repeated for 5 seconds in one-minute intervals.
 */
export function maresCues(v: ComputerView): AlertCue[] {
  const cues: AlertCue[] = [];
  const alarm = (key: string) => cues.push({ key, kind: 'beep', level: 'alarm', until: 'clear', every: 2 });
  if (v.alarms.includes('ASCENT')) alarm('fast-ascent');
  if (v.depth > v.mod) alarm('mod');
  if (v.alarms.includes('CEILING')) alarm('missed-stop');
  if (v.cns >= 100) cues.push({ key: 'cns-100', kind: 'beep', level: 'warning', until: 'clear', first: 5, every: 60, repeat: 5 });
  return cues;
}

/**
 * WARNINGS menu of the Quad Ci (§3.2) and the Genius (§2.4), described in the same words: MAX DEPTH
 * ("between 10m / 30ft and up to just shy of the MOD, in 1m / 5ft increments", default OFF), DIVE TIME
 * ("between 20 and 90 minutes in 2-minute increments", default OFF, TURN AROUND at half of it), NO DECO /
 * NO STOP at 2 minutes and ENTERING DECO (ON / OFF, defaults not given: ON assumed).
 */
export function maresWarningSettings(noDecoName: string): SettingDef[] {
  const off = { value: 'off', label: 'OFF' };
  const onOff = [{ value: 'on', label: 'ON' }, off];
  return [
    {
      key: 'wMaxDepth',
      label: { fr: 'Alarme de profondeur (MAX DEPTH)', en: 'Max depth alarm (MAX DEPTH)' },
      options: [off, ...Array.from({ length: 51 }, (_, i) => ({ value: String(10 + i), label: `${10 + i} m` }))],
      default: 'off',
    },
    {
      key: 'wTime',
      label: { fr: 'Alarme de durée (DIVE TIME)', en: 'Dive time alarm (DIVE TIME)' },
      options: [off, ...Array.from({ length: 36 }, (_, i) => ({ value: String(20 + i * 2), label: `${20 + i * 2} min` }))],
      default: 'off',
    },
    { key: 'wNoDeco', label: { fr: `Avertissement ${noDecoName} = 2 min`, en: `${noDecoName} = 2 min warning` }, options: onOff, default: 'on' },
    { key: 'wDeco', label: { fr: 'Avertissement d’entrée en déco (ENTERING DECO)', en: 'Entering deco warning (ENTERING DECO)' }, options: onOff, default: 'on' },
  ];
}
