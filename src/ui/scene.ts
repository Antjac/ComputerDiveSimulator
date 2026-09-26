import type { DiveSession } from '../engine/session';
import { depthLabel, depthUnit, depthVal, imperial } from '../units';

interface Bubble {
  x: number;
  depth: number;
  r: number;
  wobble: number;
}

const SKY = 36; // px of sky above the surface

/** Water column view: shows the diver, lets the user set the target depth with the mouse. */
export class Scene {
  private ctx: CanvasRenderingContext2D;
  private bubbles: Bubble[] = [];
  private bubbleTimer = 0;
  private dragging = false;
  private hoverDepth: number | null = null;
  private finPhase = 0;
  ceiling = 0;
  safetyBand = false;
  stopDepth = 0;

  constructor(private canvas: HTMLCanvasElement, private session: DiveSession) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already released (quick taps, synthetic events) */
      }
      this.session.setTarget(this.yToDepth(e.offsetY));
    });
    canvas.addEventListener('pointermove', (e) => {
      this.hoverDepth = this.yToDepth(e.offsetY);
      if (this.dragging) this.session.setTarget(this.hoverDepth);
    });
    canvas.addEventListener('pointerup', () => (this.dragging = false));
    canvas.addEventListener('pointercancel', () => (this.dragging = false));
    canvas.addEventListener('pointerleave', () => (this.hoverDepth = null));
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.session.setTarget(Math.round((this.session.targetDepth + Math.sign(e.deltaY) * 0.5) * 2) / 2);
      },
      { passive: false },
    );
  }

  private get height(): number {
    return this.canvas.clientHeight;
  }

  private get range(): number {
    return this.session.siteDepth + 3;
  }

  private depthToY(d: number): number {
    return SKY + (d / this.range) * (this.height - SKY);
  }

  private yToDepth(y: number): number {
    return Math.max(0, ((y - SKY) / (this.height - SKY)) * this.range);
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** `simDt` in simulated seconds, `realDt` in real seconds. */
  draw(simDt: number, realDt: number): void {
    this.resize();
    const { ctx, session: s } = this;
    const w = this.canvas.clientWidth;
    const h = this.height;

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, SKY);
    sky.addColorStop(0, '#9fd3f0');
    sky.addColorStop(1, '#d9f0fb');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, SKY);

    // Water: colour depends on absolute depth, not on the view.
    const water = ctx.createLinearGradient(0, SKY, 0, h);
    const col = (d: number) => {
      const k = Math.min(1, d / 60);
      const r = Math.round(40 * (1 - k) + 2 * k);
      const g = Math.round(170 * (1 - k) + 20 * k);
      const b = Math.round(210 * (1 - k) + 45 * k);
      return `rgb(${r},${g},${b})`;
    };
    water.addColorStop(0, col(0));
    water.addColorStop(0.5, col(this.range / 2));
    water.addColorStop(1, col(this.range));
    ctx.fillStyle = water;
    ctx.fillRect(0, SKY, w, h - SKY);

    // Light rays
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#ffffff';
    const tsec = s.clock;
    for (let i = 0; i < 5; i++) {
      const x = ((i * 97 + Math.sin(tsec / 7 + i) * 20) % w) + 20;
      ctx.beginPath();
      ctx.moveTo(x, SKY);
      ctx.lineTo(x + 30, SKY);
      ctx.lineTo(x - 40 + i * 12, this.depthToY(Math.min(25, this.range)));
      ctx.lineTo(x - 90 + i * 12, this.depthToY(Math.min(25, this.range)));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Surface line (waves)
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 6) {
      const y = SKY + Math.sin(x / 18 + tsec * 1.5) * 1.5;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Safety stop band
    if (this.safetyBand) {
      ctx.fillStyle = 'rgba(80, 220, 140, 0.13)';
      ctx.fillRect(0, this.depthToY(3), w, this.depthToY(6) - this.depthToY(3));
    }

    // Deco ceiling (forbidden zone above it) and next stop
    if (this.ceiling > 0) {
      const yc = this.depthToY(this.ceiling);
      ctx.fillStyle = 'rgba(255, 70, 60, 0.14)';
      ctx.fillRect(0, SKY, w, yc - SKY);
      ctx.strokeStyle = 'rgba(255, 90, 80, 0.9)';
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, yc);
      ctx.lineTo(w, yc);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 190, 180, 0.95)';
      ctx.font = '600 11px Inter, sans-serif';
      ctx.fillText(`ceiling ${depthLabel(this.ceiling)}`, w - 110, yc - 4);
    }

    // Seafloor
    const yb = this.depthToY(s.siteDepth);
    ctx.fillStyle = '#b89b6a';
    ctx.beginPath();
    ctx.moveTo(0, yb);
    for (let x = 0; x <= w; x += 20) ctx.lineTo(x, yb + Math.sin(x / 35) * 3 - 2);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7e6a48';
    for (let x = 30; x < w; x += 110) {
      ctx.beginPath();
      ctx.ellipse(x, yb + 2, 14, 7, 0, Math.PI, 0);
      ctx.fill();
    }

    // Depth scale
    ctx.font = '11px Inter, sans-serif';
    // Scale ticks in the display unit (5/10 m or 20/50 ft).
    const step = imperial() ? (this.range > 70 ? 50 : 20) : this.range > 70 ? 10 : 5;
    const perUnit = depthVal(1);
    for (let u = step; u / perUnit <= s.siteDepth; u += step) {
      const d = u / perUnit;
      const y = this.depthToY(d);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(34, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(`${u} ${depthUnit()}`, 4, y + 4);
    }

    // Hover indicator
    if (this.hoverDepth !== null && !this.dragging) {
      const y = this.depthToY(Math.min(this.hoverDepth, s.siteDepth));
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(34, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Target depth marker (none when the diver is driven by a vertical speed command)
    const yt = this.depthToY(s.targetDepth);
    const cx = w * 0.55;
    if (s.control === 'target') {
      ctx.strokeStyle = 'rgba(255, 230, 120, 0.9)';
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(cx - 90, yt);
      ctx.lineTo(cx + 90, yt);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 230, 120, 0.95)';
      ctx.font = '600 11px Inter, sans-serif';
      ctx.fillText(`▸ ${depthLabel(s.targetDepth)}`, cx + 94, yt + 4);
    }

    // Bubbles: exhaled every ~4 s of simulated time; they rise at ~15 m/min... faster in real time.
    this.bubbleTimer += simDt;
    if (s.depth > 0.5 && this.bubbleTimer > 4) {
      this.bubbleTimer = 0;
      for (let i = 0; i < 5; i++) {
        this.bubbles.push({ x: cx + 18 + Math.random() * 8, depth: s.depth - 0.3, r: 1.5 + Math.random() * 3, wobble: Math.random() * 6 });
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    for (const b of this.bubbles) {
      b.depth -= realDt * 4 + simDt * 0.02;
      b.wobble += realDt * 3;
      const y = this.depthToY(b.depth);
      ctx.beginPath();
      ctx.arc(b.x + Math.sin(b.wobble) * 3, y, b.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.bubbles = this.bubbles.filter((b) => b.depth > 0);

    // Diver
    this.finPhase += realDt * (2 + Math.abs(s.velocity) * 8);
    this.drawDiver(cx, this.depthToY(s.depth), s.velocity);
  }

  private drawDiver(x: number, y: number, v: number): void {
    const { ctx } = this;
    // Pitch the diver slightly head-down while descending, head-up while ascending.
    const tilt = Math.max(-0.5, Math.min(0.5, v * 1.2));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    // Fins
    const fin = Math.sin(this.finPhase) * 6;
    ctx.fillStyle = '#ffcc33';
    ctx.beginPath();
    ctx.moveTo(-38, -2);
    ctx.lineTo(-58, -8 + fin);
    ctx.lineTo(-58, 2 + fin);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-38, 3);
    ctx.lineTo(-58, 0 - fin);
    ctx.lineTo(-58, 10 - fin);
    ctx.closePath();
    ctx.fill();
    // Legs + body (wetsuit)
    ctx.fillStyle = '#1b2733';
    ctx.beginPath();
    ctx.roundRect(-40, -5, 30, 9, 4);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(-14, -8, 36, 15, 7);
    ctx.fill();
    // Tank
    ctx.fillStyle = '#c8ccd2';
    ctx.beginPath();
    ctx.roundRect(-12, -15, 30, 8, 4);
    ctx.fill();
    // Head + mask
    ctx.fillStyle = '#1b2733';
    ctx.beginPath();
    ctx.arc(27, -2, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7fe0ff';
    ctx.beginPath();
    ctx.roundRect(28, -6, 7, 5, 2);
    ctx.fill();
    // Arm + computer
    ctx.strokeStyle = '#1b2733';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(14, 3);
    ctx.lineTo(28, 9);
    ctx.stroke();
    ctx.fillStyle = '#ff6a3d';
    ctx.fillRect(24, 6, 5, 5);
    ctx.restore();
  }
}
