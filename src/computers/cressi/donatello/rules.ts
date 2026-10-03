import type { DiveSession } from '../../../engine/session';
import { type AlertCue, type ComputerView, SettingDef } from '../../base';
import { ppo2Setting } from '../../common/ppo2';
import { CressiRules } from '../common';

// Sections are those of the Donatello / Michelangelo "Direction for use" (EN, rev. 03/2019, reprint
// 01/2023): the manual has no numbered sections, so its headings and page numbers are quoted.

/** DEPTH alarm (DIVE-SET, p. 16-17): OFF (factory setting) or 10 to 50 m in 2 m steps. */
const DEPTH_ALARMS = Array.from({ length: 21 }, (_, i) => 10 + 2 * i);

/**
 * Cressi Donatello, AIR / NITROX modes (the FREE and GAGE modes are not simulated). Same rules as
 * the Goa (Cressi RGBM approximated, ../common.ts), plus the Donatello's own: maximum depth alarm,
 * AL.SP (fast ascent alarm silenced), PO2 icon kept after the MOD was exceeded, audible deep stop.
 */
export abstract class DonatelloRules extends CressiRules {
  readonly id = 'donatello';
  readonly name = 'Cressi Donatello';
  readonly notes = {
    fr: "Montre à un seul bouton, modes AIR et NITROX (FREE et GAGE non simulés). Le RGBM Cressi (9 tissus) est propriétaire : approximation (Bühlmann + SF0/SF1/SF2, pénalité en successives et après des remontées rapides prolongées), commune avec le Goa. Conforme au manuel : points de vitesse (SLOW dès 12 m/min), palier de sécurité 3 min entre 5 et 3 m, deep stop sonore, pré-alarme de déco à 3 min, icône DECO avec flèches, palier omis plus de 2 min = mode ERROR (STOP) pendant 48 h, alarme de profondeur maximale, AL.SP (alarme de vitesse muette), icône PO2 conservée jusqu'à la fin de la plongée, interdiction de vol 12 / 24 / 48 h. Bouton : appui court = informations complémentaires (ppO2 max et sa profondeur, mode, profondeur max, heure) ; appui long = rétroéclairage 5 s. En surface, l'écran DESAT alterne avec l'écran PREDIVE ; l'appui court passe à l'écran TIME (les autres menus ne sont pas simulés). Altitude, carnet et planificateur non simulés.",
    en: 'Single-button watch, AIR and NITROX modes (FREE and GAGE not simulated). Cressi RGBM (9 tissues) is proprietary: approximation (Bühlmann + SF0/SF1/SF2, penalties for repetitive dives and prolonged fast ascents), shared with the Goa. As per the manual: ascent rate dots (SLOW from 12 m/min), 3 min safety stop between 5 and 3 m, audible deep stop, deco prewarning at 3 min, DECO icon with arrows, stop omitted for more than 2 min = ERROR mode (STOP) for 48 h, maximum depth alarm, AL.SP (silent ascent alarm), PO2 icon kept until the end of the dive, 12 / 24 / 48 h no-fly. Button: short press = additional information (max ppO2 and its depth, mode, max depth, time); long press = backlight for 5 s. At the surface, the DESAT screen alternates with the PREDIVE screen; a short press moves to the TIME screen (the other menus are not simulated). Altitude, logbook and planner not simulated.',
  };
  readonly settingDefs: SettingDef[] = [
    // DIVE-SET, SF (p. 16): SF0 / SF1 / SF2, factory setting SF0.
    {
      key: 'sf',
      label: { fr: 'Facteur de sécurité', en: 'Safety factor' },
      options: [{ value: 'SF0', label: 'SF0' }, { value: 'SF1', label: 'SF1' }, { value: 'SF2', label: 'SF2' }],
      default: 'SF0',
    },
    // DIVE-SET, DEEP STOP (p. 16): "factory set with DEEP STOP active".
    {
      key: 'deepstop',
      label: { fr: 'Deep stop', en: 'Deep stop' },
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      default: 'on',
    },
    // OXYGEN PARTIAL PRESSURE (p. 17-18): 1.4 bar in the factory, 1.2 to 1.6 bar in 0.1 steps.
    ppo2Setting(1.2, 1.6, 1.4, 'PPO2'),
    // DEPTH, maximum depth alarm (p. 16-17): "set in the factory with DEPTH set to OFF".
    {
      key: 'depthAlarm',
      label: { fr: 'Alarme de profondeur (DEPTH)', en: 'Depth alarm (DEPTH)' },
      options: [{ value: 'off', label: 'OFF' }, ...DEPTH_ALARMS.map((d) => ({ value: String(d), label: `${d} m` }))],
      default: 'off',
    },
    // AL.SP (p. 21-22): disables the audible fast ascent alarm (instructors). The factory value is
    // not given in the manual: alarm enabled assumed.
    {
      key: 'alsp',
      label: { fr: 'Bip de vitesse (AL.SP)', en: 'Ascent beep (AL.SP)' },
      options: [{ value: 'on', label: { fr: 'Active', en: 'On' } }, { value: 'off', label: { fr: 'Désactivée', en: 'Off' } }],
      default: 'on',
    },
  ];

  /** PO2 ALARM (p. 26): once the MOD was exceeded, the PO2 icon stays on for the rest of the dive. */
  protected po2Exceeded = false;

  constructor() {
    super();
    // Additional information (short press, p. 24-25): the delay before the dive screen comes back is
    // not given in the manual; 5 s assumed (as on the Goa).
    this.screenTimeout = 5000;
    this.init();
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.po2Exceeded = false;
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (s.inDive && s.depth > this.modDepth(s.gas.o2)) this.po2Exceeded = true;
  }

  /** Maximum depth alarm threshold in metres (null when OFF). */
  depthAlarm(): number | null {
    const v = Number(this.settings.depthAlarm);
    return v > 0 ? v : null;
  }

  /** AL.SP (p. 21): "for the entire dive the computer displays the icon of a speaker with an X". */
  protected ascentSound(): boolean {
    return this.settings.alsp !== 'off';
  }

  /** The deep stop is shown (to reach or in progress). */
  protected deepShown(): boolean {
    return this.deepState === 'pending' || this.deepState === 'active';
  }

  alertCues(v: ComputerView): AlertCue[] {
    const cues = super.alertCues(v);
    if (!v.inDive) return cues;
    // DEPTH (p. 17): "three consecutive audible beeps", the depth flashes until back above the threshold.
    const max = this.depthAlarm();
    if (max !== null && v.depth > max) cues.push({ key: 'depth-max', kind: 'beep', level: 'warning', until: 'once', first: 1.5 });
    // DEEP STOP (p. 29): "DEEP STOP will be displayed and an audible alarm will sound".
    if (this.deepShown()) cues.push({ key: 'deep-stop', kind: 'beep', level: 'info', until: 'once' });
    return cues;
  }
}
