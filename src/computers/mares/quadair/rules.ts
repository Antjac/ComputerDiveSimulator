import { ceilingDepth, depthToPressure, type DecoParams } from '../../../engine/buhlmann';
import { type DiveSession } from '../../../engine/session';
import { type AlertCue, ComputerView, DiveComputer, SettingDef } from '../../base';
import { imperial } from '../../../units';
import { standardNoFly } from '../../common/dives';
import { ttsAfter } from '../../common/predict';
import { FastAscentRgbm, MissedStop, maresCues, maresRgbmParams } from '../common';


const atm = (d: number) => depthToPressure(d) / 1.01325;

/**
 * Mares Quad Air (manual rev. A 11/19, code 44201264). Segmented monochrome LCD: depth and a
 * selectable field on top, dive time and no deco / deco / safety stop in the middle, tank pressure
 * and a selectable field at the bottom, 10-segment nitrogen bar graph on the left (§3.3, figures of
 * §1.5 and §3.2–3.6). Mares RGBM (Wienke, 10 tissues, §4.1) is proprietary: approximated like the
 * Puck Pro (same algorithm), from the P factor.
 */
export abstract class QuadAirRules extends DiveComputer {
  readonly id = 'quadair';
  readonly name = 'Mares Quad Air';
  readonly algorithm = 'Mares RGBM (≈)';
  readonly exact = false;
  readonly transmitter = 'Tank module';
  readonly gasTimeName = 'TTR';
  readonly notes = {
    fr: 'Le RGBM Mares-Wienke (10 tissus) est propriétaire : approximation identique à celle du Puck Pro (Bühlmann + P0/P1/P2, pénalité en successives). Conforme au manuel : SLOW dès 10 m/min ; remontée incontrôlée (> 12 m/min au-delà de 12 m, sur les 2/3 de la profondeur) ou palier manqué (> 1 m pendant > 3 min) = profondimètre seul pendant 24 h ; ▼ et clignotement à plus de 0,3 m au-dessus du palier, désaturation arrêtée ; RUNAWAY DECO ; TTR, réserve (au moins 50 bar) et demi-bloc (100 bar) avec le module de bloc. Boutons du haut : champ en haut à droite ; du bas : champ en bas à droite ; appui long en haut : rétroéclairage. Après la plongée : deux pages alternées (4 s). Non simulés : deep stops (le manuel ne donne pas leur calcul), altitude, multigaz, menus de surface, planificateur, carnet.',
    en: 'Mares RGBM-Wienke (10 tissues) is proprietary: same approximation as the Puck Pro (Bühlmann + P0/P1/P2, repetitive-dive penalty). As per the manual: SLOW from 10 m/min; uncontrolled ascent (> 12 m/min deeper than 12 m, over 2/3 of the depth) or missed stop (> 1 m for > 3 min) = bottom timer only for 24 h; ▼ and blinking more than 0.3 m above the stop, desaturation halted; RUNAWAY DECO; TTR, reserve (at least 50 bar) and half tank (100 bar) with the tank module. Upper buttons: top-right field; lower buttons: bottom-right field; upper hold: backlight. After the dive: two alternating pages (4 s). Not simulated: deep stops (the manual does not give how they are computed), altitude, multigas, surface menus, planner, logbook.',
  };
  readonly settingDefs: SettingDef[] = [
    {
      // §2.2.1.11 tEMp: temperature in the top right or bottom right corner (top in the figures).
      key: 'temp',
      essential: true,
      label: { fr: 'Température', en: 'Temperature' },
      options: [{ value: 'top', label: { fr: 'En haut', en: 'Top' } }, { value: 'bottom', label: { fr: 'En bas', en: 'Bottom' } }],
      default: 'top',
    },
    {
      // §2.2.1.2 P FACt: standard P0, more conservative P1, P2.
      key: 'personal',
      label: { fr: 'Facteur P', en: 'P factor' },
      options: [{ value: 'P0', label: 'P0' }, { value: 'P1', label: 'P1' }, { value: 'P2', label: 'P2' }],
      default: 'P0',
    },
    {
      // §2.2.1.12 ASC 5: projected ascent time in the top right or bottom right corner (bottom: §3.3).
      key: 'asc5',
      label: { fr: 'ASC+5', en: 'ASC+5' },
      options: [{ value: 'bottom', label: { fr: 'En bas', en: 'Bottom' } }, { value: 'top', label: { fr: 'En haut', en: 'Top' } }],
      default: 'bottom',
    },
    {
      // §2.2.1.10 run AWAy dECO: OFF, 10, 15, 20 (10 in the §3.3.1 description).
      key: 'runaway',
      label: { fr: 'Runaway deco', en: 'Runaway deco' },
      options: [{ value: 'off', label: 'Off' }, { value: '10', label: '10' }, { value: '15', label: '15' }, { value: '20', label: '20' }],
      default: '10',
    },
    {
      // §2.2.1.7 FASt: the uncontrolled ascent lock can be turned off (instructors).
      key: 'fast',
      label: { fr: 'Verrou remontée', en: 'Fast ascent lock' },
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      default: 'on',
    },
    {
      // §2.2.1.8 ALRM turns the audible alarms off (on by default, assumed).
      key: 'alrm',
      label: { fr: 'Alarmes sonores (ALRM)', en: 'Audible alarms (ALRM)' },
      options: [{ value: 'on', label: { fr: 'Activé', en: 'On' } }, { value: 'off', label: { fr: 'Désactivé', en: 'Off' } }],
      default: 'on',
    },
  ];

