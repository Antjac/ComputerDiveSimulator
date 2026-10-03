import { ceilingDepth, depthToPressure, pressureToDepth, stopDepthFor, type DecoParams } from '../../../engine/buhlmann';
import { type DiveSession } from '../../../engine/session';
import { type AlertCue, ComputerView, DiveComputer, SettingDef, desaturationTime } from '../../base';
import { GasPrompt } from '../../common/gasSwitch';
import { divingDays } from '../../common/dives';
import { DeepStop, FastAscentZhl, GasMessages, MissedStop, PRESETS, maresCues, maresWarningSettings, quadAscentLimit } from '../common';
import { ppo2Setting } from '../../common/ppo2';
import { pressureSetting } from '../../common/tank';

const atm = (d: number) => depthToPressure(d) / 1.01325;

/**
 * Mares Quad Ci. Unmodified Bühlmann ZH-L16C with gradient factors (the model this simulator uses),
 * with the rules of the Quad Ci manual: depth-dependent ascent rate, multiday and optional
 * repetitive-dive conservatism, missed deco stop and uncontrolled ascent lock (48 h), TTR with the
 * LED tank module, E-Z / FULL / profile / tissue / stops screens. The E-Z layout and the look (white
 * figures on blue, "45:" minutes, button names printed on the case) follow footage of the device.
 */
