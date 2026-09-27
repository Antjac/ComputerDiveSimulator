import { COMPARTMENTS, DecoParams, SURFACE_PRESSURE, ceilingDepth, equilibriumDepth, firstStop } from '../../engine/buhlmann';
import { remainingTime } from '../../engine/gas';
import type { DiveSession } from '../../engine/session';
import { ComputerView, DiveComputer, SettingDef } from '../base';

/** Ideal ascent rate by depth (G2 manual §3.7), in m/min. */
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

export type PdisState = 'none' | 'shown' | 'active' | 'ok' | 'no';

/**
 * Scubapro Galileo 2 (G2), Scuba mode. Screens and rules follow the G2 user manual: Light / Classic
 * screen configurations, pop-up warnings (yellow) and alarms (red), ideal ascent rate table, safety
 * stop timer, MB levels and PDIS. ZH-L16 ADT MB itself has unpublished adjustments: approximated.
 */
export abstract class G2Rules extends DiveComputer {
  readonly id = 'scubapro';
  readonly name = 'Scubapro G2';
  readonly algorithm = 'ZH-L16 ADT MB (≈)';
  readonly exact = false;
  readonly transmitter = 'Smart';
  readonly gasTimeName = 'RBT';
  readonly notes = {
    fr: 'ZH-L16 ADT MB a des ajustements non publiés : approximation. Affichage et règles conformes au manuel : écran Light (Classic automatique en déco), vitesse de remontée idéale selon la profondeur (jaune > 110 %, alarme > 140 %), niveaux MB (réduits si le palier est ignoré de plus de 1,5 m), PDIS. Bouton MORE : informations alternatives ; TIMER : repère (et relance du palier de sécurité) ; LIGHT : rétroéclairage. Boussole et écrans de profil non simulés.',
    en: 'ZH-L16 ADT MB has unpublished adjustments: approximation. Display and rules as per the manual: Light screen (Classic automatically in deco), depth-dependent ideal ascent rate (yellow > 110 %, alarm > 140 %), MB levels (reduced if a stop is ignored by more than 1.5 m), PDIS. MORE button: alternate information; TIMER: bookmark (and safety stop restart); LIGHT: backlight. Compass and profile displays are not simulated.',
  };
  readonly settingDefs: SettingDef[] = [
    {
      key: 'level',
      label: { fr: 'Niveau MB', en: 'MB level' },
      options: Array.from({ length: 10 }, (_, i) => ({ value: String(i), label: `L${i}` })),
      default: '0',
    },
    {
      key: 'pdis',
      label: { fr: 'PDIS', en: 'PDIS' },
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      default: 'on',
    },
    {
      key: 'screen',
      essential: true,
      label: { fr: 'Configuration écran', en: 'Screen configuration' },
      options: [
        { value: 'light', label: 'Light' },
        { value: 'classic', label: 'Classic' },
        { value: 'full', label: 'Full' },
        { value: 'graphical', label: 'Graphical' },
      ],
      default: 'light',
    },
  ];

  activeLevel = 0;
  levelAnchor = 0;
  levelReducedAt = -1e9;
  pdisState: PdisState = 'none';
  pdisDepth = 0;
  pdisRemaining = 120;

  constructor() {
    super();
    // Safety stop timer: after 10 m, starts at 5 m, disappears below 6.5 m and restarts at 5 m.
    this.safetyStop = { trigger: 10, start: 5, top: 2, bottom: 6.5, reset: 6.5 };
    this.ceilingMargin = 0.5; // MISSED DECO STOP when 0.5 m above the stop
    this.stopWindow = 1.5;
    this.screenTimeout = 0;
    this.init();
  }

  baseParams(): DecoParams {
    return levelParams(0);
  }

  /** Yellow above 110 % of the ideal rate, ASCENT TOO FAST above 140 %. */
  ascentLevel(rate: number, depth: number): 0 | 1 | 2 {
    const pct = rate / idealAscent(depth);
    return pct > 1.4 ? 2 : pct > 1.1 ? 1 : 0;
  }

  /**
   * RBT (manual §2.8.3): time at the current depth that still leaves enough gas for a safe ascent at the
   * ideal ascent rate, including decompression, reaching the surface with the tank reserve.
   */
  gasTime(s: DiveSession, p: DecoParams, sacBar: number): number | null {
    return remainingTime({
      tissues: s.tissues, depth: s.depth, gas: s.gas, tankPressure: s.tankPressure, reserve: s.tank.reserve,
      sacBar, rate: idealAscent, deco: p, anchor: this.anchor,
    });
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.activeLevel = Number(this.settings.level);
    this.levelAnchor = 0;
    this.pdisState = 'none';
    this.pdisDepth = 0;
    this.pdisRemaining = 120;
    this.screen = 0;
    this.sosSec = 0;
  }

  /**
   * SOS mode (manual §1.6): above 0.8 m for more than 3 minutes without observing a prescribed
   * decompression stop, the G2 locks for 24 hours (then dives in Gauge mode, no deco information).
   * The dive closes after 3 minutes at the surface, so an obligation still pending then also locks.
   */
  protected sosSec = 0;

  onDiveEnd(s: DiveSession): void {
    super.onDiveEnd(s);
    if (this.sosSec > 0 && !s.tissues.tolerates(SURFACE_PRESSURE, this.decoParams(s).gfHigh)) this.lock(s);
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive) {
      this.activeLevel = Number(this.settings.level);
      return;
    }
    if (s.depth < 0.8 && !s.tissues.tolerates(SURFACE_PRESSURE, this.decoParams(s).gfHigh)) {
      this.sosSec += dt;
      if (this.sosSec > 180) this.lock(s);
    } else {
      this.sosSec = 0;
    }
    if (this.activeLevel > 0) {
      const lp = levelParams(this.activeLevel);
      this.levelAnchor = Math.max(this.levelAnchor, firstStop(s.tissues, s.depth, s.gas, lp));
      const lc = ceilingDepth(s.tissues, this.levelAnchor, lp);
      const deepestStop = lc > 0 ? Math.ceil(lc / 3 - 1e-6) * 3 : 0;
      if (deepestStop > 0 && s.depth < deepestStop - 1.5) {
        // MB level reduced to the next possible level.
        let l = this.activeLevel - 1;
        while (l > 0 && ceilingDepth(s.tissues, 0, levelParams(l)) > s.depth + 1.5) l--;
        this.activeLevel = l;
        this.levelAnchor = 0;
        this.levelReducedAt = s.clock;
      }
    }
    this.tickPdis(s, dt);
  }

  /** PDIS: 2-minute stop within 3 m above the depth where the leading compartment starts off-gassing. */
  protected tickPdis(s: DiveSession, dt: number): void {
    if (this.settings.pdis !== 'on' || this.pdisState === 'ok' || this.pdisState === 'no') return;
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

  summary(v: ComputerView): { ndl: string; stop: string; tts: string } {
    const b = super.summary(v);
    return this.activeLevel > 0 ? { ...b, ndl: `${b.ndl} (L${this.activeLevel})` } : b;
  }

}
