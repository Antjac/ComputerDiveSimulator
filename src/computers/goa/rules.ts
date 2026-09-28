import { ceilingDepth, depthToPressure, ndl, pressureToDepth, type DecoParams } from '../../engine/buhlmann';
import type { DiveSession } from '../../engine/session';
import { type AlertCue, type ComputerView, DiveComputer, SettingDef, desaturationTime } from '../base';
import { ppo2Setting } from '../common/ppo2';


/** Approximate GF equivalent of each safety factor (Cressi RGBM is proprietary). */
export const SAFETY: Record<string, number> = { SF0: 0.88, SF1: 0.82, SF2: 0.76 };

/**
 * Cressi Goa, AIR / NITROX modes. Display and rules follow the Goa / Cartesio user manual: ascent rate
 * dots (SLOW from 12 m/min), safety stop between 5 and 3 m, deep stop, deco prewarning at 3 min,
 * omitted stop alarm then ERROR mode for 48 h, 12 / 24 / 48 h no-fly. Cressi RGBM itself is
 * proprietary: approximated with Bühlmann + safety factor + penalties.
 */
export abstract class GoaRules extends DiveComputer {
  readonly id = 'goa';
  readonly name = 'Cressi Goa';
  readonly algorithm = 'Cressi RGBM (≈)';
  readonly exact = false;
  readonly notes = {
    fr: 'Le RGBM Cressi (9 tissus) est propriétaire : approximation (Bühlmann + SF0/SF1/SF2, pénalité en successives et après des remontées rapides prolongées). Affichage et règles conformes au manuel : points de vitesse (SLOW dès 12 m/min), palier de sécurité 3 min entre 5 et 3 m, deep stop, pré-alarme de déco à 3 min, palier omis plus de 2 min = mode ERROR pendant 48 h, interdiction de vol 12 / 24 / 48 h. Boutons ▲ / ▼ : informations complémentaires (ppO2 max, mode, profondeur max, heure) ; ▲ long : rétroéclairage.',
    en: 'Cressi RGBM (9 tissues) is proprietary: approximation (Bühlmann + SF0/SF1/SF2, penalties for repetitive dives and prolonged fast ascents). Display and rules as per the manual: ascent rate dots (SLOW from 12 m/min), 3 min safety stop between 5 and 3 m, deep stop, deco prewarning at 3 min, stop omitted for more than 2 min = ERROR mode for 48 h, 12 / 24 / 48 h no-fly. ▲ / ▼ buttons: additional information (max ppO2, mode, max depth, time); ▲ hold: backlight.',
  };
  readonly settingDefs: SettingDef[] = [
    {
      key: 'sf',
      label: { fr: 'Facteur de sécurité', en: 'Safety factor' },
      options: [{ value: 'SF0', label: 'SF0' }, { value: 'SF1', label: 'SF1' }, { value: 'SF2', label: 'SF2' }],
      default: 'SF0',
    },
    {
      key: 'deepstop',
      label: { fr: 'Deep stop', en: 'Deep stop' },
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      default: 'on',
    },
    // Manual: PO2 set in the factory to 1.4 bar, adjustable from 1.2 to 1.6 bar.
    ppo2Setting(1.2, 1.6, 1.4, 'PO2 MAX'),
  ];

  protected deepState: 'none' | 'pending' | 'active' | 'done' = 'none';
  protected deepTarget = 0;
  protected deepRemaining = 60;
  protected missedSec = 0;
  protected fastSec = 0;
  protected hadDeco = false;
  protected repetitiveDive = false;
  protected desatUntil = -Infinity;
  /** Prolonged fast ascent on the last dive: the next dive during desaturation is more conservative. */
  protected penaltyUntil = -Infinity;
  protected penaltyActive = false;
  protected noFlyHours = 12;
  constructor() {
    super();
    // Safety stop after any dive to 10 m or more, 3 minutes between 5 and 3 m.
    this.safetyStop = { trigger: 10, start: 5.1, top: 3, bottom: 5.1, reset: 10 }; // 5 m, as displayed
    this.ceilingMargin = 0; // "rising above the depth specified by the computer": no margin
    this.lockAfter = null; // ERROR mode handled in tick
    this.lockHours = 48;
    this.stopWindow = 1;
    this.screenTimeout = 5000; // additional information, then back to the dive screen
    this.init();
  }

  baseParams(): DecoParams {
    const g = SAFETY[this.settings.sf] ?? SAFETY.SF0;
    return { gfLow: g - 0.1, gfHigh: g, lastStop: 3, stopStep: 3, ascentRate: 10 };
  }

  decoParams(s: DiveSession): DecoParams {
    const p = this.baseParams();
    let drop = 0;
    if (s.lastDiveEnd !== null) {
      const si = ((s.inDive ? s.diveStart : s.clock) - s.lastDiveEnd) / 60;
      drop += 0.08 * Math.exp(-si / 150);
    }
    if (this.penaltyActive) drop += 0.05;
    return { ...p, gfLow: p.gfLow - drop, gfHigh: p.gfHigh - drop };
  }

