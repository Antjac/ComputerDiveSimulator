import { type DecoParams, ndl, SURFACE_PRESSURE } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import { remainingTime } from '../../../engine/gas';
import { type AlertCue, type ComputerView, DiveComputer, SettingDef } from '../../base';
import { Notices } from '../../common/notices';
import { ppo2Setting } from '../../common/ppo2';
import { pressureSetting } from '../../common/tank';
import { OC_DECO_PPO2, decoPpo2Setting } from '../multigas';

/** §4.10 primary notifications that can occur here, highest priority first (order of the table). */
export type PeregrineNotice =
  | 'high-ppo2' | 'missed-stop' | 'fast-ascent' | 'very-high-cns' | 'high-cns'
  | 'low-ndl' | 'depth-alert' | 'time-alert' | 'critical-pres';

// §12.2 Conservatism: Low 45/95, Med 40/85 (default), High 35/75, or Custom.
export const GF_PRESETS: Record<string, [number, number]> = { low: [45, 95], med: [40, 85], high: [35, 75] };

// §12.2: "If selected, GF Low and GF High fields will appear in the Deco Menu". Range and step not given
// by the manual: 10 to 100 % by 5 assumed (not verified).
const GF_VALUES = Array.from({ length: 19 }, (_, i) => String(10 + i * 5));
const customGf = (s: Record<string, string>) => s.gf === 'custom';

/**
 * Shearwater Peregrine TX, Air and Nitrox (single gas) modes: Air with 21 % oxygen, Nitrox otherwise.
 * Rules follow the Peregrine TX Operating Instructions (Doc. 16004-RevC, 2024-04-23, firmware V98).
 */
