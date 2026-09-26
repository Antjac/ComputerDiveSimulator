import {
  AIR, COMPARTMENTS, DecoParams, DecoPlan, SURFACE_PRESSURE, Tissues, WATER_VAPOUR, ceilingDepth, gasLabel,
  gfLowAnchor, ndl, planAscent, pressureToDepth, timeToTolerate,
} from '../engine/buhlmann';
import { sacBarPerMin } from '../engine/gas';
import { DiveSession } from '../engine/session';
import type { Lang } from '../i18n';
import { depthInt, depthText, depthUnit } from '../units';

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingDef {
  key: string;
  label: { fr: string; en: string };
  options: SettingOption[];
  default: string;
}

export type AlarmCode =
  | 'ASCENT' | 'ASCENT_WARN' | 'CEILING' | 'PPO2_HIGH' | 'CNS'
  | 'NDL_LOW' | 'DECO' | 'LOCKED' | 'LOW_GAS' | 'OUT_OF_GAS';

export type SafetyState = 'none' | 'pending' | 'active' | 'paused' | 'done';

/** Safety stop behaviour, as documented in each manual. Depths in metres. */
export interface SafetyStopDef {
  trigger: number; // the stop is required once the dive went deeper than this
  start: number; // the countdown starts when shallower than this
  top: number; // ...and keeps running while deeper than this
  bottom: number; // ...and shallower than this
  reset: number; // going deeper than this restarts the stop from scratch
}

export interface ComputerView {
  inDive: boolean;
  depth: number;
  maxDepth: number;
  avgDepth: number;
  diveTime: number; // s
  temperature: number;
  gas: string;
  o2: number; // %
  ppO2: number;
  mod: number; // m
  cns: number;
  otu: number;
  gfLow: number; // %
  gfHigh: number; // %
  ndl: number; // min
  inDeco: boolean;
  plan: DecoPlan;
  stopDepth: number; // first mandatory stop, 0 if none
  stopTime: number; // whole minutes at the first stop (rounded up)
  stopTimeSec: number; // seconds at the first stop
  atStop: boolean; // within the stop window of the first stop
  tts: number; // min
  ceiling: number; // m
  ceilingViolation: 0 | 1 | 2; // 0 ok, 1 above ceiling within the safe margin, 2 beyond it
  gf99: number; // %
  surfGf: number; // %
  n2Load: number; // % of the no-deco limit (100 = decompression required)
  ascentRate: number; // m/min, positive = up
  ascentLevel: 0 | 1 | 2; // ok / warn / alarm (colour of the ascent indicator)
  safety: { state: SafetyState; remaining: number; total: number };
  alarms: AlarmCode[];
  surfaceInterval: number | null; // s
  noFly: number; // min
  desat: number; // min
  diveNumber: number;
  locked: boolean;
  tank: TankView;
}

export interface TankView {
  pressure: number; // bar
  fill: number;
  reserve: number;
  /** Tank data shown by the computer itself (optional transmitter paired and enabled). */
  ai: boolean;
  sacBar: number; // bar/min at the surface
  /** Model-specific remaining time (GTR / ATR / RBT / gas time), null when not available. */
  gasTime: number | null;
}

/**
 * A dive computer model. All models share the diver's tissue state (Bühlmann ZHL-16C), then apply
 * their own parameters, limits, extras and display.
 */
export abstract class DiveComputer {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly algorithm: string;
  abstract readonly exact: boolean;
  abstract readonly notes: { fr: string; en: string };
  abstract readonly settingDefs: SettingDef[];
  /** Name of the optional wireless tank transmitter, or null when the model has none. */
  readonly transmitter: string | null = null;
  /** Name of the remaining-gas time shown with a transmitter (GTR, ATR, RBT…). */
  readonly gasTimeName: string = '';

  settings: Record<string, string> = {};

