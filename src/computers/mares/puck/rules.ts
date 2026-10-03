import { ceilingDepth, depthToPressure, ndl, pressureToDepth, type DecoParams } from '../../../engine/buhlmann';
import { type DiveSession } from '../../../engine/session';
import { type AlertCue, type ComputerView, DiveComputer, SettingDef } from '../../base';
import { FastAscentRgbm, GasSequence, MissedStop, maresCues, maresRgbmParams } from '../common';
import { GasPrompt } from '../../common/gasSwitch';
import { ppo2Setting } from '../../common/ppo2';

/**
 * Mares Puck Pro. Display and rules follow the Puck Pro instruction manual (display information,
 * alarms, missed deco stop, uncontrolled ascent). Mares RGBM (Wienke) itself is proprietary: it is
 * approximated with Bühlmann + a repetitive-dive penalty.
 */
export abstract class PuckRules extends DiveComputer {
  readonly id = 'mares';
  readonly name = 'Mares Puck Pro';
  readonly algorithm = 'Mares RGBM (≈)';
  readonly exact = false;
  readonly notes = {
    fr: 'Le RGBM Mares est propriétaire : approximation (Bühlmann + P0/P1/P2, pénalité en successives). Affichage et règles conformes au manuel : alarme à 10 m/min, remontée incontrôlée (> 12 m/min) ou palier manqué > 3 min = mode profondimètre pour les plongées suivantes. Bouton : informations alternatives (profondeur moyenne, O2 % et CNS en nitrox, heure) ; appui long : rétroéclairage. Deux gaz G1 et G2 (§3.5 ; bloc principal et premier gaz de déco de la page) : au MOD de G2 pendant la remontée, bip et O2 % de G1 clignotant 20 s ; appui : G2 proposé (O2 % clignotant, MOD en haut à droite) ; appui long : confirmation, appui : annulation ; appui long avec l’O2 % affiché : changement manuel. Remontée calculée avec le gaz respiré seulement (supposé, comme le Quad Air) ; ppO2max de G2 1,6 bar supposé.',
    en: 'Mares RGBM is proprietary: approximation (Bühlmann + P0/P1/P2, repetitive-dive penalty). Display and rules as per the manual: alarm at 10 m/min, uncontrolled ascent (> 12 m/min) or missed stop > 3 min = bottom timer mode for the following dives. Button: alternate information (average depth, O2 % and CNS on nitrox, time of day); hold: backlight. Two gases G1 and G2 (§3.5; the main tank and the first deco gas set on the page): at the MOD of G2 during the ascent, a beep and the O2 % of G1 blinking for 20 s; press: G2 proposed (O2 % blinking, MOD top right); hold: confirm, press: cancel; hold with the O2 % shown: manual switch. Ascent computed with the gas breathed only (assumed, as on the Quad Air); ppO2max of G2 1.6 bar assumed.',
  };
  readonly settingDefs: SettingDef[] = [
    {
      key: 'personal',
      label: { fr: 'Facteur P', en: 'P factor' },
      options: [{ value: 'P0', label: 'P0' }, { value: 'P1', label: 'P1' }, { value: 'P2', label: 'P2' }],
      default: 'P0',
    },
    {
      // §2.2.1.7 ALRM turns the audible alarms off (on by default, assumed).
      key: 'alrm',
      label: { fr: 'Alarmes sonores (ALRM)', en: 'Audible alarms (ALRM)' },
      options: [{ value: 'on', label: { fr: 'Activé', en: 'On' } }, { value: 'off', label: { fr: 'Désactivé', en: 'Off' } }],
      default: 'on',
    },
    // Manual §2.2: ppO2max 1.4 bar from the factory, adjustable between 1.2 and 1.6 bar (step not given: 0.1).
    ppo2Setting(1.2, 1.6, 1.4, 'ppO2max'),
    {
      // §3.5.1: G2 has its own ppO2max, set "in a manner completely similar to G1" (1.2 to 1.6 bar); its
      // value is not given: 1.6 bar assumed.
      key: 'ppo2Deco',
      label: { fr: 'ppO2max du gaz G2', en: 'ppO2max of gas G2' },
      options: [1.2, 1.3, 1.4, 1.5, 1.6].map((v) => ({ value: v.toFixed(2), label: `${v.toFixed(1)} bar` })),
      default: '1.60',
      group: 'deco',
    },
  ];

  /** §3.5: two gases, G1 and G2. */
  get maxGases(): number {
    return 2;
  }
  /** §3.5.2: gas switch prompt (O2 % of G1 blinking, 20 s) and the switch sequence. */
  protected prompt = new GasPrompt();
  protected seq = new GasSequence();

  decoPpo2(): number {
    return Number(this.settings.ppo2Deco) || 1.6;
  }

  /** Ascent time with the gas breathed only (not stated for the Puck Pro: as the Quad Air §3.5.2). */
  planGases() {
    return [];
  }

  /** MOD of G1 and G2, each with its own ppO2max (the MOD of G2 is its switch depth, §3.5). */
  protected gasMods(s: DiveSession): number[] {
    return this.knownGases(s).map((g, i) => (i === 0 ? this.modDepth(g.o2) : Math.max(0, pressureToDepth(this.decoPpo2() / g.o2))));
  }

