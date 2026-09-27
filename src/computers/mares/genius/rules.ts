import { ceilingDepth, depthToPressure, type DecoParams } from '../../../engine/buhlmann';
import { type DiveSession } from '../../../engine/session';
import { ComputerView, DiveComputer, SettingDef } from '../../base';
import { divingDays, standardNoFly } from '../../common/dives';
import { surfGfAfter, ttsAfter } from '../../common/predict';
import { DeepStop, FastAscentZhl, MissedStop, PRESETS, quadAscentLimit } from '../common';

const atm = (d: number) => depthToPressure(d) / 1.01325;
const LEVELS = [{ value: 'off', label: 'OFF' }, { value: '1', label: 'LOW' }, { value: '2', label: 'MEDIUM' }, { value: '3', label: 'HIGH' }];

/**
 * Mares Genius (manual 07/26). Unmodified Bühlmann ZH-L16C with gradient factors (§2.2), reproduced:
 * GF sets R0–T3, personalization (PHYSIO, DIVE, I TODAY), repetitive dive and multiday conservatism,
 * depth-dependent ascent rates, missed stop and uncontrolled ascent lock (48 h). Colour TFT display
 * drawn after the manual's figures (§8.5, §9): blue depth band, green / orange / red middle band,
 * white bottom row, tank column on the right, nitrogen bar graph (or ascent arrows) on the left.
 */
