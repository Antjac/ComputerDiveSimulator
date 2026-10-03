import { ceilingDepth, depthToPressure, type DecoParams } from '../../../engine/buhlmann';
import { type DiveSession } from '../../../engine/session';
import { type AlertCue, ComputerView, DiveComputer, SettingDef } from '../../base';
import { divingDays, standardNoFly } from '../../common/dives';
import { surfGfAfter, ttsAfter } from '../../common/predict';
import { GasPrompt } from '../../common/gasSwitch';
import { DeepStop, FastAscentZhl, GasMessages, MissedStop, PRESETS, maresCues, maresWarningSettings, quadAscentLimit } from '../common';
import { ppo2Setting } from '../../common/ppo2';
import { pressureSetting } from '../../common/tank';

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
    fr: 'Bühlmann ZH-L16C non modifié avec gradient factors : reproduit (R0 85/85, R1 70/80, R3 50/60, T0 30/85 et T3 25/40 d’après le manuel, R2, T1 et T2 interpolés), personnalisation PHYSIO / DIVE / I TODAY, successives (−8 puis +1 par 15 min) et multi-jours (−2 par jour, max −6) en option. Vitesse maximale selon la profondeur (5 / 10 / 15 / 20 m/min, flèches de 20 % à gauche, SLOW DOWN!) ; plus de 120 % sur plus de 20 m ou palier manqué (< 1 m pendant 3 min, > 1 m pendant 1 min) = verrouillage 48 h. BACK TO STOP DEPTH à 0,3 m au-dessus du palier ; RUNAWAY DECO ; CNS > 75 % ; TANK RESERVE REACHED ; LOW TANK PRESSURE (TTR < TTS). Boutons : profil (2e), champ en bas à droite (3e), champ en haut à droite (4e), graphique des tissus (4e long). Multigaz (§11) : jusqu’à 3 gaz G1 à G3 (bloc principal puis gaz de déco de la page) ; au MOD d’un gaz plus riche pendant la remontée, bip et SWITCH TO GAS G2 (boutons NO / OK / OK, 30 s), puis GAS SWITCH OK, ou GAS NOT SWITCHED et EXCLUDING GAS G2 avec PREDICTIVE (par défaut) ; bouton 3 long : écran de changement de gaz (fig. 35 : ◀ sortie, ⇕ défilement, ✓ activation, gaz trop riches pour la profondeur en gris) ; ppO2max des gaz de déco 1,60 bar (fig. 33). ALLOW SWITCH BELOW MOD, annoncé pour une future mise à jour, n’est pas simulé. Non simulés : boussole, menu sous l’eau, cartes, liste des paliers, GF alternatifs, CEIL-CON, RGT, mode nuit, niveau des batteries (valeur fictive). Émetteur : HALF TANK à la pression MID TANK WARNING (100 bar par défaut ; libellé repris du Quad Ci, non vérifié) et TANK RESERVE REACHED (50 bar par défaut), jusqu’à l’appui sur un bouton. Avertissements du §2.4 : MAX DEPTH REACHED, TURN AROUND / TIME LIMIT (désactivés par défaut), NO STOP 2 min et entrée en déco (activés supposé ; textes non donnés : « NO STOP 2 MIN » et « ENTERING DECO » déduits).',
    en: 'Unmodified Bühlmann ZH-L16C with gradient factors: reproduced (R0 85/85, R1 70/80, R3 50/60, T0 30/85 and T3 25/40 from the manual, R2, T1 and T2 interpolated), PHYSIO / DIVE / I TODAY personalization, optional repetitive dive (−8 then +1 per 15 min) and multiday (−2 per day, max −6) conservatism. Depth-dependent maximum ascent rate (5 / 10 / 15 / 20 m/min, 20 % arrows on the left, SLOW DOWN!); more than 120 % over more than 20 m or a missed stop (< 1 m for 3 min, > 1 m for 1 min) = 48 h lock. BACK TO STOP DEPTH 0.3 m above the stop; RUNAWAY DECO; CNS > 75%; TANK RESERVE REACHED; LOW TANK PRESSURE (TTR < TTS). Buttons: profile (2nd), bottom-right field (3rd), top-right field (4th), tissue graph (4th hold). Multigas (§11): up to 3 gases G1 to G3 (the main tank, then the deco gases set on the page); at the MOD of a richer gas during the ascent, a beep and SWITCH TO GAS G2 (buttons NO / OK / OK, 30 s), then GAS SWITCH OK, or GAS NOT SWITCHED and EXCLUDING GAS G2 with PREDICTIVE (default); button 3 hold: gas switch screen (fig. 35: ◀ exit, ⇕ scroll, ✓ activate, gases too rich for the depth in grey); ppO2max of the deco gases 1.60 bar (fig. 33). ALLOW SWITCH BELOW MOD, announced for a future update, is not simulated. Not simulated: compass, underwater menu, maps, list of stops, alternate GF, CEIL-CON, RGT, night mode, battery levels (fictitious value). Transmitter: HALF TANK at the MID TANK WARNING pressure (100 bar by default; wording taken from the Quad Ci, not verified) and TANK RESERVE REACHED (50 bar by default), until a button is pressed. §2.4 warnings: MAX DEPTH REACHED, TURN AROUND / TIME LIMIT (off by default), NO STOP 2 min and entering deco (on assumed; texts not given: "NO STOP 2 MIN" and "ENTERING DECO" deduced).',
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
    {
      // §4 ALL SILENT MODE turns the audible alarms off (off by default, assumed).
      key: 'silent',
      label: { fr: 'Silence (ALL SILENT)', en: 'All silent' },
      options: [{ value: 'on', label: { fr: 'Activé', en: 'On' } }, { value: 'off', label: { fr: 'Désactivé', en: 'Off' } }],
      default: 'off',
    },
    // Manual: ppO2max 1.4 bar from the factory, up to 1.6 bar (from 1.2, step 0.1: assumed as on the other Mares).
    ppo2Setting(1.2, 1.6, 1.4, 'ppO2max'),
    {
      // §11.1 / fig. 33: each gas has its own ppO2max (G2 "ppO2 max 1.60 bar" in the figure).
      key: 'ppo2Deco',
      label: { fr: 'ppO2max G2 / G3', en: 'ppO2max G2 / G3' },
      options: [1.2, 1.3, 1.4, 1.5, 1.6].map((v) => ({ value: v.toFixed(2), label: `${v.toFixed(1)} bar` })),
      default: '1.60',
      group: 'deco',
    },
    {
      // §2.5.1 PREDICTIVE: "When set to ON, Genius will consider all gases in the decompression
      // calculation, with switches carried out at the MOD of each gas. [...] The default value is ON."
      key: 'predictive',
      label: { fr: 'Multigaz PREDICTIVE', en: 'PREDICTIVE multigas' },
      options: [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }],
      default: 'on',
      group: 'deco',
    },
    // §2.3 GAS INTEGRATION: "MID TANK WARNING, is the value at which Genius triggers a half tank warning
    // [...] Default values are 100bar"; "TANK RESERVE, is the value at which an alarm is triggered [...]
    // Default values are 50bar". Ranges not given: 5 bar steps offered.
    pressureSetting('halfTank', { fr: 'Avertissement de demi-bloc (MID TANK WARNING)', en: 'Mid tank warning' }, 60, 200, 5, 100),
    pressureSetting('reserve', { fr: 'Réserve (TANK RESERVE)', en: 'Tank reserve' }, 20, 100, 5, 50),
    ...maresWarningSettings('NO STOP'),
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
  algoParams(s: DiveSession): DecoParams {
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
    return Math.max(0, Math.min(99, Math.floor((s.tankPressure - this.reservePressure()) / (sacBar * atm(s.depth)))));
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.fast.reset();
    this.missed.reset();
    this.violation = null;
    this.hadDeco = false;
    this.repetitive = this.lastView !== null && this.lastView.desat > 0;
    this.deep.reset();
    this.prompt.reset();
    this.gasMsgs.clear();
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

    // §11.2: SWITCH TO GAS G2 at its MOD during the ascent; "If you don't perform any action within 30
    // seconds, Genius shows GAS NOT SWITCHED"; back below its MOD: INCLUDING GAS G2 AGAIN.
    const { expired, included } = this.prompt.update(s, this.gasMods(s), 30);
    if (expired !== null) this.notSwitched(expired);
    if (included.length && this.settings.predictive !== 'off') this.gasMsgs.say(`INCLUDING GAS G${included[0] + 1} AGAIN`);

    // §2.9: deep stop at the depth where the 5th tissue (27 min) switches from ongassing to
    // offgassing, suggested as the no deco limit approaches (§9.1); 2 minutes, optional.
    this.deep.update(s, ceil, p, dt, this.settings.deepstop === 'on');
  }


  protected nitrox(s: DiveSession): boolean {
    return s.gas.o2 > 0.215 || this.knownGases(s).length > 1;
  }

  /** §11: up to three gases, G1 to G3. */
  get maxGases(): number {
    return 3;
  }
  /** §11.2: gas switch prompt (SWITCH TO GAS G2) and its messages. */
  protected prompt = new GasPrompt();
  protected gasMsgs = new GasMessages();

  /** ppO2max of G2 / G3: set per gas (fig. 33 shows 1.60 bar for G2); 1.2 to 1.6 bar offered. */
  decoPpo2(): number {
    return Number(this.settings.ppo2Deco) || 1.6;
  }

  /** §2.5.1 PREDICTIVE ON: all active gases at their MOD, except those excluded after a declined switch; OFF: the gas breathed. */
  planGases(s: DiveSession) {
    if (this.settings.predictive === 'off') return [];
    return super.planGases(s).filter((g) => !this.prompt.declined.has(s.allGases.indexOf(g.gas)));
  }

  /** MOD of each programmed gas, the switch depth of G2 and G3 (§11.1). */
  gasMods(s: DiveSession): number[] {
    return this.knownGases(s).map((g, i) => (i === 0 ? this.modDepth(g.o2) : this.decoMod(g.o2)));
  }

  /** Only G1 has a tank module here (fig. 35 shows "-" for a gas without one). */
  airIntegrated(s: DiveSession): boolean {
    return super.airIntegrated(s) && s.breathing === 0;
  }

  /** §11.2: GAS NOT SWITCHED, then with PREDICTIVE ON, EXCLUDING GAS G2 before the calculation drops it. */
  protected notSwitched(gas: number): void {
    this.gasMsgs.say('GAS NOT SWITCHED');
    if (this.settings.predictive !== 'off') this.gasMsgs.say(`EXCLUDING GAS G${gas + 1}`);
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

  /**
   * Audible alarms (instruction manual §5): fast ascent, MOD exceeded and missed deco stop sound while they last;
   * CNS 100 %: 5 s in one-minute intervals; CNS 75 %%, once. §4 ALL SILENT MODE turns the audible alarms off (off by default, assumed).
   */
  /** §2.3 MID TANK WARNING (bar): the half tank warning, and the limit of the blue / green and yellow ranges (§2.3.1). */
  halfTank(): number {
    return Number(this.settings.halfTank) || 100;
  }

  alertCues(v: ComputerView): AlertCue[] {
    if (this.prompt.offer !== null && this.settings.silent !== 'on' && v.inDive) {
      // §11.2: "Genius sounds an audible signal" with SWITCH TO GAS G2.
      return [...this.cues(v), { key: `switch-${this.prompt.offer}`, kind: 'beep', level: 'info', until: 'once' }];
    }
    return this.cues(v);
  }

  private cues(v: ComputerView): AlertCue[] {
    if (this.settings.silent === 'on' || !v.inDive) return [];
    const cues = maresCues(v);
    if (v.cns >= 75 && v.cns < 100) cues.push({ key: 'cns-75', kind: 'beep', level: 'info', until: 'once' });
    // TANK RESERVE alarm (with a tank module; "alarms are both visual and audible"). How it is
    // acknowledged is not given: a button press, as on the Quad Air, assumed.
    if (v.tank.ai && v.tank.pressure <= v.tank.reserve) cues.push({ key: 'reserve', kind: 'beep', level: 'warning', until: 'ack', every: 3 });
    // Half tank warning (§2.3): its sound is not described, a notice until a button is pressed assumed.
    else if (v.tank.ai && v.tank.pressure <= this.halfTank()) cues.push({ key: 'half', kind: 'beep', level: 'info', until: 'ack', every: 3 });
    return cues;
  }
}
