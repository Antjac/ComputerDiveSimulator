// Bühlmann ZHL-16C with gradient factors (Erik Baker's method).
// Pressures are in bar, times in minutes, depths in metres of salt water.

export const SURFACE_PRESSURE = 1.01325;
export const WATER_VAPOUR = 0.0627; // alveolar water vapour pressure at 37 °C
export const BAR_PER_METRE = 0.1 * 1.025 * 0.980665; // salt water, density 1.025

export const N2_HALF = [5.0, 8.0, 12.5, 18.5, 27.0, 38.3, 54.3, 77.0, 109.0, 146.0, 187.0, 239.0, 305.0, 390.0, 498.0, 635.0];
export const N2_A = [1.1696, 1.0, 0.8618, 0.7562, 0.62, 0.5043, 0.441, 0.4, 0.375, 0.35, 0.3295, 0.3065, 0.2835, 0.261, 0.248, 0.2327];
export const N2_B = [0.5578, 0.6514, 0.7222, 0.7825, 0.8126, 0.8434, 0.8693, 0.891, 0.9092, 0.9222, 0.9319, 0.9403, 0.9477, 0.9544, 0.9602, 0.9653];
export const HE_HALF = [1.88, 3.02, 4.72, 6.99, 10.21, 14.48, 20.53, 29.11, 41.2, 55.19, 70.69, 90.34, 115.29, 147.42, 188.24, 240.03];
export const HE_A = [1.6189, 1.383, 1.1919, 1.0458, 0.922, 0.8205, 0.7305, 0.6502, 0.595, 0.5545, 0.5333, 0.5189, 0.5181, 0.5176, 0.5172, 0.5119];
export const HE_B = [0.477, 0.5747, 0.6527, 0.7223, 0.7582, 0.7957, 0.8279, 0.8553, 0.8757, 0.8903, 0.8997, 0.9073, 0.9122, 0.9171, 0.9217, 0.9267];

export const COMPARTMENTS = 16;
const LN2 = Math.LN2;
const N2_K = N2_HALF.map((h) => LN2 / h);
const HE_K = HE_HALF.map((h) => LN2 / h);

export interface Gas {
  o2: number; // fraction
  he: number; // fraction
}

export const AIR: Gas = { o2: 0.21, he: 0 };

export function n2Fraction(gas: Gas): number {
  return 1 - gas.o2 - gas.he;
}

export function depthToPressure(depth: number): number {
  return SURFACE_PRESSURE + Math.max(0, depth) * BAR_PER_METRE;
}

export function pressureToDepth(p: number): number {
  return (p - SURFACE_PRESSURE) / BAR_PER_METRE;
}

export function gasLabel(gas: Gas): string {
  if (gas.he > 0) return `TX ${Math.round(gas.o2 * 100)}/${Math.round(gas.he * 100)}`;
  if (Math.round(gas.o2 * 100) === 21) return 'AIR';
  return `EAN${Math.round(gas.o2 * 100)}`;
}

export class Tissues {
  n2: Float64Array;
  he: Float64Array;

  constructor(n2?: Float64Array, he?: Float64Array) {
    if (n2 && he) {
      this.n2 = n2;
      this.he = he;
    } else {
      const surfN2 = (SURFACE_PRESSURE - WATER_VAPOUR) * 0.7902;
      this.n2 = new Float64Array(COMPARTMENTS).fill(surfN2);
      this.he = new Float64Array(COMPARTMENTS).fill(0);
    }
  }

  clone(): Tissues {
    return new Tissues(new Float64Array(this.n2), new Float64Array(this.he));
  }

  /** Constant-depth exposure (Haldane). */
  expose(pAmb: number, gas: Gas, minutes: number): void {
    if (minutes <= 0) return;
    const inspired = pAmb - WATER_VAPOUR;
    const piN2 = inspired * n2Fraction(gas);
    const piHe = inspired * gas.he;
    for (let i = 0; i < COMPARTMENTS; i++) {
      this.n2[i] = piN2 + (this.n2[i] - piN2) * Math.exp(-N2_K[i] * minutes);
      this.he[i] = piHe + (this.he[i] - piHe) * Math.exp(-HE_K[i] * minutes);
    }
  }

  /** Linear depth change (Schreiner equation). */
  exposeLinear(p0: number, p1: number, gas: Gas, minutes: number): void {
    if (minutes <= 0) return;
    const fN2 = n2Fraction(gas);
    const fHe = gas.he;
    const rate = (p1 - p0) / minutes;
    const pi0 = p0 - WATER_VAPOUR;
    for (let i = 0; i < COMPARTMENTS; i++) {
      this.n2[i] = schreiner(this.n2[i], pi0 * fN2, rate * fN2, N2_K[i], minutes);
      this.he[i] = schreiner(this.he[i], pi0 * fHe, rate * fHe, HE_K[i], minutes);
    }
  }

