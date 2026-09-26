// Seven-segment LCD rendering (inline SVG) for monochrome dive computer screens.

const MAP: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc',
  '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '', ':': '', E: 'afged', r: 'eg', L: 'fed',
  P: 'abfge', o: 'cdeg', n: 'ceg', d: 'bcdeg', C: 'afed',
  // Letters for LCD words (SAFE, DIVE, DEC, AIR, STOP...).
  A: 'abcefg', S: 'afgcd', F: 'afge', I: 'ef', U: 'bcdef', t: 'fged', O: 'abcdef', H: 'bcefg', G: 'afedc',
};

const W = 56;
const H = 100;
const T = 11;
const GAP = 1.5;
const ADV = W + 16;

function hSeg(x1: number, x2: number, y: number): string {
  const h = T / 2;
  return `${x1},${y} ${x1 + h},${y - h} ${x2 - h},${y - h} ${x2},${y} ${x2 - h},${y + h} ${x1 + h},${y + h}`;
}

function vSeg(x: number, y1: number, y2: number): string {
  const h = T / 2;
  return `${x},${y1} ${x + h},${y1 + h} ${x + h},${y2 - h} ${x},${y2} ${x - h},${y2 - h} ${x - h},${y1 + h}`;
}

function segments(x0: number): Record<string, string> {
  const l = x0 + T / 2;
  const r = x0 + W - T / 2;
  const top = T / 2;
  const mid = H / 2;
  const bot = H - T / 2;
  return {
    a: hSeg(l + GAP, r - GAP, top),
    g: hSeg(l + GAP, r - GAP, mid),
    d: hSeg(l + GAP, r - GAP, bot),
    f: vSeg(l, top + GAP, mid - GAP),
    b: vSeg(r, top + GAP, mid - GAP),
    e: vSeg(l, mid + GAP, bot - GAP),
    c: vSeg(r, mid + GAP, bot - GAP),
  };
}

/**
 * Renders `text` as seven-segment digits. `cells` fixes the number of digit positions (right-aligned),
 * so unlit "ghost" segments appear like on a real LCD. Dots and colons don't take a cell.
 */
export function sevenSeg(text: string, cells: number, cls = ''): string {
  const glyphs: { ch: string; dot: boolean; colon: boolean }[] = [];
  for (const ch of text) {
    if (ch === '.' && glyphs.length) glyphs[glyphs.length - 1].dot = true;
    else if (ch === ':' && glyphs.length) glyphs[glyphs.length - 1].colon = true;
    else glyphs.push({ ch, dot: false, colon: false });
  }
  while (glyphs.length < cells) glyphs.unshift({ ch: ' ', dot: false, colon: false });

  let on = '';
  let ghost = '';
  glyphs.forEach((g, i) => {
    const x0 = i * ADV;
    const segs = segments(x0);
    const lit = MAP[g.ch] ?? '';
    for (const [name, pts] of Object.entries(segs)) {
      if (lit.includes(name)) on += `<polygon points="${pts}"/>`;
      else ghost += `<polygon points="${pts}"/>`;
    }
    const dx = x0 + W + 8;
    if (g.dot) on += `<circle cx="${dx}" cy="${H - 5}" r="5.5"/>`;
    if (g.colon) on += `<circle cx="${dx}" cy="${H * 0.3}" r="5"/><circle cx="${dx}" cy="${H * 0.7}" r="5"/>`;
  });
  const width = glyphs.length * ADV - 8;
  return `<svg class="seg ${cls}" viewBox="-6 -2 ${width + 12} ${H + 4}" preserveAspectRatio="xMidYMid meet">
    <g transform="skewX(-7) translate(8 0)"><g class="seg-ghost">${ghost}</g><g class="seg-on">${on}</g></g></svg>`;
}
