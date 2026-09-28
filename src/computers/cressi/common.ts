// Rules shared by the Cressi computers (Goa, Donatello), whose manuals describe them in the same
// terms: Cressi RGBM with SF0/SF1/SF2, ascent rate dots (SLOW from 12 m/min), 3 min safety stop
// between 5 and 3 m, deep stop, deco prewarning at 3 min, omitted stop for more than 2 min = ERROR
// mode for 48 h, 12 / 24 / 48 h no-fly, penalty after prolonged fast ascents.
import { ceilingDepth, depthToPressure, ndl, pressureToDepth, type DecoParams } from '../../engine/buhlmann';
import type { DiveSession } from '../../engine/session';
import { type AlertCue, type ComputerView, DiveComputer, desaturationTime } from '../base';

/** Approximate GF equivalent of each safety factor (Cressi RGBM is proprietary). */
export const SAFETY: Record<string, number> = { SF0: 0.88, SF1: 0.82, SF2: 0.76 };

export abstract class CressiRules extends DiveComputer {
  readonly algorithm = 'Cressi RGBM (≈)';
  readonly exact = false;

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

  /** Number of ascent rate dots lit (0 below 4 m/min). */
  protected ascentDots(rate: number): number {
    return rate >= 12 ? 3 : rate >= 8 ? 2 : rate >= 4 ? 1 : 0;
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

  /** The fast ascent alarm sounds (the Donatello's AL.SP setting can silence it). */
  protected ascentSound(): boolean {
    return true;
  }

  /**
   * Acoustic alarms (instruction manuals): SLOW (ascent over 12 m/min) while it lasts; NO DECO time
   * down to 3 minutes; leaving the safety curve (deco); PO2 limit depth exceeded, until back
   * shallower; CNS bar at 4 segments out of 5, i.e. above 60 % (temporary alarm), repeated at 100 %
   * until the PO2 drops below 0.6 (interval not given: every minute assumed); a skipped deco stop is
   * signalled by a continuous alarm.
   */
  alertCues(v: ComputerView): AlertCue[] {
    if (!v.inDive) return [];
    const cues: AlertCue[] = [];
    if (v.alarms.includes('ASCENT') && this.ascentSound()) cues.push({ key: 'slow', kind: 'beep', level: 'alarm', until: 'clear', every: 2 });
    if (!v.inDeco && v.ndl <= 3) cues.push({ key: 'ndl-3', kind: 'beep', level: 'warning', until: 'once' });
    if (v.inDeco) cues.push({ key: 'deco', kind: 'beep', level: 'warning', until: 'once' });
    if (v.depth > v.mod) cues.push({ key: 'po2', kind: 'beep', level: 'alarm', until: 'clear', every: 2 });
    if (v.alarms.includes('CEILING')) cues.push({ key: 'missed-stop', kind: 'beep', level: 'alarm', until: 'clear', every: 1 });
    if (v.cns >= 100 && v.ppO2 >= 0.6) cues.push({ key: 'cns-100', kind: 'beep', level: 'warning', until: 'clear', every: 60 });
    else if (v.cns > 60) cues.push({ key: 'cns-4', kind: 'beep', level: 'info', until: 'once' });
    return cues;
  }
}
