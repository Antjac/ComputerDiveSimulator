// Dive sites: world size, terrain depth, wreck shape (shared by the models and the collision tests),
// where the diver starts.
import { clamp, fbm, ramp } from './math';

export type Environment = 'reef' | 'wreck' | 'wall';

// World units are metres, y = -depth. The diver swims freely over a site of radius AREA and turns
// back on their own at its edge; the terrain goes further so the fog hides where it ends.
export const AREA = 85;
export const WORLD = 320;
/** Water kept between the diver's axis and whatever lies below or ahead of them (m). */
export const CLEARANCE = 0.55;

// Wreck: dimensions shared by the model and the collision test.
export const WRECK_L = 36;
export const WRECK_W = 7;
export const WRECK_H = 5;
export const WRECK_ROLL = 0.22; // lying slightly on its side
export const WRECK_HEADING = 0.5;
/** Superstructure blocks on the deck (ship frame): x range, half width, top. */
export const WRECK_PARTS = [
  { x0: -13, x1: -5, hw: 2.7, top: WRECK_H + 3 },
  { x0: -11.75, x1: -7.25, hw: 2.2, top: WRECK_H + 5 },
  { x0: -4.9, x1: -3.1, hw: 0.9, top: WRECK_H + 3.2 },
];

/** z of the drop-off along x on the wall site (plateau at smaller z, the blue beyond). */
export function wallEdge(x: number): number {
  return (fbm(x * 0.012 + 5, 1.7) - 0.5) * 40;
}

/**
 * Depth of the sea floor at (x, z). The sand lies around the site depth (the deepest the simulation
 * lets the diver go); anything shallower is scenery the diver has to swim around or over.
 */
export function floorDepth(env: Environment, site: number, x: number, z: number): number {
  // Never shallower than site + clearance, so the full site depth stays reachable on the sand.
  const sand = site + CLEARANCE + 0.05 + fbm(x * 0.05, z * 0.05) * 1.0;
  let d: number;
  if (env === 'reef') {
    // A shallow reef flat to the north (−z), its slope down to the sand, coral heads on the sand.
    const warp = (fbm(x * 0.015, z * 0.015 + 4) - 0.5) * 40;
    const flat = Math.min(site - 1, 3 + fbm(x * 0.08, z * 0.08) * 3);
    const t = ramp(-60, -25, z + warp);
    d = flat + (sand - flat) * Math.pow(t, 0.8);
    const bommie = Math.max(0, fbm(x * 0.04 + 10, z * 0.04) - 0.5) * 2.4;
    d -= t * Math.min(site - 3, bommie * site * 0.5);
  } else if (env === 'wreck') {
    d = sand - Math.max(0, fbm(x * 0.03 + 3, z * 0.03) - 0.6) * 6;
  } else {
    const s = z - wallEdge(x);
    const top = Math.min(site - 2, 5 + fbm(x * 0.06, z * 0.06) * 4);
    const deep = site + Math.max(15, Math.min(45, site));
    d = top + ramp(-40, 0, s) * 3;
    if (s > 0) d += s * 5 + (fbm(x * 0.2, z * 0.2) - 0.5) * 4;
    d = Math.min(deep, d);
  }
  // Rugged rock and reef, smooth sand.
  const rough = clamp((sand - d) / 2, 0, 1);
  d += (fbm(x * 0.45, z * 0.45) - 0.5) * 1.4 * rough;
  return Math.max(1.5, d);
}

/** Half width of the hull at `x` (ship frame), negative outside it. */
export function hullHalfWidth(x: number): number {
  if (x < -WRECK_L / 2 || x > WRECK_L / 2) return -1;
  const bow = WRECK_L / 2 - 9;
  return x < bow ? WRECK_W / 2 : (WRECK_W / 2) * (1 - ((x - bow) / 9) ** 2);
}

/** Height of a flat top `top` (half width `hw`) once the hull is rolled, at `lz` across the wreck. */
export function rolledTop(top: number, hw: number, lz: number): number {
  const c = Math.cos(WRECK_ROLL);
  const s = Math.sin(WRECK_ROLL);
  const zs = (lz - top * s) / c;
  return Math.abs(zs) <= hw ? top * c - zs * s : -Infinity;
}

/** Highest point of the wreck above (lx, lz) in its placement frame, or −Infinity. */
export function wreckTop(lx: number, lz: number): number {
  let y = -Infinity;
  const hw = hullHalfWidth(lx);
  if (hw > 0) y = rolledTop(WRECK_H, hw, lz);
  for (const p of WRECK_PARTS) if (lx >= p.x0 && lx <= p.x1) y = Math.max(y, rolledTop(p.top, p.hw, lz));
  return y;
}

/** Where the diver starts on each site: position and heading. */
export function startOf(env: Environment): [number, number, number] {
  if (env === 'reef') return [5, 5, Math.PI]; // facing the reef slope
  if (env === 'wreck') return [-16, 20, Math.atan2(16, -20)]; // facing the wreck
  return [0, wallEdge(0) + 8, Math.PI / 2]; // along the wall, wall on the left
}

// ---------------------------------------------------------------------------

/** Third-person 3D view of the dive: same depth control as the water column, free swimming. */
