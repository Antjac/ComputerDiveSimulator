import { COMPARTMENTS, HE_HALF, N2_HALF } from '../engine/buhlmann';
import type { ProfileSample } from '../engine/session';

const MUTED = '#8b9bb0';
const GRID = 'rgba(139,155,176,0.18)';
const SERIES = '#4cc3ff';
const CEIL = 'rgba(255, 99, 88, 0.28)';
const CEIL_LINE = '#ff6358';
const STATUS = { under: '#4c8dff', ok: '#3ecf8e', warn: '#f5b83d', crit: '#ff5c5c' };

function setup(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function niceStep(max: number, target: number): number {
  const raw = max / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (raw <= m * pow) return m * pow;
  return 10 * pow;
}

export interface ProfileLabels {
  time: string;
  depth: string;
  ceiling: string;
}

/** Depth-vs-time profile with the deco ceiling as a shaded area, plus a crosshair tooltip. */
export class ProfileChart {
  private samples: ProfileSample[] = [];
  private hoverX: number | null = null;
  private pad = { l: 44, r: 12, t: 10, b: 26 };
  labels: ProfileLabels = { time: 'Time', depth: 'Depth', ceiling: 'Ceiling' };
  /** Unit of the depth values passed to draw(). */
  unit = 'm';

  constructor(private canvas: HTMLCanvasElement, private tip: HTMLElement) {
    canvas.addEventListener('pointermove', (e) => {
      this.hoverX = e.offsetX;
      this.draw(this.samples);
    });
    canvas.addEventListener('pointerleave', () => {
      this.hoverX = null;
      this.tip.hidden = true;
      this.draw(this.samples);
    });
  }

  draw(samples: ProfileSample[]): void {
    this.samples = samples;
    const { ctx, w, h } = setup(this.canvas);
    const { l, r, t, b } = this.pad;
    const pw = w - l - r;
    const ph = h - t - b;
    const maxT = Math.max(10 * 60, ...samples.map((p) => p.t));
    const maxD = Math.max(10, ...samples.map((p) => Math.max(p.depth, p.ceiling))) * 1.08;
    const x = (s: number) => l + (s / maxT) * pw;
    const y = (d: number) => t + (d / maxD) * ph;

    // Grid + axes labels
    ctx.font = '11px Inter, sans-serif';
    ctx.fillStyle = MUTED;
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    const dStep = niceStep(maxD, 5);
    for (let d = 0; d <= maxD; d += dStep) {
      ctx.beginPath();
      ctx.moveTo(l, y(d));
      ctx.lineTo(w - r, y(d));
      ctx.stroke();
      ctx.fillText(`${d} ${this.unit}`, 4, y(d) + 4);
    }
    const tStepMin = niceStep(maxT / 60, 6);
    for (let m = 0; m <= maxT / 60; m += tStepMin) {
      ctx.fillText(`${m}'`, x(m * 60) - 6, h - 8);
    }

    if (samples.length < 2) return;

    // Ceiling area
    ctx.fillStyle = CEIL;
    ctx.beginPath();
    ctx.moveTo(x(samples[0].t), y(0));
    for (const p of samples) ctx.lineTo(x(p.t), y(p.ceiling));
    ctx.lineTo(x(samples[samples.length - 1].t), y(0));
    ctx.closePath();
    ctx.fill();
    if (samples.some((p) => p.ceiling > 0)) {
      ctx.strokeStyle = CEIL_LINE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      samples.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p.ceiling)) : ctx.moveTo(x(p.t), y(p.ceiling))));
      ctx.stroke();
    }

    // Depth line
    ctx.strokeStyle = SERIES;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    samples.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p.depth)) : ctx.moveTo(x(p.t), y(p.depth))));
    ctx.stroke();

    // Crosshair + tooltip
    if (this.hoverX !== null && this.hoverX >= l && this.hoverX <= w - r) {
      const ts = ((this.hoverX - l) / pw) * maxT;
      let nearest = samples[0];
      for (const p of samples) if (Math.abs(p.t - ts) < Math.abs(nearest.t - ts)) nearest = p;
      const px = x(nearest.t);
      ctx.strokeStyle = 'rgba(230,237,243,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, t);
      ctx.lineTo(px, h - b);
      ctx.stroke();
      ctx.fillStyle = SERIES;
      ctx.strokeStyle = '#0d1520';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, y(nearest.depth), 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const mm = Math.floor(nearest.t / 60);
      const ss = String(Math.floor(nearest.t % 60)).padStart(2, '0');
      this.tip.hidden = false;
      this.tip.innerHTML = `<b>${mm}:${ss}</b><br>${this.labels.depth}: ${nearest.depth.toFixed(this.unit === 'm' ? 1 : 0)} ${this.unit}${nearest.ceiling > 0 ? `<br><span class="tip-ceil"></span>${this.labels.ceiling}: ${nearest.ceiling.toFixed(this.unit === 'm' ? 1 : 0)} ${this.unit}` : ''}`;
      const tipX = px + 12 + 140 > w ? px - 150 : px + 12;
      this.tip.style.left = `${tipX}px`;
      this.tip.style.top = `${Math.max(0, y(nearest.depth) - 20)}px`;
    } else {
      this.tip.hidden = true;
    }
  }
}

