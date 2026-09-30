// Rules shared by the Aqua Lung i330R and i770R (both built on the same Pelagic firmware family; each
// rule below is stated identically in both owner's manuals unless noted): DTR, O2 SAT, safety and
// deep stops, conditional and delayed violations, Violation Gauge Mode, audible alarms.
import { type DecoParams, ceilingDepth } from '../../engine/buhlmann';
import type { DiveSession } from '../../engine/session';
import { type AlertCue, type ComputerView, DiveComputer, type SettingDef } from '../base';

const onOff = (on: string, off: string) => [{ value: 'on', label: { fr: on, en: 'ON' } }, { value: 'off', label: { fr: off, en: 'OFF' } }];

/** Settings common to both models (Set Alarms and Set Utilities menus). */
export function pelagicSettings(): SettingDef[] {
  const minutes = (from: number, to: number, step: number) => Array.from({ length: (to - from) / step + 1 }, (_, i) => String(from + i * step));
  return [
    {
      // "Safety Stop: ON, OFF, or SET"; SET: 3 or 5 min at 3, 4, 5 or 6 m. Default and the stop used by
      // ON are not given: ON = 3 min at 5 m assumed (the SET figures show 3 MIN, 15 FT).
      key: 'safety',
      label: { fr: 'Palier de sécurité', en: 'Safety stop' },
      options: [{ value: 'on', label: 'ON' }, { value: 'set', label: 'SET' }, { value: 'off', label: 'OFF' }],
      default: 'on',
    },
    {
      key: 'ssTime',
      label: { fr: 'Durée du palier (SET)', en: 'Stop time (SET)' },
      options: [{ value: '3', label: '3 min' }, { value: '5', label: '5 min' }],
      default: '3',
      showIf: (s) => s.safety === 'set',
    },
    {
      key: 'ssDepth',
      label: { fr: 'Profondeur du palier (SET)', en: 'Stop depth (SET)' },
      options: ['3', '4', '5', '6'].map((m) => ({ value: m, label: `${m} m` })),
      default: '5',
      showIf: (s) => s.safety === 'set',
    },
    // Deep Stop "can be set ON or OFF". Default not given: OFF assumed.
    { key: 'deepStop', label: { fr: 'Deep stop', en: 'Deep stop' }, options: onOff('ON', 'OFF'), default: 'off' },
    // Set Alarms. Defaults not given: audible ON, the others OFF assumed.
    { key: 'audible', label: { fr: 'Alarme sonore (AUDIBLE)', en: 'Audible alarm' }, options: onOff('ON', 'OFF'), default: 'on' },
    {
      key: 'depthAl',
      label: { fr: 'Alarme de profondeur (DEPTH)', en: 'Depth alarm' },
      options: [{ value: 'off', label: 'OFF' }, ...minutes(10, 100, 5).map((m) => ({ value: m, label: `${m} m` }))], // OFF or 10 - 100 m (step not given: 5 m offered)
      default: 'off',
    },
    {
      key: 'diveTAl',
      label: { fr: 'Alarme de durée (DIVE-T)', en: 'Dive time alarm' },
      options: [{ value: 'off', label: 'OFF' }, ...minutes(10, 180, 10).map((m) => ({ value: m, label: `${m} min` }))], // OFF, 10 - 180 min (step not given)
      default: 'off',
    },
    {
      key: 'n2Al',
      label: { fr: 'Alarme barre N2 (N2 BAR)', en: 'N2 bar alarm' },
      options: [{ value: 'off', label: 'OFF' }, ...['1', '2', '3', '4'].map((n) => ({ value: n, label: n }))], // OFF or 1 - 4 segments
      default: 'off',
    },
    {
      key: 'dtrAl',
      label: { fr: 'Alarme de temps restant (DTR)', en: 'DTR alarm' },
      options: [{ value: 'off', label: 'OFF' }, ...minutes(5, 20, 1).map((m) => ({ value: m, label: `${m} min` }))], // OFF, 5 - 20 min
      default: 'off',
    },
    {
      // Set Gas: "PO2 Alarm setting (1.10 - 1.60, intervals of 0.05)". Default for nitrox not given:
      // 1.40, as on the figures.
      key: 'ppo2',
      label: { fr: 'Alarme PO2 (et MOD)', en: 'PO2 alarm (and MOD)' },
      options: ['1.10', '1.15', '1.20', '1.25', '1.30', '1.35', '1.40', '1.45', '1.50', '1.55', '1.60'].map((v) => ({ value: v, label: v })),
      default: '1.40',
    },
  ];
}

