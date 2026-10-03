import { ceilingDepth, type DecoParams, ndl, planAscent, pressureToDepth } from '../../../engine/buhlmann';
import { GasPrompt } from '../../common/gasSwitch';
import type { DiveSession } from '../../../engine/session';
import { type AlertCue, ComputerView, SettingDef } from '../../base';
import { ScubaproRules, idealAscent, levelParams, reserveSetting } from '../common';
import { pressureSetting, pressureValue } from '../../common/tank';
import { ppo2Setting } from '../../common/ppo2';

/** GF settings offered (GF low 5–100, GF high 50–100 on the device, §2.1.2.4); 30/70 is the one of the manual's figures. */
const GF_SETS = ['30/70', '30/85', '35/75', '40/85', '45/95', '50/80', '100/100'];

/**
 * Warnings of §3.9 (in the manual's order), each shown "a couple seconds" when it occurs. The dive time
 * and depth warnings are set on the device (§2.1.4, off from the factory); the others "can only be
 * enabled / disabled via SCUBAPRO LogTRAK", defaults not given: on assumed.
 */
export type LunaWarning = 'depth' | 'cns75' | 'nostop2' | 'nostop0' | 'decoIn2' | 'deco' | 'time' | 'turn' | 'half' | 'rbt3' | 'missed' | 'relaxed';
const WARNING_ORDER: LunaWarning[] = ['depth', 'cns75', 'nostop2', 'nostop0', 'decoIn2', 'deco', 'time', 'turn', 'half', 'rbt3', 'missed', 'relaxed'];

/** No-stop time and first stop of the stage on display (MB level above L0, or GF other than 100/100). */
export interface StageInfo {
  ndl: number;
  stop: { depth: number; min: number; tat: number } | null;
}

const onOff = (key: string, fr: string, en: string): SettingDef => ({
  key,
  label: { fr, en },
  options: [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }],
  default: 'on',
});

/** Alarms of §3.10, shown until confirmed (long press of the right button). */
export type LunaAlarm = 'slow' | 'mod' | 'missed' | 'cns100' | 'reserve' | 'rbt0';

/**
 * Scubapro Luna 2.0 AI, SCUBA mode. Rules and screens follow the LUNA 2.0 AI user manual (2024).
 * With the transmitter switched off it behaves as the LUNA 2.0 (the version without air integration
 * and heart rate), whose manual shows the same screens with water temperature and no-stop time on
 * the bottom row. Workload (heart rate or breathing) is not simulated: "with the workload estimation
 * switched off [it] will behave like SCUBAPRO dive computer models without heart rate or air
 * integration" (§2.2.2.1).
 */
export abstract class LunaRules extends ScubaproRules {
  readonly id = 'luna';
  readonly name = 'Scubapro Luna 2.0 AI';
  readonly transmitter = 'Smart';
  readonly gasTimeName = 'RBT';

  /** §2.1.2.2: ZH-L16 ADT MB PMG (proprietary: approximated) or ZH-L16C+GF PMG (Bühlmann + GF: reproduced). */
  get algorithm(): string {
    return this.gfMode ? 'ZH-L16C + GF' : 'ZH-L16 ADT MB (≈)';
  }

  get exact(): boolean {
    return this.gfMode;
  }