  /** Safety stop rules (overridden per model). */
  safetyStop: SafetyStopDef = { trigger: 10, start: 6, top: 3, bottom: 6, reset: 10 };
  /** Seconds the ascent-rate alarm condition must last before it is raised. */
  ascentAlarmDelay = 0;
  /** Metres above the ceiling tolerated before the violation alarm. */
  ceilingMargin = 0.3;
  /** Seconds beyond the margin before the algorithm locks (null = never locks). */
  lockAfter: number | null = null;
  lockHours = 24;
  /** Metres below a stop depth still considered "at the stop". */
  stopWindow = 1.5;
  /** ppO2 used for the MOD display. */
  modPpo2 = 1.4;

  // Per-dive state.
  anchor = 0;
  safetyState: SafetyState = 'none';
  safetyRemaining = 180;
  safetyTotal = 180;
  ascentAlarmSec = 0;
  ascentAlarm = false;
  ceilingViolationSec = 0;
  locked = false;
  lockedUntil = 0;

  // Screen navigation (driven by the device buttons, in real time).
  screen = 0;
  screenChangedAt = 0;
  screenTimeout = 0; // ms of real time before returning to the main screen (0 = never)

  init(): void {
    for (const def of this.settingDefs) if (!(def.key in this.settings)) this.settings[def.key] = def.default;
  }

  abstract baseParams(): DecoParams;

  /** Deco parameters, possibly adjusted by the computer's own state (penalties, levels...). */
  decoParams(_s: DiveSession): DecoParams {
    return this.baseParams();
  }

  /** Colour level of the ascent indicator for a given rate (m/min, positive = up). */
  ascentLevel(rate: number, _depth: number): 0 | 1 | 2 {
    return rate > 10 ? 2 : rate > 8 ? 1 : 0;
  }

  /** Condition that (after `ascentAlarmDelay`) raises the ascent-rate alarm. */
  ascentAlarmCondition(rate: number, depth: number): boolean {
    return this.ascentLevel(rate, depth) === 2;
  }

  /** Safety stop duration in seconds (can depend on settings or on the dive). */
  safetySeconds(_s: DiveSession): number {
    return 180;
  }

  /** Does this computer show tank data (model supports a transmitter and it is enabled)? */
  airIntegrated(s: DiveSession): boolean {
    return this.transmitter !== null && s.transmitterOn;
  }

  /** Model-specific remaining gas time, in minutes (null = not shown). */
  gasTime(_s: DiveSession, _p: DecoParams, _sacBar: number): number | null {
    return null;
  }

  /** Called when a new dive starts. */
  onDiveStart(_s: DiveSession): void {
    this.anchor = 0;
    this.safetyState = 'none';
    this.safetyRemaining = this.safetyTotal = 180;
    this.ascentAlarmSec = 0;
    this.ascentAlarm = false;
    this.ceilingViolationSec = 0;
    this.screen = 0;
  }

  onDiveEnd(_s: DiveSession): void {}

  /** A device button was pressed. Returns true if the screen changed. */
  press(_button: string, _s: DiveSession): boolean {
    return false;
  }

  protected setScreen(i: number): void {
    this.screen = i;
    this.screenChangedAt = performance.now();
  }

  /** Returns to the main screen after the model's timeout. */
  protected currentScreen(): number {
    if (this.screen !== 0 && this.screenTimeout > 0 && performance.now() - this.screenChangedAt > this.screenTimeout) {
      this.screen = 0;
    }
    return this.screen;
  }

  protected lock(s: DiveSession): void {
    if (this.locked) return;
    this.locked = true;
    this.lockedUntil = s.clock + this.lockHours * 3600;
    s.diveAlarms.add('LOCKED');
  }

  /** Per-simulation-step bookkeeping (timers, anchors, penalties). */
  tick(s: DiveSession, dt: number): void {
    if (this.locked && s.clock > this.lockedUntil) this.locked = false;
    if (!s.inDive) return;
    const p = this.decoParams(s);
    this.anchor = Math.max(this.anchor, Math.min(gfLowAnchor(s.tissues, p), Math.ceil(s.depth / p.stopStep) * p.stopStep));

    if (this.ascentAlarmCondition(s.ascentRate, s.depth)) {
      this.ascentAlarmSec += dt;
      if (this.ascentAlarmSec >= this.ascentAlarmDelay) {
        if (!this.ascentAlarm) this.onAscentViolation(s);
        this.ascentAlarm = true;
        s.diveAlarms.add('ASCENT');
      }
    } else {
      this.ascentAlarmSec = 0;
      this.ascentAlarm = false;
    }

    const ceil = ceilingDepth(s.tissues, this.anchor, p);
    if (ceil > 0 && s.depth < ceil - this.ceilingMargin) {
      this.ceilingViolationSec += dt;
      s.diveAlarms.add('CEILING');
      if (this.lockAfter !== null && this.ceilingViolationSec >= this.lockAfter) this.lock(s);
    } else {
      this.ceilingViolationSec = 0;
    }

    this.tickSafetyStop(s, dt, ceil > 0);
  }

