import type { DecoParams } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import { depthToPressure } from '../../../engine/buhlmann';
import { type AlertCue, ComputerView, DiveComputer, SettingDef } from '../../base';
import { Notices } from '../../common/notices';
import { ppo2Setting } from '../../common/ppo2';

/** §4.1 warnings (acknowledged with any button), then notifications. */
export type D5Notice = 'cns-100' | 'tank-50' | 'gas-time' | 'safety-broken' | 'cns-80';

/** Approximate GF high equivalent for each personal setting (calibrated on published NDLs). */
export const PERSONAL: Record<string, number> = { '-2': 0.98, '-1': 0.93, '0': 0.88, '+1': 0.83, '+2': 0.78 };
export interface DeepStop {
  target: number;
  remaining: number;
  state: 'pending' | 'active' | 'done';
}

/**
 * Suunto D5, Air/Nitrox mode. Screens and rules follow the Suunto D5 user guide (display, alarms,
 * decompression window, algorithm lock, safety stops and deepstops). Fused RGBM 2 itself is
 * proprietary: it is approximated with Bühlmann + penalties.
 */
export abstract class D5Rules extends DiveComputer {
  readonly id = 'suunto';
  readonly name = 'Suunto D5';
  readonly algorithm = 'Suunto Fused RGBM 2 (≈)';
  readonly exact = false;
  readonly transmitter = 'Tank POD';
  readonly gasTimeName = 'gas time';
  readonly notes = {
    fr: 'Fused RGBM 2 est propriétaire : approximation (Bühlmann + réglage personnel, pénalités en successives et après remontée rapide). Affichage, deepstops, fenêtre de déco et verrouillage 48 h conformes au manuel. Bouton bas : fenêtre d’information (appui long : repère) ; bouton haut : chronomètre. Les vues du bouton central (boussole, pression) ne sont pas simulées. Alarmes (§4.1) : High pO2 en bandeau jaune ; avertissements (CNS 100 %, temps de gaz, palier de sécurité cassé, pression du bloc) et notification CNS 80 % en bandeau jusqu’à l’appui sur un bouton. Alarmes réglables (profondeur, durée, gaz, bloc) et OTU non simulées.',
    en: 'Fused RGBM 2 is proprietary: approximation (Bühlmann + personal setting, penalties for repetitive dives and fast ascents). Display, deepstops, deco window and 48 h lock as per the manual. Lower button: switch window (hold: bookmark); upper button: timer. The middle button views (compass, tank pressure) are not simulated. Alarms (§4.1): High pO2 as a yellow band; warnings (CNS 100 %, gas time, safety stop broken, tank pressure) and the CNS 80 % notification as a band until a button is pressed. Configurable alarms (depth, time, gas, tank) and OTU are not simulated.',
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
    {
      // User guide §4.1 and General > Device settings: tones and vibration can be turned on and off.
      // Default not given: both on assumed.
      key: 'alerts',
      label: { fr: 'Sons et vibrations', en: 'Tones and vibration' },
      options: [
        { value: 'both', label: { fr: 'Sons + vibrations', en: 'Tones + vibration' } },
        { value: 'tones', label: { fr: 'Sons', en: 'Tones' } },
        { value: 'vibration', label: { fr: 'Vibrations', en: 'Vibration' } },
        { value: 'off', label: { fr: 'Aucun', en: 'None' } },
      ],
      default: 'both',
    },
    // §4.18: pO2 setting 1.6 bar by default (1.4 recommended for nitrox); range not given, 1.0–1.6 assumed.
    ppo2Setting(1.0, 1.6, 1.6, 'pO2'),
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
    this.violationRef = 'ceiling';
    this.lockAfter = 180;
    this.lockHours = 48;
    this.stopWindow = 3; // deco window: ceiling to ceiling + 3 m
    this.ndlCap = 100; // §7.1: no decompression time "0 to 99 min (>99 above 99)"
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
    this.notices.clear();
  }

