import { ceilingDepth, depthToPressure, ndl, pressureToDepth, type DecoParams } from '../../../engine/buhlmann';
import { type DiveSession } from '../../../engine/session';
import { type AlertCue, type ComputerView, DiveComputer, SettingDef } from '../../base';
import { FastAscentRgbm, MissedStop, maresCues, maresRgbmParams } from '../common';
import { ppo2Setting } from '../../common/ppo2';

/**
 * Mares Puck Pro. Display and rules follow the Puck Pro instruction manual (display information,
 * alarms, missed deco stop, uncontrolled ascent). Mares RGBM (Wienke) itself is proprietary: it is
 * approximated with Bühlmann + a repetitive-dive penalty.
 */
export abstract class PuckRules extends DiveComputer {
  readonly id = 'mares';
  readonly name = 'Mares Puck Pro';
  readonly algorithm = 'Mares RGBM (≈)';
  readonly exact = false;
  readonly notes = {
    fr: 'Le RGBM Mares est propriétaire : approximation (Bühlmann + P0/P1/P2, pénalité en successives). Affichage et règles conformes au manuel : alarme à 10 m/min, remontée incontrôlée (> 12 m/min) ou palier manqué > 3 min = mode profondimètre pour les plongées suivantes. Bouton : informations alternatives (profondeur moyenne, O2 % et CNS en nitrox, heure) ; appui long : rétroéclairage.',
    en: 'Mares RGBM is proprietary: approximation (Bühlmann + P0/P1/P2, repetitive-dive penalty). Display and rules as per the manual: alarm at 10 m/min, uncontrolled ascent (> 12 m/min) or missed stop > 3 min = bottom timer mode for the following dives. Button: alternate information (average depth, O2 % and CNS on nitrox, time of day); hold: backlight.',
  };
  readonly settingDefs: SettingDef[] = [
    {
      key: 'personal',
      label: { fr: 'Facteur P', en: 'P factor' },
      options: [{ value: 'P0', label: 'P0' }, { value: 'P1', label: 'P1' }, { value: 'P2', label: 'P2' }],
      default: 'P0',
    },
    {
      // §2.2.1.7 ALRM turns the audible alarms off (on by default, assumed).
      key: 'alrm',
      label: { fr: 'Alarmes sonores (ALRM)', en: 'Audible alarms (ALRM)' },
      options: [{ value: 'on', label: { fr: 'Activé', en: 'On' } }, { value: 'off', label: { fr: 'Désactivé', en: 'Off' } }],
      default: 'on',
    },
    // Manual §2.2: ppO2max 1.4 bar from the factory, adjustable between 1.2 and 1.6 bar (step not given: 0.1).
    ppo2Setting(1.2, 1.6, 1.4, 'ppO2max'),
  ];

  deepState: 'none' | 'pending' | 'active' | 'done' = 'none';
  deepRemaining = 120;
  deepTarget = 0;
  /** Depth where a >12 m/min ascent started (uncontrolled ascent detection). */
  protected fast = new FastAscentRgbm();
  protected fastViolation = false;
  protected missed = new MissedStop('rgbm');
  protected decoViolation = false;
  /** Violations behind the bottom timer mode, whose symbols stay on during the next dives (§3.2.1, §3.2.4.1). */
  protected lockedFast = false;
  protected lockedDeco = false;
  protected ndlTimer = 0;
  protected lastNdl = 99;

  constructor() {
    super();
    // Safety stop: dives deeper than 10 m, 3 minutes between 6 and 3 m.
    this.safetyStop = { trigger: 10, start: 6, top: 3, bottom: 6, reset: 10 };
    this.ceilingMargin = 0.3; // alarm when more than 0.3 m above the stop
    this.lockAfter = null; // handled below (1 m for 3 min)
    this.lockHours = 24;
    this.stopWindow = 1;
    this.screenTimeout = 0;
    this.init();
  }

  baseParams(): DecoParams {
    return maresRgbmParams(this.settings.personal, null);
  }

  decoParams(s: DiveSession): DecoParams {
    return maresRgbmParams(this.settings.personal, s);
  }

  /** Fast-ascent alarm from 10 m/min. */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate >= 10 ? 2 : rate >= 8 ? 1 : 0;
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.deepState = 'none';
    this.deepRemaining = 120;
    this.deepTarget = 0;
    this.fast.reset();
    this.fastViolation = false;
    this.missed.reset();
    this.decoViolation = false;
    this.screen = 0;
  }

  onDiveEnd(s: DiveSession): void {
    // After a violation, the following dives run in bottom timer mode only.
    if (this.fastViolation || this.decoViolation) {
      this.lock(s);
      this.lockedFast = this.fastViolation;
      this.lockedDeco = this.decoViolation;
    }
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive) return;

    // Uncontrolled ascent: > 12 m/min started deeper than 12 m and kept for 2/3 of that depth.
    if (this.fast.update(s.ascentRate, s.depth)) this.fastViolation = true;

    // Missed deco stop: more than 1 m above the stop for more than 3 minutes.
    const p = this.decoParams(s);
    const ceil = ceilingDepth(s.tissues, this.anchor, p);
    const inDeco = ceil > 0;
    const stopDepth = inDeco ? Math.max(p.lastStop, Math.ceil(ceil / p.stopStep - 1e-6) * p.stopStep) : 0;
    this.ndlTimer -= dt;
    if (this.ndlTimer <= 0) {
      this.ndlTimer = 10;
      this.lastNdl = inDeco ? 0 : ndl(s.tissues, s.depth, s.gas, p.gfHigh);
    }
    if (inDeco) {
      if (this.missed.update(stopDepth - s.depth, dt)) this.decoViolation = true;
    } else {
      this.missed.reset();
    }

    // Deep stop (not mandatory): generated when approaching the no-deco limit on dives deeper than 20 m.
    if (this.deepState === 'none' && s.maxDepth > 20 && (inDeco || this.lastNdl <= 10)) {
      // Half the absolute pressure of the maximum depth; below 10 m a deep stop makes no sense.
      this.deepTarget = Math.round(pressureToDepth(depthToPressure(s.maxDepth) / 2));
      this.deepState = this.deepTarget >= 10 ? 'pending' : 'done';
    }
    if (this.deepState === 'pending' || this.deepState === 'active') {
      if (Math.abs(s.depth - this.deepTarget) <= 1) {
        this.deepState = 'active';
        this.deepRemaining -= dt;
        if (this.deepRemaining <= 0) this.deepState = 'done';
      } else if (s.depth < this.deepTarget - 1) {
        this.deepState = 'done';
      } else if (this.deepState === 'active') {
        this.deepState = 'pending';
      }
    }
  }


  /**
   * Audible alarms (instruction manual §3.2): fast ascent, MOD exceeded and missed deco stop sound while they last;
   * CNS 100 %: 5 s in one-minute intervals. §2.2.1.7 ALRM turns the audible alarms off (on by default, assumed).
   */
  alertCues(v: ComputerView): AlertCue[] {
    if (this.settings.alrm === 'off' || !v.inDive) return [];
    const cues = maresCues(v);
    return cues;
  }
}
