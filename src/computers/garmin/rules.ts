import type { DecoParams } from '../../engine/buhlmann';
import type { DiveSession } from '../../engine/session';
import { remainingTime } from '../../engine/gas';
import { type AlertCue, type ComputerView, DiveComputer, SettingDef } from '../base';
import { ppo2Setting } from '../common/ppo2';
import { pressureSetting } from '../common/tank';

// Garmin conservatism presets (gradient factors).
export const PRESETS: Record<string, [number, number]> = { low: [45, 95], medium: [40, 85], high: [35, 70] };

// Manual, Dive Setup: "The Custom option sets a custom gradient factor". Range and step not given:
// 10 to 100 % by 5 assumed (not verified).
const GF_VALUES = Array.from({ length: 19 }, (_, i) => String(10 + i * 5));
const customGf = (s: Record<string, string>) => s.gf === 'custom';

/**
 * Garmin Descent Mk3, single-gas mode.
 * Layout and thresholds follow the Descent Mk3 Series owner's manual (Dive data screens, safety and
 * decompression stops, alerts).
 */
export abstract class DescentRules extends DiveComputer {
  readonly id = 'garmin';
  readonly name = 'Garmin Descent Mk3i';
  readonly algorithm = 'Bühlmann ZHL-16C + GF';
  readonly exact = true;
  readonly transmitter = 'Descent T2';
  readonly gasTimeName = 'ATR';
  readonly notes = {
    fr: 'Bühlmann ZHL-16C avec facteurs de gradient : Low, Medium, High ou Custom (GF bas et haut réglés séparément ; bornes et pas non donnés par le manuel, 10 à 100 % par 5 supposés). DOWN (et UP en sens inverse) : écrans de données ; LIGHT, START et BACK ne sont pas simulés. Verrouillage de déco après 3 min au-dessus du plafond. L’écran TTS / plafond / GF99 / Surface GF est un écran personnalisé : sur la montre, ces champs s’ajoutent via Dive Setup > Display Settings > Data Screens. Émetteur : pression de réserve réglable (valeur par défaut non indiquée : 50 bar supposé), alertes « T1 is below reserve pressure. » et « T1 pressure is critically low. » sous max(21 bar, réserve / 2) ; la montre n’a pas d’alerte de demi-bloc. Alertes du tableau Dive Alerts : Approaching NDL (10 et 5 min), NDL exceeded, Approaching Deco Stop, Decompression Cleared, Safety Stop Started / Cleared, CNS 80 % et 100 % (toutes les 2 min, 3 fois), OTU 250 et 300, PO2 Warning (valeur en jaune) et PO2 is high (toutes les 30 s, 3 fois ; seuils 1,4 / 1,6 bar supposés), alertes personnalisées de profondeur et de durée (texte non donné : « Depth Alert » / « Time Alert » déduits). Mode Single-Gas : les gaz de déco de la page sont des gaz de secours (« backup gases »), hors NDL et TTS tant qu’ils ne sont pas activés ; START > Gas : choix d’un gaz (UP / DOWN, START, BACK pour revenir). Le mode Multi-Gas (invite « Safe to switch to… ») est un autre mode de plongée, non simulé. Non simulés : fin automatique de plongée, batterie, capteur, CCR, mode Multi-Gas.',
    en: 'Bühlmann ZHL-16C with gradient factors: Low, Medium, High or Custom (GF low and high set separately; range and step not given by the manual, 10 to 100 % by 5 assumed). DOWN (and UP backwards): data screens; LIGHT, START and BACK are not simulated. Decompression lockout after 3 min above the ceiling. The TTS / ceiling / GF99 / Surface GF screen is a custom one: on the watch, these fields are added via Dive Setup > Display Settings > Data Screens. Transmitter: settable reserve pressure (default not given: 50 bar assumed), "T1 is below reserve pressure." and "T1 pressure is critically low." below max(21 bar, reserve / 2) alerts; the watch has no half tank alert. Dive Alerts table: Approaching NDL (10 and 5 min), NDL exceeded, Approaching Deco Stop, Decompression Cleared, Safety Stop Started / Cleared, CNS 80% and 100% (every 2 min, 3 times), OTU 250 and 300, PO2 Warning (yellow value) and PO2 is high (every 30 s, 3 times; 1.4 / 1.6 bar thresholds assumed), custom depth and time alerts (text not given: "Depth Alert" / "Time Alert" deduced). Single-Gas mode: the deco gases set on the page are backup gases, left out of the NDL and TTS until activated; START > Gas: choose a gas (UP / DOWN, START, BACK to go back). The Multi-Gas mode ("Safe to switch to…" prompt) is another dive mode, not simulated. Not simulated: automatic dive end, battery, sensor, CCR, Multi-Gas mode.',
  };
  readonly settingDefs: SettingDef[] = [
    {
      key: 'gf',
      label: { fr: 'Conservatisme', en: 'Conservatism' },
      options: [
        { value: 'low', label: 'Low (45/95)' },
        { value: 'medium', label: 'Medium (40/85)' },
        { value: 'high', label: 'High (35/70)' },
        { value: 'custom', label: 'Custom' },
      ],
      default: 'medium',
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
      key: 'layout',
      essential: true,
      label: { fr: 'Affichage', en: 'Display' },
      options: [{ value: 'big', label: 'Big Numbers' }, { value: 'std', label: 'Standard' }],
      default: 'big',
    },
    {
      key: 'safety',
      label: { fr: 'Palier de sécurité', en: 'Safety stop' },
      options: [{ value: '3', label: '3 min' }, { value: '4', label: '4 min' }, { value: '5', label: '5 min' }],
      default: '3',
    },
    {
      key: 'lastStop',
      label: { fr: 'Dernier palier', en: 'Last deco stop' },
      options: [{ value: '3', label: '3 m' }, { value: '6', label: '6 m' }],
      default: '3',
    },
    {
      // Manual, dive settings: "Silent Diving: Disables all tones and vibrations for alerts during dive
      // activities". Default not given: off assumed.
      key: 'silent',
      label: { fr: 'Plongée silencieuse', en: 'Silent diving' },
      options: [{ value: 'on', label: { fr: 'Activé', en: 'On' } }, { value: 'off', label: { fr: 'Désactivé', en: 'Off' } }],
      default: 'off',
    },
    // Manual, Setting PO2 Thresholds (MOD/Deco PO2): range and default not given, 1.0–1.6 and 1.4 assumed.
    { ...ppo2Setting(1.0, 1.6, 1.4, 'MOD/Deco PO2'), label: { fr: 'MOD/Deco PO2', en: 'MOD/Deco PO2' } },
    // Manual, Transceiver Settings: "Reserve Pressure: Sets the threshold values for reserve pressure and
    // critical pressure alerts" (both always on; no half tank or turn pressure alert on the device).
    // Range and default not given: 20 to 100 bar by 5, 50 bar assumed (not verified).
    pressureSetting('reserve', { fr: 'Pression de réserve (Reserve Pressure)', en: 'Reserve Pressure' }, 20, 100, 5, 50),
    // Setting PO2 Thresholds: "PO2 Warning" (the PO2 value flashes yellow) and "PO2 Critical" (alert "PO2
    // is high"). Ranges and defaults not given: 1.4 and 1.6 bar assumed.
    {
      key: 'po2Warn',
      label: { fr: 'Seuil PO2 Warning', en: 'PO2 Warning' },
      options: [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6].map((b) => ({ value: b.toFixed(1), label: `${b.toFixed(1)} bar` })),
      default: '1.4',
    },
    {
      key: 'po2Crit',
      label: { fr: 'Seuil PO2 Critical', en: 'PO2 Critical' },
      options: [1.4, 1.5, 1.6, 1.7, 1.8].map((b) => ({ value: b.toFixed(1), label: `${b.toFixed(1)} bar` })),
      default: '1.6',
    },
    // Custom Dive Alerts (Scuba Alerts): "Depth: the alert occurs when you reach the selected depth",
    // "Time: the alert occurs when the selected time interval elapses". None is set by default.
    {
      key: 'depthAlert',
      label: { fr: 'Alerte personnalisée de profondeur (Depth)', en: 'Custom depth alert' },
      options: [{ value: 'off', label: { fr: 'Aucune', en: 'None' } }, ...Array.from({ length: 20 }, (_, i) => ({ value: String(5 + i * 5), label: `${5 + i * 5} m` }))],
      default: 'off',
    },
    {
      key: 'timeAlert',
      label: { fr: 'Alerte personnalisée de durée (Time, intervalle)', en: 'Custom time alert (interval)' },
      options: [{ value: 'off', label: { fr: 'Aucune', en: 'None' } }, ...[5, 10, 15, 20, 30, 45, 60].map((m) => ({ value: String(m), label: `${m} min` }))],
      default: 'off',
    },
  ];