  get notes(): { fr: string; en: string } {
    return {
      fr: 'Deux algorithmes (§2.1.2.2) : ZH-L16 ADT MB (ajustements non publiés : approximation, niveaux MB L0 à L5, PDIS) ou ZH-L16C+GF (Bühlmann avec gradient factors : reproduit ; les paliers GF s’ajoutent à la déco 100/100). Sonde désactivée : se comporte comme le Luna 2.0 (température et NDL en bas). Vitesse de remontée idéale selon la profondeur, SLOW DOWN au-delà de 110 % ; palier de sécurité de 3 min dès 5 m après 10 m ; MISSED DECO 0,5 m au-dessus du palier ; SOS 24 h. Bouton droit : écran suivant (appui long : confirmer une alarme, pause du chronomètre) ; bouton gauche : écran précédent (appui long : repère, remise à zéro du chronomètre). Multigaz PMG (§3.19, à activer dans DIVE > SCUBA > PMG ; désactivé par défaut supposé) : jusqu’à 3 gaz (bloc principal T1 et gaz de déco de la page), tous comptés dans la décompression ; au MOD d’un autre gaz pendant la remontée, son et CONFIRM T1→T2 ; appui long à droite : GAS CHANGE SAVED ; sans réponse en 30 s : GAS 2 EXCLUDED et le gaz sort du calcul ; appui long à droite : SWITCH GAS (appuis courts : autre gaz ; appui long à gauche : sortie) ; PPO2max des gaz 2 et 3 : 1,40 bar d’usine (§2.3.2), 1,6 bar à partir de 80 % d’O2. Non simulés : fréquence cardiaque et charge de travail, altitude, apnée et profondimètre, perte du signal de l’émetteur. Avertissements du §3.9 (textes des figures), chacun quelques secondes (4 s supposées) : profondeur et durée (désactivés d’usine), les autres réglés dans LogTRAK (valeurs par défaut non indiquées : activés supposé) ; HALFTANK à 100 bar (figures). Alarme RESERVE à 50 bar par défaut.',
      en: 'Two algorithms (§2.1.2.2): ZH-L16 ADT MB (unpublished adjustments: approximation, MB levels L0 to L5, PDIS) or ZH-L16C+GF (Bühlmann with gradient factors: reproduced; GF stops come on top of the 100/100 deco). Transmitter off: behaves as the Luna 2.0 (temperature and NDL at the bottom). Depth-dependent ideal ascent rate, SLOW DOWN above 110 %; 3-min safety stop from 5 m after 10 m; MISSED DECO 0.5 m above the stop; 24 h SOS. Right button: next screen (hold: confirm an alarm, pause the timer); left button: previous screen (hold: bookmark, reset the timer). PMG multi-gas (§3.19, to be enabled in DIVE > SCUBA > PMG; off by default assumed): up to 3 gases (the main tank T1 and the deco gases set on the page), all counted in the decompression; at the MOD of another gas during the ascent, a sound and CONFIRM T1→T2; right hold: GAS CHANGE SAVED; without an answer within 30 s: GAS 2 EXCLUDED and the gas leaves the calculation; right hold: SWITCH GAS (short presses: another gas; left hold: exit); PPO2max of gases 2 and 3: 1.40 bar from the factory (§2.3.2), 1.6 bar from 80 % O2. Not simulated: heart rate and workload, altitude, apnea and gauge modes, transmitter signal loss. §3.9 warnings (texts of the figures), each for a couple of seconds (4 s assumed): depth and time (off from the factory), the others set in LogTRAK (defaults not given: on assumed); HALFTANK at 100 bar (figures). RESERVE alarm at 50 bar by default.',
    };
  }

