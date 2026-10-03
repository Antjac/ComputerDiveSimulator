import { type DecoParams, COMPARTMENTS, ceilingDepth, depthToPressure, equilibriumDepth, pressureToDepth } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import { type AlertCue, ComputerView, DiveComputer, SettingDef, desaturationTime } from '../../base';
import { ppo2Setting } from '../../common/ppo2';
import { PERSONAL } from '../d5/rules';

// Sections are those of the Suunto Zoop Novo user guide (EN, 2021-07-09) and its quick guide. Where
// the Zoop Novo guide is silent, the Suunto Vyper Air user's guide ("VA §…") is used as an
// indication only: same Suunto RGBM generation, and the Zoop Novo guide copies several of its
// sentences word for word (mandatory safety stop, ascent rate bar, deepstops shown in seconds).

/** §3.17: personal adjustment 0 (default), 1, 2. GF equivalents: the D5's 0 / +1 / +2 (not calibrated for the Zoop Novo). */
export const ZOOP_PERSONAL: Record<string, number> = { '0': PERSONAL['0'], '1': PERSONAL['+1'], '2': PERSONAL['+2'] };

/** §3.9: depth alarm at 30 m by default, adjustable or off (range not given: 10 to 60 m assumed). */
const DEPTH_ALARMS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
/** §3.15: dive time alarm, a countdown in minutes (default and range not given: off, 10 to 90 min assumed). */
const TIME_ALARMS = [10, 20, 30, 40, 45, 50, 60, 70, 80, 90];

/**
 * §3.19 deepstop: the Zoop Novo guide gives neither its depth nor its length. VA §5.10: "placing the
 * first stop about halfway between the maximum depth and the ceiling depth", then "another Deep stop
 * [...] halfway to the ceiling, and so on"; length 1 or 2 min on the Vyper Air (a setting the Zoop
 * Novo does not have): 2 min assumed (the VA §5.1 figure shows "110 seconds left").
 */
const DEEP_SECONDS = 120;
/** Iterative deepstops end where the safety stop zone begins (6 m): assumed, "until the ceiling depth is reached" (VA §5.10). */
const DEEP_MIN_DEPTH = 6;
/**
 * Mandatory safety stop after a fast ascent: its length "depends on the speed violation" (§3.19),
 * not given. VA §5.9.2's figure shows "a one minute mandatory safety stop": 1 min per violation
 * (each ascent above 10 m/min for more than 5 s) assumed.
 */
const MANDATORY_SECONDS = 60;
/** Its ceiling: "you must not ascend shallower than 3 m/10 ft with the Mandatory Safety Stop warning on" (VA §5.9.2). */
export const MANDATORY_CEILING = 3;

export type ZoopNotice = 'olf' | 'depth' | 'time';

/**
 * Suunto Zoop Novo, Air / Nitrox modes (Gauge and Free not simulated). Suunto RGBM is proprietary:
 * approximated with Bühlmann + personal setting + penalties. Continuous decompression (§3.8):
 * ceiling, floor and ceiling zone; algorithm lock (Er) after 3 minutes above the ceiling (§3.16).
 */
