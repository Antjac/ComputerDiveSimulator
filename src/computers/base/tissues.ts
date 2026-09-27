import { AIR, COMPARTMENTS, SURFACE_PRESSURE, Tissues, WATER_VAPOUR } from '../../engine/buhlmann';
import { DiveSession } from '../../engine/session';



/** True while the leading compartment (highest GF99) is below the inspired inert gas pressure. */
export function leadingOnGas(s: DiveSession): boolean {
  const g = s.tissues.gradientPercents(s.pressure);
  const i = g.indexOf(Math.max(...g));
  const inspired = (s.pressure - WATER_VAPOUR) * (1 - s.gas.o2);
  return s.tissues.n2[i] + s.tissues.he[i] < inspired;
}

/** Time until every compartment is within 0.05 bar of surface equilibrium. */
export function desaturationTime(tissues: Tissues): number {
  const t = tissues.clone();
  const eq = (SURFACE_PRESSURE - WATER_VAPOUR) * 0.79;
  const done = () => {
    for (let i = 0; i < COMPARTMENTS; i++) if (t.n2[i] - eq > 0.05 || t.he[i] > 0.05) return false;
    return true;
  };
  let m = 0;
  while (!done() && m < 72 * 60) {
    t.expose(SURFACE_PRESSURE, AIR, 10);
    m += 10;
  }
  return m;
}
