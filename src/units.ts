// Unit system shared by the page and the simulated computers (metric or imperial).

export type UnitSystem = 'metric' | 'imperial';

const FT_PER_M = 3.28084;
const PSI_PER_BAR = 14.5038;
const L_PER_CUFT = 28.3168;

let system: UnitSystem = 'metric';

export function units(): UnitSystem {
  return system;
}

export function setUnits(u: UnitSystem): void {
  system = u;
}

export const imperial = (): boolean => system === 'imperial';

/** Depth in the display unit. */
export function depthVal(m: number): number {
  return imperial() ? m * FT_PER_M : m;
}

export function depthUnit(): string {
  return imperial() ? 'ft' : 'm';
}

/** Current depth as shown by computers: 0.1 m resolution, 1 ft resolution in imperial. */
export function depthText(m: number): string {
  if (m < 0.05) return imperial() ? '0' : '0.0';
  if (imperial()) return String(Math.round(m * FT_PER_M));
  return m >= 100 ? m.toFixed(0) : m.toFixed(1);
}

/** Whole-number depth (stops, ceilings, MOD): 3 m stops become 10 ft. */
export function depthInt(m: number): number {
  return imperial() ? Math.round((m * FT_PER_M) / 5) * 5 || Math.round(m * FT_PER_M) : Math.round(m);
}

/** Depth with its unit, for the page (not the computers). */
export function depthLabel(m: number, digits = 1): string {
  return imperial() ? `${Math.round(m * FT_PER_M)} ft` : `${m.toFixed(digits)} m`;
}

export function rateLabel(mPerMin: number): string {
  return imperial() ? `${Math.round(mPerMin * FT_PER_M)} ft/min` : `${mPerMin.toFixed(1)} m/min`;
}

export function tempVal(c: number): number {
  return imperial() ? c * 1.8 + 32 : c;
}

export function tempUnit(): string {
  return imperial() ? '°F' : '°C';
}

export function pressVal(bar: number): number {
  return imperial() ? bar * PSI_PER_BAR : bar;
}

export function pressUnit(): string {
  return imperial() ? 'psi' : 'bar';
}

/** Tank pressure as displayed (bar integer, psi to the nearest 10). */
export function pressText(bar: number): string {
  return imperial() ? String(Math.round((bar * PSI_PER_BAR) / 10) * 10) : String(Math.round(bar));
}

export function volumeLabel(liters: number): string {
  return imperial() ? `${(liters / L_PER_CUFT).toFixed(2)} cuft` : `${Math.round(liters)} L`;
}

/** Nominal gas capacity of a tank (ideal gas), as used in the imperial world (e.g. "80 cuft"). */
export function tankCapacityLabel(waterLiters: number, workingBar: number): string {
  const gasLiters = waterLiters * workingBar;
  return imperial()
    ? `${Math.round(gasLiters / L_PER_CUFT)} cuft · ${Math.round(workingBar * PSI_PER_BAR / 10) * 10} psi`
    : `${waterLiters} L · ${workingBar} bar`;
}
