// Rules shared by the Scubapro computers (G2, Luna 2.0 AI), from their manuals which describe them
// in the same terms: depth-dependent ideal ascent rate, microbubble (MB) levels, PDIS, SOS lock, RBT.
import { COMPARTMENTS, DecoParams, SURFACE_PRESSURE, ceilingDepth, equilibriumDepth, updateAnchor } from '../../engine/buhlmann';
import { remainingTime } from '../../engine/gas';
import type { DiveSession } from '../../engine/session';
import { ComputerView, DiveComputer, type SettingDef } from '../base';
import { pressureSetting } from '../common/tank';

/** Ideal ascent rate by depth (G2 manual §3.7, Luna 2.0 AI manual §3.10.1: same table), in m/min. */
export const IDEAL_ASCENT: [number, number][] = [
  [0, 3], [2.5, 5.5], [6, 7], [12, 7.7], [18, 8.2], [23, 8.6], [31, 8.9], [35, 9.1], [39, 9.4], [44, 9.6], [50, 9.8], [120, 10],
];

export function idealAscent(depth: number): number {
  let v = IDEAL_ASCENT[0][1];
  for (const [d, r] of IDEAL_ASCENT) if (depth >= d) v = r;
  return v;
}

/** Microbubble level → gradient factors (approximation; L0 ≈ ZH-L16 ADT). */
export function levelParams(level: number): DecoParams {
  return { gfLow: 0.98 - 0.06 * level, gfHigh: 0.98 - 0.04 * level, lastStop: 3, stopStep: 3, ascentRate: 10 };
}

/**
 * Tank reserve (G2 §2.8.2.1, Luna 2.0 AI §2.3.6): "from 20 to 120bar in 5-bar increments"; reaching it
 * triggers an alarm and it is the empty tank of the RBT. Default not given by the manuals (their figures
 * show 40 bar): 50 bar, as confirmed by the user.
 */
export const reserveSetting: SettingDef = pressureSetting('reserve', { fr: 'Réserve du bloc (Tank reserve)', en: 'Tank reserve' }, 20, 120, 5, 50);

export type PdisState = 'none' | 'shown' | 'active' | 'ok' | 'no';

/**
 * Scubapro rules. The decompression obligation (deco stops, MISSED DECO) follows the base algorithm;
 * a stricter "stage" chosen by the diver (MB level above L0, or on the Luna a GF other than 100/100)
 * adds stops that are not mandatory: ignoring them by more than 1.5 m relaxes the stage (MB level
 * reduced, GF increased).
 */
export abstract class ScubaproRules extends DiveComputer {
  activeLevel = 0;
  levelAnchor = 0;
  levelReducedAt = -1e9;
  pdisState: PdisState = 'none';
  pdisDepth = 0;
  pdisRemaining = 120;
  /** SOS lock: seconds spent above 0.8 m with a pending obligation. */
  protected sosSec = 0;

  /** Parameters of the extra stops of the chosen stage; null when there is none (L0, 100/100). */
  stageParams(): DecoParams | null {
    return this.activeLevel > 0 ? levelParams(this.activeLevel) : null;
  }

  /** The stage chosen before the dive (from the settings). */
  protected resetStage(): void {
    this.activeLevel = Number(this.settings.level);
  }

  /** Stops of the stage ignored by more than 1.5 m: the MB level is reduced to the next possible one (Luna §3.9.16). */
  protected relaxStage(s: DiveSession): void {
    let l = this.activeLevel - 1;
    while (l > 0 && ceilingDepth(s.tissues, 0, levelParams(l)) > s.depth + 1.5) l--;
    this.activeLevel = l;
  }

  /** Pressure (bar) of the tank pressure / half tank warning, null when it is off. */
  tankWarnPressure(): number | null {
    return null;
  }

  /** PDIS is offered (setting on). */
  protected pdisEnabled(): boolean {
    return this.settings.pdis === 'on';
  }