  readonly settingDefs: SettingDef[] = [
    {
      // §2.1.2.2 (changing it requires the safety code 313). Factory algorithm not given: ADT MB assumed.
      key: 'algo',
      label: { fr: 'Algorithme (DECOALGO)', en: 'Algorithm (DECOALGO)' },
      options: [
        { value: 'adt', label: 'ZH-L16 ADT MB PMG' },
        { value: 'gf', label: 'ZH-L16C+GF PMG' },
      ],
      default: 'adt',
    },
    {
      // §2.1.2.3 and §3.14: L0 to L5 (ADT MB only). Factory level not given: L0 assumed.
      key: 'level',
      label: { fr: 'Niveau MB (ADT)', en: 'MB level (ADT)' },
      options: Array.from({ length: 6 }, (_, i) => ({ value: String(i), label: `L${i}` })),
      default: '0',
    },
    {
      // §2.1.2.4 (GF only). Factory values not given: 30/70, as on the manual's figures.
      key: 'gf',
      label: { fr: 'Gradient factors (GF)', en: 'Gradient factors (GF)' },
      options: GF_SETS.map((g) => ({ value: g, label: g })),
      default: '30/70',
    },
    {
      // §2.1.2.5 (ADT MB only). Factory setting not given: on assumed.
      key: 'pdis',
      label: { fr: 'PDIS (ADT)', en: 'PDIS (ADT)' },
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      default: 'on',
    },
    {
      // §2.2.3.1: "When delivered with factory settings the LUNA 2.0 AI's buzzer is active."
      key: 'sound',
      label: { fr: 'Buzzer', en: 'Buzzer' },
      options: [{ value: 'on', label: { fr: 'Activé', en: 'On' } }, { value: 'off', label: { fr: 'Désactivé', en: 'Off' } }],
      default: 'on',
    },
    // §2.3.2: PPO2max 1.40 bar from the factory, 1.20 to 1.60 bar (step not given: 0.1).
    ppo2Setting(1.2, 1.6, 1.4, 'PPO2max'),
    {
      // §2.1.2.6: "Predictive multi-gas (PMG) mode enables the use of multiple tanks (up to 3 tanks)".
      // Default not given: off assumed (as the G2's factory setting).
      key: 'pmg',
      label: { fr: 'Multigaz PMG', en: 'PMG multi-gas' },
      options: [{ value: 'off', label: 'OFF' }, { value: 'on', label: 'ON' }],
      default: 'off',
      group: 'deco',
    },
    {
      // §2.3.2: PPO2max 2 and 3 "can be set the same way as PPO2max 1" (1.20 to 1.60 bar); "The factory
      // setting is 1.40bar"; "The ppO2 is fixed to 1.6bar when the selected oxygen content is 80% or higher."
      key: 'ppo2Deco',
      label: { fr: 'PPO2max gaz 2 / 3', en: 'PPO2max gases 2 / 3' },
      options: [1.2, 1.3, 1.4, 1.5, 1.6].map((v) => ({ value: v.toFixed(2), label: `${v.toFixed(2)} bar` })),
      default: '1.40',
      group: 'deco',
      showIf: (s) => s.pmg === 'on',
    },
    // §2.3.5 Half gas: "ON" or "OFF", "a value from 50 to 200bar in 5-bar increments". Default not
    // given: ON at 100 bar, the value of the §2.3.5 and §3.9.8 figures, assumed.
    pressureSetting('halfTank', { fr: 'Avertissement de demi-bloc (Half gas)', en: 'Half tank warning (Half gas)' }, 50, 200, 5, 100, 'OFF'),
    reserveSetting,
    {
      // §2.1.4.1: "In initial factory settings the dive time warning is switched off [...] from 5 to 195
      // minutes in 5-minute increments."
      key: 'wTime',
      label: { fr: 'Avertissement de durée (Dive time)', en: 'Dive time warning' },
      options: [{ value: 'off', label: 'OFF' }, ...Array.from({ length: 39 }, (_, i) => ({ value: String(5 + i * 5), label: `${5 + i * 5} min` }))],
      default: 'off',
    },
    {
      // §2.1.4.2: "switched off [...] from 5 to 100m (20 to 330ft) in 1m/5ft increments" (5 m steps offered).
      key: 'wDepth',
      label: { fr: 'Avertissement de profondeur (Dive depth)', en: 'Dive depth warning' },
      options: [{ value: 'off', label: 'OFF' }, ...Array.from({ length: 20 }, (_, i) => ({ value: String(5 + i * 5), label: `${5 + i * 5} m` }))],
      default: 'off',
    },
    // §3.9 warnings set in LogTRAK (§2.1.4); defaults not given: ON assumed.
    onOff('wCns', 'Avertissement CNS O2 = 75 % (§3.9.2)', 'CNS O2 = 75% warning (§3.9.2)'),
    onOff('wNostop2', 'Avertissement no-stop = 2 min (§3.9.3)', 'No-stop time = 2 min warning (§3.9.3)'),
    onOff('wNostop0', 'Avertissement no-stop = 0 min (§3.9.4, §3.9.12)', 'No-stop time = 0 min warning (§3.9.4, §3.9.12)'),
    onOff('wDecoIn2', 'Avertissement no-stop L0 ou 100/100 = 2 min (§3.9.5, §3.9.11)', 'L0 or 100/100 no-stop = 2 min warning (§3.9.5, §3.9.11)'),
    onOff('wDeco', 'Avertissement d’entrée en déco (§3.9.6, §3.9.13)', 'Entering decompression warning (§3.9.6, §3.9.13)'),
    onOff('wRbt3', 'Avertissement RBT = 3 min (§3.9.9)', 'RBT = 3 min warning (§3.9.9)'),
    onOff('wMissed', 'Avertissement de palier MB / GF manqué (§3.9.14, §3.9.15)', 'MB-level / GF stop missed warning (§3.9.14, §3.9.15)'),
    onOff('wRelaxed', 'Avertissement MB réduit / GF augmenté (§3.9.16, §3.9.17)', 'MB-level reduced / GF increased warning (§3.9.16, §3.9.17)'),
  ];

