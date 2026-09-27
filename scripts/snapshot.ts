// Regression snapshots for refactoring: replays dive states on every computer (both unit systems,
// every display layout, every simulated button press) and records the computed view and the screen
// HTML. `npm run snapshot -- --save` stores the baseline in .snapshots/; `npm run snapshot` compares
// with it and lists the differences (one per state × computer is written to .snapshots/diff/);
// `npm run snapshot -- <id>` compares one computer only.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DiveSession } from '../src/engine/session';
import { createComputers, type DiveComputer } from '../src/computers';
import { setUnits } from '../src/units';

// Real time is frozen: blinking, time-outs and alternating pages depend on performance.now().
Object.defineProperty(globalThis.performance, 'now', { value: () => 1_000_000 });

const argv = (globalThis as { process?: { argv: string[]; exit: (c: number) => void } }).process!;
const save = argv.argv.includes('--save');
const only = argv.argv.find((a, i) => i > 1 && !a.startsWith('--'));
const DIR = '.snapshots';

type State = (s: DiveSession, c: DiveComputer, run: (sec: number) => void) => void;
const go = (s: DiveSession, run: (sec: number) => void, depth: number, sec: number) => {
  s.setTarget(depth);
  run(sec);
};
const follow = (s: DiveSession, c: DiveComputer, run: (sec: number) => void, until: (v: ReturnType<DiveComputer['compute']>) => boolean) => {
  for (let i = 0; i < 800; i++) {
    const v = c.compute(s);
    if (until(v)) return v;
    s.setTarget(v.inDeco ? v.stopDepth : 4.5);
    run(10);
  }
  return c.compute(s);
};
const deco: State = (s, _c, run) => go(s, run, 45, 60 * 30);
const safety: State = (s, _c, run) => go(s, run, 18, 60 * 12);

const STATES: Record<string, State> = {
  surfaceFresh: () => {},
  descent: (s, _c, run) => go(s, run, 30, 40),
  bottom30: (s, _c, run) => go(s, run, 30, 300),
  ndlLow: (s, _c, run) => go(s, run, 30, 60 * 17),
  decoDeep: deco,
  decoAtStop: (s, c, run) => { deco(s, c, run); follow(s, c, run, (v) => v.atStop); },
  decoAbove: (s, c, run) => { deco(s, c, run); const v = follow(s, c, run, (x) => x.atStop); go(s, run, Math.max(0.5, v.stopDepth - 1.5), 40); },
  fastAscent: (s, _c, run) => { go(s, run, 30, 300); s.ascentSpeed = 22; go(s, run, 0, 40); },
  safetyActive: (s, c, run) => { safety(s, c, run); go(s, run, 4.5, 150); },
  safetyPaused: (s, c, run) => { safety(s, c, run); go(s, run, 4.5, 60); go(s, run, 1.8, 30); },
  surfacing: (s, c, run) => { safety(s, c, run); go(s, run, 4.5, 400); go(s, run, 0, 90); },
  postDive: (s, c, run) => { safety(s, c, run); go(s, run, 4.5, 400); go(s, run, 0, 600); },
  locked: (s, c, run) => { deco(s, c, run); go(s, run, 0, 60 * 12); },
  lockedNextDive: (s, c, run) => { deco(s, c, run); go(s, run, 0, 60 * 12); go(s, run, 15, 120); },
  repetitive: (s, c, run) => { safety(s, c, run); go(s, run, 0, 3600); go(s, run, 20, 60 * 10); },
  halfTank: (s, c, run) => { safety(s, c, run); go(s, run, 4.5, 150); s.tankPressure = 100; run(2); },
  lowGas: (s, _c, run) => { go(s, run, 25, 300); s.tankPressure = 40; run(2); },
  modExceeded: (s, _c, run) => { s.gas = { o2: 0.4, he: 0 }; go(s, run, 35, 200); },
  highCns: (s, _c, run) => { s.gas = { o2: 0.32, he: 0 }; go(s, run, 30, 60 * 20); s.oxygen.cns = 80; run(2); },
  noTransmitter: (s, c, run) => { deco(s, c, run); s.transmitterOn = false; run(2); },
};

