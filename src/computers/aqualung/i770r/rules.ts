import type { DecoParams } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import { remainingTime } from '../../../engine/gas';
import type { ComputerView, SettingDef } from '../../base';
import { type PelagicAlarm, PelagicRules, pelagicSettings } from '../common';
import { pressureSetting, pressureValue } from '../../common/tank';

/**
 * Z+ ("Bühlmann ZHL-16C based") is not published: approximated by Bühlmann ZHL-16C with a single
 * gradient factor, calibrated (npm run calib) on the manual's "Z+ algorithm NDLs" table at sea
 * level: 18 m 50 min, 21 m 36, 24 m 27, 27 m 20, 30 m 16, 33 m 13 (GF 95 gives 53, 36, 25, 18, 14, 11;
 * shallower it is too long: 15 m 81 min instead of 68). Conservative ON "will be reduced to the
 * values available at the altitude level that is 915 m (3,000 ft) higher": 15 m 55, 18 m 39, 21 m 28,
 * 24 m 20, 30 m 12 → GF 85 (68, 42, 28, 19, 11).
 */
export const Z_PLUS_GF: Record<string, number> = { off: 0.95, on: 0.85 };

/**
 * Aqua Lung i770R, Dive mode (Air / Nitrox). Rules follow the i770R Dive Computer Owner's Manual
 * (Doc. 12-7892-r01, 4/24/18, firmware 1A01; the later French r02 and German r05 have the same
 * firmware and page count).
 */
