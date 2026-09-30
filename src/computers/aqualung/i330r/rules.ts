import type { DecoParams } from '../../../engine/buhlmann';
import type { SettingDef } from '../../base';
import { PelagicRules, pelagicSettings } from '../common';

// "9. Conservative Factor": OFF (GF: 90-90), MORE (GF: 85-35), MOST (GF: 70-35) — written GF high-low.
export const CF_GF: Record<string, [number, number]> = { off: [90, 90], more: [35, 85], most: [35, 70] };

/**
 * Aqua Lung i330R, Dive mode (Air / Nitrox). Rules follow the i330R Dive Computer Owner's Manual
 * (Doc. 12-7960 r04, 1/8/21, firmware v1.02; key rules checked against r07, 12/1/23).
 */
export abstract class I330rRules extends PelagicRules {
  readonly id = 'i330r';
  readonly name = 'Aqualung i330R';
  readonly algorithm = 'Bühlmann ZHL-16C + GF';
  readonly exact = true;
  readonly ackButton = 'down'; // "(Down) ... to acknowledge an alarm"
  readonly fastRate = 9; // "faster than the recommended 9 mpm (30 fpm)"
  readonly notes = {
    fr: "Mode Dive (Air ou Nitrox ; Gauge et Free non simulés). Bühlmann ZHL-16C avec les facteurs de conservatisme OFF (GF 90/90), MORE (35/85) et MOST (35/70) : reproduit. Conforme au manuel : DTR = le plus petit de NO DECO et O2 TIME (99 au maximum), barres ASC et N2 à 5 segments, TOO FAST au-delà de 9 m/min, palier de sécurité (ON, OFF ou SET : 3 ou 5 min à 3–6 m) déclenché au-delà de 9 m, deep stop à la moitié de la profondeur max (ON), DECO ENTRY, zone de palier de 3 m, DOWN TO STOP (violation conditionnelle : pas de désaturation au-dessus du palier et 1,5 min de pénalité par minute), DV1 au-delà de 5 min puis Violation Gauge Mode, VGM si un palier à plus de 21 m est requis (24 h), TOO DEEP au-delà de 100 m, alarmes PO2, O2 SAT (80 et 100 %), profondeur, durée, barre N2 et DTR (10 bips, acquittées par Down). Bouton Up : écrans ALT (et Last Dive par appui long en surface) ; Down : acquittement (menus non simulés). Supposés : palier ON = 3 min à 5 m, valeurs par défaut des alarmes, échelle de la barre N2, pas de 3 m et dernier palier à 3 m.",
    en: 'Dive mode (Air or Nitrox; Gauge and Free not simulated). Bühlmann ZHL-16C with the conservative factors OFF (GF 90/90), MORE (35/85) and MOST (35/70): reproduced. As per the manual: DTR = the least of NO DECO and O2 TIME (99 at most), 5-segment ASC and N2 bar graphs, TOO FAST above 9 m/min, safety stop (ON, OFF or SET: 3 or 5 min at 3–6 m) triggered beyond 9 m, deep stop at half the max depth (ON), DECO ENTRY, 3 m stop zone, DOWN TO STOP (conditional violation: no off-gassing credit above the stop and 1.5 min penalty per minute), DV1 beyond 5 min then Violation Gauge Mode, VGM when a stop deeper than 21 m is required (24 h), TOO DEEP beyond 100 m, PO2, O2 SAT (80 and 100 %), depth, dive time, N2 bar and DTR alarms (10 beeps, acknowledged with Down). Up button: ALT screens (and Last Dive with a long press on the surface); Down: acknowledge (menus not simulated). Assumed: safety stop ON = 3 min at 5 m, alarm defaults, N2 bar scale, 3 m stop step and last stop at 3 m.',
  };
  readonly settingDefs: SettingDef[] = [
    {
      key: 'cf',
      label: { fr: 'Conservatisme (CONSERVATIVE)', en: 'Conservative factor' },
      options: [
        { value: 'off', label: 'OFF (GF 90/90)' },
        { value: 'more', label: 'MORE (GF 35/85)' },
        { value: 'most', label: 'MOST (GF 35/70)' },
      ],
      default: 'off', // default not given: OFF assumed (the Set Conservative figure shows OFF)
    },
    ...pelagicSettings(),
  ];

  constructor() {
    super();
    this.init();
  }

  baseParams(): DecoParams {
    const [lo, hi] = CF_GF[this.settings.cf] ?? CF_GF.off;
    // Stop step and last stop not given in the manual: 3 m assumed. Ascent rate: 9 m/min (the rate
    // above which the ASC alarm strikes; the calculation rate itself is not stated).
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: 3, stopStep: 3, ascentRate: 9 };
  }
}