export abstract class QuadCiRules extends DiveComputer {
  readonly id = 'quadci';
  readonly name = 'Mares Quad Ci';
  readonly algorithm = 'ZH-L16C + GF';
  readonly exact = true;
  readonly transmitter = 'LED Tank Module';
  readonly gasTimeName = 'TTR';
  readonly notes = {
    fr: 'Bühlmann ZH-L16C non modifié avec gradient factors : reproduit (R1, R2, T1, T2 interpolés, le manuel ne donnant que R0 85/85, R3 50/60, T0 30/85 et T3 25/40). Conservatisme multi-jours (−2 par jour, max −6) et, en option, en successives (−8 à la sortie, +1 par 15 min). Vitesse maximale selon la profondeur (5 / 10 / 15 / 20 m/min) ; plus de 120 % sur plus de 20 m = verrouillage 48 h ; palier manqué (§10.3.4.2) : passage aux GF alternatifs (ALT GF, R0 par défaut, jamais plus bas que les MAIN GF) avec MAIN GF > ALT GF, puis DECO VIOLATION! et verrouillage 48 h si la profondeur ne convient pas ou si le palier ALT GF est manqué à son tour ; BR long avec MAIN GF affiché : calculs MAIN et ALT côte à côte 10 s, TR active ALT GF (§11.6) ; dernier palier DECO STOP 3 / 4,5 / 6 m (§2.5 : avec PREDICTIVE, un gaz d’au moins 36 % et le changement fait, sinon 3 m ; 3 m par défaut supposé). TTR = temps jusqu’à la réserve. BL : écrans E-Z / FULL / profil / tissus / paliers ; TR / BR : champs du FULL ; TR long : rétroéclairage ; TL : chronomètre. Multigaz (§13) : jusqu’à 3 gaz G1 à G3 (gaz du bloc principal puis gaz de déco de la page), invite SWITCH TO G2 au MOD du gaz pendant la remontée (TR ou BR : GAS SWITCH OK ; TL ou BL ou 30 s : GAS NOT SWITCHED, puis EXCLUDING G2 si PREDICTIVE), tableau des gaz par BR long ; PREDICTIVE (calcul avec tous les gaz, par défaut) et SWITCH BELOW MOD réglables ; ppO2max des gaz de déco 1,6 bar supposé, 1,6 à 1,8 bar pour les gaz à 80 % d’O2 ou plus (§13.1). Boussole, menu sous l’eau et deep stops non simulés. Émetteur : HALF TANK (100 bar par défaut, désactivable) et TANK RESERVE (50 bar par défaut), jusqu’à l’appui sur un bouton. Avertissements du §3.2 : MAX DEPTH REACHED, TURN AROUND / TIME LIMIT (désactivés par défaut), GF @SURF clignotant (désactivé par défaut), NO DECO 2 min et entrée en déco (activés supposé ; textes non donnés : « NO DECO 2 MIN » et « ENTERING DECO » déduits).',
    en: 'Unmodified Bühlmann ZH-L16C with gradient factors: reproduced (R1, R2, T1, T2 interpolated, the manual only giving R0 85/85, R3 50/60, T0 30/85 and T3 25/40). Multiday conservatism (−2 per day, max −6) and, optionally, repetitive-dive conservatism (−8 on surfacing, +1 per 15 min). Depth-dependent maximum ascent rate (5 / 10 / 15 / 20 m/min); more than 120 % over more than 20 m = 48 h lock; missed stop (§10.3.4.2): switch to the alternate GF (ALT GF, R0 by default, never below the MAIN GF) with MAIN GF > ALT GF, then DECO VIOLATION! and a 48 h lock if the depth does not suit them or the ALT GF stop is missed in turn; BR hold with MAIN GF shown: MAIN and ALT calculations side by side for 10 s, TR activates ALT GF (§11.6); shallowest stop DECO STOP 3 / 4.5 / 6 m (§2.5: with PREDICTIVE, a gas of at least 36 % and the switch made, else 3 m; 3 m by default assumed). TTR = time to reserve. BL: E-Z / FULL / profile / tissue / stops screens; TR / BR: FULL fields; TR hold: backlight; TL: stopwatch. Multigas (§13): up to 3 gases G1 to G3 (the main tank gas, then the deco gases set on the page), SWITCH TO G2 prompt at the gas MOD during the ascent (TR or BR: GAS SWITCH OK; TL or BL or 30 s: GAS NOT SWITCHED, then EXCLUDING G2 with PREDICTIVE), gas table with a BR hold; PREDICTIVE (all gases in the calculation, by default) and SWITCH BELOW MOD settable; ppO2max of the deco gases 1.6 bar assumed, 1.6 to 1.8 bar for gases of 80 % O2 or more (§13.1). Compass, underwater menu and deep stops are not simulated. Transmitter: HALF TANK (100 bar by default, can be turned off) and TANK RESERVE (50 bar by default), until a button is pressed. §3.2 warnings: MAX DEPTH REACHED, TURN AROUND / TIME LIMIT (off by default), blinking GF @SURF (off by default), NO DECO 2 min and entering deco (on assumed; texts not given: "NO DECO 2 MIN" and "ENTERING DECO" deduced).',
  };
  readonly settingDefs: SettingDef[] = [
    {
      key: 'gf',
      label: { fr: 'Gradient factors', en: 'Gradient factors' },
      options: Object.entries(PRESETS).map(([k, [lo, hi]]) => ({ value: k, label: `${k} (${lo}/${hi})` })),
      default: 'R0',
    },
    {
      // §2.2.2 ALTERNATE GF: "an alternate set of gradient factors, to use when you need to cut your
      // decompression short in case of an emergency. The set of alternate gradient factors cannot be more
      // conservative (i.e. lower) than the main set of GF values. The default value is R0 (85/85)."
      key: 'altGf',
      label: { fr: 'GF alternatifs (ALT GF)', en: 'Alternate GF (ALT GF)' },
      options: Object.entries(PRESETS).map(([k, [lo, hi]]) => ({ value: k, label: `${k} (${lo}/${hi})` })),
      default: 'R0',
      group: 'deco',
    },
    {
      // §2.5 DECO STOP: "the depth of the shallowest stop among 3m/10ft, 4.5m/15ft and 6m/20ft"; active only
      // with PREDICTIVE ON, a gas of at least 36 % O2 and the gas switch carried out when prompted, else
      // 3 m. Default not given: 3 m assumed.
      key: 'decoStop',
      label: { fr: 'Dernier palier (DECO STOP)', en: 'Shallowest stop (DECO STOP)' },
      options: [
        { value: '3', label: { fr: '3 m / 10 ft', en: '3 m / 10 ft' } },
        { value: '4.5', label: { fr: '4,5 m / 15 ft', en: '4.5 m / 15 ft' } },
        { value: '6', label: { fr: '6 m / 20 ft', en: '6 m / 20 ft' } },
      ],
      default: '3',
      group: 'deco',
    },
    {
      key: 'display',
      essential: true,
      label: { fr: 'Écran de plongée', en: 'Dive screen' },
      options: [{ value: 'ez', label: 'E-Z' }, { value: 'full', label: 'FULL' }],
      default: 'ez',
    },
    {
      key: 'deepstop',
      label: { fr: 'Deep stop', en: 'Deep stop' },
      options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }],
      default: 'off',
    },
    {
      key: 'repetitive',
      label: { fr: 'Marge successives', en: 'Repetitive conserv.' }, // short: one line in the settings grid
      options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }],
      default: 'off',
    },
    {
      // §3.3 ALL SILENT turns the audible alarms off (off by default, assumed).
      key: 'silent',
      label: { fr: 'Silence (ALL SILENT)', en: 'All silent' },
      options: [{ value: 'on', label: { fr: 'Activé', en: 'On' } }, { value: 'off', label: { fr: 'Désactivé', en: 'Off' } }],
      default: 'off',
    },
    // Manual: ppO2max 1.4 bar from the factory, adjustable up to 1.6 bar (from 1.2, step 0.1: assumed as on the other Mares).
    ppo2Setting(1.2, 1.6, 1.4, 'ppO2max'),
    {
      // §13.1: each gas has its own ppO2max (§10.3.2: "from 1.2 to 1.6bar"). Value of G2 / G3 not given:
      // 1.6 bar assumed.
      key: 'ppo2Deco',
      label: { fr: 'ppO2max G2 / G3', en: 'ppO2max G2 / G3' },
      options: [1.2, 1.3, 1.4, 1.5, 1.6].map((v) => ({ value: v.toFixed(2), label: `${v.toFixed(1)} bar` })),
      default: '1.60',
      group: 'deco',
    },
    {
      // §13.1 NOTE: "When setting an oxygen concentration of 80% or higher, Quad Ci automatically sets the
      // ppO2max to 1.6 bar"; "For gases with oxygen concentration 80% or higher, the ppO2 can be set
      // between 1.6 bar and 1.8 bar."
      key: 'ppo2Rich',
      label: { fr: 'ppO2max des gaz ≥ 80 % O2', en: 'ppO2max of gases ≥ 80% O2' },
      options: [1.6, 1.7, 1.8].map((v) => ({ value: v.toFixed(2), label: `${v.toFixed(1)} bar` })),
      default: '1.60',
      group: 'deco',
    },
    {
      // §2.4.1 PREDICTIVE: "When set to ON, Quad Ci will consider all gases in the decompression
      // calculation, with switches carried out at the MOD of each gas. [...] The default value is ON."
      key: 'predictive',
      label: { fr: 'Multigaz PREDICTIVE', en: 'PREDICTIVE multigas' },
      options: [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }],
      default: 'on',
      group: 'deco',
    },
    {
      // §2.4.2 SWITCH BELOW MOD: "When set to ON, Quad Ci will allow a switch to a gas at a depth deeper
      // than the MOD of the gas (resulting in an immediate MOD alarm). The default value is ON."
      key: 'belowMod',
      label: { fr: 'Switch sous la MOD', en: 'Switch below MOD' },
      options: [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }],
      default: 'on',
      group: 'deco',
    },
    {
      // §3.2.5 HALF TANK: "This allows you to turn off the half tank warning described at 4.1" (on unless
      // turned off: ON assumed by default).
      key: 'halfWarn',
      label: { fr: 'Avertissement de demi-bloc (HALF TANK)', en: 'Half tank warning' },
      options: [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }],
      default: 'on',
    },
    // §4.1: "HALF TANK, is the value at which Quad Ci triggers a half tank warning [...] Default values are
    // 100bar"; "TANK RESERVE, is the value at which an alarm is triggered [...] Default values are 50bar".
    // Ranges not given: 5 bar steps offered.
    { ...pressureSetting('halfTank', { fr: 'Pression du demi-bloc (HALF TANK)', en: 'Half tank pressure' }, 60, 200, 5, 100), showIf: (s) => s.halfWarn !== 'off' },
    pressureSetting('reserve', { fr: 'Réserve (TANK RESERVE)', en: 'Tank reserve' }, 20, 100, 5, 50),
    ...maresWarningSettings('NO DECO'),
    {
      // §3.2.6 GF @SURF: "The value can be set between 50 and 250. The default setting is OFF." (step not given: 10).
      key: 'wGfSurf',
      label: { fr: 'Avertissement GF @SURF', en: 'GF @SURF warning' },
      options: [{ value: 'off', label: 'OFF' }, ...Array.from({ length: 21 }, (_, i) => ({ value: String(50 + i * 10), label: String(50 + i * 10) }))],
      default: 'off',
    },
  ];

  /** ALT GF switched on after a missed stop: MAIN GF > ALT GF shown until a button is pressed. */
  protected altBySystem = false;
  protected fast = new FastAscentZhl();
  protected missed = new MissedStop('zhl');
  protected violation: 'deco' | 'ascent' | null = null;
  protected hadDeco = false;
  protected repetitiveDive = false;
  /** Session clock until which the last dive still desaturates (repetitive dive detection). */
  protected desatUntil = -Infinity;
  /** The last dive needs the 24 h no-fly time (decompression or repetitive dive). */
  protected longNoFly = false;
  protected lastView: ComputerView | null = null;
  protected deep = new DeepStop();
  /** §13.2: gas switch prompt (SWITCH TO G2 / G3). */
  protected prompt = new GasPrompt();
  /** §13.2 messages shown briefly (GAS SWITCH OK, GAS NOT SWITCHED, EXCLUDING G2, INCLUDING G2 AGAIN). */
  protected gasMsgs = new GasMessages();

  /** §13: up to three gases, G1 to G3. */
  get maxGases(): number {
    return 3;
  }

  /** §13.1: ppO2max of G2 / G3 (1.6 bar at least from 80 % O2). */
  decoPpo2(): number {
    return Number(this.settings.ppo2Deco) || 1.6;
  }

  /** §13.1: gases of 80 % O2 or more have their own ppO2max, 1.6 to 1.8 bar (1.6 by default). */
  decoMod(o2: number): number {
    const ppo2 = o2 >= 0.8 - 1e-9 ? Number(this.settings.ppo2Rich) || 1.6 : this.decoPpo2();
    return Math.max(0, pressureToDepth(ppo2 / o2));
  }

  /**
   * §2.4.1 PREDICTIVE ON: all active gases, switched at their MOD, except those excluded after a
   * declined switch (§13.2 EXCLUDING G2); OFF: the gas breathed only.
   */
  planGases(s: DiveSession) {
    if (this.settings.predictive === 'off') return [];
    return super.planGases(s).filter((g) => !this.prompt.declined.has(s.allGases.indexOf(g.gas)));
  }

  /** §13 NOTE: a gas without a paired transmitter uses the dive display without tank pressure (only T1 has one here). */
  airIntegrated(s: DiveSession): boolean {
    return super.airIntegrated(s) && s.breathing === 0;
  }

  constructor() {
    super();
    // Safety stop: dives deeper than 10 m, 3 minutes between 6 and 3 m.
    this.safetyStop = { trigger: 10, start: 6, top: 3, bottom: 6, reset: 10 };
    this.ceilingMargin = 0.3; // DECO STOP! when 0.3 m above the stop
    this.lockAfter = null; // handled in tick
    this.lockHours = 48;
    this.stopWindow = 1;
    this.screenTimeout = 0;
    this.init();
  }

  baseParams(): DecoParams {
    const [lo, hi] = PRESETS[this.settings.gf] ?? PRESETS.R0;
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: 3, stopStep: 3, ascentRate: 10 };
  }

  /** ALT GF in use: switched by hand (§11.6) or after a missed stop (§10.3.4.2). */
  protected altActive = false;

  /**
   * §2.2.2: the alternate gradient factors, never lower than the main ones (each value taken at least
   * at the main one). The personalization, repetitive and multiday reductions only apply to the MAIN GF
   * (glossary, GF SET): not applied to them (assumed).
   */
  altParams(s: DiveSession): DecoParams {
    const main = this.mainParams(s);
    const [lo, hi] = PRESETS[this.settings.altGf] ?? PRESETS.R0;
    return { ...main, gfLow: Math.max(main.gfLow, lo / 100), gfHigh: Math.max(main.gfHigh, hi / 100) };
  }

  algoParams(s: DiveSession): DecoParams {
    return this.altActive ? this.altParams(s) : this.mainParams(s);
  }

  /**
   * §2.5 DECO STOP: the shallowest stop chosen applies when "predictive multigas is ON", "at least one
   * gas is set to an oxygen percentage of at least 36%" and "when prompted to do so, the gas switch is
   * carried out"; "If these conditions are not met, Quad Ci will recalculate the decompression with a
   * 3 m / 10 ft shallowest stop."
   */
  protected lastStop(s: DiveSession): number {
    const chosen = Number(this.settings.decoStop) || 3;
    const ok = this.settings.predictive !== 'off' && this.knownGases(s).some((g) => g.o2 >= 0.36 - 1e-9) && this.prompt.declined.size === 0;
    return ok ? chosen : 3;
  }

  /** MAIN GF with the personalization, repetitive and multiday reductions. */
  mainParams(s: DiveSession): DecoParams {
    const p = { ...this.baseParams(), lastStop: this.lastStop(s) };
    let drop = Math.min(6, 2 * (divingDays(s) - 1));
    if (this.settings.repetitive === 'on' && s.lastDiveEnd !== null) {
      const si = ((s.inDive ? s.diveStart : s.clock) - s.lastDiveEnd) / 60;
      drop += Math.max(0, 8 - Math.floor(si / 15));
    }
    return { ...p, gfLow: Math.max(0.1, p.gfLow - drop / 100), gfHigh: Math.max(0.2, p.gfHigh - drop / 100) };
  }

  /** SLOW! above the limit for the current depth, warning from 80 % of it. */
  ascentLevel(rate: number, depth: number): 0 | 1 | 2 {
    const lim = quadAscentLimit(depth);
    return rate > lim ? 2 : rate > lim * 0.8 ? 1 : 0;
  }

  /** TTR: minutes until the reserve at the current depth and breathing rate. */
  gasTime(s: DiveSession, _p: DecoParams, sacBar: number): number | null {
    return Math.max(0, Math.min(99, Math.floor((s.tankPressure - this.reservePressure()) / (sacBar * atm(s.depth)))));
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.fast.reset();
    this.missed.reset();
    this.violation = null;
    this.hadDeco = false;
    this.repetitiveDive = s.clock < this.desatUntil;
    this.deep.reset();
    this.prompt.reset();
    this.gasMsgs.clear();
    this.altActive = false;
  }

  /** §11.6: the diver activates the alternate gradient factors. */
  activateAlt(): void {
    this.altActive = true;
  }

  onDiveEnd(s: DiveSession): void {
    this.desatUntil = s.clock + desaturationTime(s.tissues) * 60;
    this.longNoFly = this.hadDeco || this.repetitiveDive;
    // Violations lock the computer after surfacing: bottom timer for 48 hours.
    if (this.violation) this.lock(s);
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive || this.locked) return;

    // Uncontrolled ascent: more than 120 % of the allowed rate over more than 20 m.
    if (this.fast.update(s.ascentRate, s.depth)) this.violation = this.violation ?? 'ascent';

    // Missed stop: above it by less than 1 m for more than 3 min, or by more than 1 m for more than 1 min.
    const p = this.decoParams(s);
    const ceil = ceilingDepth(s.tissues, this.anchor, p);
    if (ceil > 0) {
      this.hadDeco = true;
      const stop = stopDepthFor(ceil, p);
      if (this.missed.update(stop - s.depth, dt)) {
        // §10.3.4.2: "Quad Ci will automatically switch to the alternate gradient factors, display the
        // messagge MAIN GF > ALT GF, and, if compatible with the current depth, keep you out of a dive
        // violation" ("If the alternate gradient factors are not compatible with the current depth, Quad
        // Ci considers this a dive violation"). Compatible: no deeper than 0.3 m above the ALT GF stop
        // (the DECO STOP! margin, assumed); missing the ALT GF stop in turn is a violation.
        if (this.altActive) this.violation = 'deco';
        else {
          this.altActive = true;
          this.altBySystem = true;
          this.missed.reset();
          const ap = this.decoParams(s);
          const altStop = stopDepthFor(ceilingDepth(s.tissues, this.anchor, ap), ap);
          if (altStop > 0 && s.depth < altStop - 0.3) this.violation = 'deco';
        }
      }
    } else {
      this.missed.reset();
    }

    // §13.2: SWITCH TO G2 when reaching its MOD during the ascent; 30 s without an answer: GAS NOT
    // SWITCHED (and, PREDICTIVE ON, EXCLUDING G2); back below its MOD: INCLUDING G2 AGAIN.
    const known = this.knownGases(s);
    const { expired, included } = this.prompt.update(s, known.map((g) => this.decoMod(g.o2)), 30);
    if (expired !== null) this.notSwitched(expired);
    if (included.length && this.settings.predictive !== 'off') this.say(`INCLUDING G${included[0] + 1} AGAIN`);

    // Deep stop (manual §4.5): depth at which the 5th tissue (27 min) switches from ongassing to
    // offgassing, suggested as the no deco limit approaches; optional, not part of the TTS.
    this.deep.update(s, ceil, p, dt, this.settings.deepstop === 'on');
  }


  protected say(text: string): void {
    this.gasMsgs.say(text);
  }

  protected gasMessage(): string | null {
    return this.gasMsgs.current;
  }

  /** §13.2: GAS NOT SWITCHED, then, PREDICTIVE ON, EXCLUDING G2 before the calculation drops it. */
  protected notSwitched(gas: number): void {
    this.say('GAS NOT SWITCHED');
    if (this.settings.predictive !== 'off') this.say(`EXCLUDING G${gas + 1}`);
  }

  protected hasDesat(s: DiveSession): boolean {
    return s.log.length > 0 && s.clock < this.desatUntil;
  }

  /**
   * Audible alarms (instruction manual, alarms): fast ascent, MOD exceeded and missed deco stop sound while they last;
   * CNS 100 %: 5 s in one-minute intervals; CNS 75 %%, once. §3.3 ALL SILENT turns the audible alarms off (off by default, assumed).
   */
  /** §4.1 HALF TANK (bar): the half tank warning, and the limit of the blue / green and yellow ranges (§4.1.1). */
  halfTank(): number {
    return Number(this.settings.halfTank) || 100;
  }

  alertCues(v: ComputerView): AlertCue[] {
    if (this.settings.silent === 'on' || !v.inDive) return [];
    const cues = maresCues(v);
    // Gas switch prompt: "sounds an audible signal" (once).
    if (this.prompt.offer !== null) cues.push({ key: `switch-${this.prompt.offer}`, kind: 'beep', level: 'info', until: 'once' });
    if (v.cns >= 75 && v.cns < 100) cues.push({ key: 'cns-75', kind: 'beep', level: 'info', until: 'once' });
    // TANK RESERVE alarm (with a tank module; "alarms are both visual and audible"). How it is
    // acknowledged is not given: a button press, as on the Quad Air, assumed.
    if (v.tank.ai && v.tank.pressure <= v.tank.reserve) cues.push({ key: 'reserve', kind: 'beep', level: 'warning', until: 'ack', every: 3 });
    // HALF TANK (§10.3.4.2: shown until a button is pressed); its sound is not described, assumed alike.
    else if (v.tank.ai && this.settings.halfWarn !== 'off' && v.tank.pressure <= this.halfTank()) cues.push({ key: 'half', kind: 'beep', level: 'info', until: 'ack', every: 3 });
    return cues;
  }
}
