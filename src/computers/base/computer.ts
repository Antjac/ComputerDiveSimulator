import { DecoParams, SURFACE_PRESSURE, ceilingDepth, gasLabel, firstStop, ndl, planAscent, pressureToDepth, timeToTolerate } from '../../engine/buhlmann';
import { sacBarPerMin } from '../../engine/gas';
import { DiveSession } from '../../engine/session';
import type { Lang } from '../../i18n';
import { depthInt, depthUnit } from '../../units';
import type { AlarmCode, AlertCue, ButtonHelp, ComputerView, SafetyState, SafetyStopDef, SettingDef } from './types';
import { desaturationTime } from './tissues';

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
  /** Metres above the stop (or ceiling, see violationRef) tolerated before the violation alarm. */
  ceilingMargin = 0.3;
  /**
   * What "above the stop" is measured against: the displayed stop depth (most manuals: "ascend above
   * the stop depth") or the continuous ceiling (Suunto's deco window).
   */
  violationRef: 'stop' | 'ceiling' = 'stop';
  /** Seconds beyond the margin before the algorithm locks (null = never locks). */
  lockAfter: number | null = null;
  lockHours = 24;
  /** Metres below a stop depth still considered "at the stop". */
  stopWindow = 1.5;
  /** ppO2 of the MOD: the model's "ppo2" setting (its own limits, from its manual), 1.4 bar otherwise. */
  get modPpo2(): number {
    const v = Number(this.settings.ppo2);
    return v > 0 ? v : 1.4;
  }

  /** Depth limit applied to the MOD on top of the ppO2 (e.g. the Perdix 2 Max. Depth); none by default. */
  modDepthLimit(): number {
    return Infinity;
  }

  /** MOD of a gas with oxygen fraction `o2` on this computer. */
  modDepth(o2: number): number {
    return Math.min(this.modDepthLimit(), Math.max(0, pressureToDepth(this.modPpo2 / o2)));
  }

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

  /** A device button was held down (long press). Returns true if the screen changed. */
  hold(_button: string, _s: DiveSession): boolean {
    return false;
  }

  /** Button functions during the dive, from the manual; keyed by `data-btn`. */
  buttons(): Record<string, ButtonHelp> {
    return {};
  }

  // Short on-screen messages (bookmark set, timer started...) and backlight, in real time.
  protected flashText = '';
  protected flashUntil = 0;
  backlightUntil = 0;

  protected flash(text: string, ms = 2500): void {
    this.flashText = text;
    this.flashUntil = performance.now() + ms;
  }

  protected flashMessage(): string | null {
    return performance.now() < this.flashUntil ? this.flashText : null;
  }

  get backlit(): boolean {
    return performance.now() < this.backlightUntil;
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
    // GF low anchor: the deepest first stop seen during the dive (kept once the diver is above it).
    this.anchor = Math.max(this.anchor, firstStop(s.tissues, s.depth, s.gas, p));

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
    if (ceil > 0 && s.depth < this.violationDepth(ceil, p) - Math.max(this.ceilingMargin, 0.05)) {
      this.ceilingViolationSec += dt;
      s.diveAlarms.add('CEILING');
      if (this.lockAfter !== null && this.ceilingViolationSec >= this.lockAfter) this.lock(s);
    } else {
      this.ceilingViolationSec = 0;
    }

    this.tickSafetyStop(s, dt, ceil > 0);
  }

  /** Depth the diver must stay below: the stop the ceiling rounds up to, or the ceiling itself. */
  protected violationDepth(ceil: number, p: DecoParams): number {
    if (this.violationRef === 'ceiling' || ceil <= 0) return ceil;
    return Math.max(p.lastStop, Math.ceil(ceil / p.stopStep - 1e-6) * p.stopStep);
  }

  private pausedDeco: Pick<ComputerView, 'ceiling' | 'stopTimeSec' | 'stopTime' | 'tts'> | null = null;

  /**
   * For models whose manual says the decompression calculation (or the desaturation) is halted while
   * the diver is beyond the violation margin: the ceiling, stop time and TTS stay frozen until the
   * diver is back below it.
   */
  protected withPausedDeco(v: ComputerView): ComputerView {
    this.pausedDeco = v.inDive && v.ceilingViolation === 2
      ? this.pausedDeco ?? { ceiling: v.ceiling, stopTimeSec: v.stopTimeSec, stopTime: v.stopTime, tts: v.tts }
      : null;
    return this.pausedDeco ? { ...v, ...this.pausedDeco } : v;
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

  /** Buttons that acknowledge an alert (stop its repeats); null: any button. */
  ackButtons: string[] | null = null;

  /**
   * A button was pressed. Models that keep notifications until acknowledged dismiss them in press()
   * and return true here: their cues then disappear by themselves instead of being muted.
   */
  acknowledgeAlerts(_id: string): boolean {
    return false;
  }

  /** How the alerts sound on this model (and with its current settings): beeps, vibration or both. */
  get soundKind(): AlertCue['kind'] {
    return 'beep';
  }

  /** Sounds or vibrations of the alerts active in `v`, per the model's manual (none by default). */
  alertCues(_v: ComputerView): AlertCue[] {
    return [];
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
    const ref = this.violationDepth(ceil, p);
    const ceilingViolation: 0 | 1 | 2 = !inDeco || depth >= ref - 0.05 ? 0 : depth >= ref - this.ceilingMargin ? 1 : 2;

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
      mod: this.modDepth(s.gas.o2),
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