export abstract class ZoopNovoRules extends DiveComputer {
  readonly id = 'zoopnovo';
  readonly name = 'Suunto Zoop Novo';
  readonly algorithm = 'Suunto RGBM (≈)';
  readonly exact = false;
  readonly notes = {
    fr: "Modes Air et Nitrox (Gauge et Free non simulés). Le Suunto RGBM est propriétaire : approximation (Bühlmann + réglage personnel P0/P1/P2, pénalités en successives, après un palier obligatoire ou un deepstop non faits), non calibrée sur des tables publiées. Conforme au guide : décompression continue (plafond CEILING à une décimale, plancher, zone du plafond, flèches), ASC TIME, vitesse max 10 m/min (SLOW, barre à droite), palier de sécurité recommandé 3 min entre 6 et 3 m, palier obligatoire après plus de 5 s au-dessus de 10 m/min, deepstop au-delà de 20 m, Er et verrouillage 48 h après 3 min au-dessus du plafond, alarme de profondeur (30 m par défaut), OLF %, interdiction de vol d'au moins 12 h (48 h après Er). Boutons : UP / DOWN = vues de la ligne du bas ; SELECT = repère (et chronomètre) ; MODE = rétroéclairage, appui long = chronomètre ; en surface, MODE passe de TIME à DIVE et PLAN. Non précisé par le guide du Zoop Novo, repris du guide du Vyper Air (même RGBM, texte en partie identique) : deepstops successifs à mi-chemin entre la profondeur max et le plafond (2 min supposées), palier obligatoire sous un plafond de 3 m (1 min par dépassement supposée), un cycle par case de la ligne du bas (DOWN à gauche, UP à droite ; MAX et DIVE TIME par défaut, vu sur une photo d'un Zoop Novo), temps sans palier non affiché au-delà de 99 min. Toujours supposé : graduations de la barre de vitesse. Altitude, carnet et réglages sur l'appareil non simulés.",
    en: 'Air and Nitrox modes (Gauge and Free not simulated). Suunto RGBM is proprietary: approximation (Bühlmann + personal setting P0/P1/P2, penalties for repetitive dives and for skipped mandatory stops or deepstops), not calibrated on published tables. As per the guide: continuous decompression (CEILING with one decimal, floor, ceiling zone, arrows), ASC TIME, max ascent rate 10 m/min (SLOW, bar on the right), recommended 3 min safety stop between 6 and 3 m, mandatory stop after more than 5 s above 10 m/min, deepstop beyond 20 m, Er and 48 h lock after 3 min above the ceiling, depth alarm (30 m by default), OLF %, no-fly at least 12 h (48 h after Er). Buttons: UP / DOWN = bottom row views; SELECT = bookmark (and stopwatch); MODE = backlight, hold = stopwatch; at the surface, MODE goes from TIME to DIVE and PLAN. Not given in the Zoop Novo guide, taken from the Vyper Air guide (same RGBM, partly identical text): successive deepstops halfway between the maximum depth and the ceiling (2 min assumed), mandatory stop under a 3 m ceiling (1 min per violation assumed), one cycle per bottom row field (DOWN left, UP right; MAX and DIVE TIME by default, as seen on a photo of a Zoop Novo), no-decompression time not shown above 99 min. Still assumed: ascent bar scale. Altitude, logbook and on-device settings not simulated.',
  };
  readonly settingDefs: SettingDef[] = [
    // §3.17: personal adjustment, 0 by default.
    {
      key: 'personal',
      label: { fr: 'Réglage personnel', en: 'Personal adjustment' },
      options: [
        { value: '0', label: { fr: 'P0 (conditions idéales)', en: 'P0 (ideal conditions)' } },
        { value: '1', label: { fr: 'P1 (prudent)', en: 'P1 (conservative)' } },
        { value: '2', label: { fr: 'P2 (plus prudent)', en: 'P2 (more conservative)' } },
      ],
      default: '0',
    },
    // §3.19: "Deepstop is on by default in Air and Nitrox modes".
    {
      key: 'deepstop',
      label: { fr: 'Deepstop', en: 'Deepstop' },
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      default: 'on',
    },
    // §3.12.2: PO2 1.4 bar by default in Nitrox mode (range not given: 1.0 to 1.6 assumed). In Air mode
    // the pre-checks (§3.1 figure) show a PO2 of 1.6.
    ppo2Setting(1.0, 1.6, 1.4, 'PO2, Nitrox'),
    {
      key: 'depthAlarm',
      label: { fr: 'Alarme de profondeur', en: 'Depth alarm' },
      options: [{ value: 'off', label: 'Off' }, ...DEPTH_ALARMS.map((d) => ({ value: String(d), label: `${d} m` }))],
      default: '30',
    },
    {
      key: 'timeAlarm',
      label: { fr: 'Alarme de durée (ALARM TIME)', en: 'Dive time alarm (ALARM TIME)' },
      options: [{ value: 'off', label: 'Off' }, ...TIME_ALARMS.map((m) => ({ value: String(m), label: `${m} min` }))],
      default: 'off',
    },
    // §3.25: tones on or off ("when tones are off, there are no audible alarms"). Default not given: on.
    {
      key: 'tones',
      label: { fr: 'Sons (Tones)', en: 'Tones' },
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      default: 'on',
    },
  ];

