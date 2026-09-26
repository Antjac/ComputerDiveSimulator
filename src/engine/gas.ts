// Gas supply calculations used by air-integrated computers (GTR, ATR, RBT, gas time).
import { DecoParams, DecoStop, Gas, Tissues, depthToPressure, planAscent } from './buhlmann';

const atm = (depth: number) => depthToPressure(depth) / 1.01325;

/** Surface consumption expressed as tank pressure per minute (bar/min), as shown by most computers. */
export function sacBarPerMin(rmv: number, tankVolume: number): number {
  return rmv / tankVolume;
}

/** Tank pressure (bar) needed to ascend from `depth` through `stops` at `rate(depth)` m/min. */
export function ascentGas(depth: number, stops: DecoStop[], rate: (depth: number) => number, sacBar: number): number {
  let d = depth;
  let bar = 0;
  const travel = (to: number) => {
    while (d > to + 1e-6) {
      const next = Math.max(to, d - 1);
      bar += sacBar * atm((d + next) / 2) * ((d - next) / rate(d));
      d = next;
    }
  };
  for (const st of stops) {
    travel(st.depth);
    bar += sacBar * atm(st.depth) * st.minutes;
  }
  travel(0);
  return bar;
}

export interface RemainingTimeOptions {
  tissues: Tissues;
  depth: number;
  gas: Gas;
  tankPressure: number;
  reserve: number;
  sacBar: number;
  /** Ascent rate used by the computer's calculation (m/min, may depend on depth). */
  rate: (depth: number) => number;
  /** Deco parameters when decompression stops are part of the ascent; null = direct ascent. */
  deco: DecoParams | null;
  anchor?: number;
  max?: number;
}

/**
 * Minutes that can still be spent at the current depth so that the ascent (with its stops when
 * `deco` is given) ends at the surface with the reserve pressure left.
 */
export function remainingTime(o: RemainingTimeOptions): number {
  const max = o.max ?? 99;
  const available = o.tankPressure - o.reserve;
  const perMin = o.sacBar * atm(o.depth);
  const need = (t: number) => {
    let stops: DecoStop[] = [];
    if (o.deco) {
      const tis = o.tissues.clone();
      if (t > 0) tis.expose(depthToPressure(o.depth), o.gas, t);
      stops = planAscent(tis, o.depth, o.gas, o.deco, o.anchor ?? 0).stops;
    }
    return perMin * t + ascentGas(o.depth, stops, o.rate, o.sacBar);
  };
  if (need(0) > available) return 0;
  if (need(max) <= available) return max;
  let lo = 0;
  let hi = max;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (need(mid) <= available) lo = mid;
    else hi = mid;
  }
  return lo;
}
