import { type DecoParams, ndl, planAscent, pressureToDepth } from '../../../engine/buhlmann';
import { GasPrompt } from '../../common/gasSwitch';
import type { DiveSession } from '../../../engine/session';
import { type AlertCue, ComputerView, SettingDef } from '../../base';
import { ScubaproRules, idealAscent, levelParams, reserveSetting } from '../common';
import { pressureSetting, pressureValue } from '../../common/tank';
import { ppo2Setting } from '../../common/ppo2';

/** §3.5 warnings (yellow pop-up), in the manual's order. */
export type G2Warning = 'depth' | 'cns75' | 'nostop' | 'deco' | 'time' | 'turn' | 'tank' | 'rbt3' | 'levelStops' | 'mbIgnored' | 'mbReduced' | 'l0Nostop' | 'l0Deco';
const WARNING_ORDER: G2Warning[] = ['depth', 'cns75', 'nostop', 'deco', 'time', 'turn', 'tank', 'rbt3', 'levelStops', 'mbIgnored', 'mbReduced', 'l0Nostop', 'l0Deco'];
/**
 * Warnings shown while their condition lasts (§3.5.3: CNS O2 75 % "until the value drops below 75%";
 * no-stop and RBT counters, MB stop ignored: deduced); the others are events, shown for 12 s like NO
 * PRESSURE SIGNAL (§3.5.9, the only duration the manual gives: assumed for all).
 */
const LASTING: G2Warning[] = ['cns75', 'nostop', 'rbt3', 'mbIgnored', 'l0Nostop'];
export const WARNING_SECONDS = 12;

/** §3.5.1: "warnings can be set to AUDIBLE, VISUAL, BOTH (audible and visual) or OFF". */
function warnSetting(key: string, fr: string, en: string, def: 'both' | 'audible' | 'visual' | 'off'): SettingDef {
  return {
    key,
    label: { fr, en },
    options: [{ value: 'both', label: 'Both' }, { value: 'audible', label: 'Audible' }, { value: 'visual', label: 'Visual' }, { value: 'off', label: 'Off' }],
    default: def,
  };
}
const on = (key: string) => (s: Record<string, string>) => s[key] !== 'off';

/**
 * §2.6 Warning settings. Factory values are not given in the text: those of the §2.6 figures are used
 * (for the maximum depth, the first figure shows "Off", then "Visual" once changed).
 */
const G2_WARNING_SETTINGS: SettingDef[] = [
  warnSetting('wDepth', 'Avertissement de profondeur max (6.1)', 'Maximum depth warning (6.1)', 'off'),
  // §2.6.1: "5-100m/20-330ft in 1m/5ft increments" (5 m steps offered); 40.0 m on the figure.
  { key: 'wDepthM', label: { fr: 'Profondeur de l’avertissement', en: 'Warning depth' }, options: Array.from({ length: 20 }, (_, i) => ({ value: String(5 + i * 5), label: `${5 + i * 5} m` })), default: '40', showIf: on('wDepth') },
  warnSetting('wCns', 'Avertissement CNS O2 = 75 % (6.2)', 'CNS O2 = 75% warning (6.2)', 'audible'),
  warnSetting('wNostop', 'Avertissement no-stop = 2 min (6.3)', 'No-stop = 2 min warning (6.3)', 'visual'),
  warnSetting('wDeco', 'Avertissement d’entrée en déco (6.4)', 'Entering deco warning (6.4)', 'visual'),
  warnSetting('wTime', 'Avertissement de durée de plongée (6.5)', 'Dive time warning (6.5)', 'visual'),
  // §2.6.5: "from 5 to 995 minutes in 1-minute increments" (5 min steps up to 180 offered); 60 min on the figure.
  { key: 'wTimeMin', label: { fr: 'Durée de l’avertissement', en: 'Warning time' }, options: Array.from({ length: 36 }, (_, i) => ({ value: String(5 + i * 5), label: `${5 + i * 5} min` })), default: '60', showIf: on('wTime') },
  // §2.6.6 / §3.5.7 ("for instance, you can set it to half the full tank pressure"); Visual, 100 bar on the figure.
  warnSetting('tankWarn', 'Avertissement de pression du bloc (6.6)', 'Tank pressure warning (6.6)', 'visual'),
  { ...pressureSetting('tankWarnP', { fr: 'Pression de l’avertissement', en: 'Warning pressure' }, 50, 200, 10, 100), showIf: on('tankWarn') },
  warnSetting('wRbt', 'Avertissement RBT = 3 min (6.7)', 'RBT = 3 min warning (6.7)', 'visual'),
  // §2.6.8 Pressure signal (Off on the figure): the transmitter signal is never lost in the simulator.
  warnSetting('wLevelStops', 'Avertissement d’entrée en paliers MB (6.9)', 'Entering level stops warning (6.9)', 'visual'),
  warnSetting('wMbIgnored', 'Avertissement de palier MB ignoré (6.10)', 'MB stop ignored warning (6.10)', 'both'),
  warnSetting('wMbReduced', 'Avertissement de niveau MB réduit (6.11)', 'MB level reduced warning (6.11)', 'both'),
  warnSetting('wL0Nostop', 'Avertissement no-stop L0 = 2 min (6.12)', 'L0 no-stop = 2 min warning (6.12)', 'visual'),
  warnSetting('wL0Deco', 'Avertissement d’entrée en déco à L0 (6.13)', 'Entering deco at L0 warning (6.13)', 'visual'),
];
const WARNING_KEY: Record<G2Warning, string> = {
  depth: 'wDepth', cns75: 'wCns', nostop: 'wNostop', deco: 'wDeco', time: 'wTime', turn: 'wTime', tank: 'tankWarn', rbt3: 'wRbt',
  levelStops: 'wLevelStops', mbIgnored: 'wMbIgnored', mbReduced: 'wMbReduced', l0Nostop: 'wL0Nostop', l0Deco: 'wL0Deco',
};

