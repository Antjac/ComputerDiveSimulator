// Dev-only layout checker (see CLAUDE.md): finds text that overflows its box or the screen, overlaps
// other text, or is covered by an opaque element, on the active computer's screen. `sweep` runs it on
// every computer, layout setting, unit system and button-reachable screen for a set of dive states.
import type { DiveComputer } from '../computers';
import type { DiveSession } from '../engine/session';

export interface DevHook {
  session: DiveSession;
  computers: DiveComputer[];
  advance: (seconds: number, maxStep?: number) => void;
  refresh: (full?: boolean) => void;
  select: (id: string) => void;
}

type Box = { left: number; right: number; top: number; bottom: number };
interface Item { t: string; el: Element; rc: Box }

const SCREENS = '.pd-screen, .pt-screen, .qc-screen, .qa-lcd, .gn-screen, .g2-screen, .mr-lcd, .cg-lcd, .gm-screen, .su-screen, .ln-screen, .zn-lcd';
const ctx = document.createElement('canvas').getContext('2d')!;

/** Ink box of a text run: the line box shrunk to the glyphs actually drawn. */
function ink(el: Element, text: string, rc: DOMRect): Box {
  const cs = getComputedStyle(el);
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const m = ctx.measureText(text);
  const fa = m.fontBoundingBoxAscent;
  const k = rc.height / (fa + m.fontBoundingBoxDescent);
  if (!isFinite(k) || k <= 0 || m.width === 0) return rc;
  const kx = rc.width / m.width;
  return {
    left: rc.left - m.actualBoundingBoxLeft * kx,
    right: rc.left + m.actualBoundingBoxRight * kx,
    top: rc.top + (fa - m.actualBoundingBoxAscent) * k,
    bottom: rc.top + (fa + m.actualBoundingBoxDescent) * k,
  };
}

const opaque = (el: Element) => {
  const a = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
  if (!a) return false;
  const p = a[1].split(',').map(Number);
  return p.length < 4 || p[3] > 0.1;
};

const tag = (el: Element) => `<${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}">`;

/** Layout problems on the screen currently rendered in #device. */
export function checkLayout(): string[] {
  const scr = document.querySelector(`#device :is(${SCREENS})`);
  if (!scr) return ['no screen found'];
  const sr = scr.getBoundingClientRect();
  const round = scr.tagName.toLowerCase() === 'svg';
  const items: Item[] = [];
  const seen = new Set<Element>();
  const walker = document.createTreeWalker(scr, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode;
    const t = n.textContent?.trim() ?? '';
    const el = n.parentElement ?? (n.parentNode as Element | null);
    if (!t || !el || el.closest('[hidden]')) continue;
    if (el instanceof SVGElement) {
      const te = el.closest('text');
      if (!te || seen.has(te)) continue;
      seen.add(te);
      const rc = te.getBoundingClientRect();
      const rotated = (te.getAttribute('transform') ?? '').includes('rotate');
      if (rc.width > 0.5) items.push({ t: te.textContent!.trim(), el: te, rc: rotated ? rc : ink(te, te.textContent!, rc) });
      continue;
    }
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.opacity === '0') continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const rc of range.getClientRects()) if (rc.width > 0.5 && rc.height > 0.5) items.push({ t, el, rc: ink(el, n.textContent!, rc) });
  }

  const issues: string[] = [];
  const cx = sr.left + sr.width / 2;
  const cy = sr.top + sr.height / 2;
  const rad = Math.min(sr.width, sr.height) / 2;
  for (const { t, el, rc } of items) {
    if (round) {
      const corners = [[rc.left, rc.top], [rc.right, rc.top], [rc.left, rc.bottom], [rc.right, rc.bottom]];
      if (corners.some(([x, y]) => Math.hypot(x - cx, y - cy) > rad + 1)) issues.push(`outside round screen: "${t}"`);
      continue;
    }
    if (rc.left < sr.left - 1 || rc.right > sr.right + 1 || rc.top < sr.top - 1 || rc.bottom > sr.bottom + 1) issues.push(`outside screen: "${t}"`);
    for (let a: Element | null = el; a && a !== scr; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'inline' || cs.display === 'contents') continue;
      const ar = a.getBoundingClientRect();
      if (ar.width === 0 && ar.height === 0) continue;
      // Descenders (p, g, y) may hang below a tight line box: allow a fifth of the glyph height.
      const vt = Math.max(2, 0.2 * (rc.bottom - rc.top));
      if (rc.left < ar.left - 2 || rc.right > ar.right + 2 || rc.top < ar.top - vt || rc.bottom > ar.bottom + vt) {
        issues.push(`overflows ${tag(a)}: "${t}"`);
        break;
      }
    }
    // Blinking text may be hidden right now: skip the cover test.
    if (!el.closest('.blink')) {
      const hit = document.elementFromPoint((rc.left + rc.right) / 2, (rc.top + rc.bottom) / 2);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el) && scr.contains(hit) && opaque(hit)) issues.push(`covered by ${tag(hit)}: "${t}"`);
    }
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i].rc;
      const b = items[j].rc;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 1 && h > 1) issues.push(`overlap: "${items[i].t}" / "${items[j].t}"`);
    }
  }
  return issues;
}