export abstract class PeregrineRules extends DiveComputer {
  readonly id = 'peregrine';
  readonly name = 'Shearwater Peregrine TX';
  readonly algorithm = 'Bühlmann ZHL-16C + GF';
  readonly exact = true;
  readonly transmitter = 'Swift';
  readonly gasTimeName = 'GTR';
  readonly notes = {
    fr: 'Modes Air / Nitrox (un seul gaz) et 3 GasNx (par défaut, §12.1 ; jusqu’à 3 gaz Nx, §12.5) ; Gauge non simulé. 3 GasNx : le gaz le moins riche suit la MOD PPO2, les autres la PPO2 de déco (1,61 par défaut, Adv. Config 2) ; le plan suppose le passage au meilleur gaz (§6.1) ; gaz en jaune quand un meilleur gaz est disponible, notifications persistantes MOD ⟳Gas et Best Gas (§4.8) ; MENU puis FUNC sur Select Gas (§11.3 : liste de tous les gaz, meilleur gaz proposé d’abord) ; dernier palier 3 ou 6 m (§12.2). Bouton droit (FUNC) : écrans d’info (LAST DIVE, AI, MOD/MAX/PPO2, TEMP/CONSERV/CNS, GF99/SurGF/CEIL, tissus, DET/Δ+5/@+5, batterie, pression, date, n° de série) ; bouton gauche (MENU) : retour à l’écran principal (menus non simulés). Aucun verrouillage en cas de palier manqué (§5.2). Palier de sécurité ajouté au-delà de 11 m, décompte entre 2,4 et 8,3 m (§5.1) ; réglages 3, 4, 5 min, Adapt, CntUp ou Off. Notifications du §4.10 en jaune sur la ligne du bas jusqu’à l’appui sur un bouton (HIGH PPO2, MISSED DECO STOP, FAST ASCENT, VERY HIGH CNS, HIGH CNS, alertes NDL / profondeur / durée, T1 CRITICAL PRES) ; notifications persistantes à gauche du NDL (High CNS, MOD, Near MOD). Compas, boussole, mini-affichages personnalisés et menus non simulés. Émetteur : pression de réserve réglable (50 bar par défaut, §12.3), alerte critique sous max(21 bar, réserve / 2).',
    en: 'Air / Nitrox (single gas) and 3 GasNx (default, §12.1; up to 3 Nx gases, §12.5) modes; Gauge not simulated. 3 GasNx: the leanest gas obeys the MOD PPO2, the others the deco PPO2 (1.61 by default, Adv. Config 2); the plan assumes the switch to the best gas (§6.1); gas in yellow when a better gas is available, MOD ⟳Gas and Best Gas persistent notifications (§4.8); MENU then FUNC on Select Gas (§11.3: list of every gas, best gas offered first); last stop 3 or 6 m (§12.2). Right button (FUNC): info screens (LAST DIVE, AI, MOD/MAX/PPO2, TEMP/CONSERV/CNS, GF99/SurGF/CEIL, tissues, DET/Δ+5/@+5, battery, pressure, date, serial number); left button (MENU): back to the main screen (menus not simulated). No lock-out for missed stops (§5.2). Safety stop added beyond 11 m, counting down between 2.4 and 8.3 m (§5.1); settings 3, 4, 5 min, Adapt, CntUp or Off. §4.10 notifications in yellow on the bottom row until a button is pressed (HIGH PPO2, MISSED DECO STOP, FAST ASCENT, VERY HIGH CNS, HIGH CNS, NDL / depth / time alerts, T1 CRITICAL PRES); persistent notifications left of the NDL (High CNS, MOD, Near MOD). Compass, custom mini displays and menus are not simulated. Transmitter: settable reserve pressure (50 bar by default, §12.3), critical warning below max(21 bar, reserve / 2).',
  };
  readonly settingDefs: SettingDef[] = [
    {
      // §12.1 Dive Mode: Air, Nitrox, 3 GasNx (default), Gauge (not simulated). Air is Nitrox at 21 %.
      key: 'mode',
      label: { fr: 'Mode de plongée', en: 'Dive mode' },
      options: [{ value: 'nitrox', label: 'Air / Nitrox' }, { value: '3gasnx', label: '3 GasNx' }],
      default: '3gasnx',
      group: 'deco',
    },
    {
      // §12.2 Last Stop: "Only configurable in 3 GasNx mode"; 3 m or 6 m (the figure shows 3m).
      key: 'lastStop',
      label: { fr: 'Dernier palier (Last Stop)', en: 'Last Stop' },
      options: [{ value: '3', label: '3 m' }, { value: '6', label: '6 m' }],
      default: '3',
      showIf: (s) => s.mode !== 'nitrox',
    },
    decoPpo2Setting((s) => s.mode !== 'nitrox'),
    {
      key: 'gf',
      label: { fr: 'Conservatisme', en: 'Conservatism' },
      options: [
        { value: 'low', label: 'Low (45/95)' },
        { value: 'med', label: 'Med (40/85)' },
        { value: 'high', label: 'High (35/75)' },
        { value: 'custom', label: 'Custom' },
      ],
      default: 'med', // §6 / §12.2: "Medium conservatism is the default setting."
    },
    {
      key: 'gfLow',
      label: { fr: 'GF bas (Custom)', en: 'GF low (Custom)' },
      options: GF_VALUES.map((v) => ({ value: v, label: `${v} %` })),
      default: '40',
      showIf: customGf,
    },
    {
      key: 'gfHigh',
      label: { fr: 'GF haut (Custom)', en: 'GF high (Custom)' },
      options: GF_VALUES.map((v) => ({ value: v, label: `${v} %` })),
      default: '85',
      showIf: customGf,
    },
    {
      // §12.2 Safety Stops: Off, 3, 4, 5 minutes, Adapt, CntUp. Default not given: the §4.1 default
      // display shows "SAFETY STOP 3:00", so 3 min (deduced from the figure).
      key: 'safety',
      label: { fr: 'Palier de sécurité', en: 'Safety stop' },
      options: [
        { value: '3', label: '3 min' }, { value: '4', label: '4 min' }, { value: '5', label: '5 min' },
        { value: 'adapt', label: 'Adapt' }, { value: 'cntup', label: 'CntUp' }, { value: 'off', label: 'Off' },
      ],
      default: '3',
    },
    {
      // §4.3 / §12.4: the left position always shows the gas; the centre and right positions are set in
      // System Setup > Bottom Row. Default: MAX and mini display 1 (temperature and time, §4.5). The
      // other choices are the combinations shown in the manual's figures.
      key: 'bottom',
      essential: true,
      label: { fr: 'Ligne du bas', en: 'Bottom row' },
      options: [
        { value: 'default', label: 'MAX & Temp/Time' },
        { value: 'ai', label: 'T1 & GTR (AI)' },
        { value: 'gf', label: 'GF99 & SurGF' },
        { value: 'ppo2', label: 'PPO2 & SurGF' },
        { value: 'mini', label: 'Mini 2 & Mini 1' },
      ],
      default: 'default',
    },
    {
      // §4.9 / §12.6: low NDL alert, 5 min by default. Other values offered: not given by the manual.
      key: 'ndlAlert',
      label: { fr: 'Alerte NDL faible (Low NDL)', en: 'Low NDL alert' },
      options: [{ value: 'off', label: 'Off' }, ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((m) => ({ value: String(m), label: `${m} min` }))],
      default: '5',
    },
    {
      // §4.9: "By default the depth alert is set to 40 meters." Other values offered: not in the manual.
      key: 'depthAlert',
      label: { fr: 'Alerte de profondeur (Depth)', en: 'Depth alert' },
      options: [{ value: 'off', label: 'Off' }, ...[10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60].map((m) => ({ value: String(m), label: `${m} m` }))],
      default: '40',
    },
    {
      // §4.9: "By default the dive time alert is set to 60 minutes, but is turned off."
      key: 'timeAlert',
      label: { fr: 'Alerte de durée (Time)', en: 'Time alert' },
      options: [{ value: 'off', label: 'Off' }, ...[30, 40, 50, 60, 70, 80, 90, 120].map((m) => ({ value: String(m), label: `${m} min` }))],
      default: 'off',
    },
    {
      // §4.8 Vibration Alerts, §12.6. Default not given; the §12.6 figure shows "Vibration On".
      key: 'vibration',
      label: { fr: 'Vibrations', en: 'Vibration' },
      options: [{ value: 'on', label: { fr: 'Activé', en: 'On' } }, { value: 'off', label: { fr: 'Désactivé', en: 'Off' } }],
      default: 'on',
    },
    // §12.1 MOD PPO2 (Air and Nitrox modes), default 1.4; §12.5: "can be set from 1.0 to 1.69 in steps of 0.01".
    ppo2Setting(1.0, 1.69, 1.4, 'MOD PPO2', 0.01),
    // §12.3 AI Setup, Reserve Pressure: "The valid range is 28 to 137 bar (400 to 2000 psi). The default
    // reserve pressure value is 50 bar (725 psi)." Used for the low pressure warnings and GTR; offered
    // in 5 bar steps.
    pressureSetting('reserve', { fr: 'Pression de réserve (Reserve Pressure)', en: 'Reserve Pressure' }, 30, 135, 5, 50),
  ];