  // Per-dive state.
  /** Seconds above 10 m/min in the current ascent episode, and whether it already counted. */
  protected fastSec = 0;
  protected fastCounted = false;
  /** §3.19: a mandatory safety stop was added (fast ascent), and its remaining seconds. */
  mandatory = false;
  mandatoryRemaining = 0;
  /** Seconds spent above the mandatory stop's ceiling while it is due. */
  protected mandatoryAboveSec = 0;
  /** The diver has reached the mandatory stop zone (6 m) since the stop was added. */
  protected mandatoryReached = false;
  /** Deepstop (§3.19). */
  deepState: 'none' | 'pending' | 'active' | 'violated' | 'done' = 'none';
  deepTarget = 0;
  deepRemaining = DEEP_SECONDS;
  /** Depth of the previous deepstop (iterative deepstops, VA §5.10); null before the first. */
  protected deepFrom: number | null = null;
  /** A deepstop or the mandatory safety stop was skipped: the next dives are penalised (§3.4, §3.8). */
  protected skipped = false;
  hadDeco = false;
  protected notices = new Set<ZoopNotice>();
  protected acked = new Set<ZoopNotice>();

  // Between dives.
  protected penaltyUntil = -Infinity;
  penaltyActive = false;
  noFlyUntil = -Infinity;

  constructor() {
    super();
    // §3.19: recommended safety stop after any dive over 10 m, three minutes in the 3-6 m range.
    this.safetyStop = { trigger: 10, start: 6, top: 3, bottom: 6, reset: 10 };
    this.ascentAlarmDelay = 0; // §3.2: SLOW as soon as 10 m/min is exceeded
    this.violationRef = 'ceiling'; // continuous decompression: the ceiling itself
    this.ceilingMargin = 0.1; // "if you ascend above the ceiling": no margin given
    this.lockAfter = 180; // §3.16: "longer than three (3) minutes"
    this.lockHours = 48;
    this.stopWindow = 1.2; // §3.8: ceiling zone, "between the ceiling depth and 1.2 m below"
    this.ndlCap = 100; // §5.1: no-decompression time "0 to 99 min (– after 99)"
    this.init();
  }

  /** The MOD's PO2: 1.6 in Air mode (pre-check figure), the Nitrox setting otherwise. */
  modDepth(o2: number): number {
    const ppo2 = o2 <= 0.21 + 1e-6 ? 1.6 : this.modPpo2;
    return Math.max(0, pressureToDepth(ppo2 / o2));
  }

  baseParams(): DecoParams {
    const hi = ZOOP_PERSONAL[this.settings.personal] ?? ZOOP_PERSONAL['0'];
    return { gfLow: hi - 0.1, gfHigh: hi, lastStop: 3, stopStep: 3, ascentRate: 10 };
  }

  algoParams(s: DiveSession): DecoParams {
    const p = this.baseParams();
    // Repetitive dives (§3.24: "computing closely spaced repetitive diving"): same fading penalty as the D5.
    let drop = 0;
    if (s.lastDiveEnd !== null) {
      const si = ((s.inDive ? s.diveStart : s.clock) - s.lastDiveEnd) / 60;
      drop += 0.08 * Math.exp(-si / 120);
    }
    if (this.penaltyActive) drop += 0.05;
    return { ...p, gfHigh: p.gfHigh - drop, gfLow: p.gfLow - drop };
  }

