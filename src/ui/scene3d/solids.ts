// Solid scenery (rocks, corals) as domes in a grid, for collisions.

export interface Solid {
  x: number;
  z: number;
  r: number;
  /** Depth of the highest point, and height of the dome. */
  top: number;
  h: number;
}

export class SolidGrid {
  private cells = new Map<number, Solid[]>();
  private static readonly CELL = 3;

  private static key(ix: number, iz: number): number {
    return (ix + 1024) * 2048 + (iz + 1024);
  }

  clear(): void {
    this.cells.clear();
  }

  add(s: Solid): void {
    const c = SolidGrid.CELL;
    for (let ix = Math.floor((s.x - s.r) / c); ix <= Math.floor((s.x + s.r) / c); ix++) {
      for (let iz = Math.floor((s.z - s.r) / c); iz <= Math.floor((s.z + s.r) / c); iz++) {
        const k = SolidGrid.key(ix, iz);
        const list = this.cells.get(k);
        if (list) list.push(s);
        else this.cells.set(k, [s]);
      }
    }
  }

  /** Shallowest of `depth` and the solids at (x, z). */
  top(x: number, z: number, depth: number): number {
    const list = this.cells.get(SolidGrid.key(Math.floor(x / SolidGrid.CELL), Math.floor(z / SolidGrid.CELL)));
    if (!list) return depth;
    for (const s of list) {
      const q = ((x - s.x) ** 2 + (z - s.z) ** 2) / (s.r * s.r);
      if (q < 1) depth = Math.min(depth, s.top + q * s.h);
    }
    return depth;
  }
}