/** Dive states reached from a reset; some depend on the computer (its own stops). */
export function diveStates(h: DevHook): Record<string, (c: DiveComputer) => void> {
  const s = h.session;
  const reset = () => {
    (document.getElementById('btn-reset') as HTMLButtonElement).click();
    s.siteDepth = 80;
    s.descentSpeed = 20;
    s.ascentSpeed = 9;
    s.gas = { o2: 0.21, he: 0 };
    s.transmitterOn = true;
    // Low enough for the long deco dives to end with gas left (an empty tank stops the simulation).
    s.rmv = 12;
  };
  const go = (depth: number, sec: number) => {
    s.setTarget(depth);
    h.advance(sec, 0.5);
  };
  const follow = (c: DiveComputer, until: (v: ReturnType<DiveComputer['compute']>) => boolean) => {
    for (let i = 0; i < 800; i++) {
      const v = c.compute(s);
      if (until(v)) return v;
      s.setTarget(v.inDeco ? v.stopDepth : 4.5);
      h.advance(10, 0.5);
    }
    return c.compute(s);
  };
  const deco = () => { reset(); go(45, 60 * 30); };
  const safety = () => { reset(); go(18, 60 * 12); };
  return {
    surfaceFresh: () => reset(),
    descent: () => { reset(); s.setTarget(30); h.advance(40, 0.5); },
    bottom30: () => { reset(); go(30, 300); },
    ndlLow: () => { reset(); go(30, 60 * 17); },
    ndl99: () => { reset(); go(6, 120); },
    decoDeep: () => deco(),
    decoApproach: (c) => { deco(); const v = c.compute(s); if (v.inDeco) go(v.stopDepth + 2.5, 400); },
    decoAtStop: (c) => { deco(); follow(c, (v) => v.atStop); },
    decoAbove: (c) => { deco(); const v = follow(c, (x) => x.atStop); go(Math.max(0.5, v.stopDepth - 1.5), 40); },
    fastAscent: () => { reset(); go(30, 300); s.ascentSpeed = 22; s.setTarget(0); h.advance(40, 0.5); },
    safetyActive: () => { safety(); go(4.5, 150); },
    safetyPaused: () => { safety(); go(4.5, 60); go(1.8, 30); },
    safetyDone: () => { safety(); go(4.5, 400); },
    surfacing: () => { safety(); go(4.5, 400); go(0, 90); },
    postDive: () => { safety(); go(4.5, 400); go(0, 600); },
    locked: () => { deco(); go(0, 60 * 12); },
    lockedNextDive: () => { deco(); go(0, 60 * 12); go(15, 120); },
    halfTank: () => { safety(); go(4.5, 150); s.tankPressure = 100; h.advance(2, 0.5); },
    lowGas: () => { reset(); go(25, 300); s.tankPressure = 40; h.advance(2, 0.5); },
    outOfGas: () => { reset(); go(25, 300); s.tankPressure = 0; h.advance(2, 0.5); },
    modExceeded: () => { reset(); s.gas = { o2: 0.4, he: 0 }; go(35, 200); },
    highCns: () => { reset(); s.gas = { o2: 0.4, he: 0 }; go(28, 60 * 60); },
    longDive: () => { reset(); s.rmv = 10; go(8, 60 * 125); },
    veryDeep: () => { reset(); go(66, 60 * 20); },
    noTransmitter: () => { deco(); s.transmitterOn = false; h.advance(2, 0.5); },
  };
}