  protected fast = new FastAscentRgbm();
  protected fastBlink = false;
  protected fastViolation = false;
  protected missed = new MissedStop('rgbm');
  protected decoViolation = false;
  /** Violation that locked the computer, shown until the lock ends (§3.2.1, §3.2.4.1). */
  protected lockCause: 'fast' | 'deco' | null = null;
  protected hadDeco = false;
  protected repetitive = false;
  /** Last dive needs the 24 h no-fly countdown (§3.4: deco and/or repetitive dives). */
  protected longNoFly = false;
  /** Depth where the current ascent started (speed shown after 0.8 m, §3.2.1). */
  protected ascentFrom = 0;
  protected lastView: ComputerView | null = null;

  constructor() {
    super();
    // §3.3: safety stop on dives deeper than 10 m, 3 minutes between 6 and 3 m.
    this.safetyStop = { trigger: 10, start: 6, top: 3, bottom: 6, reset: 10 };
    this.ceilingMargin = 0.3; // §3.2.4: ▼ and alarm more than 0.3 m above the stop
    this.lockAfter = null; // §3.2.4.1: handled in tick (1 m for 3 min)
    this.lockHours = 24; // §3.6.1: bottom timer only for 24 hours
    this.stopWindow = 1; // "optimal range" of the stop: width not given by the manual (as the Puck Pro)
    this.screenTimeout = 0;
    this.init();
  }

  baseParams(): DecoParams {
    return maresRgbmParams(this.settings.personal, null);
  }

  decoParams(s: DiveSession): DecoParams {
    return maresRgbmParams(this.settings.personal, s);
  }

  /** §3.2.1: SLOW from 10 m/min ("10 m/min or higher"). No pre-warning. */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate >= 10 ? 2 : 0;
  }

  /** §3.3: TTR, minutes at the current depth and breathing rate before the tank reserve. */
  gasTime(s: DiveSession, _p: DecoParams, sacBar: number): number | null {
    return Math.max(0, Math.min(99, Math.floor((s.tankPressure - s.tank.reserve) / (sacBar * atm(s.depth)))));
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.fast.reset();
    this.fastBlink = this.fastViolation = this.decoViolation = false;
    this.missed.reset();
    this.hadDeco = false;
    // §3.4: a dive started with remaining desaturation is a repetitive dive.
    this.repetitive = this.lastView !== null && this.lastView.desat > 0;
    this.ascentFrom = 0;
  }

  onDiveEnd(s: DiveSession): void {
    this.longNoFly = this.hadDeco || this.repetitive;
    // §3.6.1: after a violation, air and nitrox are restricted for 24 hours (bottom timer only).
    if (this.fastViolation || this.decoViolation) {
      this.lockCause = this.fastViolation ? 'fast' : 'deco';
      this.lock(s);
    }
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive) return;
    if (s.ascentRate <= 0.3) this.ascentFrom = s.depth;
    if (this.locked) return;

    // §3.2.1 / §2.2.1.7: faster than 12 m/min deeper than 12 m blinks the uncontrolled ascent icon;
    // kept for two thirds of the depth where it started, it is a dive violation.
    if (this.fast.update(s.ascentRate, s.depth) && this.settings.fast !== 'off') this.fastViolation = true;
    this.fastBlink = this.fast.active;

    // §3.2.4.1: more than 1 m above the stop for more than three minutes is a dive violation.
    const p = this.decoParams(s);
    const ceil = ceilingDepth(s.tissues, this.anchor, p);
    if (ceil > 0) {
      this.hadDeco = true;
      const stop = Math.max(p.lastStop, Math.ceil(ceil / p.stopStep - 1e-6) * p.stopStep);
      if (this.missed.update(stop - s.depth, dt)) this.decoViolation = true;
    } else {
      this.missed.reset();
    }
  }


  protected nitrox(s: DiveSession): boolean {
    return s.gas.o2 > 0.215;
  }

  protected asc5(v: ComputerView, s: DiveSession): number {
    return ttsAfter(s, v.depth, 5, this.decoParams(s), this.anchor);
  }

  protected hasPostDive(s: DiveSession): boolean {
    const v = this.lastView;
    return s.log.length > 0 && !!v && (v.desat > 0 || this.noFlyMin(v, s) > 0);
  }

  /** §3.4: standard 12 h (no-deco, non repetitive) or 24 h (deco and/or repetitive) countdown. */
  protected noFlyMin(_v: ComputerView, s: DiveSession): number {
    return standardNoFly(this.longNoFly, s);
  }

  /**
   * Audible alarms (instruction manual §3.2): fast ascent, MOD exceeded and missed deco stop sound while they last;
   * CNS 100 %: 5 s in one-minute intervals; half tank and reserve until a button is pressed. §2.2.1.8 ALRM turns the audible alarms off (on by default, assumed).
   */
  alertCues(v: ComputerView): AlertCue[] {
    if (this.settings.alrm === 'off' || !v.inDive) return [];
    const cues = maresCues(v);
    // §3.2.5 (with the tank module), until a button is pressed: TTR shorter than the ascent time in
    // deco, tank reserve (at least 50 bar), half tank (tANK WARN, 100 bar by default) — the same
    // thresholds as the screen.
    if (v.tank.ai) {
      const reserveAt = imperial() ? v.tank.reserve : Math.max(50, v.tank.reserve);
      const halfAt = imperial() ? 1500 / 14.5038 : 100;
      const ack = (key: string, level: AlertCue['level']) => cues.push({ key, kind: 'beep', level, until: 'ack', every: 3 });
      if (v.inDeco && v.diveTime > 120 && v.tank.gasTime !== null && v.tank.gasTime < v.tts) ack('ttr', 'alarm');
      if (v.tank.pressure <= reserveAt) ack('reserve', 'warning');
      else if (v.tank.pressure <= halfAt) ack('half', 'info');
    }
    return cues;
  }
}