  /**
   * RBT (G2 manual §2.8.3; Luna 2.0 AI §3.10.4, the reserve defining the empty tank): time at the current depth that still leaves enough gas for a safe ascent at the ideal ascent
   * rate, including decompression, reaching the surface with the tank reserve.
   */
  gasTime(s: DiveSession, p: DecoParams, sacBar: number): number | null {
    return remainingTime({
      tissues: s.tissues, depth: s.depth, gas: s.gas, tankPressure: s.tankPressure, reserve: this.reservePressure(),
      sacBar, rate: idealAscent, deco: p, anchor: this.anchor,
    });
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.resetStage();
    this.levelAnchor = 0;
    this.pdisState = 'none';
    this.pdisDepth = 0;
    this.pdisRemaining = 120;
    this.screen = 0;
    this.sosSec = 0;
  }

  /**
   * SOS mode (G2 manual §1.6, Luna 2.0 AI §3.11): above 0.8 m for more than 3 minutes without observing a mandatory decompression stop,
   * the computer locks for 24 hours (then dives in Gauge mode, no decompression information). The
   * dive closes after 3 minutes at the surface, so an obligation still pending then also locks.
   */
  onDiveEnd(s: DiveSession): void {
    super.onDiveEnd(s);
    if (this.sosSec > 0 && !s.tissues.tolerates(SURFACE_PRESSURE, this.decoParams(s).gfHigh)) this.lock(s);
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive) {
      this.resetStage();
      return;
    }
    if (s.depth < 0.8 && !s.tissues.tolerates(SURFACE_PRESSURE, this.decoParams(s).gfHigh)) {
      this.sosSec += dt;
      if (this.sosSec > 180) this.lock(s);
    } else {
      this.sosSec = 0;
    }
    const lp = this.stageParams();
    if (lp) {
      this.levelAnchor = updateAnchor(this.levelAnchor, s.tissues, lp);
      const lc = ceilingDepth(s.tissues, this.levelAnchor, lp);
      const deepestStop = lc > 0 ? Math.ceil(lc / 3 - 1e-6) * 3 : 0;
      if (deepestStop > 0 && s.depth < deepestStop - 1.5) {
        this.relaxStage(s);
        this.levelAnchor = 0;
        this.levelReducedAt = s.clock;
      }
    }
    this.tickPdis(s, dt);
  }

  /** PDIS (G2 manual, Luna 2.0 AI §3.15): 2-minute stop within 3 m above the depth where the leading compartment starts off-gassing. */
  protected tickPdis(s: DiveSession, dt: number): void {
    if (!this.pdisEnabled() || this.pdisState === 'ok' || this.pdisState === 'no') return;
    if (this.pdisState !== 'active') {
      const d = this.computePdis(s);
      this.pdisDepth = d;
      this.pdisState = d > 8 ? 'shown' : 'none';
    }
    if (this.pdisState === 'none') return;
    const d = this.pdisDepth;
    if (s.depth <= d && s.depth >= d - 3) {
      this.pdisState = 'active';
      this.pdisRemaining -= dt;
      if (this.pdisRemaining <= 0) this.pdisState = 'ok';
    } else if (s.depth > d + 0.5) {
      this.pdisState = 'shown';
      this.pdisRemaining = 120;
    } else if (s.depth < d - 3 && this.pdisState === 'active') {
      this.pdisState = 'no';
    }
  }

  protected computePdis(s: DiveSession): number {
    // The 4 fastest compartments are not considered.
    const g = s.tissues.gradientPercents(1.01325);
    let lead = 4;
    for (let i = 5; i < COMPARTMENTS; i++) if (g[i] > g[lead]) lead = i;
    const d = equilibriumDepth(s.tissues, lead, s.gas);
    return d > 8 && d < s.maxDepth ? Math.round(d) : 0;
  }

  /** Label of the active stage for the comparison table ("L3", "GF 30/70"…), or null. */
  protected stageLabel(): string | null {
    return this.activeLevel > 0 ? `L${this.activeLevel}` : null;
  }

  summary(v: ComputerView): { ndl: string; stop: string; tts: string } {
    const b = super.summary(v);
    const label = this.stageLabel();
    return label ? { ...b, ndl: `${b.ndl} (${label})` } : b;
  }
}