  /**
   * Single-Gas mode: "You can set up to 11 additional gases as backup gases" (the deco gases set on the
   * page are taken as backup gases); "Backup gases are not used in no-decompression limit (NDL) and time
   * to surface (TTS) decompression calculations until you activate them during a dive".
   */
  get maxGases(): number {
    return 12;
  }

  planGases() {
    return [];
  }

  /** "MOD/Deco PO2": one threshold for the bottom gas and the decompression gases. */
  decoPpo2(): number {
    return this.modPpo2;
  }

  /** The transceiver is paired with the main tank only here. */
  airIntegrated(s: DiveSession): boolean {
    return super.airIntegrated(s) && s.breathing === 0;
  }

  /** PO2 Critical threshold (bar): "PO2 is high" alert, value flashing red. */
  get po2Critical(): number {
    return Number(this.settings.po2Crit) || 1.6;
  }

  /** PO2 Warning threshold (bar): the PO2 value flashes yellow. */
  get po2Warning(): number {
    return Number(this.settings.po2Warn) || 1.4;
  }

  constructor() {
    super();
    // Safety stop after ≥11 m, stop depth 5 m: countdown within 1 m of it, pauses more than 3 m above,
    // resets below 11 m.
    this.safetyStop = { trigger: 11, start: 6, top: 2, bottom: 7, reset: 11 };
    this.ascentAlarmDelay = 5; // "faster than 9.1 m/min for more than 5 seconds"
    this.ceilingMargin = 0.6;
    this.lockAfter = 180;
    this.stopWindow = 0.6;
    this.ndlCap = 100; // "99+" beyond 99 min (not given by the manual)
    this.init();
  }