  /** Hook called once when an ascent-rate violation starts. */
  protected onAscentViolation(_s: DiveSession): void {}

  protected tickSafetyStop(s: DiveSession, dt: number, inDeco: boolean): void {
    const ss = this.safetyStop;
    const d = s.depth;
    const restart = () => {
      this.safetyState = 'pending';
      this.safetyRemaining = this.safetyTotal = this.safetySeconds(s);
    };
    if (this.safetyState === 'none') {
      if (s.maxDepth > ss.trigger) restart();
      return;
    }
    if (d > ss.reset) {
      restart();
      return;
    }
    if (this.safetyState === 'done') return;
    if (inDeco) {
      // Deco stops replace the safety stop; it starts once they are cleared.
      restart();
      return;
    }
    // The duration may grow during the dive (e.g. after ascent violations).
    const total = this.safetySeconds(s);
    if (total > this.safetyTotal) {
      this.safetyRemaining += total - this.safetyTotal;
      this.safetyTotal = total;
    }
    const inWindow = d >= ss.top && d <= ss.bottom;
    if (this.safetyState === 'pending') {
      if (d <= ss.start && inWindow) this.safetyState = 'active';
      else return;
    }
    if (inWindow) {
      this.safetyState = 'active';
      this.safetyRemaining -= dt;
      if (this.safetyRemaining <= 0) {
        this.safetyRemaining = 0;
        this.safetyState = 'done';
      }
    } else {
      this.safetyState = 'paused';
    }
  }

