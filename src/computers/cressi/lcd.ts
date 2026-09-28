// Segmented LCD shared by the Cressi Goa and Donatello: their manuals' figures show the same layout.
// A top row (MAX | DIVE.T fields), two lines with the DEPTH / NO DECO captions, the big depth and
// no-deco figures with the ascent rate dots between them, and a bottom row (temperature, DEC,
// time...). Every item sits at a fixed place (cressi/lcd.css); each model adds its own case.
import type { DiveSession } from '../../engine/session';
import { sevenSeg } from '../common/segments';

export interface CressiFields {
  tl?: string;
  tlLbl?: string;
  tlUnit?: string;
  tr?: string;
  trLbl?: string;
  trUnit?: string;
  depthLbl?: string;
  /** Depth unit after the DEPTH caption (m by default). */
  unit?: string;
  depth?: string;
  ndl?: string;
  ndlLbl?: boolean | 'deco';
  ndlBlink?: boolean;
  clock?: string;
  bottom?: string;
  bottomTag?: string;
  temp?: string;
  /** Unit after the temperature (°C by default). */
  tempUnit?: string;
  /** Safety factor caption ("SF0"), shown with the penalty mark when `pen`. */
  sf?: string;
  pen?: boolean;
  cns?: boolean;
  dots?: number;
  /** PO2 icon; the depth flashes while `depthBlink` (true by default with the icon). */
  po2?: boolean;
  po2Blink?: boolean;
  depthBlink?: boolean;
  deepStop?: boolean;
  stopIcon?: '' | 'on' | 'blink';
  decBottom?: boolean;
  up?: '' | 'on' | 'blink';
  down?: '' | 'on' | 'blink';
  // Donatello only.
  /** Average depth in the bottom row ("A.16"). */
  avg?: string;
  /** Deco icon with its ▲ / ▼ arrows (instead of the separate arrows), captioned DECO. */
  decoIcon?: 'blink' | 'on';
  /** Crossed out speaker: fast ascent alarm disabled (AL.SP). */
  mute?: boolean;
}

/** Seven-segment text sized by its slot. */
export function seg(text: string, cells: number, cls = ''): string {
  return sevenSeg(text, cells, `cg-seg ${cls}`);
}

/** Stop depth and minutes in the top-left field ("3 m  1 min"), each as wide as its digits. */
export function stopPair(depth: number, minutes: number): string {
  const d = String(depth);
  const m = String(minutes);
  return seg(d, d.length) + '<i class="cg-u">m</i>' + seg(m, m.length);
}

const STOP_SVG = '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="2.2"/><rect x="5" y="8.4" width="10" height="3.2" fill="currentColor"/></svg>';

/** Deco icon: a circle holding the ▲ (go up) and ▼ (go down) arrows, each lit or flashing on its own. */
function decoSvg(up: string, down: string): string {
  const tri = (state: string, pts: string) => (state ? `<polygon class="${state === 'blink' ? 'blink' : ''}" points="${pts}" fill="currentColor"/>` : '');
  return `<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.6" fill="none" stroke="currentColor" stroke-width="1.8"/>${tri(up, '10,3.4 15,9 5,9')}${tri(down, '10,16.6 15,11 5,11')}</svg>`;
}

export function cressiLcd(f: CressiFields, s: DiveSession): string {
  const cnsSegs = Math.min(5, Math.ceil(s.oxygen.cns / 20 - 1e-6));
  const dots = f.dots ?? 0;
  const nitrox = s.gas.o2 > 0.21;
  const parts: string[] = [];
  const put = (cls: string, html: string) => parts.push(`<div class="cg-at ${cls}">${html}</div>`);

  if (f.tlLbl !== undefined && f.tlLbl !== '') put('cg-lbl-tl', f.tlLbl);
  if (f.trLbl !== undefined) put('cg-lbl-tr', f.trLbl);
  if (f.tl) put('cg-tl', f.tl + (f.tlUnit ? `<i class="cg-u">${f.tlUnit}</i>` : ''));
  if (f.tl || f.tr) put('cg-sep', '');
  if (f.tr) put('cg-tr', f.tr + (f.trUnit ? `<i class="cg-u">${f.trUnit}</i>` : ''));
  if (f.stopIcon) put(`cg-stop ${f.stopIcon === 'blink' ? 'blink' : ''}`, STOP_SVG);
  if (f.decoIcon) {
    put(`cg-stop cg-deco-icon ${f.decoIcon === 'blink' ? 'blink' : ''}`, decoSvg(f.up ?? '', f.down ?? ''));
    put('cg-deco-lbl', 'DECO');
  }
  if (f.cns) {
    put(`cg-cns ${s.oxygen.cns >= 80 ? 'blink' : ''}`, `<b>O<sub>2</sub></b>${Array.from({ length: 5 }, (_, i) => `<i class="${i < cnsSegs ? 'on' : ''}" style="height:${4 + i * 2}px"></i>`).join('')}`);
  }
  if (f.deepStop) put('cg-deep', 'DEEP STOP');
  if (f.clock) {
    put('cg-lines', '');
    put('cg-clock', f.clock);
  } else if (f.depth || f.ndl) {
    put('cg-lines', '');
    if (f.depthLbl) put('cg-lbl-depth', `${f.depthLbl} <span>${f.unit ?? 'm'}</span>`);
    if (f.ndlLbl) put('cg-lbl-ndl', f.ndlLbl === 'deco' ? 'min <span class="off">NO</span> DECO' : `min <span class="${f.ndlBlink ? 'blink' : ''}">NO DECO</span>`);
    if (f.depth) put(`cg-depth ${f.depthBlink ?? f.po2 ? 'blink' : ''}`, f.depth);
    if (f.ndl) put(`cg-ndl ${f.ndlBlink ? 'blink' : ''}`, f.ndl);
    if (f.ndlLbl === 'deco') put('cg-total', 'TOTAL');
  }
  if (!f.decoIcon) {
    if (f.up) put(`cg-arrow up ${f.up === 'blink' ? 'blink' : ''}`, '▲');
    if (f.down) put(`cg-arrow down ${f.down === 'blink' ? 'blink' : ''}`, '▼');
  }
  if (dots > 0) {
    put(`cg-dots ${dots === 3 ? 'blink' : ''}`, `${dots === 3 ? '<b class="cg-excl">!</b>' : ''}${'<i></i>'.repeat(dots)}`);
    if (dots === 3) put('cg-slow blink', 'SLOW');
  }
  if (nitrox && (f.depth || f.ndl)) put('cg-nitrox', 'NITROX');
  if (f.sf) put('cg-sf', f.sf);
  if (f.po2) put(`cg-po2 ${f.po2Blink ?? true ? 'blink' : ''}`, 'PO<sub>2</sub>');
  if (f.pen && f.sf) put('cg-pen', '!');
  if (f.mute) put('cg-mute', '<svg viewBox="0 0 20 16"><path d="M2 5h4l5-4v14l-5-4H2z" fill="currentColor"/><path d="M13 4l6 8M19 4l-6 8" stroke="currentColor" stroke-width="2"/></svg>');
  if (f.decBottom) put('cg-dec blink', seg('dEC', 3));
  if (f.avg) put('cg-avg', f.avg);
  if (f.temp) put('cg-temp', seg(f.temp, 2) + `<i class="cg-u">${f.tempUnit ?? '°C'}</i>`);
  if (f.bottom) put('cg-bottom', f.bottom);
  if (f.bottomTag) put('cg-btag', f.bottomTag);
  return parts.join('');
}
