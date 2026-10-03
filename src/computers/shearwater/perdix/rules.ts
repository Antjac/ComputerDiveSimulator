import { type DecoParams, ndl, SURFACE_PRESSURE } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import { remainingTime } from '../../../engine/gas';
import { type AlertCue, type ComputerView, DiveComputer, SettingDef } from '../../base';
import { Notices } from '../../common/notices';
import { ppo2Setting } from '../../common/ppo2';
import { pressureSetting } from '../../common/tank';
import { OC_DECO_PPO2, decoPpo2Setting, type SwMode } from '../multigas';

export type PerdixNotice = 'high-ppo2' | 'missed-stop' | 'fast-ascent' | 'very-high-cns' | 'high-cns' | 'low-ndl' | 'depth-alert' | 'time-alert' | 'gas';

// Perdix 2 Recreational manual (RevC), §12.2 Conservatism: Low 45/95, Med 40/85 (default), High 35/75,
// or Custom ("A custom GF option is also available in every dive mode").
export const GF_PRESETS: Record<string, [number, number]> = { low: [45, 95], med: [40, 85], high: [35, 75] };

// §12.2: "If selected, GF Low and GF High fields will appear in the Deco Menu". Range and step not given
// by the manual: 10 to 100 % by 5 assumed (not verified).
const GF_VALUES = Array.from({ length: 19 }, (_, i) => String(10 + i * 5));
const customGf = (s: Record<string, string>) => s.gf === 'custom';
const isTec = (s: Record<string, string>) => s.mode === 'octec';
const notTec = (s: Record<string, string>) => s.mode !== 'octec';

