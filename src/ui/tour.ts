// Guided tour: the page is dimmed except for a spotlight on the element being explained, with a
// bubble next to it. The spotlight glides from one element to the next and follows it if the
// layout moves (sheet opening, resize). While the tour runs it takes the keyboard (← → Esc) so the
// simulation shortcuts don't fire, and blocks clicks on the page.

export interface TourStep {
  /** Elements to highlight (the spotlight covers all of them); none or all hidden → centred bubble. */
  targets?: () => (Element | null)[];
  title: () => string;
  body: () => string;
  /** Called before the step is shown (open a tab…). */
  before?: () => void;
  /** Skip the step when its targets are not visible in this layout (ex. profile hidden on tablets). */
  optional?: boolean;
}

export interface TourLabels {
  prev: string;
  next: string;
  done: string;
  close: string;
  /** "3 / 9" */
  counter: (i: number, n: number) => string;
}

const PAD = 6; // spotlight margin around the target
const GAP = 12; // spotlight ↔ bubble
const EDGE = 12; // bubble ↔ viewport edge

function visible(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement) || el.closest('[hidden]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

type Box = { l: number; t: number; r: number; b: number };

/** The part of el actually on screen: its box cut by every scrolling or clipping ancestor (the
 *  phone sheet), so the spotlight never covers content scrolled out of view. Null if none. */
function shownBox(el: HTMLElement): Box | null {
  const r = el.getBoundingClientRect();
  const box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const c = p.getBoundingClientRect();
    box.l = Math.max(box.l, c.left);
    box.t = Math.max(box.t, c.top);
    box.r = Math.min(box.r, c.right);
    box.b = Math.min(box.b, c.bottom);
  }
  return box.r > box.l && box.b > box.t ? box : null;
}

export class Tour {
  private root: HTMLElement | null = null;
  private hole!: HTMLElement;
  private bubble!: HTMLElement;
  private steps: TourStep[] = [];
  private i = 0;
  private raf = 0;
  private last = '';
  private onEnd: () => void = () => {};

  constructor(private labels: () => TourLabels) {}

  get running(): boolean {
    return this.root !== null;
  }