function setUnits(u: 'metric' | 'imperial'): void {
  const sel = document.getElementById('units-select') as HTMLSelectElement;
  sel.value = u;
  sel.dispatchEvent(new Event('change'));
}

/**
 * Runs checkLayout on every computer (or `only`), display layout, unit system and screen reachable
 * with the simulated buttons (10 presses each, plus long presses), for the given states. Returns
 * "computer | issue" → where it was seen. Slow: run a few states per call.
 */
export function sweep(h: DevHook, stateNames: string[], only?: string): Record<string, string> {
  const states = diveStates(h);
  const found = new Map<string, Set<string>>();
  for (const name of stateNames) {
    for (const c of h.computers) {
      if (only && c.id !== only) continue;
      h.select(c.id);
      const timeout = c.screenTimeout;
      c.screenTimeout = 0;
      const saved = { ...c.settings };
      const ess = c.settingDefs.find((x) => x.essential);
      states[name](c);
      for (const units of ['metric', 'imperial'] as const) {
        setUnits(units);
        for (const layout of ess ? ess.options.map((o) => o.value) : [null]) {
          if (ess && layout) c.settings[ess.key] = layout;
          c.screen = 0;
          h.refresh(true);
          const add = (where: string) => {
            for (const issue of checkLayout()) {
              const key = `${c.id} | ${issue}`;
              if (!found.has(key)) found.set(key, new Set());
              found.get(key)!.add(`${name} ${units}${layout ? ' ' + layout : ''} ${where}`);
            }
          };
          add('main');
          for (const [id, b] of Object.entries(c.buttons())) {
            if (b.press?.simulated) for (let n = 1; n <= 10; n++) { c.press(id, h.session); h.refresh(); add(`${id}×${n}`); }
            if (b.hold?.simulated) { c.hold(id, h.session); h.refresh(); add(`hold ${id}`); }
          }
        }
      }
      Object.assign(c.settings, saved);
      c.screenTimeout = timeout;
    }
  }
  setUnits('metric');
  return Object.fromEntries([...found].map(([k, v]) => [k, [...v].slice(0, 3).join(', ') + (v.size > 3 ? ` (+${v.size - 3})` : '')]));
}

/** Puts one computer in a state / layout / unit system and presses buttons, then checks the screen. */
export function show(h: DevHook, state: string, id: string, opts: { layout?: string; units?: 'metric' | 'imperial'; presses?: string[] } = {}): string[] {
  const c = h.computers.find((x) => x.id === id)!;
  h.select(id);
  c.screenTimeout = 0;
  diveStates(h)[state](c);
  setUnits(opts.units ?? 'metric');
  const ess = c.settingDefs.find((x) => x.essential);
  if (ess && opts.layout) c.settings[ess.key] = opts.layout;
  c.screen = 0;
  h.refresh(true);
  for (const p of opts.presses ?? []) {
    if (p.startsWith('hold ')) c.hold(p.slice(5), h.session);
    else c.press(p, h.session);
  }
  h.refresh();
  return checkLayout();
}