  /** §3.19: "The LUNA 2.0 AI enables you to use up to 3 gas mixtures during the dive" with PMG on. */
  get maxGases(): number {
    return this.settings.pmg === 'on' ? 3 : 1;
  }

  decoPpo2(): number {
    return Number(this.settings.ppo2Deco) || 1.4;
  }

  /** §3.19: "The MOD for tanks 2 and 3 are the switch depths"; 1.6 bar from 80 % O2 (§2.3.2). */
  decoMod(o2: number): number {
    return Math.max(0, pressureToDepth((o2 >= 0.8 ? 1.6 : this.decoPpo2()) / o2));
  }

  /** §3.19.3: a gas whose switch was not confirmed within 30 s is excluded from the calculation. */
  planGases(s: DiveSession) {
    return super.planGases(s).filter((g) => !this.prompt.declined.has(s.allGases.indexOf(g.gas)));
  }

  gasMods(s: DiveSession): number[] {
    return this.knownGases(s).map((g, i) => (i === 0 ? this.modDepth(g.o2) : this.decoMod(g.o2)));
  }

  /** Only T1 has a transmitter here. */
  airIntegrated(s: DiveSession): boolean {
    return super.airIntegrated(s) && s.breathing === 0;
  }

  /** §3.19.1: suggested gas switch (CONFIRM T1→T2), 30 s to answer. */
  prompt = new GasPrompt();
  /** §3.19.3: gas just excluded (GAS 2 EXCLUDED), and when. */
  excluded: { gas: number; at: number } | null = null;

  /** No-stop time and first stop of the stage on display (the base algorithm's without a stage). */
  stageInfo(v: ComputerView, s: DiveSession): StageInfo {
    const sp = v.inDive ? this.stageParams() : null;
    const lp = sp ? { ...sp, gases: this.planGases(s) } : null;
    const info: StageInfo = { ndl: v.ndl, stop: null };
    if (lp && !v.inDeco) {
      info.ndl = ndl(s.tissues, v.depth, s.gas, lp.gfHigh, this.ndlCap);
      if (info.ndl === 0) {
        const plan = planAscent(s.tissues, v.depth, s.gas, lp, this.levelAnchor);
        if (plan.stops[0]) info.stop = { depth: plan.stops[0].depth, min: Math.ceil(plan.stops[0].minutes), tat: plan.tts };
      }
    }
    return info;
  }

  /** Clock (s) at which each warning's condition started, while it lasts. */
  private warnSince = new Map<LunaWarning, number>();
  /** Warnings whose condition holds, with the clock at which each started (for the display and sounds). */
  activeWarnings: [LunaWarning, number][] = [];

