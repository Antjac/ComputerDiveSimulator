import { imperial, pressUnit, pressVal } from '../units';

/**
 * Analog submersible pressure gauge (SPG), shown next to the computer when the tank data is not
 * displayed on it. Scale 0–300 bar or 0–5000 psi, red zone up to `reserveBar`.
 */
export function renderGauge(bar: number, reserveBar: number, title: string): string {
  const max = imperial() ? 5000 : 300;
  const major = imperial() ? 1000 : 50;
  const ang = (val: number) => -135 + (Math.min(max, Math.max(0, val)) / max) * 270;
  const pt = (a: number, r: number) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return [50 + r * Math.cos(rad), 50 + r * Math.sin(rad)];
  };
  const arc = (a0: number, a1: number, r: number) => {
    const [x0, y0] = pt(a0, r);
    const [x1, y1] = pt(a1, r);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };

  let ticks = '';
  for (let val = 0; val <= max; val += major / 5) {
    const a = ang(val);
    const isMajor = val % major === 0;
    const [x0, y0] = pt(a, isMajor ? 34 : 37);
    const [x1, y1] = pt(a, 41);
    ticks += `<line x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}" stroke="#222" stroke-width="${isMajor ? 1.6 : 0.8}"/>`;
    if (isMajor) {
      const [tx, ty] = pt(a, 27);
      ticks += `<text x="${tx.toFixed(2)}" y="${(ty + 2.5).toFixed(2)}" font-size="7" text-anchor="middle" fill="#222" font-family="Roboto Condensed, sans-serif">${imperial() ? val / 1000 : val}</text>`;
    }
  }
  const needle = ang(pressVal(bar));
  const reserve = ang(pressVal(reserveBar));
  return `
    <svg viewBox="0 0 100 100" role="img" aria-label="${title}: ${Math.round(pressVal(bar))} ${pressUnit()}">
      <circle cx="50" cy="50" r="48" fill="#2a2d31"/>
      <circle cx="50" cy="50" r="44" fill="#f4f1e8" stroke="#111" stroke-width="1"/>
      <path d="${arc(-135, reserve, 38.5)}" stroke="#d62b1f" stroke-width="5" fill="none"/>
      ${ticks}
      <text x="50" y="68" font-size="7" text-anchor="middle" fill="#444" font-family="Roboto Condensed, sans-serif">${imperial() ? 'PSI ×1000' : 'BAR'}</text>
      <g transform="rotate(${needle.toFixed(1)} 50 50)">
        <path d="M 49 56 L 50 12 L 51 56 Z" fill="#c0392b"/>
      </g>
      <circle cx="50" cy="50" r="3.5" fill="#222"/>
    </svg>
    <span class="spg-lbl">${title}</span>`;
}
