import type { DecoParams } from '../../../engine/buhlmann';
import { type AlertCue, ComputerView, SettingDef } from '../../base';
import { ScubaproRules, idealAscent, levelParams } from '../common';
import { ppo2Setting } from '../../common/ppo2';

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
    fr: 'ZH-L16 ADT MB a des ajustements non publiés : approximation. Affichage et règles conformes au manuel : écran Light (Classic automatique en déco), vitesse de remontée idéale selon la profondeur (jaune > 110 %, alarme > 140 %), niveaux MB (réduits si le palier est ignoré de plus de 1,5 m), PDIS. Bouton MORE : informations alternatives ; TIMER : repère (et relance du palier de sécurité) ; LIGHT : rétroéclairage. Boussole et écrans de profil non simulés.',
    en: 'ZH-L16 ADT MB has unpublished adjustments: approximation. Display and rules as per the manual: Light screen (Classic automatically in deco), depth-dependent ideal ascent rate (yellow > 110 %, alarm > 140 %), MB levels (reduced if a stop is ignored by more than 1.5 m), PDIS. MORE button: alternate information; TIMER: bookmark (and safety stop restart); LIGHT: backlight. Compass and profile displays are not simulated.',
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

  /** Yellow above 110 % of the ideal rate, ASCENT TOO FAST above 140 %. */
  ascentLevel(rate: number, depth: number): 0 | 1 | 2 {
    const pct = rate / idealAscent(depth);
    return pct > 1.4 ? 2 : pct > 1.1 ? 1 : 0;
  }

  /**
   * Audible alarms (user manual §3.7 and following): ascent above 110 % of the ideal rate, the beeps
   * getting faster as the excess grows; MOD exceeded, beeping incessantly while deeper; missed deco
   * stop, a sequence of beeps while more than 0.5 m above; CNS O2 100 %, beeps for 12 s, then 5 s in
   * 1-minute intervals. Silenced by the all-silent mode (§2.2.9).
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
    return cues;
  }
}
