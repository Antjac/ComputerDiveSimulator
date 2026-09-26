import { Tissues, ndl, AIR, depthToPressure, planAscent } from '../src/engine/buhlmann';

// NDL for a first dive on air (descent at 18 m/min included), for several GF highs.
const depths = [12, 15, 18, 21, 24, 27, 30, 33, 36, 40];
for (const gf of [1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7]) {
  const row = depths.map((d) => {
    const t = new Tissues();
    t.exposeLinear(depthToPressure(0), depthToPressure(d), AIR, d / 18);
    return ndl(t, d, AIR, gf, 200);
  });
  console.log(`GF${Math.round(gf * 100)}`.padEnd(6), row.map((n) => String(n).padStart(4)).join(''));
}
console.log('depth '.padEnd(6), depths.map((n) => String(n).padStart(4)).join(''));
const t = new Tissues();
t.exposeLinear(depthToPressure(0), depthToPressure(40), AIR, 40 / 18);
t.expose(depthToPressure(40), AIR, 25);
console.log('40m/25min GF30/70', JSON.stringify(planAscent(t, 40, AIR, { gfLow: 0.3, gfHigh: 0.7, lastStop: 3, stopStep: 3, ascentRate: 10 })));
console.log('40m/25min GF100/100', JSON.stringify(planAscent(t, 40, AIR, { gfLow: 1, gfHigh: 1, lastStop: 3, stopStep: 3, ascentRate: 10 })));