/** Extra data for the tissue chart: tissue and ambient pressures (bar), inspired inert gas (chart %). */
export interface TissueDetail {
  pressures: number[];
  pAmb: number;
  inspired: number;
}

/**
 * Bar chart of the 16 compartments: below 0, tissue pressure relative to ambient (−100 % = 0 bar);
 * above 0, % of the M-value gradient (GF).
 */
export class TissueChart {
  private values: number[] = [];
  private gfHigh = 85;
  private detail?: TissueDetail;
  private hover: number | null = null;
  private pad = { l: 40, r: 10, t: 12, b: 24 };
  labels = { compartment: 'Compartment', halfTime: 'Half-time', inspired: 'Inspired gas', ofAmbient: 'of ambient' };

  constructor(private canvas: HTMLCanvasElement, private tip: HTMLElement) {
    canvas.addEventListener('pointermove', (e) => {
      const { l, r } = this.pad;
      const bw = (canvas.clientWidth - l - r) / COMPARTMENTS;
      const i = Math.floor((e.offsetX - l) / bw);
      this.hover = i >= 0 && i < COMPARTMENTS ? i : null;
      this.draw(this.values, this.gfHigh, this.detail);
    });
    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.tip.hidden = true;
      this.draw(this.values, this.gfHigh, this.detail);
    });
  }

  draw(values: number[], gfHigh: number, detail?: TissueDetail): void {
    this.values = values;
    this.gfHigh = gfHigh;
    this.detail = detail;
    const { ctx, w, h } = setup(this.canvas);
    const { l, r, t, b } = this.pad;
    const pw = w - l - r;
    const ph = h - t - b;
    const min = -100;
    const max = 120;
    const y = (v: number) => t + ((max - Math.max(min, Math.min(max, v))) / (max - min)) * ph;

    ctx.font = '11px Inter, sans-serif';
    ctx.lineWidth = 1;
    for (const v of [-100, -50, 0, 50, 100]) {
      ctx.strokeStyle = v === 0 ? 'rgba(230,237,243,0.45)' : GRID;
      ctx.beginPath();
      ctx.moveTo(l, y(v));
      ctx.lineTo(w - r, y(v));
      ctx.stroke();
      ctx.fillStyle = MUTED;
      ctx.fillText(`${v}%`, 2, y(v) + 4);
    }
    // GF high reference line
    ctx.strokeStyle = STATUS.warn;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(l, y(gfHigh));
    ctx.lineTo(w - r, y(gfHigh));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = MUTED;
    ctx.fillText(`GF ${gfHigh}`, w - r - 44, y(gfHigh) - 4);

    const bw = pw / COMPARTMENTS;
    values.forEach((v, i) => {
      const x0 = l + i * bw + 1;
      const color = v < 0 ? STATUS.under : v < gfHigh ? STATUS.ok : v < 100 ? STATUS.warn : STATUS.crit;
      const y0 = y(0);
      const y1 = y(v);
      ctx.fillStyle = color;
      ctx.globalAlpha = this.hover === null || this.hover === i ? 1 : 0.55;
      ctx.beginPath();
      const top = Math.min(y0, y1);
      const height = Math.max(1, Math.abs(y1 - y0));
      ctx.roundRect(x0, top, bw - 2, height, v >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4]);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (i % 3 === 0 || i === COMPARTMENTS - 1) {
        ctx.fillStyle = MUTED;
        ctx.fillText(String(i + 1), x0 + bw / 2 - 5, h - 8);
      }
    });

    // Inspired inert gas pressure: the level every compartment tends to (Shearwater's black line).
    if (detail) {
      ctx.strokeStyle = 'rgba(230,237,243,0.8)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(l, y(detail.inspired));
      ctx.lineTo(w - r, y(detail.inspired));
      ctx.stroke();
      ctx.setLineDash([]);
      const lx = w - r - ctx.measureText(this.labels.inspired).width - 2;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(13,17,23,0.85)';
      ctx.strokeText(this.labels.inspired, lx, y(detail.inspired) - 4);
      ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(230,237,243,0.9)';
      ctx.fillText(this.labels.inspired, lx, y(detail.inspired) - 4);
    }

    if (this.hover !== null) {
      const i = this.hover;
      this.tip.hidden = false;
      this.tip.innerHTML = `<b>${this.labels.compartment} ${i + 1}</b><br>${this.labels.halfTime} N₂ ${N2_HALF[i]} min · He ${HE_HALF[i]} min<br>${this.valueText(i)}`;
      const x0 = l + i * bw;
      this.tip.style.left = `${x0 + 180 > w ? x0 - 180 : x0 + bw + 6}px`;
      this.tip.style.top = `${t}px`;
    }
  }

  private valueText(i: number): string {
    const v = this.values[i];
    if (!this.detail) return `${v.toFixed(0)} %`;
    const { pressures, pAmb } = this.detail;
    const p = `${pressures[i].toFixed(2)} bar`;
    return v <= 0 ? `${p} · ${Math.round((pressures[i] / pAmb) * 100)} % ${this.labels.ofAmbient}` : `${p} · GF ${v.toFixed(0)} %`;
  }
}
