import { type DecoParams, ndl, SURFACE_PRESSURE } from '../../engine/buhlmann';
import type { DiveSession } from '../../engine/session';
import { remainingTime } from '../../engine/gas';
import { DiveComputer, SettingDef } from '../base';

// Perdix 2 Recreational manual, §8.2: Low 45/95, Med 40/85, High 35/75 (not editable in Rec mode).
export const GF_PRESETS: Record<string, [number, number]> = { low: [45, 95], med: [40, 85], high: [35, 75] };

/**
 * Shearwater Perdix 2, Nitrox Recreational mode.
 * Layout, colours and behaviours follow the Perdix 2 Recreational Modes operating instructions (Rev B).
 */
export abstract class PerdixRules extends DiveComputer {
  readonly id = 'shearwater';
  readonly name = 'Shearwater Perdix 2';
  readonly algorithm = 'Bühlmann ZHL-16C + GF';
  readonly exact = true;
  readonly transmitter = 'Swift';
  readonly gasTimeName = 'GTR';
  readonly notes = {
    fr: 'Mode Nitrox Recreational. Bouton droit (SELECT) : écrans d’info (MOD/MAX/PPO2, GF99/SurGF/CEIL, tissus, DET/Δ+5/@+5…) ; bouton gauche (MENU) : retour à l’écran principal (le menu de plongée n’est pas simulé). Aucun verrouillage en cas de palier manqué (conforme au manuel). Palier de sécurité ajouté dès 11 m et affiché dès lors (§6.1), décompte entre 2,4 et 7 m.',
    en: 'Nitrox Recreational mode. Right button (SELECT): info screens (MOD/MAX/PPO2, GF99/SurGF/CEIL, tissues, DET/Δ+5/@+5…); left button (MENU): back to the main screen (the dive menu is not simulated). No lock-out for missed stops (as per the manual). Safety stop added beyond 11 m and shown from then on (§6.1), counting down between 2.4 and 7 m.',
  };
  readonly settingDefs: SettingDef[] = [
    {
      key: 'gf',
      label: { fr: 'Conservatisme', en: 'Conservatism' },
      options: [
        { value: 'low', label: 'Low (45/95)' },
        { value: 'med', label: 'Med (40/85)' },
        { value: 'high', label: 'High (35/75)' },
      ],
      default: 'med',
    },
    {
      key: 'safety',
      label: { fr: 'Palier de sécurité', en: 'Safety stop' },
      options: [
        { value: '3', label: '3 min' }, { value: '4', label: '4 min' }, { value: '5', label: '5 min' },
        { value: 'adapt', label: 'Adapt' }, { value: 'off', label: 'Off' },
      ],
      default: '3',
    },
    {
      key: 'bottom',
      essential: true,
      label: { fr: 'Ligne du bas', en: 'Bottom row' },
      options: [
        { value: 't1gtr', label: 'T1 & GTR (AI)' },
        { value: 'tempclock', label: 'Temp & Time' },
        { value: 'maxtts', label: 'Max. / TTS' },
        { value: 'ppo2tts', label: 'PPO2 & CNS / TTS' },
      ],
      default: 't1gtr',
    },
  ];

  /** Adapt mode (§8.2): 5 min stop if the dive exceeded 30 m or the NDL fell below 5 min. */
  protected adaptLong = false;

  constructor() {
    super();
    // §6.1: required beyond 11 m, countdown starts above 6 m, runs between 2.4 and 7.0 m,
    // resets if the depth exceeds 11 m again.
    this.safetyStop = { trigger: 11, start: 6, top: 2.4, bottom: 7.0, reset: 11 };
    this.stopWindow = 1.5; // §6.2: "at the stop depth or up to 1.5 m deeper"
    this.ceilingMargin = 0;
    this.screenTimeout = 10_000; // §4.6: info screens time out after 10 s (except tissues and AI)
    this.init();
  }

  baseParams(): DecoParams {
    const [lo, hi] = GF_PRESETS[this.settings.gf] ?? GF_PRESETS.med;
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: 3, stopStep: 3, ascentRate: 10 };
  }

  /** Each arrow is 3 m/min; yellow from 4 arrows (≈12 m/min), red at 6 (18+ m/min). */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate >= 18 ? 2 : rate >= 12 ? 1 : 0;
  }

  /**
   * Gas Time Remaining (Technical manual §9.7): minutes at the current depth until a direct ascent at
   * 10 m/min would surface with the reserve pressure. Safety and deco stops are not considered.
   */
  gasTime(s: DiveSession, _p: DecoParams, sacBar: number): number | null {
    return remainingTime({
      tissues: s.tissues, depth: s.depth, gas: s.gas, tankPressure: s.tankPressure, reserve: s.tank.reserve,
      sacBar, rate: () => 10, deco: null,
    });
  }

  safetySeconds(): number {
    const v = this.settings.safety;
    if (v === 'adapt') return this.adaptLong ? 300 : 180;
    return Number(v) * 60 || 180;
  }

  /** Deco stops were required during this dive (§6.2: "Complete" once cleared, safety stop off). */
  protected hadDeco = false;

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.adaptLong = false;
    this.hadDeco = false;
  }

  tick(s: DiveSession, dt: number): void {
    if (s.inDive) {
      const gfHigh = this.decoParams(s).gfHigh;
      // §8.2 Adapt: 5 min if the dive exceeds 30 m or the NDL falls below 5 minutes.
      if (!this.adaptLong && (s.depth > 30 || ndl(s.tissues, s.depth, s.gas, gfHigh) < 5)) this.adaptLong = true;
      if (!s.tissues.tolerates(SURFACE_PRESSURE, gfHigh)) this.hadDeco = true;
    }
    if (this.settings.safety === 'off') {
      // Keep the rest of the bookkeeping but never request a safety stop.
      super.tick(s, dt);
      this.safetyState = 'none';
      return;
    }
    super.tick(s, dt);
  }

}
