import { SettingDef } from '../../base';
import { ppo2Setting } from '../../common/ppo2';
import { CressiRules } from '../common';

/**
 * Cressi Goa, AIR / NITROX modes. Display and rules follow the Goa / Cartesio user manual: ascent rate
 * dots (SLOW from 12 m/min), safety stop between 5 and 3 m, deep stop, deco prewarning at 3 min,
 * omitted stop alarm then ERROR mode for 48 h, 12 / 24 / 48 h no-fly (shared Cressi rules in
 * ../common.ts). Cressi RGBM itself is proprietary: approximated with Bühlmann + safety factor +
 * penalties.
 */
export abstract class GoaRules extends CressiRules {
  readonly id = 'goa';
  readonly name = 'Cressi Goa';
  readonly notes = {
    fr: 'Le RGBM Cressi (9 tissus) est propriétaire : approximation (Bühlmann + SF0/SF1/SF2, pénalité en successives et après des remontées rapides prolongées). Affichage et règles conformes au manuel : points de vitesse (SLOW dès 12 m/min), palier de sécurité 3 min entre 5 et 3 m, deep stop, pré-alarme de déco à 3 min, palier omis plus de 2 min = mode ERROR pendant 48 h, interdiction de vol 12 / 24 / 48 h. Boutons ▲ / ▼ : informations complémentaires (ppO2 max, mode, profondeur max, heure) ; ▲ long : rétroéclairage.',
    en: 'Cressi RGBM (9 tissues) is proprietary: approximation (Bühlmann + SF0/SF1/SF2, penalties for repetitive dives and prolonged fast ascents). Display and rules as per the manual: ascent rate dots (SLOW from 12 m/min), 3 min safety stop between 5 and 3 m, deep stop, deco prewarning at 3 min, stop omitted for more than 2 min = ERROR mode for 48 h, 12 / 24 / 48 h no-fly. ▲ / ▼ buttons: additional information (max ppO2, mode, max depth, time); ▲ hold: backlight.',
  };
  readonly settingDefs: SettingDef[] = [
    {
      key: 'sf',
      label: { fr: 'Facteur de sécurité', en: 'Safety factor' },
      options: [{ value: 'SF0', label: 'SF0' }, { value: 'SF1', label: 'SF1' }, { value: 'SF2', label: 'SF2' }],
      default: 'SF0',
    },
    {
      key: 'deepstop',
      label: { fr: 'Deep stop', en: 'Deep stop' },
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      default: 'on',
    },
    // Manual: PO2 set in the factory to 1.4 bar, adjustable from 1.2 to 1.6 bar.
    ppo2Setting(1.2, 1.6, 1.4, 'PO2 MAX'),
  ];

  constructor() {
    super();
    this.screenTimeout = 5000; // additional information, then back to the dive screen
    this.init();
  }
}