  /** Updates the §3.9 warning conditions from the view (called when the screen is drawn). */
  updateWarnings(v: ComputerView, st: StageInfo, s: DiveSession): [LunaWarning, number][] {
    const on = (k: string) => this.settings[k] !== 'off';
    const c = new Set<LunaWarning>();
    if (v.inDive && !v.locked) {
      const stage = this.stageParams() !== null;
      if (on('wDepth') && v.depth >= Number(this.settings.wDepth)) c.add('depth');
      if (on('wCns') && v.cns >= 75 && v.cns < 100) c.add('cns75');
      // §3.9.3: the no-stop time on display ("both L0 no-stop and MB no-stop time").
      if (on('wNostop2') && !v.inDeco && !st.stop && st.ndl <= 2 && st.ndl > 0) c.add('nostop2');
      // §3.9.4 / §3.9.12: the no-stop time on display reaches 0 (stage stops, or decompression without a stage).
      if (on('wNostop0') && (st.stop !== null || (!stage && v.inDeco))) c.add('nostop0');
      // §3.9.5 / §3.9.11: the underlying L0 (100/100) no-stop time, with a stage.
      if (on('wDecoIn2') && stage && !v.inDeco && v.ndl <= 2 && v.ndl > 0) c.add('decoIn2');
      if (on('wDeco') && v.inDeco) c.add('deco');
      const min = v.diveTime / 60;
      if (on('wTime') && min >= Number(this.settings.wTime)) c.add('time');
      else if (on('wTime') && min >= Number(this.settings.wTime) / 2) c.add('turn'); // §3.9.7 figure: TURNING TIME
      const half = this.tankWarnPressure();
      if (v.tank.ai && half !== null && v.tank.pressure <= half) c.add('half');
      if (on('wRbt3') && v.tank.ai && v.tank.gasTime !== null && v.tank.gasTime <= 3 && v.tank.gasTime > 0) c.add('rbt3');
      // §3.9.14 / §3.9.15: "shallower than the deepest required MB-level (GF) stop".
      if (on('wMissed') && st.stop && v.depth < st.stop.depth - 0.1) c.add('missed');
      if (on('wRelaxed') && this.levelReducedAt > -1e8 && s.clock - this.levelReducedAt < 5) c.add('relaxed');
    }
    for (const k of [...this.warnSince.keys()]) if (!c.has(k)) this.warnSince.delete(k);
    for (const k of c) if (!this.warnSince.has(k)) this.warnSince.set(k, s.clock);
    this.activeWarnings = WARNING_ORDER.filter((k) => c.has(k)).map((k) => [k, this.warnSince.get(k)!]);
    return this.activeWarnings;
  }

  /** §2.3.5: pressure of the half tank warning (null when OFF). */
  tankWarnPressure(): number | null {
    return pressureValue(this.settings, 'halfTank');
  }

  /** GF values in force during the dive (increased when GF stops are ignored, §3.9.17). */
  activeGf: [number, number] = [30, 70];
  /** Alarms confirmed with the right button; forgotten once the condition clears. */
  confirmed = new Set<LunaAlarm>();

  constructor() {
    super();
    // §3.7: after reaching 10 m, a 3-minute countdown starts at 5 m; it disappears below 6.5 m and
    // starts again at 5 m.
    this.safetyStop = { trigger: 10, start: 5, top: 2, bottom: 6.5, reset: 6.5 };
    this.ceilingMargin = 0.5; // §3.10.5: MISSED DECO more than 0.5 m above the stop
    this.stopWindow = 1.5;
    this.ndlCap = 199; // §3.1: "The maximum displayed no-stop time is 199 minutes."
    this.screenTimeout = 60_000; // §3.4: back to the NST (or deco stop) screen after 1 minute
    this.init();
  }

  get gfMode(): boolean {
    return this.settings.algo === 'gf';
  }

  /** The mandatory decompression: L0 (ADT MB) or ZH-L16C 100/100 (GF algorithm, §3.9.13). */
  baseParams(): DecoParams {
    return this.gfMode ? { gfLow: 1, gfHigh: 1, lastStop: 3, stopStep: 3, ascentRate: 10 } : levelParams(0);
  }

  stageParams(): DecoParams | null {
    if (!this.gfMode) return this.activeLevel > 0 ? levelParams(this.activeLevel) : null;
    const [lo, hi] = this.activeGf;
    return lo >= 100 && hi >= 100 ? null : { gfLow: lo / 100, gfHigh: hi / 100, lastStop: 3, stopStep: 3, ascentRate: 10 };
  }

  protected resetStage(): void {
    this.activeLevel = this.gfMode ? 0 : Number(this.settings.level);
    const [lo, hi] = (this.settings.gf ?? '30/70').split('/').map(Number);
    this.activeGf = [lo, hi];
  }

  /**
   * §3.9.16 / §3.9.17: more than 1.5 m above the deepest stop of the stage, the MB level is reduced,
   * or the GF increased, "to the next possible value". How the next GF is chosen is not given: both
   * values are raised by steps of 5 until the diver is no longer above that stage's ceiling (assumed).
   */
  protected relaxStage(s: DiveSession): void {
    if (!this.gfMode) {
      super.relaxStage(s);
      return;
    }
    let [lo, hi] = this.activeGf;
    do {
      lo = Math.min(100, lo + 5);
      hi = Math.min(100, hi + 5);
    } while ((lo < 100 || hi < 100) && ceilingDepth(s.tissues, 0, { gfLow: lo / 100, gfHigh: hi / 100, lastStop: 3, stopStep: 3, ascentRate: 10 }) > s.depth + 1.5);
    this.activeGf = [lo, hi];
  }