export abstract class GeniusRules extends DiveComputer {
  readonly id = 'genius';
  readonly name = 'Mares Genius';
  readonly algorithm = 'ZH-L16C + GF';
  readonly exact = true;
  readonly transmitter = 'Tank module';
  readonly gasTimeName = 'TTR';
  readonly notes = {
    fr: 'Bühlmann ZH-L16C non modifié avec gradient factors : reproduit (R0 85/85, R1 70/80, R3 50/60, T0 30/85 et T3 25/40 d’après le manuel, R2, T1 et T2 interpolés), personnalisation PHYSIO / DIVE / I TODAY, successives (−8 puis +1 par 15 min) et multi-jours (−2 par jour, max −6) en option. Vitesse maximale selon la profondeur (5 / 10 / 15 / 20 m/min, flèches de 20 % à gauche, SLOW DOWN!) ; plus de 120 % sur plus de 20 m ou palier manqué (< 1 m pendant 3 min, > 1 m pendant 1 min) = verrouillage 48 h. BACK TO STOP DEPTH à 0,3 m au-dessus du palier ; RUNAWAY DECO ; CNS > 75 % ; TANK RESERVE REACHED ; LOW TANK PRESSURE (TTR < TTS). Boutons : profil (2e), champ en bas à droite (3e), champ en haut à droite (4e), graphique des tissus (4e long). Non simulés : boussole, menu sous l’eau, cartes, liste des paliers, GF alternatifs, CEIL-CON, multigaz, RGT, mode nuit, avertissements optionnels (profondeur, durée, NO STOP, entrée en déco), niveau des batteries (valeur fictive).',
    en: 'Unmodified Bühlmann ZH-L16C with gradient factors: reproduced (R0 85/85, R1 70/80, R3 50/60, T0 30/85 and T3 25/40 from the manual, R2, T1 and T2 interpolated), PHYSIO / DIVE / I TODAY personalization, optional repetitive dive (−8 then +1 per 15 min) and multiday (−2 per day, max −6) conservatism. Depth-dependent maximum ascent rate (5 / 10 / 15 / 20 m/min, 20 % arrows on the left, SLOW DOWN!); more than 120 % over more than 20 m or a missed stop (< 1 m for 3 min, > 1 m for 1 min) = 48 h lock. BACK TO STOP DEPTH 0.3 m above the stop; RUNAWAY DECO; CNS > 75%; TANK RESERVE REACHED; LOW TANK PRESSURE (TTR < TTS). Buttons: profile (2nd), bottom-right field (3rd), top-right field (4th), tissue graph (4th hold). Not simulated: compass, underwater menu, maps, list of stops, alternate GF, CEIL-CON, multigas, RGT, night mode, optional warnings (depth, time, NO STOP, entering deco), battery levels (fictitious value).',
  };
  readonly settingDefs: SettingDef[] = [
    {
      // §2.11 SECONDS: the dive time in minutes and seconds (figure of §2.11: "14:" and "16").
      key: 'seconds',
      essential: true,
      label: { fr: 'Secondes', en: 'Seconds' },
      options: [{ value: 'off', label: 'OFF' }, { value: 'on', label: 'ON' }],
      default: 'off',
    },
    {
      // §2.2.1 MAIN GF: R0 (85/85) by default.
      key: 'gf',
      label: { fr: 'Gradient factors', en: 'Gradient factors' },
      options: Object.entries(PRESETS).map(([k, [lo, hi]]) => ({ value: k, label: `${k} (${lo}/${hi})` })),
      default: 'R0',
    },
    {
      // §2.2.3 PHYSIO: −10 per step (LOW, MEDIUM, HIGH), ADVANCED +5. Default OFF.
      key: 'physio',
      label: { fr: 'PHYSIO', en: 'PHYSIO' },
      options: [...LEVELS, { value: 'adv', label: 'ADVANCED' }],
      default: 'off',
    },
    {
      // §2.2.3 DIVE: −3 per step. Default OFF.
      key: 'dive',
      label: { fr: 'DIVE', en: 'DIVE' },
      options: LEVELS,
      default: 'off',
    },
    {
      // §2.2.3 I TODAY: −5 per step. Default OFF.
      key: 'itoday',
      label: { fr: 'I TODAY', en: 'I TODAY' },
      options: LEVELS,
      default: 'off',
    },
    {
      // §2.2.4 REP DIVES: −8 on surfacing, +1 per 15 min. Default OFF.
      key: 'rep',
      label: { fr: 'Successives', en: 'Repetitive dives' },
      options: [{ value: 'off', label: 'OFF' }, { value: 'on', label: 'ON' }],
      default: 'off',
    },
    {
      // §2.2.5 MULTIDAY: −2 per day, up to −6. Default OFF.
      key: 'multiday',
      label: { fr: 'Multi-jours', en: 'Multiday' },
      options: [{ value: 'off', label: 'OFF' }, { value: 'on', label: 'ON' }],
      default: 'off',
    },
    {
      // §2.9 DEEP STOP: default OFF.
      key: 'deepstop',
      label: { fr: 'Deep stop', en: 'Deep stop' },
      options: [{ value: 'off', label: 'OFF' }, { value: 'on', label: 'ON' }],
      default: 'off',
    },
    {
      // §9.2 note: TTS @+X, X between 3 and 10 minutes (5 in the figures and the sequence of §9).
      key: 'ttsx',
      label: { fr: 'TTS @+X', en: 'TTS @+X' },
      options: [3, 4, 5, 6, 7, 8, 9, 10].map((x) => ({ value: String(x), label: `+${x}` })),
      default: '5',
    },
    {
      // §9.2 note: RUNAWAY DECO between 2 and 4 times X (×2 matches "10 minutes" with X = 5).
      key: 'runaway',
      label: { fr: 'Runaway deco', en: 'Runaway deco' },
      options: [2, 3, 4].map((k) => ({ value: String(k), label: `×${k}` })),
      default: '2',
    },
    {
      // §2.15 ASCENT VIOLATION: the uncontrolled ascent lock can be turned off (instructors).
      key: 'ascviol',
      label: { fr: 'Verrou remontée', en: 'Ascent violation' },
      options: [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }],
      default: 'on',
    },
  ];

  protected fast = new FastAscentZhl();
  protected missed = new MissedStop('zhl');
  protected violation: 'deco' | 'ascent' | null = null;
  protected hadDeco = false;
  protected repetitive = false;
  protected longNoFly = false;
  protected deep = new DeepStop();
  protected lastView: ComputerView | null = null;

  constructor() {
    super();
    // §9.1: safety stop on dives deeper than 10 m, 3 minutes between 6 and 3 m.
    this.safetyStop = { trigger: 10, start: 6, top: 3, bottom: 6, reset: 10 };
    this.ceilingMargin = 0.3; // §8.5.4: BACK TO STOP DEPTH more than 0.3 m above the stop
    this.lockAfter = null; // §8.5.4.2: handled in tick
    this.lockHours = 48; // §12.1
    this.stopWindow = 1; // not given by the manual (as the Quad Ci)
    this.screenTimeout = 0;
    this.init();
  }

  baseParams(): DecoParams {
    const [lo, hi] = PRESETS[this.settings.gf] ?? PRESETS.R0;
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: 3, stopStep: 3, ascentRate: 10 };
  }

  /** §2.2.3–2.2.5: personalization, repetitive dive and multiday reductions of the MAIN GF. */
  decoParams(s: DiveSession): DecoParams {
    const p = this.baseParams();
    const step = (k: string) => (this.settings[k] === 'off' ? 0 : Number(this.settings[k]) || 0);
    let drop = this.settings.physio === 'adv' ? -5 : 10 * step('physio');
    drop += 3 * step('dive') + 5 * step('itoday');
    if (this.settings.multiday === 'on') drop += Math.min(6, 2 * (divingDays(s) - 1));
    if (this.settings.rep === 'on' && s.lastDiveEnd !== null) {
      const si = ((s.inDive ? s.diveStart : s.clock) - s.lastDiveEnd) / 60;
      drop += Math.max(0, 8 - Math.floor(si / 15));
    }
    return { ...p, gfLow: Math.max(0.1, p.gfLow - drop / 100), gfHigh: Math.max(0.2, p.gfHigh - drop / 100) };
  }

  /** §8.5.1: SLOW DOWN! above the limit for the depth; each arrow is 20 % of it (§9). */
  ascentLevel(rate: number, depth: number): 0 | 1 | 2 {
    const lim = quadAscentLimit(depth);
    return rate > lim ? 2 : rate > lim * 0.8 ? 1 : 0;
  }

  /** §2.3: TTR, minutes before the tank reserve at the current depth and breathing rate. */
  gasTime(s: DiveSession, _p: DecoParams, sacBar: number): number | null {
    return Math.max(0, Math.min(99, Math.floor((s.tankPressure - s.tank.reserve) / (sacBar * atm(s.depth)))));
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.fast.reset();
    this.missed.reset();
    this.violation = null;
    this.hadDeco = false;
    this.repetitive = this.lastView !== null && this.lastView.desat > 0;
    this.deep.reset();
  }

  onDiveEnd(s: DiveSession): void {
    this.longNoFly = this.hadDeco || this.repetitive;
    // §12.1: after a violation, bottom timer only for 48 hours.
    if (this.violation) this.lock(s);
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive || this.locked) return;

    // §2.15: more than 120 % of the allowed rate over a depth change of more than 20 m.
    if (this.fast.update(s.ascentRate, s.depth) && this.settings.ascviol !== 'off') this.violation = this.violation ?? 'ascent';

    // §8.5.4.2: above the stop by less than 1 m for more than 3 min, or by more than 1 m for more than 1 min.
    const p = this.decoParams(s);
    const ceil = ceilingDepth(s.tissues, this.anchor, p);
    if (ceil > 0) {
      this.hadDeco = true;
      const stop = Math.max(p.lastStop, Math.ceil(ceil / p.stopStep - 1e-6) * p.stopStep);
      if (this.missed.update(stop - s.depth, dt)) this.violation = 'deco';
    } else {
      this.missed.reset();
    }

    // §2.9: deep stop at the depth where the 5th tissue (27 min) switches from ongassing to
    // offgassing, suggested as the no deco limit approaches (§9.1); 2 minutes, optional.
    this.deep.update(s, ceil, p, dt, this.settings.deepstop === 'on');
  }


  protected nitrox(s: DiveSession): boolean {
    return s.gas.o2 > 0.215;
  }

  protected ttsPlus(v: ComputerView, s: DiveSession, x: number): number {
    return ttsAfter(s, v.depth, x, this.decoParams(s), this.anchor);
  }

  protected gfAt3(v: ComputerView, s: DiveSession): number {
    return Math.round(surfGfAfter(s, v.depth, 3));
  }

  protected hasPostDive(s: DiveSession): boolean {
    const v = this.lastView;
    return s.log.length > 0 && !!v && (v.desat > 0 || this.noFlyMin(s) > 0);
  }

  /** §10: standard 12 h (no-deco, non repetitive) or 24 h (deco and repetitive) countdown. */
  protected noFlyMin(s: DiveSession): number {
    return standardNoFly(this.longNoFly, s);
  }
}
