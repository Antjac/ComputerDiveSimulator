import type { DecoParams } from '../../engine/buhlmann';
import type { DiveSession } from '../../engine/session';
import { remainingTime } from '../../engine/gas';
import { type AlertCue, type ComputerView, DiveComputer, SettingDef } from '../base';
import { ppo2Setting } from '../common/ppo2';

// Garmin conservatism presets (gradient factors).
export const PRESETS: Record<string, [number, number]> = { low: [45, 95], medium: [40, 85], high: [35, 70] };

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
    fr: 'Bühlmann ZHL-16C avec facteurs de gradient. DOWN (et UP en sens inverse) : écrans de données ; LIGHT, START et BACK ne sont pas simulés. Verrouillage de déco après 3 min au-dessus du plafond. L’écran TTS / plafond / GF99 / Surface GF est un écran personnalisé : sur la montre, ces champs s’ajoutent via Dive Setup > Display Settings > Data Screens.',
    en: 'Bühlmann ZHL-16C with gradient factors. DOWN (and UP backwards): data screens; LIGHT, START and BACK are not simulated. Decompression lockout after 3 min above the ceiling. The TTS / ceiling / GF99 / Surface GF screen is a custom one: on the watch, these fields are added via Dive Setup > Display Settings > Data Screens.',
  };
  readonly settingDefs: SettingDef[] = [
    {
      key: 'gf',
      label: { fr: 'Conservatisme', en: 'Conservatism' },
      options: [
        { value: 'low', label: 'Low (45/95)' },
        { value: 'medium', label: 'Medium (40/85)' },
        { value: 'high', label: 'High (35/70)' },
      ],
      default: 'medium',
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
    ppo2Setting(1.0, 1.6, 1.4, 'MOD/Deco PO2'),
  ];

  constructor() {
    super();
    // Safety stop after ≥11 m, stop depth 5 m: countdown within 1 m of it, pauses more than 3 m above,
    // resets below 11 m.
    this.safetyStop = { trigger: 11, start: 6, top: 2, bottom: 7, reset: 11 };
    this.ascentAlarmDelay = 5; // "faster than 9.1 m/min for more than 5 seconds"
    this.ceilingMargin = 0.6;
    this.lockAfter = 180;
    this.stopWindow = 0.6;
    this.init();
  }

  baseParams(): DecoParams {
    const [lo, hi] = PRESETS[this.settings.gf] ?? PRESETS.medium;
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
      tissues: s.tissues, depth: s.depth, gas: s.gas, tankPressure: s.tankPressure, reserve: s.tank.reserve,
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
  alertCues(v: ComputerView): AlertCue[] {
    if (this.settings.silent === 'on' || !v.inDive) return [];
    const cues: AlertCue[] = [];
    const pop = (key: string, level: AlertCue['level']) => cues.push({ key, kind: 'both', level, until: 'once' });
    if (!v.inDeco && v.ndl <= 10) pop(v.ndl <= 5 ? 'ndl-5' : 'ndl-10', 'info');
    if (v.inDeco) pop('deco', 'warning');
    if (v.alarms.includes('ASCENT')) pop('fast-ascent', 'alarm');
    if (v.alarms.includes('CEILING')) pop('ceiling', 'alarm');
    if (v.depth > v.mod) pop('po2', 'alarm');
    return cues;
  }
}