  /** Mixed a/b coefficients for compartment i (weighted by inert gas partial pressures). */
  coefficients(i: number): [number, number] {
    const pN2 = this.n2[i];
    const pHe = this.he[i];
    const total = pN2 + pHe;
    if (total <= 0 || pHe <= 0) return [N2_A[i], N2_B[i]];
    return [(N2_A[i] * pN2 + HE_A[i] * pHe) / total, (N2_B[i] * pN2 + HE_B[i] * pHe) / total];
  }

  /** Lowest tolerated ambient pressure for compartment i with gradient factor gf (0..1). */
  toleratedPressure(i: number, gf: number): number {
    const [a, b] = this.coefficients(i);
    const p = this.n2[i] + this.he[i];
    return (p - a * gf) / (gf / b + 1 - gf);
  }

  /** Lowest tolerated ambient pressure over all compartments. */
  ceilingPressure(gf: number): number {
    let max = 0;
    for (let i = 0; i < COMPARTMENTS; i++) max = Math.max(max, this.toleratedPressure(i, gf));
    return max;
  }

  /** Can the tissues tolerate an ambient pressure with a given gf? */
  tolerates(pAmb: number, gf: number): boolean {
    return this.ceilingPressure(gf) <= pAmb + 1e-9;
  }

  /**
   * Supersaturation of each compartment as a percentage of the Bühlmann M-value gradient
   * at the given ambient pressure (0 % = ambient, 100 % = M-value). Negative = undersaturated.
   */
  gradientPercents(pAmb: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < COMPARTMENTS; i++) {
      const [a, b] = this.coefficients(i);
      const p = this.n2[i] + this.he[i];
      const m = pAmb / b + a;
      out.push(((p - pAmb) / (m - pAmb)) * 100);
    }
    return out;
  }

  maxGradientPercent(pAmb: number): number {
    return Math.max(...this.gradientPercents(pAmb));
  }

  /** Index of the compartment closest to its surface M-value. */
  leadingCompartment(): number {
    const g = this.gradientPercents(SURFACE_PRESSURE);
    let best = 0;
    for (let i = 1; i < g.length; i++) if (g[i] > g[best]) best = i;
    return best;
  }
}

function schreiner(p: number, pi0: number, rate: number, k: number, t: number): number {
  return pi0 + rate * (t - 1 / k) - (pi0 - p - rate / k) * Math.exp(-k * t);
}

// ---------------------------------------------------------------------------
// Deco planning

export interface DecoParams {
  gfLow: number; // 0..1
  gfHigh: number; // 0..1
  lastStop: number; // m (3 or 6)
  stopStep: number; // m (3)
  ascentRate: number; // m/min used for planning
}

export interface DecoStop {
  depth: number;
  minutes: number; // may be fractional when planned with a sub-minute resolution
}

export interface DecoPlan {
  stops: DecoStop[];
  tts: number; // minutes, including ascent time
  firstStop: number; // m, 0 when no deco
}

/** GF interpolated at a depth, given the anchor (first stop depth computed with GF low). */
export function gfAt(depth: number, anchor: number, p: DecoParams): number {
  if (anchor <= 0) return p.gfHigh;
  if (depth >= anchor) return p.gfLow;
  return p.gfHigh + ((p.gfLow - p.gfHigh) * Math.max(0, depth)) / anchor;
}

function roundUpToStop(depth: number, step: number): number {
  if (depth <= 0.001) return 0;
  return Math.ceil(depth / step - 1e-6) * step;
}

/** First stop depth (anchor) according to GF low, rounded to the stop grid. */
export function gfLowAnchor(t: Tissues, p: DecoParams): number {
  const ceil = pressureToDepth(t.ceilingPressure(p.gfLow));
  return roundUpToStop(Math.max(0, ceil), p.stopStep);
}

/**
 * First stop according to GF low (Baker's method): ascend from `depth` at the planning rate, one stop
 * grid depth at a time, until the next one is not tolerated with GF low. The tissues keep off-gassing
 * during that ascent, so this is usually shallower than the GF low ceiling at the bottom.
 * 0 when there is no decompression obligation.
 */
export function firstStop(tissues: Tissues, depth: number, gas: Gas, p: DecoParams): number {
  if (tissues.tolerates(SURFACE_PRESSURE, p.gfHigh)) return 0;
  const t = tissues.clone();
  let d = depth;
  while (d > 0) {
    const grid = roundUpToStop(d, p.stopStep);
    let next = Math.max(0, grid >= d - 1e-6 ? grid - p.stopStep : grid);
    if (next < p.lastStop) next = 0;
    if (!t.tolerates(depthToPressure(next), p.gfLow)) return roundUpToStop(d, p.stopStep);
    t.exposeLinear(depthToPressure(d), depthToPressure(next), gas, (d - next) / p.ascentRate);
    d = next;
  }
  return 0;
}