export abstract class I770rRules extends PelagicRules {
  readonly id = 'i770r';
  readonly name = 'Aqualung i770R';
  readonly algorithm = 'Pelagic Z+';
  readonly exact = false;
  readonly transmitter = 'TMT';
  readonly gasTimeName = 'GTR';
  readonly ackButton = 'select'; // "acknowledged and silenced by pressing the SELECT button"
  readonly fastRate = 9.2; // ASC bar graph: 5 segments "> 9.2 (> 30)", "all segments flash"
  readonly notes = {
    fr: "Mode Dive (Air ou Nitrox ; Gauge, Free et boussole non simulés). Z+ est propriétaire (« basé sur Bühlmann ZHL-16C ») : approximation par Bühlmann ZHL-16C avec un GF unique, calibré sur la table des NDL du manuel (GF 95, CONSERVATIVE ON : GF 85 ; NDL trop longs au-dessus de 18 m). Conforme au manuel : DTR = le plus petit de NO-DECO et O2 TIME, barres ASC et N2, TOO FAST au-delà de 9,2 m/min, palier de sécurité (ON, OFF ou SET : 3 ou 5 min à 3–6 m) au-delà de 9 m, deep stop (ON), DECO ENTRY, DOWN TO STOP (pas de désaturation au-dessus du palier, 1,5 min de pénalité par minute), DV1 au-delà de 5 min puis Violation Gauge Mode, VGM si un palier à plus de 21 m est requis (24 h), alarmes PO2, O2 SAT, profondeur, durée, pression de demi-tour et de fin, barre N2 et DTR (10 bips, acquittées par SELECT). Bouton ▲ : More Dive Data (en surface : More Data et Last Dive Data) ; SELECT : acquittement ; ▼ : menu (non simulé), appui long : repère (EARMARK APPLIED). Supposés : définition du GTR (temps jusqu'à la réserve, remontée à 9 m/min), pression de fin = réserve, palier ON = 3 min à 5 m, valeurs par défaut des alarmes, pas de 3 m.",
    en: 'Dive mode (Air or Nitrox; Gauge, Free and compass not simulated). Z+ is proprietary ("Bühlmann ZHL-16C based"): approximated by Bühlmann ZHL-16C with a single GF, calibrated on the manual\'s NDL table (GF 95, CONSERVATIVE ON: GF 85; NDLs too long shallower than 18 m). As per the manual: DTR = the least of NO-DECO and O2 TIME, ASC and N2 bar graphs, TOO FAST above 9.2 m/min, safety stop (ON, OFF or SET: 3 or 5 min at 3–6 m) beyond 9 m, deep stop (ON), DECO ENTRY, DOWN TO STOP (no off-gassing credit above the stop, 1.5 min penalty per minute), DV1 beyond 5 min then Violation Gauge Mode, VGM when a stop deeper than 21 m is required (24 h), PO2, O2 SAT, depth, dive time, turn and end pressure, N2 bar and DTR alarms (10 beeps, acknowledged with SELECT). ▲ button: More Dive Data (on the surface: More Data and Last Dive Data); SELECT: acknowledge; ▼: menu (not simulated), hold: earmark (EARMARK APPLIED). Assumed: GTR definition (time to the reserve, ascent at 9 m/min), end pressure = reserve, safety stop ON = 3 min at 5 m, alarm defaults, 3 m stop step.',
  };
  readonly settingDefs: SettingDef[] = [
    {
      // "Add PO2/MOD" (Display menu): third field of the bottom bar, "Maximum Operating Depth, current
      // PO2 value, or blank". Default not given: MOD, as on the Dive Main figures.
      key: 'field',
      essential: true,
      label: { fr: 'Barre du bas (Add PO2/MOD)', en: 'Bottom bar (Add PO2/MOD)' },
      options: [{ value: 'mod', label: 'MOD' }, { value: 'po2', label: 'PO2' }, { value: 'off', label: 'OFF' }],
      default: 'mod',
    },
    {
      key: 'cf',
      label: { fr: 'Conservatisme (CONSERV FACTOR)', en: 'Conservative factor' },
      options: [{ value: 'off', label: 'OFF' }, { value: 'on', label: 'ON' }],
      default: 'off', // default not given: OFF assumed
    },
    ...pelagicSettings(),
    // Set Alarms, 4. Turn Press: "OFF or 70 to 205 BAR (1000 to 3000 PSI)", TURN PRESSURE when triggered.
    // Default not given: OFF assumed; step: 5 bar offered.
    pressureSetting('turnAl', { fr: 'Alarme de demi-tour (TURN PRESS)', en: 'Turn pressure alarm (TURN PRESS)' }, 70, 205, 5, 'off', 'OFF'),
    // Set Alarms, 5. End Press: 20 to 105 BAR (300 to 1500 PSI)", always on; it is also the pressure GTR counts down
    // to (assumed). Default not given: 50 bar assumed; step: 5 bar offered.
    pressureSetting('reserve', { fr: 'Alarme de fin (END PRESS)', en: 'End pressure alarm (END PRESS)' }, 20, 105, 5, 50),
  ];

  constructor() {
    super();
    this.init();
  }

  baseParams(): DecoParams {
    const g = Z_PLUS_GF[this.settings.cf] ?? Z_PLUS_GF.off;
    // A single GF (Z+ deco stops are not described): 3 m steps, last stop 3 m assumed.
    return { gfLow: g, gfHigh: g, lastStop: 3, stopStep: 3, ascentRate: 9 };
  }

  /** "End Press" setting (bar). */
  endPressure(): number {
    return this.reservePressure();
  }

  /**
   * GTR ("Gas Time Remaining", 0 - 99 min): not defined in the manual. Assumed: minutes at the current
   * depth until a direct ascent at 9 m/min would surface with the end (reserve) pressure.
   */
  gasTime(s: DiveSession, _p: DecoParams, sacBar: number): number | null {
    return remainingTime({
      tissues: s.tissues, depth: s.depth, gas: s.gas, tankPressure: s.tankPressure, reserve: this.endPressure(),
      sacBar, rate: () => 9, deco: null,
    });
  }

  protected alarmConditions(s: DiveSession, v: ComputerView): PelagicAlarm[] {
    const a = super.alarmConditions(s, v);
    if (v.tank.ai) {
      const turn = pressureValue(this.settings, 'turnAl');
      if (turn !== null && s.tankPressure <= turn) a.push('turn');
      if (s.tankPressure <= this.endPressure()) a.push('end');
    }
    return a;
  }
}