  /** Computes everything the screen needs. */
  compute(s: DiveSession): ComputerView {
    const p = this.decoParams(s);
    const depth = s.depth;
    const anchor = s.inDive ? this.anchor : 0;
    const ceil = ceilingDepth(s.tissues, anchor, p);
    const inDeco = ceil > 0;
    const plan = planAscent(s.tissues, depth, s.gas, p, anchor, 1 / 6);
    const n = inDeco ? 0 : ndl(s.tissues, depth, s.gas, p.gfHigh);
    const first = plan.stops[0];
    const rate = s.ascentRate;
    const ascentLevel = s.inDive ? this.ascentLevel(rate, depth) : 0;
    const ceilingViolation: 0 | 1 | 2 = !inDeco || depth >= ceil ? 0 : depth >= ceil - this.ceilingMargin ? 1 : 2;

    const alarms: AlarmCode[] = [];
    if (this.locked) alarms.push('LOCKED');
    if (s.inDive) {
      if (this.ascentAlarm) alarms.push('ASCENT');
      else if (ascentLevel >= 1) alarms.push('ASCENT_WARN');
      if (ceilingViolation === 2) alarms.push('CEILING');
      if (s.ppO2 > 1.6) alarms.push('PPO2_HIGH');
      if (s.oxygen.cns >= 80) alarms.push('CNS');
      if (inDeco) alarms.push('DECO');
      else if (n <= 5 && depth > 3) alarms.push('NDL_LOW');
    }

    const gf99 = s.tissues.maxGradientPercent(s.pressure);
    const surfGf = s.tissues.maxGradientPercent(SURFACE_PRESSURE);
    const surfaceInterval = s.surfaceInterval;
    let noFly = 0;
    let desat = 0;
    if (!s.inDive && s.log.length > 0) {
      // No-fly: tissues must tolerate a 0.75 bar cabin with GF high, at least 12 h after diving.
      const sinceEnd = (surfaceInterval ?? 0) / 60;
      noFly = Math.max(timeToTolerate(s.tissues, 0.75, p.gfHigh), 12 * 60 - sinceEnd, 0);
      desat = desaturationTime(s.tissues);
    }
    const stopTimeSec = first ? Math.round(first.minutes * 60) : 0;
    const ai = this.airIntegrated(s);
    const sacBar = sacBarPerMin(s.rmv, s.tank.volume);
    if (s.inDive && s.outOfGas) alarms.push('OUT_OF_GAS');
    else if (s.inDive && ai && s.tankPressure < s.tank.reserve) alarms.push('LOW_GAS');

    return {
      inDive: s.inDive,
      depth,
      maxDepth: s.maxDepth,
      avgDepth: s.avgDepth,
      diveTime: s.diveTime,
      temperature: s.temperature,
      gas: gasLabel(s.gas),
      o2: Math.round(s.gas.o2 * 100),
      ppO2: s.ppO2,
      mod: Math.max(0, pressureToDepth(this.modPpo2 / s.gas.o2)),
      cns: s.oxygen.cns,
      otu: s.oxygen.otu,
      gfLow: Math.round(p.gfLow * 100),
      gfHigh: Math.round(p.gfHigh * 100),
      ndl: n,
      inDeco,
      plan,
      stopDepth: first ? first.depth : 0,
      stopTime: Math.ceil(stopTimeSec / 60),
      stopTimeSec,
      atStop: !!first && depth >= first.depth - 0.1 && depth <= first.depth + this.stopWindow,
      tts: plan.tts,
      ceiling: ceil,
      ceilingViolation,
      gf99: Math.max(0, gf99),
      surfGf: Math.max(0, surfGf),
      n2Load: Math.max(0, (surfGf / p.gfHigh)),
      ascentRate: rate,
      ascentLevel,
      safety: { state: s.inDive && depth > 1 ? this.safetyState : 'none', remaining: this.safetyRemaining, total: this.safetyTotal },
      alarms,
      surfaceInterval,
      noFly,
      desat,
      diveNumber: s.diveNumber,
      locked: this.locked,
      tank: {
        pressure: s.tankPressure,
        fill: s.tank.fill,
        reserve: s.tank.reserve,
        ai,
        sacBar,
        gasTime: ai && s.inDive && !s.outOfGas ? this.gasTime(s, p, sacBar) : null,
      },
    };
  }

  /** Renders the screen into `el`. Buttons carry `data-btn` attributes. */
  abstract render(el: HTMLElement, v: ComputerView, s: DiveSession, lang: Lang): void;

  /** Short summary for the comparison table. */
  summary(v: ComputerView): { ndl: string; stop: string; tts: string } {
    if (v.locked) return { ndl: '🔒', stop: '🔒', tts: '🔒' };
    return {
      ndl: v.inDeco ? '—' : String(v.ndl),
      stop: v.inDeco ? `${depthInt(v.stopDepth)} ${depthUnit()} · ${v.stopTime}'` : '—',
      tts: String(v.tts),
    };
  }
}

/** Time until every compartment is within 0.05 bar of surface equilibrium. */
function desaturationTime(tissues: Tissues): number {
  const t = tissues.clone();
  const eq = (SURFACE_PRESSURE - WATER_VAPOUR) * 0.79;
  const done = () => {
    for (let i = 0; i < COMPARTMENTS; i++) if (t.n2[i] - eq > 0.05 || t.he[i] > 0.05) return false;
    return true;
  };
  let m = 0;
  while (!done() && m < 72 * 60) {
    t.expose(SURFACE_PRESSURE, AIR, 10);
    m += 10;
  }
  return m;
}

// ---------------------------------------------------------------------------
// Formatting helpers shared by the screens.

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function hmm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Time of day of the simulated clock (dives start at 09:00 on day 1). */
export function clockOfDay(s: DiveSession): { h: number; m: number } {
  const t = (s.clock + 9 * 3600) % 86400;
  return { h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60) };
}

/** Depth as displayed by the computers, in the selected unit system. */
export function depthStr(d: number): string {
  return depthText(d);
}