  /**
   * Custom starts from the preset in use (Garmin forum, Descent Mk1: "It defaults to the current GF
   * setting, and will show the low and high values"; not stated in the Mk3 manual).
   */
  settingChanged(key: string, previous: string): void {
    const preset = PRESETS[previous];
    if (key === 'gf' && this.settings.gf === 'custom' && preset) {
      [this.settings.gfLow, this.settings.gfHigh] = preset.map(String);
    }
  }

  baseParams(): DecoParams {
    let [lo, hi] = this.settings.gf === 'custom'
      ? [Number(this.settings.gfLow), Number(this.settings.gfHigh)]
      : PRESETS[this.settings.gf] ?? PRESETS.medium;
    // A GF low above the GF high is not meaningful: capped at the GF high (the watch's own check is
    // not described in the manual).
    lo = Math.min(lo, hi);
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: Number(this.settings.lastStop), stopStep: 3, ascentRate: 10 };
  }

  /** Green < 7.9, yellow 7.9–10.1, red > 10.1 m/min. */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate > 10.1 ? 2 : rate >= 7.9 ? 1 : 0;
  }

  ascentAlarmCondition(rate: number): boolean {
    return rate > 9.1;
  }

  /**
   * Air time remaining (manual, Dive terminology): time at the current depth until an ascent at 9 m/min
   * would surface with the reserve pressure. Decompression stops are included, safety stops are not.
   */
  gasTime(s: DiveSession, p: DecoParams, sacBar: number): number | null {
    return remainingTime({
      tissues: s.tissues, depth: s.depth, gas: s.gas, tankPressure: s.tankPressure, reserve: this.reservePressure(),
      sacBar, rate: () => 9, deco: p, anchor: this.anchor,
    });
  }

  safetySeconds(): number {
    return Number(this.settings.safety) * 60;
  }


  get soundKind(): AlertCue['kind'] {
    return 'both';
  }

  /**
   * Dive alerts (manual, "Dive Alerts" table): each pops up with a tone and a vibration ("Sound and
   * Vibe"), once: Approaching NDL at 10 then 5 min, NDL exceeded, ascending too fast, above the deco
   * ceiling, PO2 above the warning value. The exact tone of each alert is not described.
   */
  /**
   * Descent T2 manual, Transceiver Settings: "The critical pressure threshold value is the greater of
   * half of the reserve pressure or 21 bar (300 PSI)."
   */
  criticalPressure(): number {
    return Math.max(21, this.reservePressure() / 2);
  }

  alertCues(v: ComputerView): AlertCue[] {
    if (this.settings.silent === 'on' || !v.inDive) return [];
    const cues: AlertCue[] = [];
    const pop = (key: string, level: AlertCue['level']) => cues.push({ key, kind: 'both', level, until: 'once' });
    if (!v.inDeco && v.ndl <= 10) pop(v.ndl <= 5 ? 'ndl-5' : 'ndl-10', 'info');
    if (v.inDeco) pop('deco', 'warning');
    if (v.alarms.includes('ASCENT')) pop('fast-ascent', 'alarm');
    if (v.alarms.includes('CEILING')) pop('ceiling', 'alarm');
    if (v.ppO2 > this.po2Critical) pop('po2', 'alarm');
    // Transceiver Alerts: "The paired watch vibrates and plays a warning tone" below the reserve and
    // below the critical pressure.
    if (v.tank.ai && v.tank.pressure < v.tank.reserve) pop(v.tank.pressure < this.criticalPressure() ? 'tank-critical' : 'tank-reserve', 'warning');
    return cues;
  }
}