  protected pdisEnabled(): boolean {
    return !this.gfMode && this.settings.pdis === 'on'; // §2.1.2.5: ADT MB only
  }

  protected stageLabel(): string | null {
    if (this.gfMode) return this.stageParams() ? `GF ${this.activeGf.join('/')}` : null;
    return super.stageLabel();
  }

  /** Stage shown on the screens: "MBL5" or "30/70". */
  stageText(): string {
    return this.gfMode ? this.activeGf.join('/') : `MBL${this.activeLevel}`;
  }

  /** §3.10.1: six bars up to 110 % of the ideal rate; SLOW DOWN above. */
  ascentLevel(rate: number, depth: number): 0 | 1 | 2 {
    const pct = rate / idealAscent(depth);
    return pct > 1.1 ? 2 : pct > 1 ? 1 : 0;
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.confirmed.clear();
    this.warnSince.clear();
    this.activeWarnings = [];
    this.prompt.reset();
    this.excluded = null;
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive || this.locked || this.maxGases < 2) return;
    const { expired } = this.prompt.update(s, this.gasMods(s), 30);
    if (expired !== null) this.excluded = { gas: expired, at: s.clock };
  }

  /** §3.10 alarms active in `v` (all shown, sounded, and confirmable). */
  activeAlarms(v: ComputerView): LunaAlarm[] {
    if (!v.inDive || v.locked) return [];
    const a: LunaAlarm[] = [];
    if (this.ascentAlarm) a.push('slow');
    if (v.depth > v.mod) a.push('mod');
    if (v.ceilingViolation === 2) a.push('missed');
    if (v.cns >= 100) a.push('cns100');
    if (v.tank.ai && v.tank.pressure <= v.tank.reserve) a.push('reserve');
    if (v.tank.ai && v.tank.gasTime === 0) a.push('rbt0');
    return a;
  }

  /** Confirms the alarms on display (§3.10: "Alarms can be confirmed by pressing the right button"). */
  confirmAlarms(v: ComputerView): boolean {
    const a = this.activeAlarms(v).filter((k) => !this.confirmed.has(k));
    for (const k of a) this.confirmed.add(k);
    return a.length > 0;
  }

  /** Forgets the confirmations of alarms that cleared (a new occurrence is shown again). */
  pruneConfirmed(v: ComputerView): void {
    const now = new Set(this.activeAlarms(v));
    for (const k of this.confirmed) if (!now.has(k)) this.confirmed.delete(k);
  }

  /** The screen confirms alarms on a long press of the right button (hold()). */
  acknowledgeAlerts(): boolean {
    return true;
  }

  /**
   * Buzzer (§2.2.3.1, on by default): CNS O2 75 % and 100 % give "a sequence of audible beeps for 12
   * seconds" (§3.9.2, §3.10.3); the other alarms and warnings have "audible signals" whose pattern is
   * not described (repeated every 2 s until confirmed or cleared, assumed).
   */
  alertCues(v: ComputerView): AlertCue[] {
    if (this.settings.sound === 'off' || !v.inDive) return [];
    this.pruneConfirmed(v);
    const cues: AlertCue[] = [];
    // §3.19.1: "An audible sequence is played" with the suggested gas switch.
    if (this.prompt.offer !== null) cues.push({ key: `switch-${this.prompt.offer}`, kind: 'beep', level: 'info', until: 'once' });
    for (const k of this.activeAlarms(v)) {
      if (this.confirmed.has(k)) continue;
      if (k === 'cns100') cues.push({ key: k, kind: 'beep', level: 'alarm', until: 'once', first: 12 });
      else cues.push({ key: k, kind: 'beep', level: 'alarm', until: 'ack', every: 2 });
    }
    // §3.9.2: CNS O2 75 % "a sequence of audible beeps for 12 seconds"; the other warnings have "audible
    // signals" whose pattern is not described (one warning sound, assumed).
    for (const [k, since] of this.activeWarnings) {
      cues.push({ key: `w-${k}-${since}`, kind: 'beep', level: 'warning', until: 'once', first: k === 'cns75' ? 12 : undefined });
    }
    return cues;
  }
}