/** An audible alarm: 1 beep per second for 10 seconds, silenced by a button; its message shows meanwhile. */
export type PelagicAlarm =
  | 'deco-entry' | 'down-to-stop' | 'violation' | 'too-deep' | 'too-fast' | 'high-po2' | 'o2-alarm' | 'o2-warning'
  | 'dtr' | 'n2bar' | 'depth' | 'dive-t' | 'turn' | 'end' | 'deco-deep';

const ALARM_ORDER: PelagicAlarm[] = ['violation', 'too-deep', 'down-to-stop', 'deco-entry', 'deco-deep', 'high-po2', 'o2-alarm', 'too-fast', 'o2-warning', 'end', 'turn', 'n2bar', 'dtr', 'depth', 'dive-t'];

/**
 * Pelagic-family rules. "Audible/Visual Alarm": 1 beep per second for 10 seconds when an alarm
 * strikes, acknowledged (silenced) by a button; the alarm message flashes during the audible alarm,
 * then the normal display returns.
 */
export abstract class PelagicRules extends DiveComputer {
  /** Button that acknowledges alarms (i330R: Down; i770R: Select). */
  abstract readonly ackButton: string;
  /** Ascent rate (m/min) above which the ASC alarm strikes (TOO FAST). */
  abstract readonly fastRate: number;

  // Per-dive state.
  protected alarmUntil = new Map<PelagicAlarm, number>(); // sim clock (s) until which the message shows
  protected alarmWas = new Set<PelagicAlarm>();
  /** Conditional Violation: seconds of penalty still to work off (1½ min per minute above the stop). */
  penaltySec = 0;
  /** Delayed Violation 1 (more than 5 min above a stop): Violation Gauge Mode after the dive. */
  dv1 = false;
  /** Safety stop cancelled for the rest of the dive (surfaced to 0.9 m). */
  protected ssCancelled = false;
  /** Deco happened during the dive: the safety stop comes back only after descending below 9 m again. */
  protected ssAfterDeco: 'none' | 'wait' | 'ok' = 'none';
  /** Deep stop (set ON): half the max depth, 2:00 countdown within 3 m of it. */
  deep: { state: 'none' | 'armed' | 'active' | 'done' | 'off'; target: number; remaining: number; outSec: number } = { state: 'none', target: 0, remaining: 120, outSec: 0 };

  constructor() {
    super();
    this.ceilingMargin = 0; // "Upon ascent above the required Decompression Stop depth" → Conditional Violation
    this.stopWindow = 3; // "within 3 m (10 ft) below the required Stop Depth (stop zone)"
    this.lockHours = 24; // Violation Gauge Mode "for 24 hours after surfacing"
  }

  // --- Safety stop ------------------------------------------------------------------------------

  /** Safety stop depth and time from the ON / SET settings (ON: 3 min at 5 m assumed). */
  ssDepth(): number {
    return this.settings.safety === 'set' ? Number(this.settings.ssDepth) : 5;
  }

  safetySeconds(): number {
    return (this.settings.safety === 'set' ? Number(this.settings.ssTime) : 3) * 60;
  }

  /**
   * "Upon ascent to within 1.5 m (5 ft) deeper than the Safety Stop depth ... on a No Decompression
   * dive in which Depth exceeded 9 m (30 ft)": countdown to 0:00; going 3 m deeper than the stop
   * (10 s) brings back the No Deco Main until the next ascent (countdown kept: not stated, assumed).
   */
  protected updateSafetyDef(): void {
    const d = this.ssDepth();
    this.safetyStop = { trigger: 9, start: d + 1.5, top: 0.9, bottom: d + 3, reset: 999 };
  }