  /** §3.4 / §3.2: maximum ascent rate 10 m/min. */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate > 10 ? 2 : 0;
  }

  /** §3.8 floor: where decompression starts, i.e. where the leading compartment stops on-gassing (approximation). */
  floorDepth(s: DiveSession, ceiling: number): number {
    const g = s.tissues.gradientPercents(depthToPressure(ceiling));
    let lead = 0;
    for (let i = 1; i < COMPARTMENTS; i++) if (g[i] > g[lead]) lead = i;
    return Math.max(ceiling + this.stopWindow, equilibriumDepth(s.tissues, lead, s.gas));
  }

  /** OLF %: the larger of CNS % and OTU % (§3.24.3); OTU % taken against 300 OTU (limit not given). */
  olf(s: DiveSession): number {
    return Math.max(s.oxygen.cns, (s.oxygen.otu / 300) * 100);
  }

  depthAlarm(): number | null {
    const v = Number(this.settings.depthAlarm);
    return v > 0 ? v : null;
  }

  timeAlarm(): number | null {
    const v = Number(this.settings.timeAlarm);
    return v > 0 ? v : null;
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.fastSec = 0;
    this.fastCounted = false;
    this.mandatory = false;
    this.mandatoryRemaining = 0;
    this.mandatoryAboveSec = 0;
    this.mandatoryReached = false;
    this.deepState = 'none';
    this.deepRemaining = DEEP_SECONDS;
    this.deepFrom = null;
    this.skipped = false;
    this.hadDeco = false;
    this.notices.clear();
    this.acked.clear();
    this.penaltyActive = s.clock < this.penaltyUntil;
  }

  onDiveEnd(s: DiveSession): void {
    const desat = desaturationTime(s.tissues);
    // §3.8, §3.4: a skipped mandatory safety stop or deepstop penalises the next dive(s) (while desaturating).
    if (this.mandatory && this.mandatoryRemaining > 0) this.skipped = true;
    this.penaltyUntil = this.skipped ? s.clock + desat * 60 : -Infinity;
    // §3.16: "if you dive again in this error state, the algorithm lock time resets to 48 hours when you surface".
    if (this.locked) this.lockedUntil = s.clock + 48 * 3600;
    // §3.23: no-fly at least 12 h, the desaturation time when longer; not shown below 70 min of
    // desaturation; always 48 h after an error state.
    if (this.locked) this.noFlyUntil = s.clock + 48 * 3600;
    else this.noFlyUntil = desat < 70 ? -Infinity : s.clock + Math.max(12 * 60, desat) * 60;
  }

  /** Remaining no-fly time in minutes (0 when not shown). */
  noFlyLeft(s: DiveSession): number {
    return Math.max(0, (this.noFlyUntil - s.clock) / 60);
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive) return;
    const d = s.depth;

    // §3.19: "when the ascent rate exceeds 10 m (33 ft) per minute for more than five consecutive
    // seconds", a mandatory safety stop is added.
    if (s.ascentRate > 10) {
      this.fastSec += dt;
      if (this.fastSec > 5 && !this.fastCounted) {
        // "The total length of the Mandatory Safety Stop time depends on the seriousness of the
        // ascent rate violation" (VA §5.9.2): one more minute per violation (assumed).
        this.fastCounted = true;
        this.mandatory = true;
        this.mandatoryRemaining += MANDATORY_SECONDS;
      }
    } else {
      this.fastSec = 0;
      this.fastCounted = false;
    }
    // Mandatory stop counted in the 6 to 3 m zone (§3.19).
    if (this.mandatory && this.mandatoryRemaining > 0 && d <= 6) this.mandatoryReached = true;
    if (this.mandatory && this.mandatoryRemaining > 0 && d <= 6 && d >= MANDATORY_CEILING - 0.3) this.mandatoryRemaining = Math.max(0, this.mandatoryRemaining - dt);
    // Above its ceiling: "immediately (within 3 minutes) descend"; corrected, "no effects on [...]
    // future dives"; if the violation continues, the next dive is penalised (VA §5.9.2).
    if (this.mandatoryViolatedNow(s)) {
      this.mandatoryAboveSec += dt;
      if (this.mandatoryAboveSec > 180) this.skipped = true;
    }

    if (this.locked) return;
    const p = this.decoParams(s);
    const ceil = ceilingDepth(s.tissues, this.anchor, p);
    if (ceil > 0) this.hadDeco = true;

    // §3.19 deepstops, deeper than 20 m. VA §5.10: the first one halfway between the maximum depth
    // and the ceiling, then halfway between the previous one and the ceiling, and so on (see DEEP_SECONDS).
    if (this.settings.deepstop === 'on' && s.maxDepth > 20 && this.deepState !== 'done') {
      if (this.deepState === 'none' || this.deepState === 'pending') this.deepTarget = Math.round(((this.deepFrom ?? s.maxDepth) + ceil) / 2 * 10) / 10;
      if (this.deepState === 'none') this.deepState = 'pending';
      if (Math.abs(d - this.deepTarget) <= 1.5) {
        this.deepState = 'active';
        this.deepRemaining -= dt;
        if (this.deepRemaining <= 0) {
          // Completed: the next one halfway to the ceiling, unless it falls in the safety stop zone.
          const next = (this.deepTarget + ceil) / 2;
          if (next > DEEP_MIN_DEPTH) {
            this.deepFrom = this.deepTarget;
            this.deepState = 'pending';
            this.deepRemaining = DEEP_SECONDS;
          } else {
            this.deepState = 'done';
          }
        }
      } else if (d < this.deepTarget - 1.5 && (this.deepState === 'active' || this.deepState === 'violated')) {
        // Above the deepstop: "Mandatory deepstop violated" (§3.2); abandoned 3 m above it (assumed).
        this.deepState = d < this.deepTarget - 3 ? 'done' : 'violated';
        if (this.deepState === 'done') this.skipped = true;
      } else if (this.deepState === 'active') {
        this.deepState = 'pending';
      }
    }

    // Notices acknowledged with any button (§3.2): OLF 80 % / 100 % (Nitrox only), depth, dive time.
    const now = new Set<ZoopNotice>();
    const olf = this.olf(s);
    if (s.gas.o2 > 0.21 && olf >= 80) now.add('olf');
    const maxD = this.depthAlarm();
    if (maxD !== null && d > maxD) now.add('depth');
    const maxT = this.timeAlarm();
    if (maxT !== null && s.diveTime >= maxT * 60) now.add('time');
    for (const k of [...this.acked]) if (!now.has(k)) this.acked.delete(k);
    this.notices = now;
  }

  /** Notices waiting for a button press. */
  pendingNotices(): ZoopNotice[] {
    return [...this.notices].filter((k) => !this.acked.has(k));
  }

  /** Any button acknowledges the notices on display (§3.2). */
  protected ackNotices(): void {
    for (const k of this.notices) this.acked.add(k);
  }

  acknowledgeAlerts(): boolean {
    return true;
  }

  /** Seconds of stops still to do (deepstop, mandatory stop), added to ASC TIME (§3.8). */
  protected extraStopSeconds(): number {
    const deep = this.deepState === 'pending' || this.deepState === 'active' || this.deepState === 'violated' ? this.deepRemaining : 0;
    return deep + (this.mandatory ? this.mandatoryRemaining : 0);
  }

  compute(s: DiveSession): ComputerView {
    const v = super.compute(s);
    const extra = s.inDive && !this.locked ? Math.ceil(this.extraStopSeconds() / 60) : 0;
    const tts = v.inDeco || extra > 0 ? v.tts + extra : v.tts;
    return { ...v, tts, noFly: this.noFlyLeft(s) };
  }

  summary(v: ComputerView): { ndl: string; stop: string; tts: string } {
    const b = super.summary(v);
    if (v.locked || !v.inDeco) return b;
    return { ...b, stop: `${v.ceiling.toFixed(1)} m (${b.stop})` };
  }

  /**
   * §3.2 sounds: high priority (2.4 s sound + 2.4 s break) for PO2, ceiling (both repeated for at
   * most three minutes) and ascent rate (three times); low priority (0.8 s + 3.2 s) for entering
   * decompression (twice), deepstop violated, mandatory safety stop violated (for three minutes),
   * deepstop reached, OLF 80 / 100 %, depth and dive time (twice). The guidance beeps ('start
   * ascending' / 'descending') are part of each pattern here. No sound with Tones off (§3.25).
   */
  alertCues(v: ComputerView): AlertCue[] {
    if (this.settings.tones === 'off' || !v.inDive) return [];
    const cues: AlertCue[] = [];
    if (v.depth > v.mod) cues.push({ key: 'po2', kind: 'beep', level: 'alarm', until: 'clear', every: 4.8 });
    if (v.alarms.includes('CEILING')) cues.push({ key: 'ceiling', kind: 'beep', level: 'alarm', until: 'clear', every: 4.8 });
    if (v.alarms.includes('ASCENT')) cues.push({ key: 'slow', kind: 'beep', level: 'alarm', until: 'once', first: 14.4 });
    if (v.inDeco) cues.push({ key: 'deco', kind: 'beep', level: 'warning', until: 'once', first: 8 });
    if (this.deepState === 'violated') cues.push({ key: 'deep-violated', kind: 'beep', level: 'warning', until: 'once' });
    if (this.deepState === 'active') cues.push({ key: 'deep-reached', kind: 'beep', level: 'info', until: 'once' });
    if (this.mandatoryViolated(v)) cues.push({ key: 'stop-violated', kind: 'beep', level: 'warning', until: 'clear', every: 4 });
    for (const k of this.pendingNotices()) cues.push({ key: `notice-${k}`, kind: 'beep', level: 'warning', until: 'once', first: 8 });
    return cues;
  }

  /** Mandatory safety stop started and the diver above its ceiling (§3.2). */
  protected mandatoryViolatedNow(s: { inDive: boolean; depth: number }): boolean {
    return s.inDive && this.mandatory && this.mandatoryRemaining > 0 && this.mandatoryReached && s.depth < MANDATORY_CEILING - 0.3 && s.depth > 0.5;
  }

  mandatoryViolated(v: ComputerView): boolean {
    return this.mandatoryViolatedNow(v);
  }


}