  deepState: 'none' | 'pending' | 'active' | 'done' = 'none';
  deepRemaining = 120;
  deepTarget = 0;
  /** Depth where a >12 m/min ascent started (uncontrolled ascent detection). */
  protected fast = new FastAscentRgbm();
  protected fastViolation = false;
  protected missed = new MissedStop('rgbm');
  protected decoViolation = false;
  /** Violations behind the bottom timer mode, whose symbols stay on during the next dives (§3.2.1, §3.2.4.1). */
  protected lockedFast = false;
  protected lockedDeco = false;
  protected ndlTimer = 0;
  protected lastNdl = 99;

  constructor() {
    super();
    // Safety stop: dives deeper than 10 m, 3 minutes between 6 and 3 m.
    this.safetyStop = { trigger: 10, start: 6, top: 3, bottom: 6, reset: 10 };
    this.ceilingMargin = 0.3; // alarm when more than 0.3 m above the stop
    this.lockAfter = null; // handled below (1 m for 3 min)
    this.lockHours = 24;
    this.stopWindow = 1;
    this.screenTimeout = 0;
    this.init();
  }

  baseParams(): DecoParams {
    return maresRgbmParams(this.settings.personal, null);
  }

  algoParams(s: DiveSession): DecoParams {
    return maresRgbmParams(this.settings.personal, s);
  }

  /** Fast-ascent alarm from 10 m/min. */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate >= 10 ? 2 : rate >= 8 ? 1 : 0;
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.deepState = 'none';
    this.deepRemaining = 120;
    this.deepTarget = 0;
    this.fast.reset();
    this.fastViolation = false;
    this.missed.reset();
    this.decoViolation = false;
    this.screen = 0;
    this.prompt.reset();
    this.seq.cancel();
  }

  onDiveEnd(s: DiveSession): void {
    // After a violation, the following dives run in bottom timer mode only.
    if (this.fastViolation || this.decoViolation) {
      this.lock(s);
      this.lockedFast = this.fastViolation;
      this.lockedDeco = this.decoViolation;
    }
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive) return;
    // §3.5.2: "The automatic blinking of the oxygen concentration of G1 lasts only for 20 seconds."
    if (!this.locked) {
      this.prompt.update(s, this.gasMods(s), 20);
      this.seq.expire(s, 20);
    }

    // Uncontrolled ascent: > 12 m/min started deeper than 12 m and kept for 2/3 of that depth.
    if (this.fast.update(s.ascentRate, s.depth)) this.fastViolation = true;

    // Missed deco stop: more than 1 m above the stop for more than 3 minutes.
    const p = this.decoParams(s);
    const ceil = ceilingDepth(s.tissues, this.anchor, p);
    const inDeco = ceil > 0;
    const stopDepth = inDeco ? Math.max(p.lastStop, Math.ceil(ceil / p.stopStep - 1e-6) * p.stopStep) : 0;
    this.ndlTimer -= dt;
    if (this.ndlTimer <= 0) {
      this.ndlTimer = 10;
      this.lastNdl = inDeco ? 0 : ndl(s.tissues, s.depth, s.gas, p.gfHigh);
    }
    if (inDeco) {
      if (this.missed.update(stopDepth - s.depth, dt)) this.decoViolation = true;
    } else {
      this.missed.reset();
    }

    // Deep stop (not mandatory): generated when approaching the no-deco limit on dives deeper than 20 m.
    if (this.deepState === 'none' && s.maxDepth > 20 && (inDeco || this.lastNdl <= 10)) {
      // Half the absolute pressure of the maximum depth; below 10 m a deep stop makes no sense.
      this.deepTarget = Math.round(pressureToDepth(depthToPressure(s.maxDepth) / 2));
      this.deepState = this.deepTarget >= 10 ? 'pending' : 'done';
    }
    if (this.deepState === 'pending' || this.deepState === 'active') {
      if (Math.abs(s.depth - this.deepTarget) <= 1) {
        this.deepState = 'active';
        this.deepRemaining -= dt;
        if (this.deepRemaining <= 0) this.deepState = 'done';
      } else if (s.depth < this.deepTarget - 1) {
        this.deepState = 'done';
      } else if (this.deepState === 'active') {
        this.deepState = 'pending';
      }
    }
  }


  /**
   * Audible alarms (instruction manual §3.2): fast ascent, MOD exceeded and missed deco stop sound while they last;
   * CNS 100 %: 5 s in one-minute intervals. §2.2.1.7 ALRM turns the audible alarms off (on by default, assumed).
   */
  alertCues(v: ComputerView): AlertCue[] {
    if (this.settings.alrm === 'off' || !v.inDive) return [];
    const cues = maresCues(v);
    // §3.5.2: "Puck Pro sounds an audible signal" at the MOD of G2.
    if (this.prompt.offer !== null) cues.push({ key: `switch-${this.prompt.offer}`, kind: 'beep', level: 'info', until: 'once' });
    return cues;
  }
}