  /** Dots: 1 from 4 m/min, 2 from 8, 3 + SLOW from 12. */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate >= 12 ? 2 : rate >= 8 ? 1 : 0;
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.deepState = 'none';
    this.deepRemaining = 60;
    this.missedSec = 0;
    this.fastSec = 0;
    this.hadDeco = false;
    this.repetitiveDive = s.clock < this.desatUntil;
    this.penaltyActive = s.clock < this.penaltyUntil;
  }

  onDiveEnd(s: DiveSession): void {
    const desat = desaturationTime(s.tissues) * 60;
    this.desatUntil = s.clock + desat;
    // "If the maximum ascent rate of 12 m/min is exceeded for a prolonged period of time", the next
    // dive during the desaturation is more conservative. The duration is not given: 30 s assumed.
    this.penaltyUntil = this.fastSec > 30 ? s.clock + desat : -Infinity;
    this.noFlyHours = this.locked ? 48 : this.hadDeco || this.repetitiveDive ? 24 : 12;
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive || this.locked) return;
    if (s.ascentRate >= 12) this.fastSec += dt;

    const p = this.decoParams(s);
    const ceil = ceilingDepth(s.tissues, this.anchor, p);
    const inDeco = ceil > 0;
    if (inDeco) this.hadDeco = true;

    // Omitted stop (rising above the stop depth): 2 minutes to go back down, then ERROR mode for 48 hours.
    const stop = inDeco ? Math.max(p.lastStop, Math.ceil(ceil / p.stopStep - 1e-6) * p.stopStep) : 0;
    if (inDeco && s.depth < stop - 0.05) {
      this.missedSec += dt;
      if (this.missedSec > 120) this.lock(s);
    } else {
      this.missedSec = 0;
    }

    // Deep stop: suggested when the profile requires it (1 min, 2 min in a decompression dive).
    if (this.settings.deepstop === 'on' && this.deepState === 'none' && s.maxDepth > 20) {
      const near = inDeco || ndl(s.tissues, s.depth, s.gas, p.gfHigh) <= 10;
      if (near) {
        this.deepTarget = Math.round(pressureToDepth(depthToPressure(s.maxDepth) / 2));
        this.deepRemaining = inDeco ? 120 : 60;
        this.deepState = this.deepTarget >= 10 ? 'pending' : 'done';
      }
    }
    if (this.deepState === 'pending' || this.deepState === 'active') {
      if (Math.abs(s.depth - this.deepTarget) <= 1) {
        this.deepState = 'active';
        this.deepRemaining -= dt;
        if (this.deepRemaining <= 0) this.deepState = 'done';
      } else if (s.depth < this.deepTarget - 1) {
        this.deepState = 'done'; // skipped: the warning is deleted
      } else if (this.deepState === 'active') {
        this.deepState = 'pending';
      }
    }
  }


  /**
   * Acoustic alarms (instruction manual): SLOW (ascent over 12 m/min) while it lasts; NO DECO time
   * down to 3 minutes; leaving the safety curve (deco); PO2 limit depth exceeded, until back
   * shallower; CNS bar at 4 segments out of 5, i.e. above 60 % (temporary alarm), repeated at 100 %
   * until the PO2 drops below 0.6 (interval not given: every minute assumed); a skipped deco stop is
   * signalled by a continuous alarm. There is no setting to silence them (AL.SP only disables
   * the fast ascent alarm, for instructors).
   */
  alertCues(v: ComputerView): AlertCue[] {
    if (!v.inDive) return [];
    const cues: AlertCue[] = [];
    if (v.alarms.includes('ASCENT')) cues.push({ key: 'slow', kind: 'beep', level: 'alarm', until: 'clear', every: 2 });
    if (!v.inDeco && v.ndl <= 3) cues.push({ key: 'ndl-3', kind: 'beep', level: 'warning', until: 'once' });
    if (v.inDeco) cues.push({ key: 'deco', kind: 'beep', level: 'warning', until: 'once' });
    if (v.depth > v.mod) cues.push({ key: 'po2', kind: 'beep', level: 'alarm', until: 'clear', every: 2 });
    if (v.alarms.includes('CEILING')) cues.push({ key: 'missed-stop', kind: 'beep', level: 'alarm', until: 'clear', every: 1 });
    if (v.cns >= 100 && v.ppO2 >= 0.6) cues.push({ key: 'cns-100', kind: 'beep', level: 'warning', until: 'clear', every: 60 });
    else if (v.cns > 60) cues.push({ key: 'cns-4', kind: 'beep', level: 'info', until: 'once' });
    return cues;
  }
}