  /** §4.10: seconds above the PPO2 limit (HIGH PPO2), faster than 10 m/min (FAST ASCENT). */
  protected highPpo2Sec = 0;
  protected fastSec = 0;
  /** §4.9: the low NDL and depth alerts re-arm with a margin; the time alert fires once per dive. */
  protected ndlArmed = true;
  protected depthArmed = true;
  protected timeFired = false;
  protected notices = new Notices<PeregrineNotice>(['high-ppo2', 'missed-stop', 'fast-ascent', 'very-high-cns', 'high-cns', 'low-ndl', 'depth-alert', 'time-alert', 'critical-pres']);
  /** Adapt safety stop (§12.2): 5 min once the dive exceeded 30 m or the NDL fell below 5 minutes. */
  protected adaptLong = false;
  /** Deco stops were required during this dive (§5.2 "Complete", §7.2 "CLEAR" counter). */
  protected hadDeco = false;

  constructor() {
    super();
    // §5.1: required once deeper than 11 m; countdown begins shallower than 6 m and runs between 2.4
    // and 8.3 m; reset if the depth exceeds 11 m again.
    this.safetyStop = { trigger: 11, start: 6, top: 2.4, bottom: 8.3, reset: 11 };
    this.stopWindow = 1.5; // §5.2: "at the stop depth or up to 5ft (1.5m) deeper" (§7.2 says 1.8 m)
    this.ceilingMargin = 0; // §5.2: flashes red as soon as shallower than the stop
    this.screenTimeout = 10_000; // §4.6: info screens time out after 10 s (not tissues, AI, compass)
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
    let [lo, hi] = this.settings.gf === 'custom'
      ? [Number(this.settings.gfLow), Number(this.settings.gfHigh)]
      : GF_PRESETS[this.settings.gf] ?? GF_PRESETS.med;
    lo = Math.min(lo, hi); // a GF low above the GF high is not meaningful (device check not described)
    // §5.2: stops every 3 m; §12.2: last stop set only in 3 GasNx mode, 3 m otherwise; §4.4: deco
    // calculations assume 10 m/min.
    const last = this.maxGases > 1 ? Number(this.settings.lastStop) || 3 : 3;
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: last, stopStep: 3, ascentRate: 10 };
  }

  /** §12.5: "up to 3 nitrox gases in the 3 GasNx dive mode". */
  get maxGases(): number {
    return this.settings.mode === 'nitrox' ? 1 : 3;
  }

  /** Adv. Config 2: deco gases obey the OC Deco PPO2 (1.61 by default). */
  decoPpo2(): number {
    return Number(this.settings.decoPpo2) || OC_DECO_PPO2;
  }

  /** §4.4: 1 arrow per 3 m/min; yellow above 9 m/min (4–5 arrows), flashing red above 18 m/min (6). */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate > 18 ? 2 : rate > 9 ? 1 : 0;
  }

  /** §4.10 FAST ASCENT: "sustained as faster than 10m/min". */
  ascentAlarmCondition(rate: number): boolean {
    return rate > 10;
  }

  /** §12.3: "Critical Pressure" below the larger of 21 bar or half the reserve pressure. */
  criticalPressure(): number {
    return Math.max(21, this.reservePressure() / 2);
  }

  /**
   * §10.7 GTR: minutes at the current depth until a direct ascent at 10 m/min would surface with the
   * reserve pressure, from the current SAC. Safety and deco stops are not considered.
   */
  gasTime(s: DiveSession, _p: DecoParams, sacBar: number): number | null {
    return remainingTime({
      tissues: s.tissues, depth: s.depth, gas: s.gas, tankPressure: s.tankPressure, reserve: this.reservePressure(),
      sacBar, rate: () => 10, deco: null,
    });
  }

  /** CntUp counts up from zero (§12.2): the stop never completes by itself. */
  get countUp(): boolean {
    return this.settings.safety === 'cntup';
  }

  safetySeconds(): number {
    const v = this.settings.safety;
    if (v === 'adapt') return this.adaptLong ? 300 : 180;
    if (v === 'cntup') return 99 * 60 + 59;
    return Number(v) * 60 || 180;
  }

  /** §4.9 alert thresholds (null when off). */
  protected alertValue(key: 'ndlAlert' | 'depthAlert' | 'timeAlert'): number | null {
    const v = this.settings[key];
    return v === 'off' ? null : Number(v);
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.adaptLong = false;
    this.hadDeco = false;
    this.highPpo2Sec = this.fastSec = 0;
    this.ndlArmed = this.depthArmed = true;
    this.timeFired = false;
    this.notices.clear();
  }

  tick(s: DiveSession, dt: number): void {
    const now: PeregrineNotice[] = [];
    if (s.inDive) {
      const gfHigh = this.decoParams(s).gfHigh;
      const n = ndl(s.tissues, s.depth, s.gas, gfHigh);
      // §12.2 Adapt: 5 min if the dive exceeds 30 m or the NDL falls below 5 minutes.
      if (!this.adaptLong && (s.depth > 30 || n < 5)) this.adaptLong = true;
      if (!s.tissues.tolerates(SURFACE_PRESSURE, gfHigh)) this.hadDeco = true;
      // §4.8: HIGH PPO2 when the average PPO2 stays above the limit for more than 30 s; in Air and
      // Nitrox modes the limit is the OC MOD PPO2, in 3 GasNx the deco gases obey the Deco PPO2 (Adv.
      // Config 2 "Bottom Gases Vs. Deco Gases", deduced).
      const limit = s.breathing > 0 && this.maxGases > 1 ? this.decoPpo2() : this.modPpo2;
      this.highPpo2Sec = s.ppO2 > limit ? this.highPpo2Sec + dt : 0;
      this.fastSec = s.ascentRate > 10 ? this.fastSec + dt : 0;
      if (this.highPpo2Sec > 30) now.push('high-ppo2');
      // §5.2: "Significant stop violations will result in a MISSED STOP notification": threshold not
      // given, 10 s above the stop assumed.
      if (this.ceilingViolationSec >= 10) now.push('missed-stop');
      if (this.fastSec >= 10) now.push('fast-ascent'); // "sustained": duration not given, 10 s assumed
      if (s.oxygen.cns > 150) now.push('very-high-cns');
      if (s.oxygen.cns > 90) now.push('high-cns');
      // §4.9 Low NDL: at or below the alert value; resets once the NDL is 3 min above it.
      const ndlA = this.alertValue('ndlAlert');
      if (ndlA !== null) {
        if (n > ndlA + 3 - 1e-9) this.ndlArmed = true;
        if (this.ndlArmed && n <= ndlA && s.depth > 1) { now.push('low-ndl'); }
      }
      // §4.9 Depth: deeper than the alert value; resets 2 m shallower than it.
      const depthA = this.alertValue('depthAlert');
      if (depthA !== null) {
        if (s.depth < depthA - 2) this.depthArmed = true;
        if (this.depthArmed && s.depth > depthA) now.push('depth-alert');
      }
      // §4.9 Time: "will only fire once per dive".
      const timeA = this.alertValue('timeAlert');
      if (timeA !== null && !this.timeFired && s.diveTime > timeA * 60) now.push('time-alert');
      if (this.airIntegrated(s) && s.tankPressure < this.criticalPressure()) now.push('critical-pres');
    }
    super.tick(s, dt);
    if (this.settings.safety === 'off') this.safetyState = 'none';
    if (s.inDive) {
      this.notices.update(now);
      // Once raised, the low NDL and depth alerts wait for their reset margin; the time alert is spent.
      if (now.includes('low-ndl')) this.ndlArmed = false;
      if (now.includes('depth-alert')) this.depthArmed = false;
      if (now.includes('time-alert')) this.timeFired = true;
    }
  }

  /** §4.8: a notification is dismissed by pressing either button (see press()). */
  acknowledgeAlerts(): boolean {
    return true;
  }

  get soundKind(): AlertCue['kind'] {
    return 'buzz';
  }

  /**
   * §4.8 Vibration Alerts: attention vibration when a safety stop starts, pauses or is completed; a
   * primary notification vibrates when it first occurs and every 10 seconds until acknowledged. The
   * Peregrine TX has no buzzer.
   */
  alertCues(v: ComputerView): AlertCue[] {
    if (this.settings.vibration === 'off' || !v.inDive) return [];
    const cues: AlertCue[] = [];
    const st = v.safety.state;
    if (st === 'active' || st === 'paused' || st === 'done') cues.push({ key: `safety-${st}`, kind: 'buzz', level: 'info', until: 'once' });
    for (const key of this.notices.all) cues.push({ key, kind: 'buzz', level: 'warning', until: 'ack', every: 10 });
    return cues;
  }
}