/** Technical manual §4.4 "Home Screen Configuration Options" offered for the left and right centre positions. */
export const CENTER_OPTIONS = ['none', 'MAX', 'AVG', 'CNS', 'MOD', 'GF99', 'SurGF', 'CEIL', '@+5', 'Δ+5', 'TTS', 'TEMP', 'CLOCK', 'DENSITY']
  .map((v) => ({ value: v, label: v === 'none' ? { fr: 'Vide', en: 'Empty' } : v }));

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
    fr: 'Modes Nitrox, 3 GasNx (par défaut, §4.1 : jusqu’à 3 gaz Nx) et OC Tec (manuel Technical, rév. B : jusqu’à 5 gaz). Multigaz : le gaz le moins riche suit la MOD PPO2, les autres la PPO2 de déco (1,61 par défaut, Adv. Config 2) ; le plan suppose le passage au meilleur gaz ; gaz en jaune quand un meilleur gaz est disponible ; MENU puis SELECT sur Select Gas pour changer (liste « nouveau style » en 3 GasNx, un gaz à la fois en OC Tec). OC Tec : écran technique (DEPTH TIME STOP TIME, ligne centrale PPO2 et deux emplacements réglables, OC O2/HE NDL TTS), GF 30/70, dernier palier 3 ou 6 m, pas de palier de sécurité, compteur CLEAR, PPO2 en rouge clignotant au-delà de 1,65 (High PPO2 dans la ligne centrale). Mode Nitrox Recreational. Bouton droit (SELECT) : écrans d’info (MOD/MAX/PPO2, GF99/SurGF/CEIL, tissus, DET/Δ+5/@+5…) ; bouton gauche (MENU) : retour à l’écran principal (le menu de plongée n’est pas simulé). Aucun verrouillage en cas de palier manqué (conforme au manuel). Palier de sécurité ajouté dès 11 m et affiché dès lors (§6.1), décompte entre 2,4 et 7 m. Notifications du §10 (High PPO2 au-delà de 1,65 pendant 30 s, Missed Stop, Fast Ascent au-delà de 10 m/min, High CNS au-delà de 90 %, Very High CNS au-delà de 150 %) et alertes du §4.9 (Low NDL 5 min, Depth 40 m, Time 60 min désactivée par défaut ; valeur concernée en jaune) affichées en bas de l’écran sous « Warning » ou « Alert » jusqu’à SELECT. Vibrations (règles du manuel Tech) : début, pause et fin du palier de sécurité, notifications toutes les 10 s jusqu’à SELECT, High PPO2 jusqu’à sa résolution. Émetteur : pression de réserve réglable (50 bar par défaut, §12.3), T1 en jaune sous la réserve, en rouge et T1 CRITICAL PRES sous max(21 bar, réserve / 2).',
    en: 'Nitrox, 3 GasNx (default, §4.1: up to 3 Nx gases) and OC Tec (Technical manual, rev. B: up to 5 gases) modes. Multigas: the leanest gas obeys the MOD PPO2, the others the deco PPO2 (1.61 by default, Adv. Config 2); the plan assumes the switch to the best gas; gas in yellow when a better gas is available; MENU then SELECT on Select Gas to switch (new style list in 3 GasNx, one gas at a time in OC Tec). OC Tec: technical screen (DEPTH TIME STOP TIME, centre row PPO2 and two settable positions, OC O2/HE NDL TTS), GF 30/70, last stop 3 or 6 m, no safety stop, CLEAR counter, PPO2 flashing red above 1.65 (High PPO2 in the centre row). Nitrox Recreational mode. Right button (SELECT): info screens (MOD/MAX/PPO2, GF99/SurGF/CEIL, tissues, DET/Δ+5/@+5…); left button (MENU): back to the main screen (the dive menu is not simulated). No lock-out for missed stops (as per the manual). Safety stop added beyond 11 m and shown from then on (§6.1), counting down between 2.4 and 7 m. §10 notifications (High PPO2 above 1.65 for 30 s, Missed Stop, Fast Ascent above 10 m/min, High CNS above 90 %, Very High CNS above 150 %) and §4.9 alerts (Low NDL 5 min, Depth 40 m, Time 60 min off by default; the value concerned in yellow) shown at the bottom of the screen under "Warning" or "Alert" until SELECT. Vibration (rules of the Tech manual): safety stop start, pause and end, notifications every 10 s until SELECT, High PPO2 until resolved. Transmitter: settable reserve pressure (50 bar by default, §12.3), T1 yellow below the reserve, red and T1 CRITICAL PRES below max(21 bar, reserve / 2).',
  };
  readonly settingDefs: SettingDef[] = [
    {
      // Technical manual §11.1 Mode: Air, Nitrox, 3 GasNx (default), OC Tec, CC/BO, Gauge (Air, CC/BO and
      // Gauge not simulated; air is simulated as Nitrox 21 %).
      key: 'mode',
      label: { fr: 'Mode de plongée', en: 'Dive mode' },
      options: [{ value: 'nitrox', label: 'Nitrox' }, { value: '3gasnx', label: '3 GasNx' }, { value: 'octec', label: 'OC Tec' }],
      default: '3gasnx',
      group: 'deco',
    },
    {
      key: 'gf',
      showIf: notTec,
      label: { fr: 'Conservatisme', en: 'Conservatism' },
      options: [
        { value: 'low', label: 'Low (45/95)' },
        { value: 'med', label: 'Med (40/85)' },
        { value: 'high', label: 'High (35/75)' },
        { value: 'custom', label: 'Custom' },
      ],
      default: 'med', // §12.2: "Medium conservatism is the default setting."
    },
    {
      key: 'gfLow',
      label: { fr: 'GF bas (Custom)', en: 'GF low (Custom)' },
      options: GF_VALUES.map((v) => ({ value: v, label: `${v} %` })),
      default: '40',
      showIf: (s) => notTec(s) && customGf(s),
    },
    {
      key: 'gfHigh',
      label: { fr: 'GF haut (Custom)', en: 'GF high (Custom)' },
      options: GF_VALUES.map((v) => ({ value: v, label: `${v} %` })),
      default: '85',
      showIf: (s) => notTec(s) && customGf(s),
    },
    {
      // Technical manual §5: "For OC Tec and CC/BO modes [...] the default is a more conservative 30/70";
      // §10.3 Conserv. (GF low / GF high). Range and step not given: 10 to 100 % by 5 offered.
      key: 'tecGfLow',
      label: { fr: 'GF bas (OC Tec)', en: 'GF low (OC Tec)' },
      options: GF_VALUES.map((v) => ({ value: v, label: `${v} %` })),
      default: '30',
      showIf: isTec,
    },
    {
      key: 'tecGfHigh',
      label: { fr: 'GF haut (OC Tec)', en: 'GF high (OC Tec)' },
      options: GF_VALUES.map((v) => ({ value: v, label: `${v} %` })),
      default: '70',
      showIf: isTec,
    },
    {
      // Technical manual §4.4: "By default the Perdix 2 uses a 3m (10ft) last deco stop depth"; §11.2 Last
      // Stop: 3 m or 6 m.
      key: 'lastStop',
      label: { fr: 'Dernier palier (Last Stop)', en: 'Last Stop' },
      options: [{ value: '3', label: '3 m' }, { value: '6', label: '6 m' }],
      default: '3',
      showIf: isTec,
    },
    {
      // Technical manual §4.4 / §11.2 NDL Display: NDL, or once in deco CEIL, @+5, Δ+5, GF99, SurGF
      // (Mini not simulated). Default NDL.
      key: 'ndlDisplay',
      label: { fr: 'Affichage NDL en déco (NDL Display)', en: 'NDL Display' },
      options: ['NDL', 'CEIL', '@+5', 'Δ+5', 'GF99', 'SurGF'].map((v) => ({ value: v, label: v })),
      default: 'NDL',
      group: 'display',
      showIf: isTec,
    },
    {
      // Technical manual §11.2 Clear Cntr: "toggle the deco clear counter on or off" ("By default, the deco
      // clear counter is enabled", §4.10).
      key: 'clearCntr',
      label: { fr: 'Compteur CLEAR (Clear Cntr)', en: 'Clear Cntr' },
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      default: 'on',
      group: 'display',
      showIf: isTec,
    },
    {
      // Technical manual §4.4 / §11.4: centre row positions; "The middle location of the center row
      // displays gas PPO2 by default"; the left and right positions are empty in the manual's dive
      // figures (default deduced). A subset of the options of §4.4 is offered; the middle one stays PPO2.
      key: 'centerL',
      label: { fr: 'Ligne centrale, gauche', en: 'Centre row, left' },
      options: CENTER_OPTIONS,
      default: 'none',
      group: 'display',
      showIf: isTec,
    },
    {
      key: 'centerR',
      label: { fr: 'Ligne centrale, droite', en: 'Centre row, right' },
      options: CENTER_OPTIONS,
      default: 'none',
      group: 'display',
      showIf: isTec,
    },
    decoPpo2Setting((s) => s.mode === '3gasnx' || s.mode === 'octec'),
    {
      key: 'safety',
      label: { fr: 'Palier de sécurité', en: 'Safety stop' },
      options: [
        { value: '3', label: '3 min' }, { value: '4', label: '4 min' }, { value: '5', label: '5 min' },
        { value: 'adapt', label: 'Adapt' }, { value: 'off', label: 'Off' },
      ],
      default: '3',
      showIf: notTec, // Technical manual §4.10: "There are no Safety Stops in technical diving modes."
    },
    {
      key: 'bottom',
      showIf: notTec,
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
    {
      // Technical modes manual, "Vibration Alerts" and §11.8 Alerts Setup (the Recreational manual does
      // not mention vibration; confirmed on the device in Recreational mode). Default not given: on assumed.
      key: 'vibration',
      label: { fr: 'Vibrations', en: 'Vibration' },
      options: [{ value: 'on', label: { fr: 'Activé', en: 'On' } }, { value: 'off', label: { fr: 'Désactivé', en: 'Off' } }],
      default: 'on',
    },
    // §8 Display Setup: "MOD PPO2 can be set from 1.2 to 1.6 in steps of 0.1" (1.4 ata).
    ppo2Setting(1.2, 1.6, 1.4, 'MOD PPO2'),
    {
      // §8 Adv. Config, Max. Depth: "The shallower of this value and the depth determined from the PPO2
      // sets the MOD. Can be set from 100ft to 165ft (default is 130ft), or 30m to 50m (default 40m)."
      // Step not given: 5 m offered.
      key: 'maxdepth',
      showIf: notTec, // not in the Technical manual

      label: { fr: 'Limite MOD (Max. Depth)', en: 'MOD limit (Max. Depth)' },
      options: [30, 35, 40, 45, 50].map((m) => ({ value: String(m), label: `${m} m` })),
      default: '40',
    },
    // §12.3 AI Setup, Reserve Pressure: "The valid range is 28 to 137 bar (400 to 2000 psi). The default
    // reserve pressure value is 50 bar (725 psi)." Used for the low pressure warnings and GTR; offered
    // in 5 bar steps.
    pressureSetting('reserve', { fr: 'Pression de réserve (Reserve Pressure)', en: 'Reserve Pressure' }, 30, 135, 5, 50),
    {
      // §4.9 / §12.6: "By default the low NDL alert is set to 5 minutes." Other values offered: not given by the manual.
      key: 'ndlAlert',
      label: { fr: 'Alerte NDL faible (Low NDL)', en: 'Low NDL alert' },
      options: [{ value: 'off', label: 'Off' }, ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((m) => ({ value: String(m), label: `${m} min` }))],
      default: '5',
    },
    {
      // §4.9: "By default the depth alert is set to 40 meters." Other values offered: not given by the manual.
      key: 'depthAlert',
      label: { fr: 'Alerte de profondeur (Depth)', en: 'Depth alert' },
      options: [{ value: 'off', label: 'Off' }, ...[10, 15, 20, 25, 30, 35, 40, 45, 50].map((m) => ({ value: String(m), label: `${m} m` }))],
      default: '40',
    },
    {
      // §4.9: "By default the dive time alert is set to 60 minutes, but is turned off."
      key: 'timeAlert',
      label: { fr: 'Alerte de durée (Time)', en: 'Time alert' },
      options: [{ value: 'off', label: 'Off' }, ...[30, 40, 50, 60, 70, 80, 90, 120].map((m) => ({ value: String(m), label: `${m} min` }))],
      default: 'off',
    },
  ];

  /** §10: seconds with the PPO2 above 1.65 (High PPO2) and with an ascent faster than 10 m/min (Fast Ascent). */
  protected highPpo2Sec = 0;
  protected fastSec = 0;
  /** §10 error displays, highest priority first (Low PPO2 cannot occur with air or nitrox). */
  protected notices = new Notices<PerdixNotice>(['high-ppo2', 'missed-stop', 'fast-ascent', 'very-high-cns', 'high-cns', 'low-ndl', 'depth-alert', 'time-alert', 'gas']);

  /** The screen dismisses the notification itself (SELECT), see press(). */
  acknowledgeAlerts(): boolean {
    return true;
  }

  private updateNotices(s: DiveSession): void {
    if (!s.inDive) return;
    const now: PerdixNotice[] = [];
    if (this.highPpo2Sec > 30) now.push('high-ppo2');
    if (this.ceilingViolationSec > 0) now.push('missed-stop');
    if (this.fastSec >= 10) now.push('fast-ascent'); // "sustained": no duration in the manual, 10 s assumed
    // §4.10: VERY HIGH CNS beyond 150 %, HIGH CNS beyond 90 %.
    if (s.oxygen.cns > 150) now.push('very-high-cns');
    if (s.oxygen.cns > 90) now.push('high-cns');
    // §4.9 Low NDL: at or below the alert value; "will reset if the NDL goes above the NDL alert value by 3 minutes".
    const ndlA = this.alertValue('ndlAlert');
    if (ndlA !== null) {
      const n = ndl(s.tissues, s.depth, s.gas, this.decoParams(s).gfHigh);
      if (n > ndlA + 3 - 1e-9) this.ndlArmed = true;
      if (this.ndlArmed && n <= ndlA && s.depth > 1) now.push('low-ndl');
    }
    // §4.9 Depth: deeper than the alert value; "will reset if the depth goes 2m shallower than the alert depth".
    const depthA = this.alertValue('depthAlert');
    if (depthA !== null) {
      if (s.depth < depthA - 2) this.depthArmed = true;
      if (this.depthArmed && s.depth > depthA) now.push('depth-alert');
    }
    // §4.9 Time: "The time alert will only fire once per dive."
    const timeA = this.alertValue('timeAlert');
    if (timeA !== null && !this.timeFired && s.diveTime > timeA * 60) now.push('time-alert');
    // §12.3: "Critical Pressure" warning below the larger of 21 bar or half the reserve pressure (the
    // reserve itself only turns the pressure yellow, §10.3).
    if (this.airIntegrated(s) && (s.outOfGas || s.tankPressure < this.criticalPressure())) now.push('gas');
    this.notices.update(now);
    if (now.includes('low-ndl')) this.ndlArmed = false;
    if (now.includes('depth-alert')) this.depthArmed = false;
    if (now.includes('time-alert')) this.timeFired = true;
  }

  /** §4.9 armed alerts (the low NDL and depth alerts wait for their reset margin; the time alert is spent). */
  protected ndlArmed = true;
  protected depthArmed = true;
  protected timeFired = false;

  /** §4.9 alert thresholds (null when off). */
  alertValue(key: 'ndlAlert' | 'depthAlert' | 'timeAlert'): number | null {
    const v = this.settings[key];
    return v === 'off' ? null : Number(v);
  }

  /** §12.3: critical pressure, the larger of 21 bar or half the reserve pressure. */
  criticalPressure(): number {
    return Math.max(21, this.reservePressure() / 2);
  }

  /** §8 Max. Depth: caps the MOD (Recreational modes only: not in the Technical manual). */
  modDepthLimit(): number {
    return this.mode === 'octec' ? Infinity : Number(this.settings.maxdepth) || 40;
  }

  get mode(): SwMode {
    return (this.settings.mode as SwMode) || '3gasnx';
  }

  /** Recreational manual §12.5: "up to 3 nitrox gases in the 3 GasNx dive mode"; Technical manual §11.5: 5 OC gases. */
  get maxGases(): number {
    return this.mode === 'octec' ? 5 : this.mode === '3gasnx' ? 3 : 1;
  }

  /** Adv. Config 2: deco gases obey the OC Deco PPO2 (1.61 by default). */
  decoPpo2(): number {
    return Number(this.settings.decoPpo2) || OC_DECO_PPO2;
  }

  /** Technical manual §4.10: "There are no Safety Stops in technical diving modes." */
  get hasSafetyStop(): boolean {
    return this.mode !== 'octec' && this.settings.safety !== 'off';
  }

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

  /** Custom starts from the preset in use (not described in the manual). */
  settingChanged(key: string, previous: string): void {
    const preset = GF_PRESETS[previous];
    if (key === 'gf' && this.settings.gf === 'custom' && preset) {
      [this.settings.gfLow, this.settings.gfHigh] = preset.map(String);
    }
  }

  baseParams(): DecoParams {
    if (this.mode === 'octec') {
      const lo = Number(this.settings.tecGfLow) || 30;
      const hi = Number(this.settings.tecGfHigh) || 70;
      return { gfLow: Math.min(lo, hi) / 100, gfHigh: hi / 100, lastStop: Number(this.settings.lastStop) || 3, stopStep: 3, ascentRate: 10 };
    }
    let [lo, hi] = this.settings.gf === 'custom'
      ? [Number(this.settings.gfLow), Number(this.settings.gfHigh)]
      : GF_PRESETS[this.settings.gf] ?? GF_PRESETS.med;
    lo = Math.min(lo, hi); // a GF low above the GF high is not meaningful (device check not described)
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
      tissues: s.tissues, depth: s.depth, gas: s.gas, tankPressure: s.tankPressure, reserve: this.reservePressure(),
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
    this.highPpo2Sec = this.fastSec = 0;
    this.ndlArmed = this.depthArmed = true;
    this.timeFired = false;
    this.notices.clear();
    this.clearedAt = null;
  }

  /** Session clock when the deco stops were cleared (CLEAR counter), null before. */
  protected clearedAt: number | null = null;

  tick(s: DiveSession, dt: number): void {
    if (s.inDive) {
      const gfHigh = this.decoParams(s).gfHigh;
      // §8.2 Adapt: 5 min if the dive exceeds 30 m or the NDL falls below 5 minutes.
      if (!this.adaptLong && (s.depth > 30 || ndl(s.tissues, s.depth, s.gas, gfHigh) < 5)) this.adaptLong = true;
      if (!s.tissues.tolerates(SURFACE_PRESSURE, gfHigh)) this.hadDeco = true;
      this.highPpo2Sec = s.ppO2 > 1.65 ? this.highPpo2Sec + dt : 0;
      // Technical manual §4.10: the deco clear counter starts "when decompression obligations are cleared".
      const deco = !s.tissues.tolerates(SURFACE_PRESSURE, gfHigh);
      if (deco) this.clearedAt = null;
      else if (this.hadDeco && this.clearedAt === null) this.clearedAt = s.clock;
      this.fastSec = s.ascentRate > 10 ? this.fastSec + dt : 0;
    }
    super.tick(s, dt);
    // Keep the rest of the bookkeeping but never request a safety stop.
    if (!this.hasSafetyStop) this.safetyState = 'none';
    this.updateNotices(s);
  }


  get soundKind(): AlertCue['kind'] {
    return 'buzz';
  }

  /**
   * Vibration alerts (Perdix 2 Technical modes manual, "Vibration Alerts" and §4.8; the Recreational
   * manual says nothing about vibration, but a Perdix 2 owner confirmed that it vibrates in
   * Recreational mode too): attention buzz when the safety stop starts, pauses or is
   * completed; a notification vibrates when it appears and every 10 s until it is dismissed; a high
   * PPO2 keeps vibrating until it is resolved. The Perdix 2 has no buzzer. Notifications and their
   * triggers from the Recreational manual (§10, errors table): High PPO2 (average above 1.65 for more
   * than 30 s), Missed Stop, Fast Ascent (sustained faster than 10 m/min), High CNS (above 90 %);
   * dismissed with SELECT (right button).
   */
  alertCues(v: ComputerView): AlertCue[] {
    if (this.settings.vibration === 'off' || !v.inDive) return [];
    const cues: AlertCue[] = [];
    const st = v.safety.state;
    if (st === 'active' || st === 'paused' || st === 'done') cues.push({ key: `safety-${st}`, kind: 'buzz', level: 'info', until: 'once' });
    // High PPO2 is a persistent condition: vibrates until resolved (Tech manual), dismissed or not.
    if (this.highPpo2Sec > 30) cues.push({ key: 'high-ppo2-now', kind: 'buzz', level: 'alarm', until: 'clear', every: 10 });
    // Each notification on display or waiting vibrates every 10 s until dismissed.
    for (const key of this.notices.all) cues.push({ key, kind: 'buzz', level: 'warning', until: 'ack', every: 10 });
    return cues;
  }

}
