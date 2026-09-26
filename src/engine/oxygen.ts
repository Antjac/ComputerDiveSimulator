// Oxygen toxicity tracking: CNS % (NOAA single-exposure limits) and OTU.

const NOAA: [number, number][] = [
  [0.6, 720], [0.7, 570], [0.8, 450], [0.9, 360], [1.0, 300], [1.1, 240],
  [1.2, 210], [1.3, 180], [1.4, 150], [1.5, 120], [1.6, 45],
];

const CNS_SURFACE_HALF_LIFE = 90; // minutes

function cnsLimitMinutes(ppO2: number): number {
  if (ppO2 <= 0.5) return Infinity;
  if (ppO2 <= 0.6) return 720;
  for (let i = 1; i < NOAA.length; i++) {
    const [p1, l1] = NOAA[i];
    if (ppO2 <= p1) {
      const [p0, l0] = NOAA[i - 1];
      return l0 + ((l1 - l0) * (ppO2 - p0)) / (p1 - p0);
    }
  }
  // Beyond 1.6 bar: extrapolate aggressively.
  return Math.max(5, 45 - (ppO2 - 1.6) * 400);
}

export class OxygenTracker {
  cns = 0; // percent
  otu = 0;

  /** Accumulate exposure for `minutes` at the given ppO2 (bar). */
  expose(ppO2: number, minutes: number): void {
    if (ppO2 > 0.5) {
      this.cns += (minutes / cnsLimitMinutes(ppO2)) * 100;
      this.otu += minutes * Math.pow((ppO2 - 0.5) / 0.5, 0.83);
    } else {
      this.cns *= Math.pow(0.5, minutes / CNS_SURFACE_HALF_LIFE);
    }
  }

  reset(): void {
    this.cns = 0;
    this.otu = 0;
  }
}