/** No-stop time and first stop at the active MB level (level stops are not mandatory). */
export interface LevelInfo {
  ndl: number;
  stop: { depth: number; min: number } | null;
  tat: number;
}

/**
 * Scubapro Galileo 2 (G2), Scuba mode. Screens and rules follow the G2 user manual: Light / Classic
 * screen configurations, pop-up warnings (yellow) and alarms (red), ideal ascent rate table, safety
 * stop timer, MB levels and PDIS. ZH-L16 ADT MB itself has unpublished adjustments: approximated.
 */
export abstract class G2Rules extends ScubaproRules {
  readonly id = 'scubapro';
  readonly name = 'Scubapro G2';
  readonly algorithm = 'ZH-L16 ADT MB (≈)';
  readonly exact = false;
  readonly transmitter = 'Smart';
  readonly gasTimeName = 'RBT';
  readonly notes = {
    fr: 'ZH-L16 ADT MB a des ajustements non publiés : approximation. Affichage et règles conformes au manuel : écran Light (Classic automatique en déco), vitesse de remontée idéale selon la profondeur (jaune > 110 %, alarme > 140 %), niveaux MB (réduits si le palier est ignoré de plus de 1,5 m), PDIS. Bouton MORE : informations alternatives ; TIMER : repère (et relance du palier de sécurité) ; LIGHT : rétroéclairage. Les 13 avertissements du §3.5 (MAX DEPTH REACHED, CNS O2 = 75%, NO STOP = 2 MINUTES, TIME LIMIT REACHED / TURN-AROUND TIME, 100BAR REACHED, RBT = 3 MINUTES, niveaux MB…) se règlent en Off / Visual / Audible / Both ; valeurs par défaut non indiquées dans le texte : celles des figures du §2.6. Un avertissement ponctuel reste 12 s à l’écran (durée de NO PRESSURE SIGNAL, supposée pour tous) ; « ENTERING DECO » est déduit (pas de figure). Alarmes du §3.6 (réserve du bloc : 50 bar par défaut). Multigaz PMG (§3.4.2, à activer, désactivé en réglage d’usine §2.2.15) : jusqu’à 8 gaz (ici le bloc principal T1 et les gaz de déco de la page), tous comptés dans la décompression ; au MOD d’un autre gaz pendant la remontée, son et SWITCH TO GAS T2 ; SAVE (bouton gauche) confirme (SWITCH TO GAS T2 SUCCESSFUL, 4 s), la flèche (bouton du milieu) propose un autre gaz ; sans réponse en 30 s, EXCLUDING GAS T2 et le gaz sort du calcul ; appui long sur BOOK : changement manuel ; ppO2max des gaz de déco 1,6 bar supposé (fixé à 1,6 bar à partir de 80 % d’O2). Appui long sur MORE (§3.7.1) : en Classic, Full et Graphical, tableau des gaz (PMG) et tableau de déco (PMG / 1G au niveau MB et à L0 ; avec PMG ou un niveau MB), puis profil de la plongée (partie plongée en bleu, remontée prévue en vert, MOD des gaz en blanc, paliers en orange) et saturation des compartiments (rouge : saturation, vert : désaturation ; hauteur rapportée à la M-value à la pression ambiante, déduit) ; ⇧ (milieu) : écran suivant, ⇩ (gauche) : précédent ; retour après 12 s sans appui, 1 min au plus, ou à la première alerte. Non simulés : images, boussole, perte du signal de l’émetteur, batterie.',
    en: 'ZH-L16 ADT MB has unpublished adjustments: approximation. Display and rules as per the manual: Light screen (Classic automatically in deco), depth-dependent ideal ascent rate (yellow > 110 %, alarm > 140 %), MB levels (reduced if a stop is ignored by more than 1.5 m), PDIS. MORE button: alternate information; TIMER: bookmark (and safety stop restart); LIGHT: backlight. The 13 warnings of §3.5 (MAX DEPTH REACHED, CNS O2 = 75%, NO STOP = 2 MINUTES, TIME LIMIT REACHED / TURN-AROUND TIME, 100BAR REACHED, RBT = 3 MINUTES, MB levels…) are set to Off / Visual / Audible / Both; defaults not given in the text: those of the §2.6 figures. An event warning stays 12 s on screen (the NO PRESSURE SIGNAL duration, assumed for all); "ENTERING DECO" is deduced (no figure). §3.6 alarms (tank reserve: 50 bar by default). PMG multi-gas (§3.4.2, to be activated, off as factory setting §2.2.15): up to 8 gases (here the main tank T1 and the deco gases set on the page), all counted in the decompression; at the MOD of another gas during the ascent, a sound and SWITCH TO GAS T2; SAVE (left button) confirms (SWITCH TO GAS T2 SUCCESSFUL, 4 s), the arrow (middle button) proposes another gas; without an answer within 30 s, EXCLUDING GAS T2 and the gas leaves the calculation; BOOK hold: manual switch; ppO2max of the deco gases 1.6 bar assumed (fixed at 1.6 bar from 80 % O2). MORE held (§3.7.1): on Classic, Full and Graphical, gas summary (PMG) and deco summary table (PMG / 1G at the MB level and at L0; with PMG or an MB level), then the dive profile (dived part in blue, predicted ascent in green, gas MODs in white, stops in orange) and the compartment saturation (red: on-gassing, green: off-gassing; height relative to the M-value at the ambient pressure, deduced); ⇧ (middle): next display, ⇩ (left): previous; back after 12 s without a press, 1 min at most, or at the first alert. Not simulated: pictures, compass, transmitter signal loss, battery.',
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
    {
      // User manual §2.2.9 All-silent mode (factory setting OFF, i.e. sound on).
      key: 'sound',
      label: { fr: 'Son', en: 'Sound' },
      options: [{ value: 'on', label: { fr: 'Activé', en: 'On' } }, { value: 'off', label: { fr: 'Désactivé', en: 'Off' } }],
      default: 'on',
    },
    // Manual §2.1.2: ppO2max 1.40 bar from the factory, adjustable between 1.0 and 1.6 bar (step not given: 0.1; "off" not offered).
    ppo2Setting(1.0, 1.6, 1.4, 'PPO2max'),
    {
      // §2.2.15 Activating PMG: "Predictive Multi-gas (PMG) mode enables the use of multiple tanks from 2
      // to 8"; §2.1.1: one-tank diving is the factory setting.
      key: 'pmg',
      label: { fr: 'Multigaz PMG (2.2.15)', en: 'PMG multi-gas (2.2.15)' },
      options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }],
      default: 'off',
      group: 'deco',
    },
    {
      // §2.1.2: "You can set a different ppO2 setting for decompression gases" (value not given: 1.6 bar
      // assumed); §3.4.2: "For oxygen concentrations of 80% and higher, the ppO2max is fixed at 1.6bar".
      key: 'ppo2Deco',
      label: { fr: 'ppO2max gaz de déco', en: 'Deco gas ppO2max' },
      options: [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6].map((v) => ({ value: v.toFixed(2), label: `${v.toFixed(1)} bar` })),
      default: '1.60',
      group: 'deco',
      showIf: (s) => s.pmg === 'on',
    },
    ...G2_WARNING_SETTINGS,
    reserveSetting,
  ];

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

  /** §3.4.2: "The G2 enables you to use up to 8 gas mixtures" once PMG is enabled (§2.2.15). */
  get maxGases(): number {
    return this.settings.pmg === 'on' ? 8 : 1;
  }

  decoPpo2(): number {
    return Number(this.settings.ppo2Deco) || 1.6;
  }

  /** §3.4.2: "The MOD for tanks 2 through 8 are the switch depths for those gases"; 1.6 bar from 80 % O2. */
  decoMod(o2: number): number {
    return Math.max(0, pressureToDepth((o2 >= 0.8 ? 1.6 : this.decoPpo2()) / o2));
  }

  /** §3.4.2 PMG: all the gases programmed, except one excluded after an unanswered switch (EXCLUDING GAS T2). */
  planGases(s: DiveSession) {
    return super.planGases(s).filter((g) => !this.prompt.declined.has(s.allGases.indexOf(g.gas)));
  }

  /** MOD of each programmed gas: T1 with the PPO2max, the others their switch depth. */
  gasMods(s: DiveSession): number[] {
    return this.knownGases(s).map((g, i) => (i === 0 ? this.modDepth(g.o2) : this.decoMod(g.o2)));
  }

  /** Only T1 has a Smart transmitter here (fig. of §3.4.2: "TANK2 ... NO P"). */
  airIntegrated(s: DiveSession): boolean {
    return super.airIntegrated(s) && s.breathing === 0;
  }

  /** §3.4.2: SWITCH TO GAS T2 at its MOD during the ascent, 30 s to answer. */
  prompt = new GasPrompt();
  /** Gas just excluded (EXCLUDING GAS T2 shown in the bar), and when. */
  excluded: { gas: number; at: number } | null = null;

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive || this.locked || this.maxGases < 2) return;
    // "You have 30 seconds to respond to this message; otherwise, the G2 will conclude that gas 2 will not
    // be used (text: EXCLUDING GAS T2 will be displayed) and adapt the decompression schedule accordingly."
    const { expired } = this.prompt.update(s, this.gasMods(s), 30);
    if (expired !== null) this.excluded = { gas: expired, at: s.clock };
  }

  /** Yellow above 110 % of the ideal rate, ASCENT TOO FAST above 140 %. */
  ascentLevel(rate: number, depth: number): 0 | 1 | 2 {
    const pct = rate / idealAscent(depth);
    return pct > 1.4 ? 2 : pct > 1.1 ? 1 : 0;
  }

  /** §2.6.6: pressure of the tank pressure warning (null when set to OFF). */
  tankWarnPressure(): number | null {
    return this.settings.tankWarn === 'off' ? null : pressureValue(this.settings, 'tankWarnP');
  }

  /** No-stop time and stops at the active MB level (the base algorithm's when at L0). */
  levelInfo(v: ComputerView, s: DiveSession): LevelInfo {
    const info: LevelInfo = { ndl: v.ndl, stop: null, tat: v.tts };
    if (v.inDive && this.activeLevel > 0 && !v.inDeco) {
      const lp = { ...levelParams(this.activeLevel), gases: this.planGases(s) };
      info.ndl = ndl(s.tissues, v.depth, s.gas, lp.gfHigh);
      if (info.ndl === 0) {
        const lplan = planAscent(s.tissues, v.depth, s.gas, lp, this.levelAnchor);
        if (lplan.stops[0]) info.stop = { depth: lplan.stops[0].depth, min: Math.ceil(lplan.stops[0].minutes) };
        info.tat = lplan.tts;
      }
    }
    return info;
  }

  /** Clock (s) at which each warning's condition started, while it lasts. */
  private warnSince = new Map<G2Warning, number>();

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.warnSince.clear();
    this.activeWarnings = [];
    this.prompt.reset();
    this.excluded = null;
  }

  /** Conditions of the §3.5 warnings switched on (any mode), from the view and the MB level information. */
  private warningConditions(v: ComputerView, lv: LevelInfo, s: DiveSession): G2Warning[] {
    if (!v.inDive || v.locked) return [];
    const set = (k: G2Warning) => this.settings[WARNING_KEY[k]] !== 'off';
    const c: G2Warning[] = [];
    const mb = this.activeLevel > 0;
    if (set('depth') && v.depth >= Number(this.settings.wDepthM)) c.push('depth');
    if (set('cns75') && v.cns >= 75 && v.cns < 100) c.push('cns75');
    // §3.5.4: "applies to both L0 no-stop and MB no-stop time" (the one on display).
    if (set('nostop') && !v.inDeco && !lv.stop && lv.ndl <= 2 && lv.ndl > 0) c.push('nostop');
    // §3.5.5: "applies to dives with the computer set to L0-L9" (above L0, §3.5.14 also warns about L0 deco).
    if (set('deco') && v.inDeco) c.push('deco');
    const min = v.diveTime / 60;
    const limit = Number(this.settings.wTimeMin);
    if (set('time') && min >= limit) c.push('time');
    else if (set('turn') && min >= limit / 2) c.push('turn'); // §3.5.6: "Half of the dive time warning"
    const warnP = this.tankWarnPressure();
    if (v.tank.ai && warnP !== null && v.tank.pressure <= warnP) c.push('tank');
    if (set('rbt3') && v.tank.ai && v.tank.gasTime !== null && v.tank.gasTime <= 3 && v.tank.gasTime > 0) c.push('rbt3');
    if (set('levelStops') && mb && lv.stop) c.push('levelStops');
    // §2.6.10: "shallower than the deepest required MB level stop".
    if (set('mbIgnored') && mb && lv.stop && v.depth < lv.stop.depth - 0.1) c.push('mbIgnored');
    if (set('mbReduced') && s.clock - this.levelReducedAt < WARNING_SECONDS) c.push('mbReduced');
    if (set('l0Nostop') && mb && !v.inDeco && v.ndl <= 2 && v.ndl > 0) c.push('l0Nostop');
    if (set('l0Deco') && mb && v.inDeco) c.push('l0Deco');
    return c;
  }

  /** Warnings whose condition holds now (for the sounds), with the clock at which each started. */
  private activeWarnings: [G2Warning, number][] = [];

  /**
   * Updates the warnings from the view (called when the screen is drawn) and returns those shown in
   * the pop-up window (VISUAL or BOTH), in the manual's order.
   */
  updateWarnings(v: ComputerView, lv: LevelInfo, s: DiveSession): G2Warning[] {
    const now = new Set(this.warningConditions(v, lv, s));
    for (const k of [...this.warnSince.keys()]) if (!now.has(k)) this.warnSince.delete(k);
    for (const k of now) if (!this.warnSince.has(k)) this.warnSince.set(k, s.clock);
    this.activeWarnings = WARNING_ORDER.filter((k) => now.has(k)).map((k) => [k, this.warnSince.get(k)!]);
    return this.activeWarnings
      .filter(([k, since]) => LASTING.includes(k) || s.clock - since < WARNING_SECONDS)
      .filter(([k]) => ['visual', 'both'].includes(this.settings[WARNING_KEY[k]]))
      .map(([k]) => k);
  }

  /**
   * Audible alarms (user manual §3.6 and following): ascent above 110 % of the ideal rate, the beeps
   * getting faster as the excess grows; MOD exceeded, beeping incessantly while deeper; missed deco
   * stop, a sequence of beeps while more than 0.5 m above; CNS O2 100 %, beeps for 12 s, then 5 s in
   * 1-minute intervals. Warnings set to AUDIBLE or BOTH beep once when they occur (§3.5.1; pattern not
   * described). Silenced by the all-silent mode (§2.2.9).
   */
  alertCues(v: ComputerView): AlertCue[] {
    if (this.settings.sound === 'off' || !v.inDive) return [];
    const cues: AlertCue[] = [];
    if (v.ascentLevel >= 1) {
      const excess = v.ascentRate / idealAscent(v.depth) - 1.1;
      cues.push({ key: 'ascent', kind: 'beep', level: v.ascentLevel >= 2 ? 'alarm' : 'warning', until: 'clear', every: Math.max(0.6, 2.5 - excess * 4) });
    }
    if (v.depth > v.mod) cues.push({ key: 'mod', kind: 'beep', level: 'alarm', until: 'clear', every: 1 });
    if (v.alarms.includes('CEILING')) cues.push({ key: 'missed-stop', kind: 'beep', level: 'alarm', until: 'clear', every: 2 });
    if (v.cns >= 100) cues.push({ key: 'cns', kind: 'beep', level: 'warning', until: 'clear', first: 12, every: 60, repeat: 5 });
    // §3.6.4 tank reserve reached: "an alarm is triggered" (sound pattern not described: one alarm, assumed).
    if (v.tank.ai && v.tank.pressure < v.tank.reserve) cues.push({ key: 'reserve', kind: 'beep', level: 'alarm', until: 'once' });
    // §3.4.2: "An audible sequence is played" with SWITCH TO GAS T2.
    if (this.prompt.offer !== null) cues.push({ key: `switch-${this.prompt.offer}`, kind: 'beep', level: 'info', until: 'once' });
    for (const [k, since] of this.activeWarnings) {
      if (['audible', 'both'].includes(this.settings[WARNING_KEY[k]])) cues.push({ key: `w-${k}-${since}`, kind: 'beep', level: 'warning', until: 'once' });
    }
    return cues;
  }
}