  start(steps: TourStep[], onEnd: () => void): void {
    if (this.root) return;
    this.steps = steps;
    this.onEnd = onEnd;
    this.root = document.createElement('div');
    this.root.className = 'tour';
    this.root.innerHTML = `<div class="tour-hole"></div>
      <div class="tour-bubble" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body"></div>`;
    this.hole = this.root.querySelector('.tour-hole')!;
    this.bubble = this.root.querySelector('.tour-bubble')!;
    this.bubble.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-tour]')?.dataset.tour;
      if (act === 'prev') this.go(this.i - 1, -1);
      else if (act === 'next') this.go(this.i + 1, 1);
      else if (act === 'close') this.end();
    });
    document.body.append(this.root);
    window.addEventListener('keydown', this.onKey, true);
    this.go(0, 1);
    this.raf = requestAnimationFrame(this.follow);
  }

  end(): void {
    if (!this.root) return;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey, true);
    this.root.remove();
    this.root = null;
    this.last = '';
    this.onEnd();
  }

  /** Show step i, skipping optional steps with nothing visible in direction dir. */
  private go(i: number, dir: 1 | -1): void {
    while (i >= 0 && i < this.steps.length) {
      const s = this.steps[i];
      s.before?.();
      if (!s.optional || this.targets(s).length) break;
      i += dir;
    }
    if (i >= this.steps.length) return this.end();
    if (i < 0) return;
    this.i = i;
    this.renderBubble();
    // Last target first: when they don't all fit (small phone sheet), the first one stays in view.
    for (const el of this.targets(this.steps[i]).reverse()) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.last = '';
    this.place();
  }

  private targets(s: TourStep): HTMLElement[] {
    return (s.targets?.() ?? []).filter(visible);
  }

  private renderBubble(): void {
    const L = this.labels();
    const s = this.steps[this.i];
    // Count only the steps shown in this layout.
    const shown = this.steps.filter((x) => !x.optional || this.targets(x).length);
    const n = shown.length;
    const lastStep = this.i === this.steps.length - 1;
    this.bubble.innerHTML = `
      <button class="tour-x" data-tour="close" aria-label="${L.close}" title="${L.close}">✕</button>
      <h2 id="tour-title">${s.title()}</h2>
      <div id="tour-body" class="tour-body">${s.body()}</div>
      <div class="tour-nav">
        <span class="tour-count">${L.counter(shown.indexOf(s) + 1, n)}</span>
        <button class="btn" data-tour="prev" ${this.i === 0 ? 'disabled' : ''}>← ${L.prev}</button>
        <button class="btn primary" data-tour="${lastStep ? 'close' : 'next'}">${lastStep ? L.done : `${L.next} →`}</button>
      </div>`;
    this.bubble.querySelector<HTMLElement>('.btn.primary')!.focus();
  }

  // The layout can move under the spotlight (sheet opening, device re-render, resize): follow it.
  private follow = (): void => {
    this.place();
    this.raf = requestAnimationFrame(this.follow);
  };

  private place(): void {
    if (!this.root) return;
    const els = this.targets(this.steps[this.i]);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let box: Box | null = null;
    for (const el of els) {
      const r = shownBox(el);
      if (!r) continue;
      box = box ? { l: Math.min(box.l, r.l), t: Math.min(box.t, r.t), r: Math.max(box.r, r.r), b: Math.max(box.b, r.b) } : r;
    }
    if (box) box = { l: Math.max(2, box.l - PAD), t: Math.max(2, box.t - PAD), r: Math.min(vw - 2, box.r + PAD), b: Math.min(vh - 2, box.b + PAD) };
    const bw = this.bubble.offsetWidth;
    const bh = this.bubble.offsetHeight;
    const key = box ? `${box.l | 0},${box.t | 0},${box.r | 0},${box.b | 0},${bw},${bh},${vw},${vh}` : `c,${bw},${bh},${vw},${vh}`;
    if (key === this.last) return;
    this.last = key;

    const hs = this.hole.style;
    if (!box) {
      // No target: the spotlight shrinks to nothing in the middle, the whole page is dimmed.
      Object.assign(hs, { left: `${vw / 2}px`, top: `${vh / 2}px`, width: '0px', height: '0px' });
      this.hole.classList.add('empty');
      this.moveBubble((vw - bw) / 2, (vh - bh) / 2);
      return;
    }
    this.hole.classList.remove('empty');
    Object.assign(hs, { left: `${box.l}px`, top: `${box.t}px`, width: `${box.r - box.l}px`, height: `${box.b - box.t}px` });

    // Bubble: below, above, right, left of the spotlight, whichever fits first; otherwise over the
    // spotlight, at the bottom of the screen (large targets on phones).
    const cx = (box.l + box.r) / 2 - bw / 2;
    const cy = (box.t + box.b) / 2 - bh / 2;
    const spots: [number, number, boolean][] = [
      [cx, box.b + GAP, box.b + GAP + bh <= vh - EDGE],
      [cx, box.t - GAP - bh, box.t - GAP - bh >= EDGE],
      [box.r + GAP, cy, box.r + GAP + bw <= vw - EDGE],
      [box.l - GAP - bw, cy, box.l - GAP - bw >= EDGE],
    ];
    const [x, y] = spots.find((s) => s[2]) ?? [(vw - bw) / 2, vh - bh - EDGE];
    this.moveBubble(x, y);
  }

  private moveBubble(x: number, y: number): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bs = this.bubble.style;
    bs.left = `${Math.max(EDGE, Math.min(x, vw - this.bubble.offsetWidth - EDGE))}px`;
    bs.top = `${Math.max(EDGE, Math.min(y, vh - this.bubble.offsetHeight - EDGE))}px`;
  }

  // Capture phase: runs before the simulation shortcuts (arrows, space, +/−) and stops them.
  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Tab') {
      // Keep the focus in the bubble.
      const btns = [...this.bubble.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const k = btns.indexOf(document.activeElement as HTMLButtonElement);
      btns[(k + (e.shiftKey ? -1 : 1) + btns.length) % btns.length]?.focus();
    } else if (e.key === 'Escape') this.end();
    else if (e.key === 'ArrowRight') this.go(this.i + 1, 1);
    else if (e.key === 'ArrowLeft') this.go(this.i - 1, -1);
    else if (e.key === 'Enter' || e.key === ' ') {
      const f = document.activeElement;
      if (f instanceof HTMLButtonElement && this.bubble.contains(f)) f.click();
    } else if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) return; // browser shortcuts
    e.preventDefault();
    e.stopImmediatePropagation();
  };
}