/** Rounds the numbers of a view so that the JSON is stable. */
const stable = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v));

const out: Record<string, string> = {};
let n = 0;
for (const name of Object.keys(STATES)) {
  for (const proto of createComputers()) {
    if (only && proto.id !== only) continue;
    for (const units of ['metric', 'imperial'] as const) {
      const ess = proto.settingDefs.find((d) => d.essential);
      for (const layout of ess ? ess.options.map((o) => o.value) : ['-']) {
        // Fresh session and computers for every case: nothing leaks from one case to the next.
        setUnits('metric');
        const s = new DiveSession();
        s.siteDepth = 80;
        s.descentSpeed = 20;
        s.ascentSpeed = 9;
        s.rmv = 12;
        const cs = createComputers();
        const c = cs.find((x) => x.id === proto.id)!;
        if (ess) c.settings[ess.key] = layout;
        s.on((e) => cs.forEach((x) => (e === 'start' ? x.onDiveStart(s) : x.onDiveEnd(s))));
        const run = (sec: number) => {
          for (let i = 0; i < sec; i++) {
            s.step(1);
            cs.forEach((x) => x.tick(s, 1));
          }
        };
        STATES[name](s, c, run);
        setUnits(units);
        const el = { innerHTML: '' } as HTMLElement;
        const shot = (step: string) => {
          const v = c.compute(s);
          s.reportedCeiling = v.ceiling;
          c.render(el, v, s, 'en');
          out[`${name} | ${c.id} | ${units} | ${layout} | ${step}`] = `${stable(v)}\n${el.innerHTML}`;
          n++;
        };
        shot('main');
        for (const [id, b] of Object.entries(c.buttons())) {
          if (b.press?.simulated) for (let k = 1; k <= 4; k++) { c.press(id, s); shot(`${id}×${k}`); }
          if (b.hold?.simulated) { c.hold(id, s); shot(`hold ${id}`); }
        }
      }
    }
  }
}

const hash = (t: string) => createHash('sha1').update(t).digest('hex');
mkdirSync(DIR, { recursive: true });
const file = `${DIR}/baseline.json`;
if (save) {
  if (only) {
    console.log('Save the baseline for every computer (no computer id).');
    argv.exit(1);
  }
  writeFileSync(file, JSON.stringify(out));
  console.log(`${n} snapshots saved to ${file}`);
} else {
  if (!existsSync(file)) {
    console.log('No baseline: run "npm run snapshot -- --save" first.');
    argv.exit(1);
  }
  const all: Record<string, string> = JSON.parse(readFileSync(file, 'utf8'));
  // With a computer id, only its cases are compared.
  const base = Object.fromEntries(Object.entries(all).filter(([k]) => !only || k.split(' | ')[1] === only));
  const keys = new Set([...Object.keys(base), ...Object.keys(out)]);
  const diff = [...keys].filter((k) => base[k] === undefined || out[k] === undefined || hash(base[k]) !== hash(out[k]));
  if (!diff.length) {
    console.log(`✓ ${n} snapshots identical`);
  } else {
    mkdirSync(`${DIR}/diff`, { recursive: true });
    // The first difference of each state × computer.
    const firsts = [...new Map(diff.map((k) => [k.split(' | ').slice(0, 2).join(' | '), k])).values()];
    firsts.forEach((k, i) => {
      writeFileSync(`${DIR}/diff/${i}-before.txt`, `${k}\n${base[k] ?? '(missing)'}`);
      writeFileSync(`${DIR}/diff/${i}-after.txt`, `${k}\n${out[k] ?? '(missing)'}`);
    });
    console.log(`✗ ${diff.length} of ${keys.size} snapshots differ (first ones in ${DIR}/diff/):`);
    // Grouped by state and computer, then the first keys in full.
    const groups = new Map<string, number>();
    for (const k of diff) { const g = k.split(' | ').slice(0, 2).join(' | '); groups.set(g, (groups.get(g) ?? 0) + 1); }
    groups.forEach((n, g) => console.log(`  ${String(n).padStart(4)}  ${g}`));
    diff.slice(0, 5).forEach((k) => console.log(`  ${k}`));
    argv.exit(1);
  }
}