/** Continuous ceiling depth, using the slope defined by `anchor`. */
export function ceilingDepth(t: Tissues, anchor: number, p: DecoParams): number {
  if (t.tolerates(SURFACE_PRESSURE, p.gfHigh)) return 0;
  // Search the shallowest depth that is tolerated with the GF interpolated at that depth.
  let lo = 0;
  let hi = Math.max(anchor, pressureToDepth(t.ceilingPressure(p.gfLow))) + 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (t.tolerates(depthToPressure(mid), gfAt(mid, anchor, p))) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** No-decompression limit at the current depth, in whole minutes (capped). */
export function ndl(t: Tissues, depth: number, gas: Gas, gfHigh: number, cap = 99): number {
  if (!t.tolerates(SURFACE_PRESSURE, gfHigh)) return 0;
  const sim = t.clone();
  const pAmb = depthToPressure(depth);
  for (let m = 0; m < cap; m++) {
    sim.expose(pAmb, gas, 1);
    if (!sim.tolerates(SURFACE_PRESSURE, gfHigh)) return m;
  }
  return cap;
}

/**
 * Simulates a direct ascent from `depth` with stops. Returns the stops and total time to surface.
 * `anchor` is the GF low anchor (first stop) already fixed during the dive (0 if none); the deeper of
 * that and the first stop from here is used, like most GF implementations. The anchor stays put when
 * the diver is shallower than it: the GF keeps its interpolated value at each stop. `resolution` is
 * the stop time step in minutes (1 = whole minutes like most computers; smaller for second-level
 * countdowns).
 */
export function planAscent(tissues: Tissues, depth: number, gas: Gas, p: DecoParams, anchor = 0, resolution = 1): DecoPlan {
  const t = tissues.clone();
  const stops: DecoStop[] = [];
  const a = Math.max(anchor, firstStop(t, depth, gas, p));
  let d = depth;
  let time = 0;

  const ascend = (to: number) => {
    if (to >= d) return;
    const minutes = (d - to) / p.ascentRate;
    t.exposeLinear(depthToPressure(d), depthToPressure(to), gas, minutes);
    time += minutes;
    d = to;
  };

  const nextStopAbove = (from: number) => {
    const grid = roundUpToStop(from, p.stopStep);
    let next = grid >= from - 1e-6 ? grid - p.stopStep : grid;
    if (next < p.lastStop) next = 0;
    return Math.max(0, next);
  };

  // Go straight up to the first stop given the current ceiling.
  let first = roundUpToStop(ceilingDepth(t, a, p), p.stopStep);
  if (first > 0 && first < p.lastStop) first = p.lastStop;
  if (first < d) ascend(first);
  const initialStop = first;

  let guard = 0;
  while (d > 0 && guard++ < 5000) {
    const next = nextStopAbove(d);
    if (t.tolerates(depthToPressure(next), gfAt(next, a, p))) {
      ascend(next);
      continue;
    }
    t.expose(depthToPressure(d), gas, resolution);
    time += resolution;
    // Report stops on the stop grid, even when the diver waits between two grid depths.
    const stopDepth = Math.max(p.lastStop, roundUpToStop(Math.round(d * 10) / 10, p.stopStep));
    const last = stops[stops.length - 1];
    if (last && last.depth === stopDepth) last.minutes += resolution;
    else stops.push({ depth: stopDepth, minutes: resolution });
  }
  // A ceiling means the diver may not go straight up (NDL at 0): even when the gas released during
  // the ascent would clear it on the way, show a minimal stop rather than a "deco" state without any.
  // Same test as ceilingDepth() > 0, so that a positive ceiling always comes with a stop. Below the
  // ceiling it is the last stop, where that ascent ends (the ceiling, deeper, would announce a stop
  // the ascent does not need, replaced by a shallower one moments later); a diver already above the
  // ceiling (e.g. back at the surface) is sent back down to it.
  if (!stops.length && !tissues.tolerates(SURFACE_PRESSURE, p.gfHigh)) {
    stops.push({ depth: depth > initialStop ? p.lastStop : Math.max(p.lastStop, initialStop), minutes: resolution });
    time += resolution;
  }

  return { stops, tts: Math.ceil(time - 1e-6), firstStop: stops.length ? stops[0].depth : initialStop > 0 ? initialStop : 0 };
}

/** Time (minutes) until the tissues tolerate a given ambient pressure while resting at the surface. */
export function timeToTolerate(tissues: Tissues, pAmb: number, gf: number, stepMin = 5, maxMin = 72 * 60): number {
  const t = tissues.clone();
  let m = 0;
  while (!t.tolerates(pAmb, gf) && m < maxMin) {
    t.expose(SURFACE_PRESSURE, AIR, stepMin);
    m += stepMin;
  }
  return m;
}

/** Depth at which the given compartment stops on-gassing (inspired inert gas = tissue tension). */
export function equilibriumDepth(t: Tissues, i: number, gas: Gas): number {
  const fInert = n2Fraction(gas) + gas.he;
  const p = t.n2[i] + t.he[i];
  return pressureToDepth(p / fInert + WATER_VAPOUR);
}
