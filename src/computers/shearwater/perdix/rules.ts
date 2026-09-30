import { type DecoParams, ndl, SURFACE_PRESSURE } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import { remainingTime } from '../../../engine/gas';
import { type AlertCue, type ComputerView, DiveComputer, SettingDef } from '../../base';
import { Notices } from '../../common/notices';
import { ppo2Setting } from '../../common/ppo2';
import { pressureSetting } from '../../common/tank';

export type PerdixNotice = 'high-ppo2' | 'missed-stop' | 'fast-ascent' | 'very-high-cns' | 'high-cns' | 'low-ndl' | 'depth-alert' | 'time-alert' | 'gas';

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
    fr: 'Mode Nitrox Recreational. Bouton droit (SELECT) : écrans d’info (MOD/MAX/PPO2, GF99/SurGF/CEIL, tissus, DET/Δ+5/@+5…) ; bouton gauche (MENU) : retour à l’écran principal (le menu de plongée n’est pas simulé). Aucun verrouillage en cas de palier manqué (conforme au manuel). Palier de sécurité ajouté dès 11 m et affiché dès lors (§6.1), décompte entre 2,4 et 7 m. Notifications du §10 (High PPO2 au-delà de 1,65 pendant 30 s, Missed Stop, Fast Ascent au-delà de 10 m/min, High CNS au-delà de 90 %, Very High CNS au-delà de 150 %) et alertes du §4.9 (Low NDL 5 min, Depth 40 m, Time 60 min désactivée par défaut ; valeur concernée en jaune) affichées en bas de l’écran sous « Warning » ou « Alert » jusqu’à SELECT. Vibrations (règles du manuel Tech) : début, pause et fin du palier de sécurité, notifications toutes les 10 s jusqu’à SELECT, High PPO2 jusqu’à sa résolution. Émetteur : pression de réserve réglable (50 bar par défaut, §12.3), T1 en jaune sous la réserve, en rouge et T1 CRITICAL PRES sous max(21 bar, réserve / 2).',
    en: 'Nitrox Recreational mode. Right button (SELECT): info screens (MOD/MAX/PPO2, GF99/SurGF/CEIL, tissues, DET/Δ+5/@+5…); left button (MENU): back to the main screen (the dive menu is not simulated). No lock-out for missed stops (as per the manual). Safety stop added beyond 11 m and shown from then on (§6.1), counting down between 2.4 and 7 m. §10 notifications (High PPO2 above 1.65 for 30 s, Missed Stop, Fast Ascent above 10 m/min, High CNS above 90 %, Very High CNS above 150 %) and §4.9 alerts (Low NDL 5 min, Depth 40 m, Time 60 min off by default; the value concerned in yellow) shown at the bottom of the screen under "Warning" or "Alert" until SELECT. Vibration (rules of the Tech manual): safety stop start, pause and end, notifications every 10 s until SELECT, High PPO2 until resolved. Transmitter: settable reserve pressure (50 bar by default, §12.3), T1 yellow below the reserve, red and T1 CRITICAL PRES below max(21 bar, reserve / 2).',
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
      label: { fr: 'Profondeur max. de la MOD (Max. Depth)', en: 'MOD depth limit (Max. Depth)' },
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

  /** §8 Max. Depth: caps the MOD. */
  modDepthLimit(): number {
    return Number(this.settings.maxdepth) || 40;
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
  }

  tick(s: DiveSession, dt: number): void {
    if (s.inDive) {
      const gfHigh = this.decoParams(s).gfHigh;
      // §8.2 Adapt: 5 min if the dive exceeds 30 m or the NDL falls below 5 minutes.
      if (!this.adaptLong && (s.depth > 30 || ndl(s.tissues, s.depth, s.gas, gfHigh) < 5)) this.adaptLong = true;
      if (!s.tissues.tolerates(SURFACE_PRESSURE, gfHigh)) this.hadDeco = true;
      this.highPpo2Sec = s.ppO2 > 1.65 ? this.highPpo2Sec + dt : 0;
      this.fastSec = s.ascentRate > 10 ? this.fastSec + dt : 0;
    }
    super.tick(s, dt);
    // Keep the rest of the bookkeeping but never request a safety stop.
    if (this.settings.safety === 'off') this.safetyState = 'none';
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