  /** §4.1: warnings then notifications, shown until a button is pressed (order within each: the table's). */
  protected notices = new Notices<D5Notice>(['cns-100', 'gas-time', 'safety-broken', 'tank-50', 'cns-80']);

  /** The screen dismisses the warning itself (any button), see press(). */
  acknowledgeAlerts(): boolean {
    return true;
  }

  private updateNotices(s: DiveSession): void {
    if (!s.inDive) return;
    const now: D5Notice[] = [];
    const cns = s.oxygen.cns;
    if (cns >= 100) now.push('cns-100');
    else if (cns >= 80) now.push('cns-80');
    const ai = this.airIntegrated(s);
    // Gas time is zero below 35 bar; the built-in tank pressure alarm is at 50 bar.
    if (ai && s.tankPressure < 35) now.push('gas-time');
    if (ai && s.tankPressure < 50) now.push('tank-50');
    // "Ceiling of the voluntary safety stop broken by more than 0.6 m": the stop is counted from
    // 2.4 m down, so shallower than 1.8 m before it is completed.
    const st = this.safetyState;
    if ((st === 'pending' || st === 'active' || st === 'paused') && s.depth < this.safetyStop.top - 0.6 && s.depth > 0.3) now.push('safety-broken');
    this.notices.update(now);
  }

  protected onAscentViolation(): void {
    this.violations += 1;
    this.ascentPenalty = Math.min(0.08, this.ascentPenalty + 0.02);
  }

  tick(s: DiveSession, dt: number): void {
    if (this.timerRunning) this.timerSec += dt;
    super.tick(s, dt);
    this.updateNotices(s);
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

  // User guide §3.2, §4.15.1, §4.32 and §5.12. Upper: timer start/pause (hold: reset). Middle: next
  // view (hold: gas menu). Lower: switch window (hold: bookmark, or bearing lock in compass view).
  protected timerSec = 0;
  protected timerRunning = false;

  summary(v: ComputerView): { ndl: string; stop: string; tts: string } {
    const b = super.summary(v);
    const extra = this.pendingDeepSeconds();
    return extra > 0 && !v.locked ? { ...b, tts: String(v.tts + Math.ceil(extra / 60)) } : b;
  }

  protected pendingDeepSeconds(): number {
    return this.deepstops.filter((d) => d.state !== 'done').reduce((a, d) => a + d.remaining, 0);
  }


  get soundKind(): AlertCue['kind'] {
    return this.settings.alerts === 'tones' ? 'beep' : this.settings.alerts === 'vibration' ? 'buzz' : 'both';
  }

  /**
   * §4.1: alarms, warnings and notifications come with an audible alarm (if tones are on) and a
   * vibration (if on). Alarms (ascent too fast, ceiling broken, pO2 > 1.6) stop by themselves once
   * the situation is back to normal; warnings (CNS 100 %, gas time at zero i.e. tank below 35 bar,
   * safety stop broken, tank pressure below the built-in 50 bar alarm) and notifications (CNS 80 %)
   * are acknowledged with any button. The configurable depth, dive time, gas time and tank alarms are
   * not simulated: the guide gives no default ("when the tank pressure alarm is turned on" suggests
   * they start off); OTU is not computed.
   */
  alertCues(v: ComputerView): AlertCue[] {
    const mode = this.settings.alerts;
    if (mode === 'off' || !v.inDive) return [];
    const kind: AlertCue['kind'] = mode === 'tones' ? 'beep' : mode === 'vibration' ? 'buzz' : 'both';
    const cues: AlertCue[] = [];
    const alarm = (key: string) => cues.push({ key, kind, level: 'alarm', until: 'clear', every: 3 });
    if (v.alarms.includes('ASCENT')) alarm('fast-ascent');
    if (v.alarms.includes('CEILING')) alarm('ceiling');
    if (v.ppO2 > 1.6) alarm('po2');
    // Warnings and notifications sound when they appear (once; they stay on screen until acknowledged).
    for (const key of this.notices.all) cues.push({ key, kind, level: key === 'cns-80' ? 'info' : 'warning', until: 'once' });
    return cues;
  }
}