  /** ASC bar graph alarm: "When the ascent is faster than the recommended 9 mpm (30 fpm)". */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate > this.fastRate ? 2 : 0;
  }

  // --- Oxygen --------------------------------------------------------------------------------------

  /** O2 SAT %: "The limit for O2 Saturation (100%) is set at 300 OTU per dive or 24 hour period." */
  o2Sat(s: DiveSession): number {
    return Math.min(999, (s.oxygen.otu / 300) * 100);
  }

  /** O2 TIME: minutes until O2 SAT reaches 100 % at the current PO2 (OTU rate of the NOAA formula). */
  o2Time(s: DiveSession): number {
    const p = s.ppO2;
    if (p <= 0.5) return 999;
    const rate = Math.pow((p - 0.5) / 0.5, 0.83);
    return Math.max(0, Math.floor((300 - s.oxygen.otu) / rate));
  }

  /** PO2 alarm set point; "except in Deco then at greater than 1.60". */
  po2Limit(inDeco: boolean): number {
    return inDeco ? 1.6 : Number(this.settings.ppo2) || 1.4;
  }

  // --- N2 bar graph --------------------------------------------------------------------------------

  /**
   * N2 bar graph segments (5): 1-3 normal, 4 caution, 5 = decompression. The controlling compartment's
   * loading is shown as the surfacing gradient factor relative to the one allowed (scale deduced).
   */
  n2Segments(v: ComputerView): number {
    if (v.inDeco) return 5;
    return Math.max(0, Math.min(4, Math.ceil((Math.min(100, v.n2Load) / 100) * 4 - 1e-9)));
  }

  // --- Alarms --------------------------------------------------------------------------------------

  /** Alarm conditions true now (each strikes when it newly occurs). */
  protected alarmConditions(s: DiveSession, v: ComputerView): PelagicAlarm[] {
    const a: PelagicAlarm[] = [];
    if (this.locked) a.push('violation');
    if (s.depth > 100) a.push('too-deep'); // DV3: "maximum functional depth (100 m)"
    if (v.inDeco && v.ceilingViolation > 0) a.push('down-to-stop');
    if (v.inDeco) a.push('deco-entry');
    if (v.inDeco && v.stopDepth >= 18 && v.stopDepth <= 21) a.push('deco-deep'); // DV2
    if (v.inDeco ? s.ppO2 > 1.6 : s.ppO2 >= this.po2Limit(false) - 1e-9) a.push('high-po2');
    const sat = this.o2Sat(s);
    if (sat >= 100) a.push('o2-alarm');
    else if (sat >= 80) a.push('o2-warning');
    if (this.ascentAlarm) a.push('too-fast');
    const n = this.settings;
    if (n.depthAl !== 'off' && s.depth >= Number(n.depthAl)) a.push('depth');
    if (n.diveTAl !== 'off' && s.diveTime >= Number(n.diveTAl) * 60) a.push('dive-t');
    if (n.n2Al !== 'off' && this.n2Segments(v) >= Number(n.n2Al)) a.push('n2bar');
    if (n.dtrAl !== 'off' && !v.inDeco && this.dtr(s, v).value <= Number(n.dtrAl)) a.push('dtr');
    return a;
  }

  /** The alarm whose message is showing (during its 10 s audible alarm, until acknowledged). */
  shownAlarm(s: DiveSession): PelagicAlarm | undefined {
    return ALARM_ORDER.find((k) => (this.alarmUntil.get(k) ?? -1) > s.clock);
  }

  protected updateAlarms(s: DiveSession, v: ComputerView): void {
    const now = new Set(this.alarmConditions(s, v));
    for (const k of now) if (!this.alarmWas.has(k)) this.alarmUntil.set(k, s.clock + 10);
    this.alarmWas = now;
  }

  /** "the audible alarm can be acknowledged and silenced by pressing the button". */
  protected acknowledge(s: DiveSession): boolean {
    const shown = this.shownAlarm(s);
    for (const k of this.alarmUntil.keys()) this.alarmUntil.set(k, -1);
    return shown !== undefined;
  }

  acknowledgeAlerts(id: string): boolean {
    return id === this.ackButton;
  }

  alertCues(v: ComputerView): AlertCue[] {
    if (this.settings.audible === 'off' || !v.inDive || !this.lastSession) return [];
    const k = this.shownAlarm(this.lastSession);
    // 1 beep per second for 10 seconds; the cue disappears once acknowledged (shownAlarm() is then empty).
    return k ? [{ key: `pelagic-${k}-${this.alarmUntil.get(k)}`, kind: 'beep', level: 'alarm', until: 'once', first: 10 }] : [];
  }

  protected lastSession: DiveSession | null = null;

  // --- Dive time remaining ------------------------------------------------------------------------

  /** DTR: the least of NO DECO and O2 TIME, 0 - 99 ("all times greater than 99 display as 99"). */
  dtr(s: DiveSession, v: ComputerView): { value: number; o2: boolean } {
    const o2 = this.o2Time(s);
    return o2 < v.ndl ? { value: Math.min(99, o2), o2: true } : { value: Math.min(99, v.ndl), o2: false };
  }

  // --- Dive bookkeeping ---------------------------------------------------------------------------

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.alarmUntil.clear();
    this.alarmWas.clear();
    this.penaltySec = 0;
    this.dv1 = false;
    this.ssCancelled = false;
    this.ssAfterDeco = 'none';
    this.deep = { state: this.settings.deepStop === 'on' ? 'none' : 'off', target: 0, remaining: 120, outSec: 0 };
  }

  /** DV1: "5 minutes after surfacing from the dive, operation will now enter Violation Gauge Mode" (at the end of the dive here). */
  onDiveEnd(s: DiveSession): void {
    super.onDiveEnd(s);
    if (this.dv1) this.lock(s);
  }

  tick(s: DiveSession, dt: number): void {
    this.lastSession = s;
    this.updateSafetyDef();
    super.tick(s, dt);
    if (!s.inDive) return;
    const p: DecoParams = this.decoParams(s);
    const ceil = ceilingDepth(s.tissues, this.anchor, p);
    const inDeco = ceil > 0 && !this.locked;
    const stop = inDeco ? this.violationDepth(ceil, p) : 0;

    // Violation Gauge Mode "when Decompression requires a Stop Depth greater than 21 m (70 ft)".
    if (inDeco && stop > 21) this.lock(s);
    // Conditional Violation: 1½ minutes of penalty for each minute above the stop; DV1 after 5 minutes.
    if (inDeco && s.depth < stop - 0.05) {
      this.penaltySec += 1.5 * dt;
      if (this.ceilingViolationSec > 300) this.dv1 = true;
    } else if (this.penaltySec > 0 && inDeco && s.depth <= stop + this.stopWindow) {
      this.penaltySec = Math.max(0, this.penaltySec - dt); // worked off at the stop before any credit
    } else if (!inDeco) {
      this.penaltySec = 0;
    }

    // Safety stop: off, cancelled at 0.9 m, and after deco only once below 9 m again.
    if (inDeco) this.ssAfterDeco = 'wait';
    else if (this.ssAfterDeco === 'wait' && s.depth > 9) this.ssAfterDeco = 'ok';
    if (this.safetyState !== 'none' && s.depth <= 0.9) this.ssCancelled = true;
    if (this.settings.safety === 'off' || this.ssCancelled || this.ssAfterDeco === 'wait' || this.locked) this.safetyState = 'none';

    this.tickDeepStop(s, dt, inDeco);
  }

  /**
   * Deep Stop (set ON): triggers deeper than 24 m, stop at half the max depth; on ascent within 3 m
   * below it, 2:00 countdown while within 3 m above or below; 10 s outside, or deco, deeper than 57 m,
   * O2 SAT ≥ 80 % or a high PO2 alarm, disable it for the dive. No penalty.
   */
  private tickDeepStop(s: DiveSession, dt: number, inDeco: boolean): void {
    const ds = this.deep;
    if (ds.state === 'off' || ds.state === 'done') return;
    if (inDeco || s.depth > 57 || this.o2Sat(s) >= 80 || s.ppO2 >= this.po2Limit(false)) {
      ds.state = 'off';
      return;
    }
    if (ds.state === 'none') {
      if (s.maxDepth > 24) ds.state = 'armed';
      else return;
    }
    if (ds.state === 'armed') {
      ds.target = s.maxDepth / 2;
      if (s.depth <= ds.target + 3) ds.state = 'active';
      return;
    }
    // active
    if (Math.abs(s.depth - ds.target) > 3) {
      ds.outSec += dt;
      if (ds.outSec >= 10) ds.state = 'off';
      return;
    }
    ds.outSec = 0;
    ds.remaining -= dt;
    if (ds.remaining <= 0) {
      ds.remaining = 0;
      ds.state = 'done';
    }
  }

  compute(s: DiveSession): ComputerView {
    let v = super.compute(s);
    if (this.locked) {
      // Violation Gauge Mode: "without any decompression or oxygen related calculations or displays".
      return { ...v, inDeco: false, ndl: 0, stopDepth: 0, stopTime: 0, stopTimeSec: 0, tts: 0, ceilingViolation: 0 };
    }
    // Conditional Violation: "no off gassing credit will be given" while above the stop.
    v = this.withPausedDeco(v);
    if (v.inDeco && this.penaltySec > 0) {
      const add = Math.ceil(this.penaltySec / 60);
      v = { ...v, stopTime: v.stopTime + add, stopTimeSec: v.stopTimeSec + Math.round(this.penaltySec), tts: v.tts + add };
    }
    if (s.inDive) this.updateAlarms(s, v);
    return v;
  }
}
