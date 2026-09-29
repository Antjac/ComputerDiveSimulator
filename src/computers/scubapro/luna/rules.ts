import { ceilingDepth, type DecoParams } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import { type AlertCue, ComputerView, SettingDef } from '../../base';
import { ScubaproRules, idealAscent, levelParams } from '../common';
import { ppo2Setting } from '../../common/ppo2';

/** GF settings offered (GF low 5–100, GF high 50–100 on the device, §2.1.2.4); 30/70 is the one of the manual's figures. */
const GF_SETS = ['30/70', '30/85', '35/75', '40/85', '45/95', '50/80', '100/100'];

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
      fr: 'Deux algorithmes (§2.1.2.2) : ZH-L16 ADT MB (ajustements non publiés : approximation, niveaux MB L0 à L5, PDIS) ou ZH-L16C+GF (Bühlmann avec gradient factors : reproduit ; les paliers GF s’ajoutent à la déco 100/100). Sonde désactivée : se comporte comme le Luna 2.0 (température et NDL en bas). Vitesse de remontée idéale selon la profondeur, SLOW DOWN au-delà de 110 % ; palier de sécurité de 3 min dès 5 m après 10 m ; MISSED DECO 0,5 m au-dessus du palier ; SOS 24 h. Bouton droit : écran suivant (appui long : confirmer une alarme, pause du chronomètre) ; bouton gauche : écran précédent (appui long : repère, remise à zéro du chronomètre). Non simulés : fréquence cardiaque et charge de travail, multigaz (PMG), altitude, apnée et profondimètre, avertissements réglables dans LogTRAK (valeurs par défaut non indiquées).',
      en: 'Two algorithms (§2.1.2.2): ZH-L16 ADT MB (unpublished adjustments: approximation, MB levels L0 to L5, PDIS) or ZH-L16C+GF (Bühlmann with gradient factors: reproduced; GF stops come on top of the 100/100 deco). Transmitter off: behaves as the Luna 2.0 (temperature and NDL at the bottom). Depth-dependent ideal ascent rate, SLOW DOWN above 110 %; 3-min safety stop from 5 m after 10 m; MISSED DECO 0.5 m above the stop; 24 h SOS. Right button: next screen (hold: confirm an alarm, pause the timer); left button: previous screen (hold: bookmark, reset the timer). Not simulated: heart rate and workload, multi-gas (PMG), altitude, apnea and gauge modes, warnings set in LogTRAK (defaults not given).',
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
  ];

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
    for (const k of this.activeAlarms(v)) {
      if (this.confirmed.has(k)) continue;
      if (k === 'cns100') cues.push({ key: k, kind: 'beep', level: 'alarm', until: 'once', first: 12 });
      else cues.push({ key: k, kind: 'beep', level: 'alarm', until: 'ack', every: 2 });
    }
    if (v.cns >= 75 && v.cns < 100) cues.push({ key: 'cns75', kind: 'beep', level: 'warning', until: 'once', first: 12 });
    if (this.levelReducedAt > 0 && v.inDive) cues.push({ key: `relaxed-${this.levelReducedAt}`, kind: 'beep', level: 'warning', until: 'once' });
    return cues;
  }
}
